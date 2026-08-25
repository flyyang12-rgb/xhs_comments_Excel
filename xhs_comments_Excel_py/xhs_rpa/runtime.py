from __future__ import annotations

import json
import logging
import random
import time
from pathlib import Path
from typing import Any, Callable

from .settings import CACHE_DIR, LOG_DIR, OUTPUT_DIR, RUNTIME_DIR


def ensure_runtime_dirs() -> None:
    for path in (RUNTIME_DIR, CACHE_DIR, LOG_DIR, OUTPUT_DIR):
        path.mkdir(parents=True, exist_ok=True)


def configure_logging() -> logging.Logger:
    ensure_runtime_dirs()
    logger = logging.getLogger("xhs_rpa")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
        file_handler = logging.FileHandler(LOG_DIR / "collector.log", encoding="utf-8")
        file_handler.setFormatter(formatter)
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        logger.addHandler(stream_handler)
    return logger


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def random_sleep(min_seconds: float, max_seconds: float, logger=None, label: str = "等待") -> None:
    seconds = random.uniform(min_seconds, max_seconds)
    if logger:
        logger.info("%s %.1f 秒", label, seconds)
    time.sleep(seconds)


class RiskControlStop(RuntimeError):
    pass


def is_risk_error(message: str) -> bool:
    lowered = str(message or "").lower()
    markers = ("461", "captcha", "验证码", "安全限制", "风控", "频繁操作")
    return any(marker in lowered for marker in markers)


def call_with_retries(
    operation: Callable[[], Any],
    *,
    attempts: int,
    logger,
    label: str,
    base_delay: float = 2,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as error:  # noqa: BLE001 - 统一记录第三方接口异常
            if is_risk_error(str(error)):
                raise RiskControlStop(str(error)) from error
            last_error = error
            logger.warning("%s失败（%s/%s）：%s", label, attempt, attempts, error)
            if attempt < attempts:
                time.sleep(base_delay * attempt)
    raise RuntimeError(f"{label}连续失败：{last_error}") from last_error

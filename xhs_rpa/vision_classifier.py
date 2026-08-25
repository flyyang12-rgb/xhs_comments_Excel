from __future__ import annotations

import base64
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from PIL import Image, ImageOps

from .models import Candidate
from .runtime import call_with_retries, load_json, random_sleep, save_json
from .settings import (
    CACHE_DIR,
    QWEN_VL_API_KEY,
    QWEN_VL_BASE_URL,
    QWEN_VL_MODEL,
    VISION_NEGATIVE_EXAMPLE,
    VISION_POSITIVE_EXAMPLE,
)


VISION_CACHE = CACHE_DIR / "vision_results.json"
COVER_DIR = CACHE_DIR / "covers"
VISION_PROMPT_VERSION = "2026-08-17-large-cape-binary-v3-reference-images"

VISION_PROMPT = """你是儿童大披肩防晒帽封面审核助手。前两张图片分别是用户指定的反例和正例，第三张才是待判断的笔记封面。必须以用户示例为定义基准，不做OCR，也不要根据标题或常识猜测。

保留标准：帽子的结构从前檐延伸到头部两侧及后方，并在侧面/后方明显向下垂落。必须能看到一块实体帽檐或布料垂到耳朵下沿附近、后脑下部或后颈，形成明显的侧后方遮挡。它可以是单独缝制的披肩布，也可以是一体式连续大帽檐；平铺图和佩戴图都可判断。

关键反例：帽檐很宽、很长或绕到侧面，并不自动算“大披肩”。如果只是前檐突出，耳朵与后颈仍完整露出，必须剔除。

必须剔除：只有前方大帽檐的棒球帽/空顶帽；普通渔夫帽或普通宽檐帽但侧后方没有垂到耳朵下沿或后颈的实体遮挡；成人帽、非帽子、无关内容；画面过远、模糊、遮挡，或无法明确看清侧后结构。任何不确定情况一律剔除，不存在“待复核”。

只返回JSON对象：{"decision":"保留或剔除","reason":"不超过30字"}。"""


def parse_vision_decision(value: dict) -> bool:
    return str(value.get("decision") or "").strip() == "保留"


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _vision_cache_key(image_hash: str) -> str:
    value = f"{QWEN_VL_MODEL}\n{VISION_PROMPT_VERSION}\n{image_hash}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _image_content(path: Path) -> dict:
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{encoded}"}}


class VisionClassifier:
    def __init__(self, config: dict, logger):
        self.config = config
        self.logger = logger

    def _download_cover(self, candidate: Candidate) -> Path:
        if not candidate.cover_url:
            raise ValueError("封面地址为空")
        COVER_DIR.mkdir(parents=True, exist_ok=True)
        output = COVER_DIR / f"{candidate.note_id}.jpg"
        if output.exists() and output.stat().st_size > 0:
            return output

        response = requests.get(
            candidate.cover_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
                "Referer": "https://www.xiaohongshu.com/",
            },
            timeout=float(self.config["vision"].get("download_timeout_seconds", 45)),
        )
        response.raise_for_status()
        if len(response.content) > 15 * 1024 * 1024:
            raise ValueError("封面文件超过15MB")
        with Image.open(io.BytesIO(response.content)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            image.save(output, "JPEG", quality=82, optimize=True)
        return output

    def _request(self, candidate: Candidate, path: Path) -> tuple[bool, str]:
        from openai import OpenAI

        if not QWEN_VL_API_KEY:
            raise RuntimeError("缺少 QWEN_VL_API_KEY：请复制 .env.example 为 .env 并填写密钥")

        client = OpenAI(
            api_key=QWEN_VL_API_KEY,
            base_url=QWEN_VL_BASE_URL,
            timeout=float(self.config["vision"].get("request_timeout_seconds", 120)),
        )
        response = client.chat.completions.create(
            model=QWEN_VL_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "用户指定反例：只有前檐突出，不是大披肩帽，必须剔除。"},
                        _image_content(VISION_NEGATIVE_EXAMPLE),
                        {"type": "text", "text": "用户指定正例：侧面和后方大幅下垂遮挡，属于大披肩帽，必须保留。"},
                        _image_content(VISION_POSITIVE_EXAMPLE),
                        {"type": "text", "text": "以下是待判断封面："},
                        _image_content(path),
                        {"type": "text", "text": VISION_PROMPT},
                    ],
                }
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=200,
        )
        content = (response.choices[0].message.content or "").strip()
        if content.startswith("```"):
            content = content.strip("`").removeprefix("json").strip()
        parsed = json.loads(content)
        kept = parse_vision_decision(parsed)
        reason = str(parsed.get("reason") or "").strip()[:100]
        return kept, reason

    def classify(self, candidates: list[Candidate]) -> set[str]:
        cache = load_json(VISION_CACHE, {})
        retained: set[str] = set()
        pending: list[tuple[Candidate, Path, str]] = []
        failures = 0
        retries = max(1, int(self.config["vision"].get("max_retries", 3)))
        throttle = self.config["throttle"]

        for index, candidate in enumerate(candidates, 1):
            cached_cover = COVER_DIR / f"{candidate.note_id}.jpg"
            cover_was_cached = cached_cover.exists() and cached_cover.stat().st_size > 0
            try:
                path = call_with_retries(
                    lambda item=candidate: self._download_cover(item),
                    attempts=retries,
                    logger=self.logger,
                    label=f"下载封面 {candidate.note_id}",
                )
                image_hash = _file_sha256(path)
                cache_key = _vision_cache_key(image_hash)
                cached = cache.get(candidate.note_id) or {}
                if cached.get("cache_key") == cache_key:
                    if cached.get("kept") is True:
                        retained.add(candidate.note_id)
                    continue
                pending.append((candidate, path, cache_key))
            except Exception as error:  # 封面失败按已确认规则直接剔除
                failures += 1
                self.logger.warning("封面无法用于判断，剔除 %s：%s", candidate.note_id, error)
            if index < len(candidates) and not cover_was_cached:
                random_sleep(
                    float(throttle.get("cover_min_seconds", 1.5)),
                    float(throttle.get("cover_max_seconds", 3.0)),
                    self.logger,
                    "封面下载间隔",
                )

        workers = min(3, max(1, int(self.config["vision"].get("max_concurrency", 3))))
        self.logger.info(
            "封面视觉判断：缓存命中 %s，待请求 %s，下载失败 %s",
            len(candidates) - len(pending) - failures,
            len(pending),
            failures,
        )
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    call_with_retries,
                    lambda item=candidate, image_path=path: self._request(item, image_path),
                    attempts=retries,
                    logger=self.logger,
                    label=f"视觉判断 {candidate.note_id}",
                    base_delay=3,
                ): (candidate, cache_key)
                for candidate, path, cache_key in pending
            }
            for future in as_completed(futures):
                candidate, cache_key = futures[future]
                try:
                    kept, reason = future.result()
                except Exception as error:  # 三次失败后按规则剔除，但不缓存瞬时失败
                    failures += 1
                    self.logger.warning("视觉判断失败，剔除 %s：%s", candidate.note_id, error)
                    continue
                cache[candidate.note_id] = {
                    "cache_key": cache_key,
                    "kept": kept,
                    "reason": reason,
                }
                if kept:
                    retained.add(candidate.note_id)
                save_json(VISION_CACHE, cache)

        self.logger.info("封面视觉判断完成：保留 %s，剔除/失败 %s", len(retained), len(candidates) - len(retained))
        return retained


def cleanup_cover_cache(logger) -> tuple[int, int]:
    if not COVER_DIR.exists():
        return 0, 0
    files = [path for path in COVER_DIR.rglob("*") if path.is_file()]
    size = sum(path.stat().st_size for path in files)
    for path in files:
        path.unlink()
    for directory in sorted((path for path in COVER_DIR.rglob("*") if path.is_dir()), reverse=True):
        directory.rmdir()
    COVER_DIR.rmdir()
    logger.info("已清理封面临时缓存：%s 个文件，释放 %.2f MB", len(files), size / 1024 / 1024)
    return len(files), size

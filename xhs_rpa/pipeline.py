from __future__ import annotations

from datetime import date

import yaml

from .ai_classifier import DeepSeekClassifier
from .collector import SpiderXHSCollector
from .excel_exporter import export_results, verify_workbooks
from .models import Candidate
from .normalization import is_within_months, normalize_date
from .runtime import configure_logging, ensure_runtime_dirs
from .settings import CONFIG_PATH
from .vision_classifier import VisionClassifier, cleanup_cover_cache


def filter_candidates_before_cover(
    candidates: list[Candidate],
    *,
    min_publish_date: str,
    positive_months: int,
    today: date | None = None,
) -> list[Candidate]:
    minimum = normalize_date(min_publish_date)
    if not minimum:
        raise ValueError(f"最早发布日期配置无效：{min_publish_date}")
    kept: list[Candidate] = []
    for candidate in candidates:
        published = normalize_date(candidate.published_at)
        if not published or not candidate.title or not candidate.canonical_url or not candidate.cover_url:
            continue
        eligible_modes: list[str] = []
        if "negative" in candidate.modes and published >= minimum:
            eligible_modes.append("negative")
        if "positive" in candidate.modes and is_within_months(published, positive_months, today):
            eligible_modes.append("positive")
        if eligible_modes:
            candidate.modes = eligible_modes
            kept.append(candidate)
    return kept


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    for section in ("task", "keywords", "analysis_terms", "throttle", "ai", "vision"):
        if section not in config:
            raise ValueError(f"配置文件缺少 {section} 部分")
    for section in ("keywords", "analysis_terms"):
        for label in ("negative", "positive"):
            values = config[section].get(label)
            if not isinstance(values, list) or not any(str(value).strip() for value in values):
                raise ValueError(f"配置文件 {section}.{label} 必须是非空列表")
            config[section][label] = list(
                dict.fromkeys(str(value).strip() for value in values if str(value).strip())
            )
    return config


def run() -> dict:
    ensure_runtime_dirs()
    logger = configure_logging()
    config = load_config()
    logger.info("开始执行儿童大披肩防晒帽小红书舆情采集")

    collector = SpiderXHSCollector(config, logger)
    candidates = collector.collect(
        config["keywords"]["negative"],
        config["keywords"]["positive"],
    )
    if not candidates:
        logger.warning("本次无可分析的笔记候选")

    candidates = filter_candidates_before_cover(
        candidates,
        min_publish_date=str(config["task"].get("min_publish_date", "2024-01-01")),
        positive_months=int(config["task"]["positive_months"]),
    )
    logger.info("日期和基础字段预筛后剩余 %s 条，开始处理首张封面", len(candidates))

    vision = VisionClassifier(config, logger)
    visually_retained = vision.classify(candidates)
    candidates = [candidate for candidate in candidates if candidate.note_id in visually_retained]
    logger.info("封面帽型筛选后剩余 %s 条，开始文字舆情判断", len(candidates))

    classifier = DeepSeekClassifier(config, logger)
    analyses = classifier.classify(candidates)
    if len(analyses) != len(candidates):
        raise RuntimeError("AI 判断结果不完整，正式 Excel 未生成")

    negative_count, positive_count = export_results(
        candidates,
        analyses,
        int(config["task"]["positive_months"]),
        logger,
        min_publish_date=str(config["task"].get("min_publish_date", "2024-01-01")),
    )
    verify_workbooks(negative_count, positive_count)
    cleanup_cover_cache(logger)
    cost = classifier.estimated_cost_cny()
    logger.info(
        "任务完成：差评 %s 条，好评 %s 条；本次 AI 估算费用 ¥%.4f",
        negative_count,
        positive_count,
        cost,
    )
    if negative_count == 0 and positive_count == 0:
        logger.warning("本次无新增有效笔记")
    return {
        "negative_count": negative_count,
        "positive_count": positive_count,
        "ai_cost_cny": cost,
    }

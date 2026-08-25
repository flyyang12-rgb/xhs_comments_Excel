from __future__ import annotations

import sys
from collections import OrderedDict
from pathlib import Path
from typing import Iterable

from .models import Candidate
from .normalization import canonical_note_url, normalize_count, normalize_date, safe_text
from .runtime import RiskControlStop, call_with_retries, load_json, random_sleep, save_json
from .settings import CACHE_DIR, VENDOR_ROOT


COLLECTION_CACHE = CACHE_DIR / "collection_state_large_cape_v3.json"


def _cover_url_from_detail(detail: dict) -> str:
    video_cover = str(detail.get("video_cover") or "").strip()
    if video_cover:
        return video_cover
    image_list = detail.get("image_list") or []
    return str(image_list[0] or "").strip() if image_list else ""


def _round_robin_unique(buckets: list[list[Candidate]], limit: int) -> list[Candidate]:
    selected: OrderedDict[str, Candidate] = OrderedDict()
    depth = 0
    while len(selected) < limit:
        progressed = False
        for bucket in buckets:
            if depth >= len(bucket):
                continue
            progressed = True
            item = bucket[depth]
            if item.note_id not in selected:
                selected[item.note_id] = item
                if len(selected) >= limit:
                    break
        if not progressed:
            break
        depth += 1
    return list(selected.values())


class SpiderXHSCollector:
    def __init__(self, config: dict, logger):
        self.config = config
        self.logger = logger
        self.api = None

    def _load_upstream(self):
        vendor = str(VENDOR_ROOT)
        if vendor not in sys.path:
            sys.path.insert(0, vendor)
        from apis.xhs_pc_apis import XHS_Apis
        from xhs_utils.data_util import handle_note_info
        from xhs_utils.xhs_pc import XHSPcAuth

        return XHS_Apis, XHSPcAuth, handle_note_info

    def login(self) -> None:
        XHS_Apis, XHSPcAuth, _ = self._load_upstream()
        self.logger.info("请使用小红书 App 扫描终端中的二维码")
        auth = XHSPcAuth.from_qrcode_login(show_in_terminal=True)
        self.api = XHS_Apis(auth)
        success, message, result = self.api.get_user_me()
        if not success:
            raise RuntimeError(f"登录验证失败：{message}")
        user_id = ((result or {}).get("data") or {}).get("user_id") or ""
        if not user_id:
            raise RuntimeError("登录验证失败：接口未返回 user_id")
        auth.set_user_id(user_id)
        self.logger.info("小红书登录成功")

    @staticmethod
    def _candidate_from_search_item(item: dict, mode: str, keyword: str) -> Candidate | None:
        if item.get("model_type") != "note":
            return None
        note_id = str(item.get("id") or "").strip()
        token = str(item.get("xsec_token") or "").strip()
        if not note_id or not token:
            return None
        card = item.get("note_card") or {}
        request_url = (
            f"https://www.xiaohongshu.com/explore/{note_id}"
            f"?xsec_token={token}&xsec_source=pc_search"
        )
        return Candidate(
            note_id=note_id,
            request_url=request_url,
            canonical_url=canonical_note_url(note_id),
            title=safe_text(card.get("display_title") or card.get("title"), 500),
            modes=[mode],
            keywords=[keyword],
        )

    def _search_keyword(self, keyword: str, mode: str, limit: int) -> list[Candidate]:
        throttle = self.config["throttle"]
        candidates = []
        seen = set()
        from xhs_utils.xhs_pc.params import generate_search_id

        search_id = generate_search_id()
        page = 1
        while len(candidates) < limit and page <= 10:
            def operation():
                success, message, response = self.api.search_note(
                    keyword,
                    page=page,
                    sort_type_choice=0,
                    note_type=0,
                    note_time=0,
                    search_id=search_id,
                )
                if not success:
                    raise RuntimeError(message)
                return response or {}

            response = call_with_retries(
                operation,
                attempts=3,
                logger=self.logger,
                label=f"搜索关键词“{keyword}”第 {page} 页",
            )
            data = response.get("data") or {}
            items = data.get("items") or []
            for item in items:
                candidate = self._candidate_from_search_item(item, mode, keyword)
                if candidate and candidate.note_id not in seen:
                    candidates.append(candidate)
                    seen.add(candidate.note_id)
                    if len(candidates) >= limit:
                        break
            if not data.get("has_more") or not items or len(candidates) >= limit:
                break
            page += 1
            random_sleep(
                throttle["search_page_min_seconds"],
                throttle["search_page_max_seconds"],
                self.logger,
                "搜索翻页间隔",
            )
        self.logger.info("关键词“%s”获得 %s 条笔记候选", keyword, len(candidates))
        random_sleep(
            throttle["keyword_min_seconds"],
            throttle["keyword_max_seconds"],
            self.logger,
            "关键词间隔",
        )
        return candidates

    def _collect_search_candidates(
        self,
        negative_keywords: Iterable[str],
        positive_keywords: Iterable[str],
    ) -> list[Candidate]:
        task = self.config["task"]
        fallback = int(task.get("per_keyword_limit", 30))
        negative_per_keyword = int(task.get("negative_per_keyword_limit", fallback))
        positive_per_keyword = int(task.get("positive_per_keyword_limit", fallback))
        negative_buckets = [
            self._search_keyword(word, "negative", negative_per_keyword) for word in negative_keywords
        ]
        positive_buckets = [
            self._search_keyword(word, "positive", positive_per_keyword)
            for word in positive_keywords
        ]
        negative = _round_robin_unique(
            negative_buckets,
            int(self.config["task"]["negative_candidate_limit"]),
        )
        positive = _round_robin_unique(
            positive_buckets,
            int(self.config["task"]["positive_candidate_limit"]),
        )

        merged: OrderedDict[str, Candidate] = OrderedDict()
        for item in [*negative, *positive]:
            existing = merged.get(item.note_id)
            if not existing:
                merged[item.note_id] = item
                continue
            existing.modes = sorted(set(existing.modes + item.modes))
            existing.keywords = list(dict.fromkeys(existing.keywords + item.keywords))
            if "xsec_token=" not in existing.request_url and "xsec_token=" in item.request_url:
                existing.request_url = item.request_url
        self.logger.info(
            "候选汇总：差评候选 %s 条，好评候选 %s 条，跨模式去重后 %s 条",
            len(negative),
            len(positive),
            len(merged),
        )
        return list(merged.values())

    def _fetch_detail(self, candidate: Candidate) -> Candidate:
        _, _, handle_note_info = self._load_upstream()

        def operation():
            success, message, response = self.api.get_note_info(candidate.request_url)
            if not success:
                raise RuntimeError(message)
            item = ((response or {}).get("data") or {}).get("items") or []
            if not item:
                raise RuntimeError("详情接口未返回笔记内容")
            raw = item[0]
            raw["url"] = candidate.request_url
            return handle_note_info(raw)

        detail = call_with_retries(
            operation,
            attempts=3,
            logger=self.logger,
            label=f"读取笔记详情 {candidate.note_id}",
        )
        candidate.title = safe_text(detail.get("title") or candidate.title, 500)
        candidate.description = safe_text(detail.get("desc"), 6000)
        candidate.tags = [safe_text(value, 100) for value in (detail.get("tags") or []) if value]
        candidate.author = safe_text(detail.get("nickname"), 200)
        candidate.published_at = normalize_date(detail.get("upload_time"))
        candidate.liked_count = normalize_count(detail.get("liked_count"))
        candidate.collected_count = normalize_count(detail.get("collected_count"))
        candidate.comment_count = normalize_count(detail.get("comment_count"))
        candidate.cover_url = _cover_url_from_detail(detail)
        return candidate

    def collect(self, negative_keywords: list[str], positive_keywords: list[str]) -> list[Candidate]:
        cached = load_json(COLLECTION_CACHE, {})
        if cached.get("complete") and cached.get("items"):
            self.logger.info("检测到完整采集断点，跳过小红书请求，继续后续处理")
            return [Candidate.from_dict(item) for item in cached["items"]]

        self.login()
        cached_candidates = cached.get("candidates") or []
        if cached_candidates:
            candidates = [Candidate.from_dict(item) for item in cached_candidates]
            self.logger.info("检测到候选列表断点，跳过关键词搜索，共 %s 条", len(candidates))
        else:
            candidates = self._collect_search_candidates(negative_keywords, positive_keywords)
            save_json(
                COLLECTION_CACHE,
                {"complete": False, "candidates": [item.to_dict() for item in candidates], "items": [], "failed": []},
            )
        completed_by_id = {
            item.note_id: item for item in (Candidate.from_dict(value) for value in (cached.get("items") or []))
        }
        completed: list[Candidate] = list(completed_by_id.values())
        failed: list[dict] = []
        throttle = self.config["throttle"]
        newly_processed = 0
        for index, candidate in enumerate(candidates, 1):
            if candidate.note_id in completed_by_id:
                continue
            self.logger.info("读取笔记详情 %s/%s：%s", index, len(candidates), candidate.note_id)
            try:
                detailed = self._fetch_detail(candidate)
                completed.append(detailed)
                completed_by_id[detailed.note_id] = detailed
            except RiskControlStop:
                save_json(
                    COLLECTION_CACHE,
                    {"complete": False, "candidates": [item.to_dict() for item in candidates], "items": [item.to_dict() for item in completed], "failed": failed},
                )
                raise
            except Exception as error:  # noqa: BLE001 - 按需求记录失败并继续
                failed.append({"note_id": candidate.note_id, "url": candidate.canonical_url, "error": str(error)})
                self.logger.error("笔记 %s 详情读取失败，跳过：%s", candidate.note_id, error)
            save_json(
                COLLECTION_CACHE,
                {"complete": False, "candidates": [item.to_dict() for item in candidates], "items": [item.to_dict() for item in completed], "failed": failed},
            )
            newly_processed += 1
            rest_every = max(1, int(throttle.get("long_rest_every_notes", 80)))
            if newly_processed % rest_every == 0 and index < len(candidates):
                random_sleep(
                    throttle.get("long_rest_min_seconds", 180),
                    throttle.get("long_rest_max_seconds", 300),
                    self.logger,
                    "阶段性长休息",
                )
            if index < len(candidates):
                random_sleep(
                    throttle["detail_min_seconds"],
                    throttle["detail_max_seconds"],
                    self.logger,
                    "详情请求间隔",
                )

        save_json(
            COLLECTION_CACHE,
            {"complete": True, "candidates": [item.to_dict() for item in candidates], "items": [item.to_dict() for item in completed], "failed": failed},
        )
        self.logger.info("详情采集完成：成功 %s，失败 %s", len(completed), len(failed))
        return completed

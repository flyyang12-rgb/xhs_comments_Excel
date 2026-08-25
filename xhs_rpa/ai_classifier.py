from __future__ import annotations

import hashlib
import json
from dataclasses import asdict

from .models import Analysis, Candidate
from .normalization import safe_text
from .runtime import call_with_retries, load_json, save_json
from .settings import (
    CACHE_DIR,
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
)


AI_CACHE = CACHE_DIR / "ai_results_large_cape_v4.json"
PROMPT_VERSION = "2026-08-25-positive-negative-v4"

SYSTEM_PROMPT_TEMPLATE = """你是儿童大披肩防晒帽商品信息与舆情识别助手。输入笔记已经通过封面帽型审核；你只依据用户提供的标题、正文、标签、作者和搜索来源判断文字内容，不得猜测原文没有的信息，也不能因为搜索关键词而直接认定相关或好评/差评。

目标文字内容必须明确涉及儿童、宝宝、婴幼儿或给孩子使用的防晒/遮阳帽。成人帽、非帽子、无关内容均剔除。

请按以下顺序判断：
第一阶段——品类相关性：
1. relevance_status 只能是“保留”或“剔除”。明确涉及儿童防晒/遮阳帽时为“保留”；不明确或无关时一律“剔除”，不存在“待复核”。
2. is_relevant 仅当 relevance_status=“保留”时为 true，其余为 false。

第二阶段——品牌和舆情：
3. brand_name：只提取原文中有明确文字依据的品牌，不根据产品类型、作者名称或常识猜测。“儿童防晒帽、儿童大披肩防晒帽、护颈帽、遮阳帽”等是产品名称，不是品牌。KK树、kk树、Kocotree、kocotree 统一为“Kocotree（KK树）”。其他品牌使用常用官方名称；多个品牌用中文顿号“、”分隔并去重；无法确认输出“未识别”。
4. product：只概括涉及的产品品类或具体款式，不混入品牌；目标品类无更具体信息时输出“儿童大披肩防晒帽”。
5. is_ad：纯广告、直播预告、只有促销口号而无真实体验或具体观点时为 true。带品牌但有真实体验不自动视为广告。
6. is_negative：存在具体负向问题才为 true，不能仅因命中“差评/避雷”等搜索词而判负向。
7. is_positive：存在明确满意、认可、推荐或具体良好体验时为 true；纯提问、无态度描述或普通介绍不能判为好评。若同时存在会影响购买或使用的具体负向问题，is_negative=true 且 is_positive=false。
8. risk_terms：仅在 is_negative=true 时填写。优先从下列负向分析词选择，可多选；确有其它具体问题时可使用不超过12字的简短风险词：{negative_terms}
9. negative_summary：仅在 is_negative=true 时，用一句话概括主要吐槽点，否则为空。
10. positive_summary：仅在 is_positive=true 时，用一句话概括主要认可点，否则为空。可参考下列正向分析词，但不能只因命中词语就判好评：{positive_terms}
11. confidence：0到1之间。

必须返回一个 JSON 对象，顶层只有 items。每项必须包含：id、relevance_status、is_relevant、brand_name、is_ad、is_negative、is_positive、product、risk_terms、negative_summary、positive_summary、confidence。每个输入 id 恰好返回一次，不得遗漏或新增。不要输出解释。"""


def build_system_prompt(config: dict) -> str:
    terms = config.get("analysis_terms") or {}
    negative_terms = [str(value).strip() for value in terms.get("negative") or [] if str(value).strip()]
    positive_terms = [str(value).strip() for value in terms.get("positive") or [] if str(value).strip()]
    return SYSTEM_PROMPT_TEMPLATE.format(
        negative_terms="、".join(negative_terms),
        positive_terms="、".join(positive_terms),
    )


def _content_hash(candidate: Candidate) -> str:
    content = json.dumps(
        {
            "prompt_version": PROMPT_VERSION,
            "title": candidate.title,
            "description": candidate.description,
            "tags": candidate.tags,
            "keywords": candidate.keywords,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _candidate_payload(candidate: Candidate) -> dict:
    return {
        "id": candidate.note_id,
        "搜索模式": candidate.modes,
        "命中关键词": candidate.keywords,
        "标题": safe_text(candidate.title, 500),
        "正文": safe_text(candidate.description, 6000),
        "标签": candidate.tags[:30],
        "作者": safe_text(candidate.author, 200),
        "发布日期": candidate.published_at,
    }


def _as_bool(value) -> bool:
    return value is True or str(value).strip().lower() == "true"


def _parse_item(raw: dict, expected_id: str) -> Analysis:
    note_id = str(raw.get("id") or raw.get("note_id") or "").strip()
    if note_id != expected_id:
        raise ValueError(f"AI 返回 id 不匹配：期望 {expected_id}，实际 {note_id}")
    risk_terms = []
    for value in raw.get("risk_terms") or []:
        term = safe_text(value, 12).replace("/", "").strip()
        if term and term not in risk_terms:
            risk_terms.append(term)
    try:
        confidence = min(1.0, max(0.0, float(raw.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0
    relevance_status = safe_text(raw.get("relevance_status"), 10)
    if relevance_status == "待复核":
        relevance_status = "剔除"
    elif relevance_status not in {"保留", "剔除"}:
        relevance_status = "保留" if _as_bool(raw.get("is_relevant")) else "剔除"
    brand_name = safe_text(raw.get("brand_name"), 100) or "未识别"
    is_negative = _as_bool(raw.get("is_negative"))
    is_positive = _as_bool(raw.get("is_positive")) and not is_negative
    return Analysis(
        note_id=note_id,
        is_relevant=relevance_status == "保留",
        is_ad=_as_bool(raw.get("is_ad")),
        is_negative=is_negative,
        is_positive=is_positive,
        product=safe_text(raw.get("product"), 100) or "儿童大披肩防晒帽",
        risk_terms=risk_terms[:5] if is_negative else [],
        negative_summary=safe_text(raw.get("negative_summary"), 300) if is_negative else "",
        positive_summary=safe_text(raw.get("positive_summary"), 300) if is_positive else "",
        confidence=confidence,
        relevance_status=relevance_status,
        brand_name=brand_name,
    )


class DeepSeekClassifier:
    def __init__(self, config: dict, logger):
        self.config = config
        self.logger = logger
        self.system_prompt = build_system_prompt(config)
        self.total_prompt_tokens = 0
        self.total_completion_tokens = 0
        self.total_cache_hit_tokens = 0
        self.total_cache_miss_tokens = 0

    def _client(self):
        from openai import OpenAI

        if not DEEPSEEK_API_KEY:
            raise RuntimeError("缺少 DEEPSEEK_API_KEY：请复制 .env.example 为 .env 并填写密钥")
        return OpenAI(
            api_key=DEEPSEEK_API_KEY,
            base_url=DEEPSEEK_BASE_URL,
            timeout=float(self.config["ai"]["request_timeout_seconds"]),
        )

    def _request_batch(self, candidates: list[Candidate]) -> list[Analysis]:
        client = self._client()
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {
                    "role": "user",
                    "content": "请判断以下笔记并输出 JSON：\n"
                    + json.dumps([_candidate_payload(item) for item in candidates], ensure_ascii=False),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=max(1200, len(candidates) * 350),
            extra_body={"thinking": {"type": "disabled"}},
        )
        usage = response.usage
        if usage:
            self.total_prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
            self.total_completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
            self.total_cache_hit_tokens += int(getattr(usage, "prompt_cache_hit_tokens", 0) or 0)
            self.total_cache_miss_tokens += int(getattr(usage, "prompt_cache_miss_tokens", 0) or 0)
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        items = parsed.get("items")
        if not isinstance(items, list):
            raise ValueError("AI 返回 JSON 缺少 items 数组")
        by_id = {str(item.get("id") or item.get("note_id") or ""): item for item in items if isinstance(item, dict)}
        if set(by_id) != {candidate.note_id for candidate in candidates}:
            raise ValueError("AI 返回的笔记 ID 与当前批次不一致")
        return [_parse_item(by_id[candidate.note_id], candidate.note_id) for candidate in candidates]

    def classify(self, candidates: list[Candidate]) -> dict[str, Analysis]:
        cache = load_json(AI_CACHE, {})
        results: dict[str, Analysis] = {}
        pending: list[Candidate] = []
        for candidate in candidates:
            cached = cache.get(candidate.note_id) or {}
            if cached.get("content_hash") == _content_hash(candidate) and cached.get("analysis"):
                results[candidate.note_id] = Analysis.from_dict(cached["analysis"])
            else:
                pending.append(candidate)
        self.logger.info("AI 判断：缓存命中 %s 篇，待处理 %s 篇", len(results), len(pending))

        batch_size = max(1, int(self.config["ai"]["batch_size"]))
        retries = max(1, int(self.config["ai"]["max_retries"]))
        for start in range(0, len(pending), batch_size):
            batch = pending[start : start + batch_size]
            batch_no = start // batch_size + 1
            total_batches = (len(pending) + batch_size - 1) // batch_size
            self.logger.info("AI 判断批次 %s/%s（%s 篇）", batch_no, total_batches, len(batch))
            analyses = call_with_retries(
                lambda: self._request_batch(batch),
                attempts=retries,
                logger=self.logger,
                label=f"AI 判断批次 {batch_no}",
                base_delay=3,
            )
            for candidate, analysis in zip(batch, analyses):
                results[candidate.note_id] = analysis
                cache[candidate.note_id] = {
                    "content_hash": _content_hash(candidate),
                    "analysis": analysis.to_dict(),
                }
            save_json(AI_CACHE, cache)
        return results

    def estimated_cost_cny(self) -> float:
        hit = self.total_cache_hit_tokens
        miss = self.total_cache_miss_tokens
        if hit == 0 and miss == 0:
            miss = self.total_prompt_tokens
        return hit / 1_000_000 * 0.02 + miss / 1_000_000 * 1.0 + self.total_completion_tokens / 1_000_000 * 2.0

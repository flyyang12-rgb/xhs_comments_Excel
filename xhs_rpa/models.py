from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Candidate:
    note_id: str
    request_url: str
    canonical_url: str
    title: str = ""
    description: str = ""
    tags: list[str] = field(default_factory=list)
    author: str = ""
    published_at: str = ""
    liked_count: int | None = None
    collected_count: int | None = None
    comment_count: int | None = None
    cover_url: str = ""
    modes: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Candidate":
        return cls(**value)


@dataclass
class Analysis:
    note_id: str
    is_relevant: bool
    is_ad: bool
    is_negative: bool
    is_positive: bool
    product: str
    risk_terms: list[str]
    negative_summary: str
    positive_summary: str
    confidence: float
    relevance_status: str = "待复核"
    brand_name: str = "未识别"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Analysis":
        return cls(**value)

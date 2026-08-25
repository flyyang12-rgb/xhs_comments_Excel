from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime


NOTE_ID_RE = re.compile(r"/(?:explore|discovery/item)/([0-9a-zA-Z]+)")


def extract_note_id(url: str) -> str:
    match = NOTE_ID_RE.search(str(url or ""))
    return match.group(1) if match else ""


def canonical_note_url(note_id_or_url: str) -> str:
    note_id = extract_note_id(note_id_or_url) or str(note_id_or_url or "").strip()
    return f"https://www.xiaohongshu.com/explore/{note_id}" if note_id else ""


def normalize_count(value) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return max(0, int(value))
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    multiplier = 1
    if text.endswith("万"):
        multiplier = 10_000
        text = text[:-1]
    elif text.lower().endswith("w"):
        multiplier = 10_000
        text = text[:-1]
    try:
        return max(0, int(float(text) * multiplier))
    except ValueError:
        return None


def normalize_date(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", text) else ""


def is_within_months(value: str, months: int, today: date | None = None) -> bool:
    normalized = normalize_date(value)
    if not normalized:
        return False
    published = datetime.strptime(normalized, "%Y-%m-%d").date()
    today = today or date.today()
    year = today.year
    month = today.month - months
    while month <= 0:
        year -= 1
        month += 12
    day = min(today.day, monthrange(year, month)[1])
    cutoff = date(year, month, day)
    return cutoff <= published <= today


def engagement_score(likes: int | None, collects: int | None, comments: int | None) -> int:
    return (likes or 0) + 2 * (collects or 0) + 3 * (comments or 0)


def safe_text(value, limit: int = 6000) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(value or ""))
    return text.strip()[:limit]

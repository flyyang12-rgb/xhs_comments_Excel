from datetime import date

from xhs_rpa.models import Candidate
from xhs_rpa.pipeline import filter_candidates_before_cover


def candidate(note_id, published, modes):
    return Candidate(
        note_id=note_id,
        request_url=f"request/{note_id}",
        canonical_url=f"canonical/{note_id}",
        title=note_id,
        published_at=published,
        modes=modes,
        cover_url=f"https://img/{note_id}.jpg",
    )


def test_date_rules_are_applied_before_cover_classification():
    items = [
        candidate("both", "2025-09-01", ["negative", "positive"]),
        candidate("negative_only", "2024-01-01", ["negative", "positive"]),
        candidate("too_old", "2023-12-31", ["negative", "positive"]),
        candidate("missing", "", ["negative", "positive"]),
    ]

    result = filter_candidates_before_cover(
        items,
        min_publish_date="2024-01-01",
        positive_months=12,
        today=date(2026, 8, 17),
    )

    assert [(item.note_id, item.modes) for item in result] == [
        ("both", ["negative", "positive"]),
        ("negative_only", ["negative"]),
    ]

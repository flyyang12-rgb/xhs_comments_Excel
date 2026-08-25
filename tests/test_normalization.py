from datetime import date

from xhs_rpa.normalization import (
    canonical_note_url,
    engagement_score,
    is_within_months,
    normalize_count,
)


def test_normalize_interaction_counts():
    assert normalize_count("1.2万") == 12000
    assert normalize_count("3,210") == 3210
    assert normalize_count(8) == 8
    assert normalize_count("") is None


def test_canonical_url_removes_temporary_parameters():
    source = "https://www.xiaohongshu.com/explore/abc123?xsec_token=secret&xsec_source=pc_search"
    assert canonical_note_url(source) == "https://www.xiaohongshu.com/explore/abc123"


def test_engagement_score_uses_requirement_formula():
    assert engagement_score(10, 20, 30) == 140
    assert engagement_score(None, None, None) == 0


def test_twelve_month_filter():
    today = date(2026, 8, 13)
    assert is_within_months("2025-08-13", 12, today)
    assert not is_within_months("2025-08-12", 12, today)

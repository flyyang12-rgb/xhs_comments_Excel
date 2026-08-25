import pytest

from xhs_rpa.ai_classifier import _parse_item


def test_parse_ai_item_normalizes_fields():
    result = _parse_item(
        {
            "id": "n1",
            "relevance_status": "保留",
            "brand_name": "Kocotree（KK树）",
            "is_relevant": True,
            "is_ad": False,
            "is_negative": True,
            "is_positive": True,
            "product": "某品牌儿童大披肩防晒帽",
            "risk_terms": ["闷热不透气", "闷热不透气", "遮挡/视线"],
            "negative_summary": "佩戴闷热。",
            "positive_summary": "透气舒适。",
            "confidence": 1.5,
        },
        "n1",
    )
    assert result.risk_terms == ["闷热不透气", "遮挡视线"]
    assert result.confidence == 1.0
    assert result.is_negative is True
    assert result.is_positive is False
    assert result.positive_summary == ""
    assert result.relevance_status == "保留"
    assert result.brand_name == "Kocotree（KK树）"


def test_uncertain_relevance_is_not_exportable():
    result = _parse_item(
        {
            "id": "n2",
            "relevance_status": "待复核",
            "is_relevant": True,
            "brand_name": "",
        },
        "n2",
    )
    assert result.is_relevant is False
    assert result.brand_name == "未识别"


def test_parse_ai_item_rejects_wrong_id():
    with pytest.raises(ValueError, match="id 不匹配"):
        _parse_item({"id": "wrong"}, "expected")


def test_positive_item_does_not_keep_negative_fields():
    result = _parse_item(
        {
            "id": "positive",
            "relevance_status": "保留",
            "is_positive": True,
            "is_negative": False,
            "risk_terms": ["不应保留"],
            "negative_summary": "不应保留",
            "positive_summary": "佩戴舒适，防晒效果好。",
        },
        "positive",
    )

    assert result.is_positive is True
    assert result.risk_terms == []
    assert result.negative_summary == ""
    assert result.positive_summary == "佩戴舒适，防晒效果好。"

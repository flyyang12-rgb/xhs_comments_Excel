from xhs_rpa.vision_classifier import parse_vision_decision


def test_visual_decision_is_strictly_binary():
    assert parse_vision_decision({"decision": "保留"}) is True
    assert parse_vision_decision({"decision": "剔除"}) is False
    assert parse_vision_decision({"decision": "待复核"}) is False
    assert parse_vision_decision({}) is False

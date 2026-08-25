from xhs_rpa.ai_classifier import build_system_prompt
from xhs_rpa.pipeline import load_config


def test_keywords_and_analysis_terms_are_managed_in_config():
    config = load_config()

    assert config["keywords"]["negative"]
    assert config["keywords"]["positive"]
    assert config["analysis_terms"]["negative"]
    assert config["analysis_terms"]["positive"]
    assert len(config["keywords"]["negative"]) == len(set(config["keywords"]["negative"]))
    assert len(config["keywords"]["positive"]) == len(set(config["keywords"]["positive"]))


def test_prompt_uses_configured_positive_and_negative_terms():
    prompt = build_system_prompt(
        {
            "analysis_terms": {
                "negative": ["测试负向词"],
                "positive": ["测试正向词"],
            }
        }
    )

    assert "测试负向词" in prompt
    assert "测试正向词" in prompt
    assert "is_positive" in prompt

from xhs_rpa.collector import _cover_url_from_detail, _round_robin_unique
from xhs_rpa.models import Candidate


def candidate(note_id):
    return Candidate(note_id, f"request/{note_id}", f"canonical/{note_id}")


def test_round_robin_keeps_keyword_diversity_and_deduplicates():
    buckets = [
        [candidate("a"), candidate("b")],
        [candidate("a"), candidate("c")],
        [candidate("d")],
    ]
    assert [item.note_id for item in _round_robin_unique(buckets, 4)] == ["a", "d", "b", "c"]


def test_cover_uses_first_image_for_image_and_video_notes():
    assert _cover_url_from_detail({"video_cover": "https://img/video.jpg", "image_list": []}) == "https://img/video.jpg"
    assert _cover_url_from_detail({"video_cover": None, "image_list": ["https://img/first.jpg", "https://img/second.jpg"]}) == "https://img/first.jpg"
    assert _cover_url_from_detail({"video_cover": None, "image_list": []}) == ""

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENDOR_ROOT = PROJECT_ROOT / "vendor" / "Spider_XHS"
RUNTIME_DIR = PROJECT_ROOT / "_runtime"
CACHE_DIR = RUNTIME_DIR / "cache"
LOG_DIR = RUNTIME_DIR / "logs"
OUTPUT_DIR = PROJECT_ROOT / "output"
CONFIG_PATH = PROJECT_ROOT / "config.yaml"

load_dotenv(PROJECT_ROOT / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash").strip()

QWEN_VL_API_KEY = os.getenv("QWEN_VL_API_KEY", "").strip()
QWEN_VL_BASE_URL = os.getenv(
    "QWEN_VL_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
).strip()
QWEN_VL_MODEL = os.getenv("QWEN_VL_MODEL", "qwen3-vl-flash").strip()
VISION_NEGATIVE_EXAMPLE = PROJECT_ROOT / "assets" / "vision_examples" / "negative_front_brim.jpg"
VISION_POSITIVE_EXAMPLE = PROJECT_ROOT / "assets" / "vision_examples" / "positive_large_cape.png"

NEGATIVE_OUTPUT = OUTPUT_DIR / "儿童大披肩防晒帽_差评.xlsx"
POSITIVE_OUTPUT = OUTPUT_DIR / "儿童大披肩防晒帽_好评.xlsx"

EXCEL_HEADERS = [
    "采集日期",
    "笔记标题",
    "笔记链接",
    "发布日期",
    "达人",
    "涉及产品",
    "品牌名",
    "风险词",
    "点赞",
    "收藏",
    "评论",
    "备注",
    "数据来源",
]

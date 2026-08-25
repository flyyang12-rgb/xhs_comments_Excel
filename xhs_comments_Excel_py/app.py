from __future__ import annotations

import sys
import traceback

from xhs_rpa.pipeline import run
from xhs_rpa.runtime import RiskControlStop
from xhs_rpa.settings import NEGATIVE_OUTPUT, OUTPUT_DIR, POSITIVE_OUTPUT


def main() -> int:
    try:
        result = run()
    except KeyboardInterrupt:
        print("\n任务已由用户停止，断点已经保留。")
        return 130
    except RiskControlStop as error:
        print(f"\n检测到小红书安全限制，任务已停止且没有绕过：{error}")
        print("已保留断点，请稍后重新运行。")
        return 2
    except Exception as error:  # noqa: BLE001 - 顶层统一生成错误报告
        print(f"\n任务失败：{error}")
        traceback.print_exc()
        print("已保留可恢复断点；修复问题后重新双击启动脚本即可。")
        return 1

    print("\n任务完成。")
    print(f"差评：{result['negative_count']} 条 -> {NEGATIVE_OUTPUT}")
    print(f"好评：{result['positive_count']} 条 -> {POSITIVE_OUTPUT}")
    print(f"本次 AI 估算费用：¥{result['ai_cost_cny']:.4f}")
    print(f"结果目录：{OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

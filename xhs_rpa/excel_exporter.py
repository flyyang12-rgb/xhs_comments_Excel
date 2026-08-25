from __future__ import annotations

import os
import time
from datetime import date
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import Analysis, Candidate
from .normalization import canonical_note_url, engagement_score, is_within_months, normalize_count, normalize_date
from .settings import EXCEL_HEADERS, NEGATIVE_OUTPUT, OUTPUT_DIR, POSITIVE_OUTPUT


COLUMN_WIDTHS = [13, 38, 52, 13, 20, 28, 22, 28, 12, 12, 12, 52, 18]
LEGACY_HEADERS = [header for header in EXCEL_HEADERS if header != "品牌名"]


def _empty_or_number(value: int | None):
    return "" if value is None else int(value)


def _read_existing(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    workbook = load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value or "").strip() for value in next(rows, [])]
    if headers == LEGACY_HEADERS:
        workbook.close()
        # 旧表来自旧版相关性提示词，不能把旧误判和缺失品牌重新混入新结果。
        return {}
    if headers != EXCEL_HEADERS:
        workbook.close()
        raise ValueError(f"已有文件表头不符合需求，无法安全更新：{path}")
    result = {}
    for values in rows:
        row = dict(zip(headers, values))
        canonical_url = canonical_note_url(str(row.get("笔记链接") or ""))
        if canonical_url:
            result[canonical_url] = row
    workbook.close()
    return result


def _candidate_row(candidate: Candidate, analysis: Analysis, mode: str) -> dict:
    return {
        "采集日期": date.today().isoformat(),
        "笔记标题": candidate.title,
        # Excel 展示并跳转搜索结果返回的完整访问链接；
        # 去重仍由 _merge_rows 使用无参数的标准链接完成。
        "笔记链接": candidate.request_url or candidate.canonical_url,
        "发布日期": normalize_date(candidate.published_at),
        "达人": candidate.author,
        "涉及产品": analysis.product or "儿童大披肩防晒帽",
        "品牌名": analysis.brand_name or "未识别",
        "风险词": "/".join(analysis.risk_terms) if mode == "negative" else "",
        "点赞": _empty_or_number(candidate.liked_count),
        "收藏": _empty_or_number(candidate.collected_count),
        "评论": _empty_or_number(candidate.comment_count),
        "备注": analysis.negative_summary if mode == "negative" else analysis.positive_summary,
        "数据来源": "小红书搜索页",
    }


def _merge_rows(existing: dict[str, dict], current: list[dict]) -> dict[str, dict]:
    merged = dict(existing)
    for row in current:
        canonical_url = canonical_note_url(row.get("笔记链接", ""))
        if not canonical_url:
            continue
        previous = merged.get(canonical_url)
        if previous:
            for field in ("点赞", "收藏", "评论"):
                if row.get(field) == "" and previous.get(field) not in (None, ""):
                    row[field] = previous[field]
        merged[canonical_url] = row
    return merged


def _write_workbook(path: Path, rows: list[dict], logger) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "数据"
    sheet.append(EXCEL_HEADERS)
    for row in rows:
        sheet.append([row.get(header, "") for header in EXCEL_HEADERS])

    link_column = EXCEL_HEADERS.index("笔记链接") + 1
    for row_index in range(2, sheet.max_row + 1):
        cell = sheet.cell(row=row_index, column=link_column)
        if cell.value:
            cell.hyperlink = str(cell.value)
            cell.style = "Hyperlink"

    header_fill = PatternFill("solid", fgColor="C00000")
    for cell in sheet[1]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    sheet.row_dimensions[1].height = 24
    for index, width in enumerate(COLUMN_WIDTHS, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    if sheet.max_row >= 2:
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)
        for column in (1, 4, 7, 9, 10, 11, 13):
            for cells in sheet.iter_cols(min_col=column, max_col=column, min_row=2):
                for cell in cells:
                    cell.alignment = Alignment(
                        horizontal="center", vertical="center", wrap_text=True
                    )

    temp = path.with_suffix(".tmp.xlsx")
    last_error = None
    for attempt in range(1, 3):
        try:
            workbook.save(temp)
            os.replace(temp, path)
            workbook.close()
            logger.info("已生成：%s（%s 条）", path, len(rows))
            return
        except OSError as error:
            last_error = error
            logger.warning("Excel 写入失败（%s/2）：%s", attempt, error)
            time.sleep(2 * attempt)
    workbook.close()
    if temp.exists():
        temp.unlink()
    raise RuntimeError(f"Excel 写入连续失败：{last_error}") from last_error


def verify_workbooks(negative_count: int, positive_count: int) -> None:
    link_column = EXCEL_HEADERS.index("笔记链接") + 1
    for path, expected_count in ((NEGATIVE_OUTPUT, negative_count), (POSITIVE_OUTPUT, positive_count)):
        workbook = load_workbook(path, data_only=False, read_only=False)
        sheet = workbook.active
        headers = [cell.value for cell in sheet[1]]
        if headers != EXCEL_HEADERS:
            workbook.close()
            raise RuntimeError(f"Excel 表头校验失败：{path}")
        actual_count = max(0, sheet.max_row - 1)
        if actual_count != expected_count:
            workbook.close()
            raise RuntimeError(
                f"Excel 行数校验失败：{path}，期望 {expected_count}，实际 {actual_count}"
            )
        for row_index in range(2, sheet.max_row + 1):
            cell = sheet.cell(row=row_index, column=link_column)
            if not cell.value or not cell.hyperlink or cell.hyperlink.target != str(cell.value):
                workbook.close()
                raise RuntimeError(f"Excel 笔记链接校验失败：{path} 第 {row_index} 行")
        workbook.close()


def export_results(
    candidates: list[Candidate],
    analyses: dict[str, Analysis],
    positive_months: int,
    logger,
    min_publish_date: str = "2024-01-01",
) -> tuple[int, int]:
    min_date = normalize_date(min_publish_date)
    if not min_date:
        raise ValueError(f"最早发布日期配置无效：{min_publish_date}")

    def has_valid_publish_date(value) -> bool:
        normalized = normalize_date(value)
        return bool(normalized and normalized >= min_date)

    negative_current = []
    positive_current = []
    for candidate in candidates:
        analysis = analyses.get(candidate.note_id)
        if not analysis or not candidate.title or not candidate.canonical_url:
            continue
        if not has_valid_publish_date(candidate.published_at):
            continue
        if not analysis.is_relevant or analysis.is_ad:
            continue
        if "negative" in candidate.modes and analysis.is_negative:
            negative_current.append(_candidate_row(candidate, analysis, "negative"))
        if (
            "positive" in candidate.modes
            and analysis.is_positive
            and not analysis.is_negative
            and is_within_months(candidate.published_at, positive_months)
        ):
            positive_current.append(_candidate_row(candidate, analysis, "positive"))

    negative_rows = [
        row for row in negative_current if has_valid_publish_date(row.get("发布日期"))
    ]
    negative_rows.sort(key=lambda row: (row.get("发布日期") or "", row.get("点赞") or 0), reverse=True)

    positive_rows = [
        row
        for row in positive_current
        if has_valid_publish_date(row.get("发布日期"))
        and is_within_months(str(row.get("发布日期") or ""), positive_months)
    ]
    positive_rows.sort(
        key=lambda row: engagement_score(
            normalize_count(row.get("点赞")),
            normalize_count(row.get("收藏")),
            normalize_count(row.get("评论")),
        ),
        reverse=True,
    )
    positive_rows = positive_rows[:100]

    _write_workbook(NEGATIVE_OUTPUT, negative_rows, logger)
    _write_workbook(POSITIVE_OUTPUT, positive_rows, logger)
    return len(negative_rows), len(positive_rows)

"""Normalize GHIN API payloads and write CSV / JSON under output/."""

from __future__ import annotations

import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

SCORE_COLUMNS = [
    "score_id",
    "played_at",
    "posted_at",
    "course_name",
    "course_id",
    "tee_set_name",
    "holes",
    "holes_played",
    "adjusted_gross_score",
    "course_rating",
    "slope_rating",
    "differential",
    "unadjusted_differential",
    "score_type",
    "score_type_short",
    "status",
    "used",
    "exceptional",
    "is_manual",
    "front9_adjusted",
    "back9_adjusted",
    "gender",
    "golfer_id",
    "hole_detail_count",
]

HOLE_COLUMNS = [
    "score_id",
    "played_at",
    "course_name",
    "hole_number",
    "par",
    "raw_score",
    "adjusted_gross_score",
    "stroke_allocation",
    "putts",
    "fairway_hit",
    "gir_flag",
    "drive_accuracy",
    "approach_shot_accuracy",
    "x_hole",
    "most_likely_score",
    "hole_detail_id",
]


def _get(obj: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in obj and obj[name] is not None:
            return obj[name]
    return default


def _date_prefix(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    return text[:10] if text else ""


def _boolish(value: Any) -> Any:
    if value is None:
        return ""
    if value in (True, "true", "True", 1, "1"):
        return 1
    if value in (False, "false", "False", 0, "0"):
        return 0
    return value


def flatten_scores(payload: Any) -> list[dict[str, Any]]:
    """Merge GHIN score buckets into a deduped flat list."""
    if isinstance(payload, list):
        return [s for s in payload if isinstance(s, dict)]
    if not isinstance(payload, dict):
        return []

    out: list[dict[str, Any]] = []
    seen: set[Any] = set()
    bucket_keys = (
        "recent_scores",
        "revision_scores",
        "9_hole_score",
        "scores",
        "Scores",
        "results",
    )
    for key in bucket_keys:
        value = payload.get(key)
        if isinstance(value, dict):
            value = value.get("scores") or value.get("Scores")
        if not isinstance(value, list):
            continue
        for score in value:
            if not isinstance(score, dict):
                continue
            sid = score.get("id")
            if sid is not None and sid in seen:
                continue
            if sid is not None:
                seen.add(sid)
            out.append(score)
    return out


def score_to_row(score: dict[str, Any]) -> dict[str, Any]:
    holes = score.get("hole_details") or []
    return {
        "score_id": _get(score, "id", "score_id"),
        "played_at": _date_prefix(_get(score, "played_at", "date_played")),
        "posted_at": _date_prefix(_get(score, "posted_at")),
        "course_name": _get(
            score, "course_name", "course_display_value", "FacilityName", default=""
        ),
        "course_id": _get(score, "course_id", "CourseId"),
        "tee_set_name": _get(score, "tee_set_rating_name", "tee_name", "TeeSetName"),
        "holes": _get(score, "number_of_holes", "holes"),
        "holes_played": _get(score, "number_of_played_holes", "holes_played"),
        "adjusted_gross_score": _get(score, "adjusted_gross_score", "score"),
        "course_rating": _get(score, "course_rating"),
        "slope_rating": _get(score, "slope_rating"),
        "differential": _get(score, "differential"),
        "unadjusted_differential": _get(score, "unadjusted_differential"),
        "score_type": _get(score, "score_type_display_full", "score_type"),
        "score_type_short": _get(score, "score_type_display_short", "score_type"),
        "status": _get(score, "status"),
        "used": _boolish(_get(score, "used")),
        "exceptional": _boolish(_get(score, "exceptional")),
        "is_manual": _boolish(_get(score, "is_manual")),
        "front9_adjusted": _get(score, "front9_adjusted"),
        "back9_adjusted": _get(score, "back9_adjusted"),
        "gender": _get(score, "gender"),
        "golfer_id": _get(score, "golfer_id"),
        "hole_detail_count": len(holes) if isinstance(holes, list) else 0,
    }


def hole_rows_for_score(score: dict[str, Any]) -> list[dict[str, Any]]:
    details = score.get("hole_details") or []
    if not isinstance(details, list):
        return []
    played_at = _date_prefix(_get(score, "played_at", "date_played"))
    course_name = _get(
        score, "course_name", "course_display_value", "FacilityName", default=""
    )
    score_id = _get(score, "id", "score_id")
    rows: list[dict[str, Any]] = []
    for hole in details:
        if not isinstance(hole, dict):
            continue
        rows.append(
            {
                "score_id": score_id,
                "played_at": played_at,
                "course_name": course_name,
                "hole_number": _get(hole, "hole_number", "hole"),
                "par": _get(hole, "par"),
                "raw_score": _get(hole, "raw_score", "gross_score", "score"),
                "adjusted_gross_score": _get(
                    hole, "adjusted_gross_score", "adjusted_score"
                ),
                "stroke_allocation": _get(
                    hole, "stroke_allocation", "handicap_stroke"
                ),
                "putts": _get(hole, "putts", "number_of_putts"),
                "fairway_hit": _get(hole, "fairway_hit"),
                "gir_flag": _get(hole, "gir_flag", "green_in_regulation"),
                "drive_accuracy": _get(hole, "drive_accuracy"),
                "approach_shot_accuracy": _get(hole, "approach_shot_accuracy"),
                "x_hole": _get(hole, "x_hole"),
                "most_likely_score": _get(hole, "most_likely_score"),
                "hole_detail_id": _get(hole, "id"),
            }
        )
    return rows


def profile_summary(profile_payload: Any) -> dict[str, Any]:
    golfer: dict[str, Any] = {}
    if isinstance(profile_payload, dict):
        golfers = profile_payload.get("golfers") or profile_payload.get("golfer")
        if isinstance(golfers, list) and golfers:
            golfer = golfers[0] if isinstance(golfers[0], dict) else {}
        elif isinstance(golfers, dict):
            golfer = golfers
        elif profile_payload.get("ghin") or profile_payload.get("handicap_index"):
            golfer = profile_payload

    index = _get(golfer, "hi_display", "handicap_index", "hi_value", "display")
    if index in (999, 999.0, "999", "999.0"):
        index = "NH"

    return {
        "ghin": _get(golfer, "ghin", "ghin_number", "golfer_id"),
        "player_name": _get(golfer, "player_name", "full_name", "name"),
        "handicap_index": index,
        "low_hi": _get(golfer, "low_hi", "low_hi_display"),
        "low_hi_date": _get(golfer, "low_hi_date"),
        "rev_date": _get(golfer, "rev_date"),
        "soft_cap": _get(golfer, "soft_cap"),
        "hard_cap": _get(golfer, "hard_cap"),
        "club_name": _get(golfer, "club_name"),
        "association_name": _get(
            golfer, "association_name", "golf_association_name"
        ),
        "state": _get(golfer, "state"),
        "country": _get(golfer, "country"),
        "gender": _get(golfer, "gender"),
        "status": _get(golfer, "status"),
    }


def apply_limit(scores: list[dict[str, Any]], limit: Optional[int]) -> list[dict[str, Any]]:
    ordered = sorted(
        scores,
        key=lambda s: _date_prefix(_get(s, "played_at", "date_played")) or "",
        reverse=True,
    )
    if limit is None or limit <= 0:
        return ordered
    return ordered[:limit]


def write_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {col: ("" if row.get(col) is None else row.get(col)) for col in columns}
            )
    tmp.replace(path)
    logger.info("Wrote %s (%s rows)", path, len(rows))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, default=str)
        handle.write("\n")
    tmp.replace(path)
    logger.info("Wrote %s", path)


def export_bundle(
    *,
    output_dir: Path,
    profile_payload: Any,
    scores_payload: Any,
    handicap_payload: Any,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Build normalized tables and optionally write files under output_dir."""
    raw_scores = flatten_scores(scores_payload)
    limited = apply_limit(raw_scores, limit)
    score_rows = [score_to_row(s) for s in limited]
    holes: list[dict[str, Any]] = []
    for score in limited:
        holes.extend(hole_rows_for_score(score))
    holes.sort(
        key=lambda r: (r.get("played_at") or "", r.get("hole_number") or 0),
        reverse=True,
    )
    profile = profile_summary(profile_payload)

    meta = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "score_count": len(score_rows),
        "hole_row_count": len(holes),
        "limit": limit,
        "dry_run": dry_run,
        "read_only": True,
        "profile": {
            "ghin": profile.get("ghin"),
            "handicap_index": profile.get("handicap_index"),
            "club_name": profile.get("club_name"),
        },
    }

    result = {
        "meta": meta,
        "scores": score_rows,
        "holes": holes,
        "profile": profile,
    }

    if dry_run:
        logger.info(
            "Dry-run: would export %s scores / %s hole rows (no files written)",
            len(score_rows),
            len(holes),
        )
        return result

    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "scores.csv", SCORE_COLUMNS, score_rows)
    write_csv(output_dir / "holes.csv", HOLE_COLUMNS, holes)
    write_json(output_dir / "scores.json", limited)
    write_json(
        output_dir / "export.json",
        {
            "meta": meta,
            "profile": profile,
            "scores": score_rows,
            "holes": holes,
            "handicap_history": handicap_payload,
        },
    )
    write_json(output_dir / "profile.json", profile)
    write_json(output_dir / "handicap_history.json", handicap_payload)
    write_json(output_dir / "raw_scores_response.json", scores_payload)

    logger.info(
        "Export complete: %s scores, %s hole rows → %s",
        len(score_rows),
        len(holes),
        output_dir,
    )
    return result

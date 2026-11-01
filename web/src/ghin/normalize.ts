/** Normalize GHIN score payloads into flat tables. */

export type ScoreRow = Record<string, string | number | boolean | null>;
export type HoleRow = Record<string, string | number | boolean | null>;

export const SCORE_COLUMNS = [
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
] as const;

export const HOLE_COLUMNS = [
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
] as const;

function get(
  obj: Record<string, unknown>,
  ...names: string[]
): unknown {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return null;
}

function datePrefix(value: unknown): string {
  if (value == null) return "";
  return String(value).slice(0, 10);
}

function boolish(value: unknown): number | "" {
  if (value == null) return "";
  if (value === true || value === "true" || value === 1 || value === "1") return 1;
  if (value === false || value === "false" || value === 0 || value === "0") return 0;
  return "";
}

export function flattenScores(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((s) => s && typeof s === "object") as Record<
      string,
      unknown
    >[];
  }
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const keys = [
    "recent_scores",
    "revision_scores",
    "9_hole_score",
    "scores",
    "Scores",
    "results",
  ];

  for (const key of keys) {
    let value: unknown = root[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      value = nested.scores ?? nested.Scores;
    }
    if (!Array.isArray(value)) continue;
    for (const score of value) {
      if (!score || typeof score !== "object") continue;
      const s = score as Record<string, unknown>;
      const sid = s.id;
      if (sid != null && seen.has(sid)) continue;
      if (sid != null) seen.add(sid);
      out.push(s);
    }
  }
  return out;
}

export function scoreToRow(score: Record<string, unknown>): ScoreRow {
  const holes = Array.isArray(score.hole_details) ? score.hole_details : [];
  return {
    score_id: (get(score, "id", "score_id") as string | number | null) ?? null,
    played_at: datePrefix(get(score, "played_at", "date_played")),
    posted_at: datePrefix(get(score, "posted_at")),
    course_name: String(
      get(score, "course_name", "course_display_value", "FacilityName") ?? "",
    ),
    course_id: (get(score, "course_id", "CourseId") as string | number | null) ?? null,
    tee_set_name: String(
      get(score, "tee_set_rating_name", "tee_name", "TeeSetName") ?? "",
    ),
    holes: (get(score, "number_of_holes", "holes") as number | null) ?? null,
    holes_played:
      (get(score, "number_of_played_holes", "holes_played") as number | null) ??
      null,
    adjusted_gross_score:
      (get(score, "adjusted_gross_score", "score") as number | null) ?? null,
    course_rating: (get(score, "course_rating") as number | null) ?? null,
    slope_rating: (get(score, "slope_rating") as number | null) ?? null,
    differential: (get(score, "differential") as number | null) ?? null,
    unadjusted_differential:
      (get(score, "unadjusted_differential") as number | null) ?? null,
    score_type: String(
      get(score, "score_type_display_full", "score_type") ?? "",
    ),
    score_type_short: String(
      get(score, "score_type_display_short", "score_type") ?? "",
    ),
    status: String(get(score, "status") ?? ""),
    used: boolish(get(score, "used")),
    exceptional: boolish(get(score, "exceptional")),
    is_manual: boolish(get(score, "is_manual")),
    front9_adjusted: (get(score, "front9_adjusted") as number | null) ?? null,
    back9_adjusted: (get(score, "back9_adjusted") as number | null) ?? null,
    gender: String(get(score, "gender") ?? ""),
    golfer_id: (get(score, "golfer_id") as string | number | null) ?? null,
    hole_detail_count: holes.length,
  };
}

export function holeRowsForScore(score: Record<string, unknown>): HoleRow[] {
  const details = Array.isArray(score.hole_details) ? score.hole_details : [];
  const playedAt = datePrefix(get(score, "played_at", "date_played"));
  const courseName = String(
    get(score, "course_name", "course_display_value", "FacilityName") ?? "",
  );
  const scoreId = get(score, "id", "score_id");
  const rows: HoleRow[] = [];
  for (const hole of details) {
    if (!hole || typeof hole !== "object") continue;
    const h = hole as Record<string, unknown>;
    rows.push({
      score_id: (scoreId as string | number | null) ?? null,
      played_at: playedAt,
      course_name: courseName,
      hole_number: (get(h, "hole_number", "hole") as number | null) ?? null,
      par: (get(h, "par") as number | null) ?? null,
      raw_score:
        (get(h, "raw_score", "gross_score", "score") as number | null) ?? null,
      adjusted_gross_score:
        (get(h, "adjusted_gross_score", "adjusted_score") as number | null) ??
        null,
      stroke_allocation:
        (get(h, "stroke_allocation", "handicap_stroke") as number | null) ??
        null,
      putts: (get(h, "putts", "number_of_putts") as number | null) ?? null,
      fairway_hit: (get(h, "fairway_hit") as boolean | null) ?? null,
      gir_flag: (get(h, "gir_flag", "green_in_regulation") as unknown as
        | string
        | boolean
        | null) ?? null,
      drive_accuracy: (get(h, "drive_accuracy") as number | null) ?? null,
      approach_shot_accuracy:
        (get(h, "approach_shot_accuracy") as number | null) ?? null,
      x_hole: (get(h, "x_hole") as boolean | null) ?? null,
      most_likely_score:
        (get(h, "most_likely_score") as number | null) ?? null,
      hole_detail_id: (get(h, "id") as number | null) ?? null,
    });
  }
  return rows;
}

export function profileSummary(
  profilePayload: unknown,
): Record<string, unknown> {
  let golfer: Record<string, unknown> = {};
  if (profilePayload && typeof profilePayload === "object") {
    const root = profilePayload as Record<string, unknown>;
    const golfers = root.golfers ?? root.golfer;
    if (Array.isArray(golfers) && golfers[0] && typeof golfers[0] === "object") {
      golfer = golfers[0] as Record<string, unknown>;
    } else if (golfers && typeof golfers === "object" && !Array.isArray(golfers)) {
      golfer = golfers as Record<string, unknown>;
    } else if (root.ghin || root.handicap_index) {
      golfer = root;
    }
  }

  let index = get(golfer, "hi_display", "handicap_index", "hi_value", "display");
  if (index === 999 || index === 999.0 || index === "999" || index === "999.0") {
    index = "NH";
  }

  return {
    ghin: get(golfer, "ghin", "ghin_number", "golfer_id"),
    player_name: get(golfer, "player_name", "full_name", "name"),
    handicap_index: index,
    low_hi: get(golfer, "low_hi", "low_hi_display"),
    low_hi_date: get(golfer, "low_hi_date"),
    rev_date: get(golfer, "rev_date"),
    club_name: get(golfer, "club_name"),
    association_name: get(golfer, "association_name", "golf_association_name"),
    state: get(golfer, "state"),
    gender: get(golfer, "gender"),
    status: get(golfer, "status"),
  };
}

export function applyLimit(
  scores: Record<string, unknown>[],
  limit: number | null,
): Record<string, unknown>[] {
  const ordered = [...scores].sort((a, b) => {
    const da = datePrefix(get(a, "played_at", "date_played"));
    const db = datePrefix(get(b, "played_at", "date_played"));
    return db.localeCompare(da);
  });
  if (limit == null || limit <= 0) return ordered;
  return ordered.slice(0, limit);
}

export function buildTables(
  scoresPayload: unknown,
  limit: number | null,
): { scores: ScoreRow[]; holes: HoleRow[]; rawLimited: Record<string, unknown>[] } {
  const limited = applyLimit(flattenScores(scoresPayload), limit);
  const scores = limited.map(scoreToRow);
  const holes = limited.flatMap(holeRowsForScore);
  holes.sort((a, b) => {
    const dateCmp = String(b.played_at ?? "").localeCompare(
      String(a.played_at ?? ""),
    );
    if (dateCmp !== 0) return dateCmp;
    return Number(a.hole_number ?? 0) - Number(b.hole_number ?? 0);
  });
  return { scores, holes, rawLimited: limited };
}

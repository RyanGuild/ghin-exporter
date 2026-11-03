/**
 * GHIN full scorecard pull → Excel sheets (Scores, Holes, Profile, optional HandicapHistory).
 *
 * Primary use: Excel Automate tab → Run (Microsoft 365, including Home/Family
 * when Automate is available). Keep this .osts on OneDrive, not SharePoint
 * (SharePoint blocks external HTTP).
 *
 * Do not launch from cloud Power Automate "Run script" — fetch is blocked there.
 *
 * Credentials: Config sheet B1 email/GHIN, B2 password (cleared after success),
 * B3 Yes/No handicap history. Nothing is hardcoded.
 *
 * API (read-only, same as https://ryanguild.github.io/ghin-exporter/):
 *   POST /api/v1/golfer_login.json → Bearer JWT
 *   GET  /api/v1/scores.json?golfer_id&limit&offset until total_count
 *   GET  /api/v1/golfers/search.json (profile)
 *   GET  /api/v1/golfers/{id}/handicap_history.json (optional)
 */

const API_BASE = "https://api2.ghin.com/api/v1";
const CLIENT_SOURCE = "GHINcom";
const PAGE_SIZE = 50;
const DELAY_MS = 750;

const SCORE_COLUMNS: string[] = [
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
];

const HOLE_COLUMNS: string[] = [
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
];

interface LoginResponse {
  golfer_user?: GolferUser;
}

interface GolferUser {
  golfer_user_token?: string;
  golfer_id?: string | number;
  ghin?: string | number;
  ghin_number?: string | number;
  id?: string | number;
  golfers?: GolferRef[];
}

interface GolferRef {
  ghin?: string | number;
  ghin_number?: string | number;
  golfer_id?: string | number;
  id?: string | number;
}

interface ScoresPage {
  scores?: ScoreRecord[];
  total_count?: number | string;
  highest_score?: number | string;
  lowest_score?: number | string;
  average?: number | string;
}

interface ScoreRecord {
  id?: string | number;
  score_id?: string | number;
  played_at?: string;
  date_played?: string;
  posted_at?: string;
  course_name?: string;
  course_display_value?: string;
  FacilityName?: string;
  course_id?: string | number;
  CourseId?: string | number;
  tee_set_rating_name?: string;
  tee_name?: string;
  TeeSetName?: string;
  number_of_holes?: number;
  holes?: number;
  number_of_played_holes?: number;
  holes_played?: number;
  adjusted_gross_score?: number;
  score?: number;
  course_rating?: number;
  slope_rating?: number;
  differential?: number;
  unadjusted_differential?: number;
  score_type_display_full?: string;
  score_type?: string;
  score_type_display_short?: string;
  status?: string;
  used?: boolean | string | number;
  exceptional?: boolean | string | number;
  is_manual?: boolean | string | number;
  front9_adjusted?: number;
  back9_adjusted?: number;
  gender?: string;
  golfer_id?: string | number;
  hole_details?: HoleDetail[];
}

interface HoleDetail {
  id?: number;
  hole_number?: number;
  hole?: number;
  par?: number;
  raw_score?: number;
  gross_score?: number;
  score?: number;
  adjusted_gross_score?: number;
  adjusted_score?: number;
  stroke_allocation?: number;
  handicap_stroke?: number;
  putts?: number;
  number_of_putts?: number;
  fairway_hit?: boolean | string | number;
  gir_flag?: boolean | string | number;
  green_in_regulation?: boolean | string | number;
  drive_accuracy?: number;
  approach_shot_accuracy?: number;
  x_hole?: boolean | string | number;
  most_likely_score?: number;
}

interface ProfileSearch {
  golfers?: ProfileGolfer[];
  golfer?: ProfileGolfer;
  ghin?: string | number;
  handicap_index?: string | number;
}

interface ProfileGolfer {
  ghin?: string | number;
  ghin_number?: string | number;
  golfer_id?: string | number;
  player_name?: string;
  full_name?: string;
  name?: string;
  hi_display?: string | number;
  handicap_index?: string | number;
  hi_value?: string | number;
  display?: string | number;
  low_hi?: string | number;
  low_hi_display?: string | number;
  low_hi_date?: string;
  rev_date?: string;
  club_name?: string;
  association_name?: string;
  golf_association_name?: string;
  state?: string;
  gender?: string;
  status?: string;
}

interface HandicapHistoryPayload {
  handicap_revisions?: object[];
  revisions?: object[];
  handicap_history?: object[];
}

async function main(workbook: ExcelScript.Workbook): Promise<void> {
  const config = ensureConfigSheet(workbook);
  const emailOrGhin = String(config.getRange("B1").getValue() ?? "").trim();
  const password = String(config.getRange("B2").getValue() ?? "");
  const includeHandicap = isYes(config.getRange("B3").getValue());
  const statusCell = config.getRange("B5");

  if (!emailOrGhin || !password) {
    statusCell.setValue("Enter email/GHIN in B1 and password in B2, then Run.");
    throw new Error("Missing GHIN email/number or password on Config sheet.");
  }

  statusCell.setValue("Signing in to GHIN…");
  const login = await loginGhin(emailOrGhin, password);
  const token = login.token;
  const golferId = login.golferId;
  if (!token || !golferId) {
    statusCell.setValue("Login failed — check email/GHIN and password.");
    throw new Error("GHIN login failed.");
  }

  statusCell.setValue(`Signed in (GHIN ${golferId}). Fetching profile…`);
  const profile = await getProfile(token, golferId);

  statusCell.setValue("Fetching scorecards…");
  const scores = await getAllScores(token, golferId, (msg) => statusCell.setValue(msg));

  let handicapRows: string[][] = [];
  if (includeHandicap) {
    statusCell.setValue("Fetching handicap history…");
    handicapRows = await getHandicapHistoryRows(token, golferId);
  }

  statusCell.setValue(`Writing ${scores.length} rounds…`);
  const scoreRows = scores.map((s) => scoreToRow(s));
  const holeRows = flattenHoles(scores);

  writeTableSheet(workbook, "Scores", SCORE_COLUMNS, scoreRows);
  writeTableSheet(workbook, "Holes", HOLE_COLUMNS, holeRows);
  writeProfileSheet(workbook, profile);

  if (includeHandicap) {
    writeHandicapSheet(workbook, handicapRows);
  } else {
    removeSheetIfExists(workbook, "HandicapHistory");
  }

  // Clear password after success — keep email for next run.
  config.getRange("B2").setValue("");
  statusCell.setValue(
    `Done ${stampNow()}: ${scoreRows.length} rounds, ${holeRows.length} holes` +
      (includeHandicap ? `, ${Math.max(0, handicapRows.length - 1)} handicap rows` : "") +
      ". Password cleared."
  );
}

function ensureConfigSheet(workbook: ExcelScript.Workbook): ExcelScript.Worksheet {
  let sheet = workbook.getWorksheet("Config");
  if (!sheet) {
    sheet = workbook.addWorksheet("Config");
  }
  sheet.getRange("A1").setValue("Email or GHIN number");
  sheet.getRange("A2").setValue("Password (cleared after success)");
  sheet.getRange("A3").setValue("Include handicap history? (Yes/No)");
  sheet.getRange("A4").setValue("Delay ms between requests");
  sheet.getRange("A5").setValue("Status");
  if (!String(sheet.getRange("B3").getValue() ?? "").trim()) {
    sheet.getRange("B3").setValue("Yes");
  }
  if (!String(sheet.getRange("B4").getValue() ?? "").trim()) {
    sheet.getRange("B4").setValue(DELAY_MS);
  }
  sheet.getRange("A1:A5").getFormat().getFont().setBold(true);
  sheet.getRange("A1:B5").getFormat().autofitColumns();
  return sheet;
}

function isYes(value: string | number | boolean): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "yes" || text === "y" || text === "true" || text === "1";
}

async function loginGhin(
  emailOrGhin: string,
  password: string
): Promise<{ token: string; golferId: string }> {
  // Match web client: try simple preauth token first, then stop (Firebase optional).
  const body = {
    token: "nonblank",
    user: {
      email_or_ghin: emailOrGhin,
      password: password,
      remember_me: true,
    },
  };
  const response = await fetch(`${API_BASE}/golfer_login.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      source: CLIENT_SOURCE,
    },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("GHIN rejected login. Check email/GHIN and password.");
  }
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw new Error(`Login HTTP ${response.status}: ${text}`);
  }
  const data = (await response.json()) as LoginResponse;
  const user = data.golfer_user;
  const token = user && user.golfer_user_token ? String(user.golfer_user_token) : "";
  const golferId = user ? extractGolferId(user) : "";
  return { token, golferId };
}

function extractGolferId(user: GolferUser): string {
  const keys: (keyof GolferUser)[] = ["golfer_id", "ghin", "ghin_number", "id"];
  for (const key of keys) {
    const value = user[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  if (user.golfers && user.golfers.length > 0) {
    const first = user.golfers[0];
    const nestedKeys: (keyof GolferRef)[] = ["ghin", "ghin_number", "golfer_id", "id"];
    for (const key of nestedKeys) {
      const value = first[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return "";
}

async function getProfile(token: string, golferId: string): Promise<ProfileGolfer> {
  const url =
    `${API_BASE}/golfers/search.json` +
    `?golfer_id=${encodeURIComponent(golferId)}` +
    `&status=Active&per_page=10&page=1&source=${CLIENT_SOURCE}`;
  await sleep(DELAY_MS);
  const response = await authorizedGet(token, url);
  const data = (await response.json()) as ProfileSearch;
  if (data.golfers && data.golfers.length > 0) {
    return data.golfers[0];
  }
  if (data.golfer) {
    return data.golfer;
  }
  return {
    ghin: golferId,
    player_name: "",
  };
}

async function getAllScores(
  token: string,
  golferId: string,
  onProgress: (message: string) => void
): Promise<ScoreRecord[]> {
  const merged: ScoreRecord[] = [];
  const seen: { [id: string]: boolean } = {};
  let offset = 0;
  let totalCount = -1;

  while (true) {
    const label = totalCount >= 0 ? `${merged.length}/${totalCount}` : `${merged.length} so far`;
    onProgress(`Fetching scorecards… ${label}`);
    const url =
      `${API_BASE}/scores.json` +
      `?golfer_id=${encodeURIComponent(golferId)}` +
      `&source=${CLIENT_SOURCE}` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    await sleep(DELAY_MS);
    const response = await authorizedGet(token, url);
    const data = (await response.json()) as ScoresPage;
    const batch = data.scores ? data.scores : [];
    if (typeof data.total_count === "number") {
      totalCount = data.total_count;
    } else if (typeof data.total_count === "string" && data.total_count !== "-") {
      const parsed = Number(data.total_count);
      if (!isNaN(parsed)) {
        totalCount = parsed;
      }
    }
    for (const score of batch) {
      const id = score.id != null ? String(score.id) : "";
      if (id && seen[id]) {
        continue;
      }
      if (id) {
        seen[id] = true;
      }
      merged.push(score);
    }
    if (batch.length === 0) {
      break;
    }
    if (totalCount >= 0 && merged.length >= totalCount) {
      break;
    }
    if (batch.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
    if (offset > 5000) {
      break; // hard safety stop
    }
  }
  onProgress(`Fetched ${merged.length} scorecards.`);
  return merged;
}

async function getHandicapHistoryRows(token: string, golferId: string): Promise<string[][]> {
  const url =
    `${API_BASE}/golfers/${encodeURIComponent(golferId)}/handicap_history.json` +
    `?rev_count=0&include_hidden=false&source=${CLIENT_SOURCE}`;
  await sleep(DELAY_MS);
  const response = await authorizedGet(token, url);
  const data = (await response.json()) as HandicapHistoryPayload;
  let revs: object[] = [];
  if (data.handicap_revisions && data.handicap_revisions.length) {
    revs = data.handicap_revisions;
  } else if (data.revisions && data.revisions.length) {
    revs = data.revisions;
  } else if (data.handicap_history && data.handicap_history.length) {
    revs = data.handicap_history;
  }
  if (revs.length === 0) {
    return [["note"], ["No handicap history returned"]];
  }
  const columns: string[] = [];
  const columnSeen: { [k: string]: boolean } = {};
  for (const row of revs) {
    const keys = Object.keys(row as object);
    for (const key of keys) {
      if (!columnSeen[key]) {
        columnSeen[key] = true;
        columns.push(key);
      }
    }
  }
  const out: string[][] = [columns];
  for (const row of revs) {
    const record = row as { [key: string]: string | number | boolean };
    const line: string[] = [];
    for (const col of columns) {
      const value = record[col];
      line.push(value === null || value === undefined ? "" : String(value));
    }
    out.push(line);
  }
  return out;
}

async function authorizedGet(token: string, url: string): Promise<Response> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      source: CLIENT_SOURCE,
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`GHIN session rejected (HTTP ${response.status}).`);
  }
  if (response.status === 429) {
    throw new Error("GHIN rate-limited this request. Wait a bit and try again.");
  }
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw new Error(`GHIN HTTP ${response.status}: ${text}`);
  }
  return response;
}

function scoreToRow(score: ScoreRecord): (string | number | boolean)[] {
  const holes = score.hole_details ? score.hole_details : [];
  return [
    cell(score.id != null ? score.id : score.score_id),
    datePrefix(score.played_at != null ? score.played_at : score.date_played),
    datePrefix(score.posted_at),
    String(
      firstDefined([score.course_name, score.course_display_value, score.FacilityName], "")
    ),
    cell(score.course_id != null ? score.course_id : score.CourseId),
    String(
      firstDefined([score.tee_set_rating_name, score.tee_name, score.TeeSetName], "")
    ),
    cell(score.number_of_holes != null ? score.number_of_holes : score.holes),
    cell(
      score.number_of_played_holes != null
        ? score.number_of_played_holes
        : score.holes_played
    ),
    cell(
      score.adjusted_gross_score != null ? score.adjusted_gross_score : score.score
    ),
    cell(score.course_rating),
    cell(score.slope_rating),
    cell(score.differential),
    cell(score.unadjusted_differential),
    String(
      firstDefined([score.score_type_display_full, score.score_type], "")
    ),
    String(
      firstDefined([score.score_type_display_short, score.score_type], "")
    ),
    String(score.status != null ? score.status : ""),
    boolish(score.used),
    boolish(score.exceptional),
    boolish(score.is_manual),
    cell(score.front9_adjusted),
    cell(score.back9_adjusted),
    String(score.gender != null ? score.gender : ""),
    cell(score.golfer_id),
    holes.length,
  ];
}

function flattenHoles(scores: ScoreRecord[]): (string | number | boolean)[][] {
  const rows: (string | number | boolean)[][] = [];
  // Sort newest first by played_at, then hole number ascending — match web exporter.
  const ordered = scores.slice().sort((a, b) => {
    const da = datePrefix(a.played_at != null ? a.played_at : a.date_played);
    const db = datePrefix(b.played_at != null ? b.played_at : b.date_played);
    if (da < db) {
      return 1;
    }
    if (da > db) {
      return -1;
    }
    return 0;
  });
  for (const score of ordered) {
    const details = score.hole_details ? score.hole_details : [];
    const playedAt = datePrefix(
      score.played_at != null ? score.played_at : score.date_played
    );
    const courseName = String(
      firstDefined([score.course_name, score.course_display_value, score.FacilityName], "")
    );
    const scoreId = score.id != null ? score.id : score.score_id;
    const holesSorted = details.slice().sort((a, b) => {
      const ha = a.hole_number != null ? a.hole_number : a.hole != null ? a.hole : 0;
      const hb = b.hole_number != null ? b.hole_number : b.hole != null ? b.hole : 0;
      return Number(ha) - Number(hb);
    });
    for (const h of holesSorted) {
      rows.push([
        cell(scoreId),
        playedAt,
        courseName,
        cell(h.hole_number != null ? h.hole_number : h.hole),
        cell(h.par),
        cell(
          firstDefined([h.raw_score, h.gross_score, h.score], null) as
            | string
            | number
            | boolean
            | null
        ),
        cell(
          h.adjusted_gross_score != null ? h.adjusted_gross_score : h.adjusted_score
        ),
        cell(h.stroke_allocation != null ? h.stroke_allocation : h.handicap_stroke),
        cell(h.putts != null ? h.putts : h.number_of_putts),
        boolish(h.fairway_hit),
        cell(
          h.gir_flag != null
            ? h.gir_flag
            : h.green_in_regulation != null
              ? h.green_in_regulation
              : null
        ),
        cell(h.drive_accuracy),
        cell(h.approach_shot_accuracy),
        boolish(h.x_hole),
        cell(h.most_likely_score),
        cell(h.id),
      ]);
    }
  }
  return rows;
}

function writeTableSheet(
  workbook: ExcelScript.Workbook,
  name: string,
  columns: string[],
  rows: (string | number | boolean)[][]
): void {
  removeSheetIfExists(workbook, name);
  const sheet = workbook.addWorksheet(name);
  const header: (string | number | boolean)[] = columns.slice();
  const values: (string | number | boolean)[][] = [header];
  for (const row of rows) {
    values.push(row);
  }
  if (values.length === 1) {
    // Header only — still write columns so dad sees the shape.
    sheet.getRangeByIndexes(0, 0, 1, columns.length).setValues([header]);
  } else {
    sheet.getRangeByIndexes(0, 0, values.length, columns.length).setValues(values);
  }
  sheet.getRangeByIndexes(0, 0, 1, columns.length).getFormat().getFont().setBold(true);
  const usedScores = sheet.getUsedRange();
  if (usedScores) {
    usedScores.getFormat().autofitColumns();
  }
}

function writeProfileSheet(workbook: ExcelScript.Workbook, golfer: ProfileGolfer): void {
  removeSheetIfExists(workbook, "Profile");
  const sheet = workbook.addWorksheet("Profile");
  let index: string | number = firstDefined(
    [golfer.hi_display, golfer.handicap_index, golfer.hi_value, golfer.display],
    ""
  ) as string | number;
  if (index === 999 || index === 999.0 || index === "999" || index === "999.0") {
    index = "NH";
  }
  const headers = [
    "ghin",
    "player_name",
    "handicap_index",
    "low_hi",
    "low_hi_date",
    "rev_date",
    "club_name",
    "association_name",
    "state",
    "gender",
    "status",
  ];
  const values = [
    cell(firstDefined([golfer.ghin, golfer.ghin_number, golfer.golfer_id], "")),
    String(firstDefined([golfer.player_name, golfer.full_name, golfer.name], "")),
    cell(index),
    cell(golfer.low_hi != null ? golfer.low_hi : golfer.low_hi_display),
    String(golfer.low_hi_date != null ? golfer.low_hi_date : ""),
    String(golfer.rev_date != null ? golfer.rev_date : ""),
    String(golfer.club_name != null ? golfer.club_name : ""),
    String(
      firstDefined([golfer.association_name, golfer.golf_association_name], "")
    ),
    String(golfer.state != null ? golfer.state : ""),
    String(golfer.gender != null ? golfer.gender : ""),
    String(golfer.status != null ? golfer.status : ""),
  ];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).setValues([headers]);
  sheet.getRangeByIndexes(1, 0, 1, values.length).setValues([values]);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).getFormat().getFont().setBold(true);
  const usedProfile = sheet.getUsedRange();
  if (usedProfile) {
    usedProfile.getFormat().autofitColumns();
  }
}

function writeHandicapSheet(workbook: ExcelScript.Workbook, rows: string[][]): void {
  removeSheetIfExists(workbook, "HandicapHistory");
  const sheet = workbook.addWorksheet("HandicapHistory");
  if (rows.length === 0) {
    sheet.getRange("A1").setValue("note");
    sheet.getRange("A2").setValue("No handicap history returned");
    return;
  }
  const width = rows[0].length;
  sheet.getRangeByIndexes(0, 0, rows.length, width).setValues(rows);
  sheet.getRangeByIndexes(0, 0, 1, width).getFormat().getFont().setBold(true);
  const usedHist = sheet.getUsedRange();
  if (usedHist) {
    usedHist.getFormat().autofitColumns();
  }
}

function removeSheetIfExists(workbook: ExcelScript.Workbook, name: string): void {
  const existing = workbook.getWorksheet(name);
  if (existing) {
    // Excel requires at least one sheet — if this is the only one, rename/clear instead.
    if (workbook.getWorksheets().length === 1) {
      existing.setName("_tmp_clear");
      workbook.addWorksheet("Config");
      existing.delete();
      return;
    }
    existing.delete();
  }
}

function cell(value: string | number | boolean | null | undefined): string | number | boolean {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

function boolish(value: boolean | string | number | null | undefined): string | number {
  if (value === null || value === undefined) {
    return "";
  }
  if (value === true || value === "true" || value === 1 || value === "1") {
    return 1;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return 0;
  }
  return "";
}

function datePrefix(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }
  return String(value).slice(0, 10);
}

function firstDefined(
  values: (string | number | boolean | null | undefined)[],
  fallback: string | number | boolean | null
): string | number | boolean | null {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value) !== "") {
      return value;
    }
  }
  return fallback;
}

function stampNow(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Office Scripts has no setTimeout — busy-wait via Promise + Date is unreliable.
    // Use a tiny fetch delay workaround: resolve immediately after awaiting a
    // microtask chain approximated by ExcelScript isn't available; instead we
    // rely on sequential awaits between HTTP calls and a no-op Promise.
    // Actually Office Scripts DOES support setTimeout in modern runtimes.
    setTimeout(() => resolve(), ms);
  });
}

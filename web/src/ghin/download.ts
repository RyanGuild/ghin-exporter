import * as XLSX from "xlsx";
import type { HoleRow, ScoreRow } from "./normalize";
import { HOLE_COLUMNS, SCORE_COLUMNS } from "./normalize";

export type ExportFormat = "csv" | "jsonl" | "xlsx";

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(
  columns: readonly string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function rowsToJsonl(rows: Record<string, unknown>[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`;
}

/** Flatten GHIN handicap_history payloads into spreadsheet rows. */
export function handicapRevisionRows(
  handicap: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(handicap)) {
    return handicap.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === "object" && !Array.isArray(row),
    );
  }
  if (!handicap || typeof handicap !== "object") return [];
  const root = handicap as Record<string, unknown>;
  const revs =
    root.handicap_revisions ?? root.revisions ?? root.handicap_history;
  if (Array.isArray(revs)) {
    return revs.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === "object" && !Array.isArray(row),
    );
  }
  return Object.keys(root).length ? [root] : [];
}

export function downloadCsvBundle(
  scores: ScoreRow[],
  holes: HoleRow[],
  profile: Record<string, unknown>,
  handicap: unknown | null = null,
): string[] {
  const tag = stamp();
  const files: string[] = [];
  const scoresName = `ghin-scores-${tag}.csv`;
  const holesName = `ghin-holes-${tag}.csv`;
  const profileName = `ghin-profile-${tag}.csv`;

  triggerDownload(
    new Blob([rowsToCsv(SCORE_COLUMNS, scores)], {
      type: "text/csv;charset=utf-8",
    }),
    scoresName,
  );
  files.push(scoresName);

  triggerDownload(
    new Blob([rowsToCsv(HOLE_COLUMNS, holes)], {
      type: "text/csv;charset=utf-8",
    }),
    holesName,
  );
  files.push(holesName);

  const profileCols = Object.keys(profile);
  triggerDownload(
    new Blob([rowsToCsv(profileCols, [profile])], {
      type: "text/csv;charset=utf-8",
    }),
    profileName,
  );
  files.push(profileName);

  if (handicap != null) {
    const histRows = handicapRevisionRows(handicap);
    const histName = `ghin-handicap-history-${tag}.csv`;
    const cols =
      histRows.length > 0
        ? Array.from(
            histRows.reduce((set, row) => {
              for (const key of Object.keys(row)) set.add(key);
              return set;
            }, new Set<string>()),
          )
        : ["note"];
    const rows = histRows.length
      ? histRows
      : [{ note: "No handicap history returned" }];
    triggerDownload(
      new Blob([rowsToCsv(cols, rows)], { type: "text/csv;charset=utf-8" }),
      histName,
    );
    files.push(histName);
  }

  return files;
}

export function downloadJsonlBundle(
  scores: ScoreRow[],
  holes: HoleRow[],
  profile: Record<string, unknown>,
  handicap: unknown | null = null,
): string[] {
  const tag = stamp();
  const files: string[] = [];

  const scoresName = `ghin-scores-${tag}.jsonl`;
  const holesName = `ghin-holes-${tag}.jsonl`;
  const metaName = `ghin-meta-${tag}.jsonl`;

  triggerDownload(
    new Blob([rowsToJsonl(scores)], { type: "application/x-ndjson" }),
    scoresName,
  );
  files.push(scoresName);

  triggerDownload(
    new Blob([rowsToJsonl(holes)], { type: "application/x-ndjson" }),
    holesName,
  );
  files.push(holesName);

  const metaLines: Record<string, unknown>[] = [
    { type: "profile", ...profile },
    {
      type: "export_meta",
      exported_at: new Date().toISOString(),
      score_count: scores.length,
      hole_count: holes.length,
      include_handicap_history: handicap != null,
    },
  ];
  if (handicap != null) {
    metaLines.push({ type: "handicap_history", data: handicap });
  }
  triggerDownload(
    new Blob([rowsToJsonl(metaLines)], { type: "application/x-ndjson" }),
    metaName,
  );
  files.push(metaName);
  return files;
}

export function downloadXlsxBundle(
  scores: ScoreRow[],
  holes: HoleRow[],
  profile: Record<string, unknown>,
  handicap: unknown | null = null,
): string {
  const tag = stamp();
  const filename = `ghin-export-${tag}.xlsx`;
  const book = XLSX.utils.book_new();

  const scoresSheet = XLSX.utils.json_to_sheet(scores, {
    header: [...SCORE_COLUMNS],
  });
  XLSX.utils.book_append_sheet(book, scoresSheet, "Scores");

  const holesSheet = XLSX.utils.json_to_sheet(holes, {
    header: [...HOLE_COLUMNS],
  });
  XLSX.utils.book_append_sheet(book, holesSheet, "Holes");

  const profileSheet = XLSX.utils.json_to_sheet([profile]);
  XLSX.utils.book_append_sheet(book, profileSheet, "Profile");

  if (handicap != null) {
    const handicapRows = handicapRevisionRows(handicap);
    const histSheet = XLSX.utils.json_to_sheet(
      handicapRows.length
        ? handicapRows
        : [{ note: "No handicap history returned" }],
    );
    XLSX.utils.book_append_sheet(book, histSheet, "HandicapHistory");
  }

  XLSX.writeFile(book, filename);
  return filename;
}

export function downloadSelectedFormats(
  formats: ExportFormat[],
  scores: ScoreRow[],
  holes: HoleRow[],
  profile: Record<string, unknown>,
  handicap: unknown | null,
): string[] {
  const written: string[] = [];
  if (formats.includes("csv")) {
    written.push(...downloadCsvBundle(scores, holes, profile, handicap));
  }
  if (formats.includes("jsonl")) {
    written.push(...downloadJsonlBundle(scores, holes, profile, handicap));
  }
  if (formats.includes("xlsx")) {
    written.push(downloadXlsxBundle(scores, holes, profile, handicap));
  }
  return written;
}

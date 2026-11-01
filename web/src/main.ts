import "./style.css";
import {
  GhinApiError,
  GhinAuthError,
  GhinClient,
  GhinRateLimitError,
} from "./ghin/client";
import {
  downloadSelectedFormats,
  type ExportFormat,
} from "./ghin/download";
import { buildTables, profileSummary } from "./ghin/normalize";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <main class="shell">
    <h1 class="brand">GHIN Export</h1>
    <p class="lede">Pull your own scorecards into a spreadsheet. Read-only — nothing is posted back to GHIN.</p>

    <section class="panel">
      <form id="export-form" novalidate>
        <fieldset>
          <legend>Sign in</legend>
          <label>
            Email or GHIN number
            <input id="email" name="email" type="text" autocomplete="username" required placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="GHIN password" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Export controls</legend>
          <div class="row">
            <label>
              Recent rounds
              <select id="limit" name="limit">
                <option value="5">Last 5</option>
                <option value="10" selected>Last 10</option>
                <option value="25">Last 25</option>
                <option value="50">Last 50</option>
                <option value="0">All available</option>
              </select>
            </label>
            <label>
              Request delay
              <select id="delay" name="delay">
                <option value="500">0.5s (faster)</option>
                <option value="750" selected>0.75s (default)</option>
                <option value="1200">1.2s (gentler)</option>
                <option value="2000">2s (safest)</option>
              </select>
            </label>
          </div>

          <div class="checks" role="group" aria-label="File formats">
            <label class="check"><input type="checkbox" name="fmt" value="csv" checked /> CSV (scores + holes + profile)</label>
            <label class="check"><input type="checkbox" name="fmt" value="jsonl" checked /> JSONL</label>
            <label class="check"><input type="checkbox" name="fmt" value="xlsx" checked /> Excel (.xlsx)</label>
          </div>

          <label class="check">
            <input type="checkbox" id="include-handicap" checked />
            Include handicap revision history
          </label>
          <p class="hint">Credentials stay in this browser tab and are sent only to GHIN. They are not saved on this site.</p>
        </fieldset>

        <div class="actions">
          <button class="primary" id="submit" type="submit">Export scorecards</button>
          <button class="ghost" id="reset" type="reset">Clear</button>
        </div>
      </form>

      <p class="status" id="status" role="status" aria-live="polite"></p>
      <p class="safety"><strong>Read-only.</strong> This app only signs in and downloads your data. It never posts scores or changes your profile.</p>
    </section>
  </main>
`;

const form = document.querySelector<HTMLFormElement>("#export-form")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const submitBtn = document.querySelector<HTMLButtonElement>("#submit")!;

function setStatus(message: string, tone: "ok" | "error" | "" = "", busy = false) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
  statusEl.dataset.busy = busy ? "true" : "false";
}

function selectedFormats(formEl: HTMLFormElement): ExportFormat[] {
  return Array.from(formEl.querySelectorAll<HTMLInputElement>('input[name="fmt"]:checked'))
    .map((el) => el.value as ExportFormat)
    .filter((v): v is ExportFormat => v === "csv" || v === "jsonl" || v === "xlsx");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
  const password = (form.elements.namedItem("password") as HTMLInputElement).value;
  const limitRaw = Number((form.elements.namedItem("limit") as HTMLSelectElement).value);
  const delayMs = Number((form.elements.namedItem("delay") as HTMLSelectElement).value);
  const includeHandicap = (
    form.querySelector<HTMLInputElement>("#include-handicap")
  )?.checked ?? true;
  const formats = selectedFormats(form);

  if (!email || !password) {
    setStatus("Enter your GHIN email/number and password.", "error");
    return;
  }
  if (!formats.length) {
    setStatus("Pick at least one export format.", "error");
    return;
  }

  submitBtn.disabled = true;
  setStatus("Starting export…", "", true);

  try {
    const client = new GhinClient(email, password, delayMs, (msg) =>
      setStatus(msg, "", true),
    );
    await client.login();
    if (!client.golferId) {
      throw new GhinAuthError(
        "Signed in, but no GHIN number came back. Try your GHIN number as the username.",
      );
    }

    const profilePayload = await client.getProfile();
    const scoresPayload = await client.getScores();
    let handicap: unknown = {};
    if (includeHandicap) {
      try {
        handicap = await client.getHandicapHistory();
      } catch {
        setStatus("Handicap history unavailable — continuing with scores…", "", true);
        handicap = {};
      }
    }

    setStatus("Building files…", "", true);
    const limit = limitRaw > 0 ? limitRaw : null;
    const { scores, holes } = buildTables(scoresPayload, limit);
    const profile = profileSummary(profilePayload);

    if (!scores.length) {
      setStatus("No scores found for this account.", "error");
      return;
    }

    const files = downloadSelectedFormats(
      formats,
      scores,
      holes,
      profile,
      handicap,
    );
    setStatus(
      `Done — ${scores.length} rounds, ${holes.length} hole rows. Downloaded: ${files.join(", ")}`,
      "ok",
    );
  } catch (err) {
    const message =
      err instanceof GhinAuthError ||
      err instanceof GhinRateLimitError ||
      err instanceof GhinApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Something went wrong.";
    setStatus(message, "error");
  } finally {
    submitBtn.disabled = false;
  }
});

form.addEventListener("reset", () => {
  setTimeout(() => setStatus(""), 0);
});

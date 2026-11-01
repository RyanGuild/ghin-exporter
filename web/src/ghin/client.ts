/** Read-only GHIN API client for browser use (api2.ghin.com). */

const API_BASE = "https://api2.ghin.com/api/v1";
const FIREBASE_URL =
  "https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations";
const FIREBASE_API_KEY = "AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I";
const FIREBASE_APP_ID = "1:884417644529:web:47fb315bc6c70242f72650";
const CLIENT_SOURCE = "GHINcom";

export class GhinAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhinAuthError";
  }
}

export class GhinRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhinRateLimitError";
  }
}

export class GhinApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhinApiError";
  }
}

export type ProgressFn = (message: string) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GhinClient {
  private token: string | null = null;
  golferId: string | null = null;
  private lastRequestAt = 0;
  private readonly emailOrGhin: string;
  private readonly password: string;
  private readonly delayMs: number;
  private readonly onProgress: ProgressFn;

  constructor(
    emailOrGhin: string,
    password: string,
    delayMs = 750,
    onProgress: ProgressFn = () => undefined,
  ) {
    this.emailOrGhin = emailOrGhin;
    this.password = password;
    this.delayMs = delayMs;
    this.onProgress = onProgress;
  }

  async login(): Promise<Record<string, unknown>> {
    this.onProgress("Signing in to GHIN…");
    let lastError: Error | null = null;

    for (const useFirebase of [false, true]) {
      try {
        const preauth = useFirebase ? await this.firebaseToken() : "nonblank";
        const data = await this.request<Record<string, unknown>>(
          "POST",
          `${API_BASE}/golfer_login.json`,
          {
            jsonBody: {
              token: preauth,
              user: {
                email_or_ghin: this.emailOrGhin,
                password: this.password,
                remember_me: true,
              },
            },
            auth: false,
          },
        );
        const user = (data?.golfer_user ?? {}) as Record<string, unknown>;
        const token = user.golfer_user_token;
        if (typeof token !== "string" || !token) {
          lastError = new GhinAuthError(
            "Login failed — check email/GHIN number and password.",
          );
          continue;
        }
        this.token = token;
        this.golferId = extractGolferId(user);
        this.onProgress(
          this.golferId
            ? `Signed in (GHIN ${this.golferId}).`
            : "Signed in.",
        );
        return user;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof GhinAuthError && useFirebase) throw err;
      }
    }
    throw lastError ?? new GhinAuthError("GHIN login failed.");
  }

  async getProfile(golferId?: string): Promise<Record<string, unknown>> {
    const gid = golferId ?? this.golferId;
    if (!gid) throw new GhinApiError("Missing golfer id.");
    this.onProgress("Loading profile…");
    return this.request("GET", `${API_BASE}/golfers/search.json`, {
      params: {
        golfer_id: gid,
        status: "Active",
        per_page: "10",
        page: "1",
        source: CLIENT_SOURCE,
      },
    });
  }

  async getScores(golferId?: string): Promise<Record<string, unknown>> {
    const gid = golferId ?? this.golferId;
    if (!gid) throw new GhinApiError("Missing golfer id.");
    this.onProgress("Fetching scorecards…");
    try {
      const primary = await this.request<Record<string, unknown>>(
        "GET",
        `${API_BASE}/golfers/${gid}/scores.json`,
        { params: { source: CLIENT_SOURCE } },
      );
      if (primary) return primary;
    } catch {
      this.onProgress("Trying alternate score search…");
    }
    return this.request("GET", `${API_BASE}/scores/search.json`, {
      params: {
        golfer_id: gid,
        per_page: "100",
        page: "1",
        source: CLIENT_SOURCE,
      },
    });
  }

  async getHandicapHistory(
    golferId?: string,
  ): Promise<Record<string, unknown>> {
    const gid = golferId ?? this.golferId;
    if (!gid) throw new GhinApiError("Missing golfer id.");
    this.onProgress("Fetching handicap history…");
    return this.request(
      "GET",
      `${API_BASE}/golfers/${gid}/handicap_history.json`,
      {
        params: {
          rev_count: "0",
          include_hidden: "false",
          source: CLIENT_SOURCE,
        },
      },
    );
  }

  private async firebaseToken(): Promise<string> {
    const data = await this.request<{
      authToken?: { token?: string };
    }>("POST", FIREBASE_URL, {
      jsonBody: {
        appId: FIREBASE_APP_ID,
        authVersion: "FIS_v2",
        sdkVersion: "w:0.5.7",
        fid: "fg6JfS0U01YmrelthLX9Iz",
      },
      auth: false,
      headers: { "x-goog-api-key": FIREBASE_API_KEY },
    });
    const token = data?.authToken?.token;
    if (!token) throw new GhinAuthError("Could not get pre-auth token.");
    return token;
  }

  private async throttle(): Promise<void> {
    const wait = this.delayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    url: string,
    options: {
      params?: Record<string, string>;
      jsonBody?: unknown;
      auth?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { params, jsonBody, auth = true, headers = {} } = options;
    if (auth && !this.token) {
      throw new GhinAuthError("Not signed in.");
    }

    let fullUrl = url;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      fullUrl = `${url}?${qs}`;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.throttle();
      this.lastRequestAt = Date.now();

      const response = await fetch(fullUrl, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          source: CLIENT_SOURCE,
          ...(auth && this.token
            ? { Authorization: `Bearer ${this.token}` }
            : {}),
          ...headers,
        },
        body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
      });

      if (response.status === 401 || response.status === 403) {
        throw new GhinAuthError(
          `GHIN rejected the session (HTTP ${response.status}). Check credentials.`,
        );
      }
      if (response.status === 429) {
        throw new GhinRateLimitError(
          "GHIN rate-limited this request. Wait a bit and try again.",
        );
      }
      if ([500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
        await sleep(Math.min(30_000, this.delayMs * 2 ** attempt));
        continue;
      }
      if (!response.ok) {
        const text = (await response.text()).slice(0, 240);
        throw new GhinApiError(`GHIN HTTP ${response.status}: ${text}`);
      }
      if (response.status === 204) return {} as T;
      const text = await response.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }
    throw new GhinApiError("Request failed after retries.");
  }
}

function extractGolferId(user: Record<string, unknown>): string | null {
  for (const key of ["golfer_id", "ghin", "ghin_number", "id"]) {
    const value = user[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  const golfers = user.golfers;
  if (Array.isArray(golfers) && golfers[0] && typeof golfers[0] === "object") {
    const first = golfers[0] as Record<string, unknown>;
    for (const key of ["ghin", "ghin_number", "golfer_id", "id"]) {
      const value = first[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return null;
}

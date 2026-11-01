"""Read-only GHIN API client (api2.ghin.com).

Uses the same XHR endpoints the GHIN web app hits after login. Never POSTs
scores, never edits profile data — login + GET only.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional
from urllib.parse import urlencode

import requests

logger = logging.getLogger(__name__)

API_BASE = "https://api2.ghin.com/api/v1"
FIREBASE_URL = (
    "https://firebaseinstallations.googleapis.com/v1/projects/"
    "ghin-mobile-app/installations"
)
# Public web-app Firebase key used by ghin.com (not a user secret).
FIREBASE_API_KEY = "AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I"
FIREBASE_APP_ID = "1:884417644529:web:47fb315bc6c70242f72650"
CLIENT_SOURCE = "GHINcom"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class GhinAuthError(RuntimeError):
    """Authentication failed (401/403) or login rejected."""


class GhinRateLimitError(RuntimeError):
    """Server returned 429 Too Many Requests."""


class GhinApiError(RuntimeError):
    """Other GHIN HTTP / API failure."""


class GhinClient:
    """Polite, sequential, read-only session against api2.ghin.com."""

    def __init__(
        self,
        email_or_ghin: str,
        password: str,
        *,
        delay_seconds: float = 0.75,
        timeout_seconds: float = 30.0,
        max_retries: int = 3,
    ) -> None:
        self.email_or_ghin = email_or_ghin
        self._password = password
        self.delay_seconds = max(0.0, delay_seconds)
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(1, max_retries)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
                "source": CLIENT_SOURCE,
            }
        )
        self.token: Optional[str] = None
        self.golfer_id: Optional[str] = None
        self._last_request_at = 0.0

    # ------------------------------------------------------------------ auth

    def login(self) -> dict[str, Any]:
        """Authenticate and store Bearer token + golfer id. Password never logged."""
        logger.info("Authenticating to GHIN (credentials not logged)…")
        last_error: Optional[Exception] = None
        for preauth in ("nonblank", None):
            try:
                token_value = preauth if preauth is not None else self._firebase_token()
                payload = {
                    "token": token_value,
                    "user": {
                        "email_or_ghin": self.email_or_ghin,
                        "password": self._password,
                        "remember_me": True,
                    },
                }
                data = self._request(
                    "POST",
                    f"{API_BASE}/golfer_login.json",
                    json_body=payload,
                    auth=False,
                )
                user = (data or {}).get("golfer_user") or {}
                token = user.get("golfer_user_token")
                if not token:
                    last_error = GhinAuthError(
                        "Login response missing golfer_user_token. "
                        "Check GHIN_EMAIL / GHIN_PASSWORD."
                    )
                    continue
                self.token = token
                self.session.headers["Authorization"] = f"Bearer {token}"
                self.golfer_id = self._extract_golfer_id(user)
                logger.info(
                    "Login OK%s",
                    f" (golfer_id={self.golfer_id})" if self.golfer_id else "",
                )
                return user
            except GhinAuthError as exc:
                last_error = exc
                logger.warning("Login attempt failed: %s", exc)
        raise last_error or GhinAuthError("GHIN login failed.")

    def _firebase_token(self) -> str:
        """Mint the Firebase Installations token the web app sends at login."""
        body = {
            "appId": FIREBASE_APP_ID,
            "authVersion": "FIS_v2",
            "sdkVersion": "w:0.5.7",
            "fid": "fg6JfS0U01YmrelthLX9Iz",
        }
        data = self._request(
            "POST",
            FIREBASE_URL,
            json_body=body,
            auth=False,
            extra_headers={"x-goog-api-key": FIREBASE_API_KEY},
        )
        token = ((data or {}).get("authToken") or {}).get("token")
        if not token:
            raise GhinAuthError("Could not obtain Firebase pre-auth token.")
        return token

    @staticmethod
    def _extract_golfer_id(user: dict[str, Any]) -> Optional[str]:
        for key in ("golfer_id", "ghin", "ghin_number", "id"):
            value = user.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        golfers = user.get("golfers") or []
        if isinstance(golfers, list) and golfers:
            first = golfers[0] or {}
            for key in ("ghin", "ghin_number", "golfer_id", "id"):
                value = first.get(key)
                if value is not None and str(value).strip():
                    return str(value).strip()
        return None

    # --------------------------------------------------------------- read API

    def get_profile(self, golfer_id: Optional[str] = None) -> dict[str, Any]:
        gid = golfer_id or self.golfer_id
        if not gid:
            raise GhinApiError("No golfer_id available; login first or pass --ghin-id.")
        logger.info("Fetching golfer profile…")
        data = self._request(
            "GET",
            f"{API_BASE}/golfers/search.json",
            params={
                "golfer_id": gid,
                "status": "Active",
                "per_page": "10",
                "page": "1",
                "source": CLIENT_SOURCE,
            },
        )
        return data or {}

    def get_scores(
        self,
        golfer_id: Optional[str] = None,
        *,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        max_scores: Optional[int] = None,
    ) -> dict[str, Any]:
        """Fetch full score history (paginated).

        /golfers/{id}/scores.json only returns the ~20 revision-window rows.
        This pages GET /scores.json (limit/offset) until total_count is reached,
        then falls back to /scores/search.json pages.
        """
        gid = golfer_id or self.golfer_id
        if not gid:
            raise GhinApiError("No golfer_id available; login first or pass --ghin-id.")

        logger.info("Fetching scorecards for golfer %s…", gid)
        try:
            return self._fetch_scores_limit_offset(str(gid), max_scores)
        except GhinApiError as exc:
            logger.warning("scores.json paging failed (%s); trying search…", exc)
            return self._fetch_scores_search_pages(
                str(gid), max_scores, from_date=from_date, to_date=to_date
            )

    def _fetch_scores_limit_offset(
        self, gid: str, max_scores: Optional[int]
    ) -> dict[str, Any]:
        page_size = 50
        merged: list[dict[str, Any]] = []
        seen: set[Any] = set()
        offset = 0
        total_count: Optional[int] = None
        meta: dict[str, Any] = {}

        while True:
            data = self._request(
                "GET",
                f"{API_BASE}/scores.json",
                params={
                    "golfer_id": gid,
                    "source": CLIENT_SOURCE,
                    "limit": str(page_size),
                    "offset": str(offset),
                },
            ) or {}
            batch = data.get("scores") if isinstance(data.get("scores"), list) else []
            raw_total = data.get("total_count")
            if isinstance(raw_total, (int, float)):
                total_count = int(raw_total)
            elif isinstance(raw_total, str) and raw_total not in ("", "-"):
                try:
                    total_count = int(float(raw_total))
                except ValueError:
                    pass
            meta = {
                "highest_score": data.get("highest_score"),
                "lowest_score": data.get("lowest_score"),
                "average": data.get("average"),
                "total_count": total_count if total_count is not None else raw_total,
            }
            for score in batch:
                if not isinstance(score, dict):
                    continue
                sid = score.get("id")
                if sid is not None and sid in seen:
                    continue
                if sid is not None:
                    seen.add(sid)
                merged.append(score)
                if max_scores is not None and len(merged) >= max_scores:
                    break
            if not batch:
                break
            if max_scores is not None and len(merged) >= max_scores:
                break
            if total_count is not None and len(merged) >= total_count:
                break
            if len(batch) < page_size:
                break
            offset += page_size

        logger.info("Fetched %s scorecards.", len(merged))
        return {**meta, "scores": merged}

    def _fetch_scores_search_pages(
        self,
        gid: str,
        max_scores: Optional[int],
        *,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> dict[str, Any]:
        per_page = 50
        merged: list[dict[str, Any]] = []
        seen: set[Any] = set()
        page = 1

        while True:
            params: dict[str, str] = {
                "golfer_id": gid,
                "per_page": str(per_page),
                "page": str(page),
                "source": CLIENT_SOURCE,
            }
            if from_date:
                params["from_date_played"] = from_date
            if to_date:
                params["to_date_played"] = to_date
            data = self._request(
                "GET",
                f"{API_BASE}/scores/search.json",
                params=params,
            ) or {}
            batch = data.get("Scores") or data.get("scores") or []
            if not isinstance(batch, list):
                batch = []
            for score in batch:
                if not isinstance(score, dict):
                    continue
                sid = score.get("id")
                if sid is not None and sid in seen:
                    continue
                if sid is not None:
                    seen.add(sid)
                merged.append(score)
                if max_scores is not None and len(merged) >= max_scores:
                    break
            if max_scores is not None and len(merged) >= max_scores:
                break
            if not batch or len(batch) < per_page:
                break
            page += 1
            if page > 50:
                break

        logger.info("Fetched %s scorecards via search.", len(merged))
        return {"scores": merged, "total_count": len(merged)}

    def get_handicap_history(
        self,
        golfer_id: Optional[str] = None,
        *,
        rev_count: int = 0,
    ) -> dict[str, Any]:
        gid = golfer_id or self.golfer_id
        if not gid:
            raise GhinApiError("No golfer_id available; login first or pass --ghin-id.")
        logger.info("Fetching handicap revision history…")
        return (
            self._request(
                "GET",
                f"{API_BASE}/golfers/{gid}/handicap_history.json",
                params={
                    "rev_count": str(rev_count),
                    "include_hidden": "false",
                    "source": CLIENT_SOURCE,
                },
            )
            or {}
        )

    # --------------------------------------------------------------- HTTP core

    def _throttle(self) -> None:
        if self.delay_seconds <= 0:
            return
        elapsed = time.monotonic() - self._last_request_at
        wait = self.delay_seconds - elapsed
        if wait > 0:
            time.sleep(wait)

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict[str, str]] = None,
        json_body: Optional[dict[str, Any]] = None,
        auth: bool = True,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> Any:
        if auth and not self.token:
            raise GhinAuthError("Not authenticated; call login() first.")

        headers = dict(extra_headers or {})
        attempt = 0
        while True:
            attempt += 1
            self._throttle()
            self._last_request_at = time.monotonic()
            full_url = url
            if params:
                full_url = f"{url}?{urlencode(params)}"
            safe_label = url.split("/api/")[-1] if "/api/" in url else url.rsplit("/", 1)[-1]
            logger.debug("%s %s", method, safe_label)

            try:
                response = self.session.request(
                    method,
                    full_url,
                    json=json_body,
                    headers=headers or None,
                    timeout=self.timeout_seconds,
                )
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise GhinApiError(f"Network error talking to GHIN: {exc}") from exc
                backoff = min(30.0, self.delay_seconds * (2**attempt))
                logger.warning(
                    "Network error (%s); retry %s/%s in %.1fs",
                    type(exc).__name__,
                    attempt,
                    self.max_retries,
                    backoff,
                )
                time.sleep(backoff)
                continue

            status = response.status_code
            if status in (401, 403):
                raise GhinAuthError(
                    f"GHIN returned HTTP {status}. Session rejected or credentials "
                    "invalid — check .env and try again. Stopping cleanly (read-only)."
                )
            if status == 429:
                retry_after = response.headers.get("Retry-After")
                hint = f" Retry-After={retry_after}." if retry_after else ""
                raise GhinRateLimitError(
                    f"GHIN rate-limited this client (HTTP 429).{hint} "
                    "Stop and wait before retrying; increase --delay."
                )
            if status in (500, 502, 503, 504) and attempt < self.max_retries:
                backoff = min(30.0, self.delay_seconds * (2**attempt))
                logger.warning(
                    "HTTP %s from GHIN; retry %s/%s in %.1fs",
                    status,
                    attempt,
                    self.max_retries,
                    backoff,
                )
                time.sleep(backoff)
                continue
            if status >= 400:
                body_preview = (response.text or "")[:300]
                raise GhinApiError(
                    f"GHIN HTTP {status} for {safe_label}: {body_preview}"
                )

            if not response.content:
                return {}
            try:
                return response.json()
            except ValueError as exc:
                raise GhinApiError(
                    f"Non-JSON response from {safe_label}"
                ) from exc

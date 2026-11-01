"""CLI for the read-only GHIN scorecard exporter."""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from ghin_export.client import (
    GhinApiError,
    GhinAuthError,
    GhinClient,
    GhinRateLimitError,
)
from ghin_export.export import export_bundle

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "output"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="export_ghin",
        description=(
            "Read-only GHIN scorecard exporter. Logs into api2.ghin.com, "
            "fetches your score history (including hole-by-hole details when "
            "available), and writes CSV/JSON under ./output/. Never posts scores "
            "or edits your profile."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Export only the N most recent scores (useful for smoke tests).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Authenticate and fetch, but do not write output files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Directory for CSV/JSON (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Polite delay between HTTP requests (default: GHIN_DELAY or 0.75).",
    )
    parser.add_argument(
        "--ghin-id",
        default=None,
        help="Override golfer / GHIN number (default: from login or GHIN_ID).",
    )
    parser.add_argument(
        "--from-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="Optional lower bound when falling back to scores/search.json.",
    )
    parser.add_argument(
        "--to-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="Optional upper bound when falling back to scores/search.json.",
    )
    parser.add_argument(
        "--skip-handicap-history",
        action="store_true",
        help="Skip fetching handicap revision history.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Debug logging (still never logs password).",
    )
    return parser


def _load_credentials() -> tuple[str, str, str | None]:
    load_dotenv(ROOT / ".env")
    email = (
        os.getenv("GHIN_EMAIL")
        or os.getenv("GHIN_USERNAME")
        or os.getenv("GHIN_USER")
        or ""
    ).strip()
    password = (os.getenv("GHIN_PASSWORD") or "").strip()
    ghin_id = (os.getenv("GHIN_ID") or os.getenv("GHIN_NUMBER") or "").strip() or None
    if not email or not password:
        raise SystemExit(
            "Missing credentials. Copy .env.example to .env and set "
            "GHIN_EMAIL and GHIN_PASSWORD (never commit .env)."
        )
    return email, password, ghin_id


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    # Ensure third-party HTTP noise stays quiet unless -v
    if not args.verbose:
        logging.getLogger("urllib3").setLevel(logging.WARNING)

    try:
        email, password, env_ghin = _load_credentials()
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2

    delay = args.delay
    if delay is None:
        delay = float(os.getenv("GHIN_DELAY", "0.75"))

    client = GhinClient(email, password, delay_seconds=delay)
    try:
        client.login()
        golfer_id = args.ghin_id or env_ghin or client.golfer_id
        if not golfer_id:
            print(
                "Login succeeded but no golfer_id was returned. "
                "Pass --ghin-id or set GHIN_ID in .env.",
                file=sys.stderr,
            )
            return 1
        client.golfer_id = str(golfer_id)

        profile = client.get_profile()
        scores = client.get_scores(
            from_date=args.from_date,
            to_date=args.to_date,
        )
        handicap: dict = {}
        if not args.skip_handicap_history:
            try:
                handicap = client.get_handicap_history()
            except (GhinApiError, GhinAuthError, GhinRateLimitError) as exc:
                logging.getLogger(__name__).warning(
                    "Handicap history skipped: %s", exc
                )

        result = export_bundle(
            output_dir=args.output_dir.resolve(),
            profile_payload=profile,
            scores_payload=scores,
            handicap_payload=handicap,
            limit=args.limit,
            dry_run=args.dry_run,
        )
        summary = result["meta"]
        if args.dry_run:
            print(
                f"Dry-run OK: {summary['score_count']} scores / "
                f"{summary['hole_row_count']} hole rows "
                f"(handicap_index={result['profile'].get('handicap_index')})"
            )
        else:
            print(
                f"Done: {summary['score_count']} scores / "
                f"{summary['hole_row_count']} hole rows "
                f"→ {args.output_dir.resolve()}"
            )
        return 0
    except GhinAuthError as exc:
        print(f"Auth error: {exc}", file=sys.stderr)
        return 1
    except GhinRateLimitError as exc:
        print(f"Rate limited: {exc}", file=sys.stderr)
        return 1
    except GhinApiError as exc:
        print(f"API error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Entrypoint: python export_ghin.py [--limit 5] [--dry-run] …"""

from ghin_export.cli import main

if __name__ == "__main__":
    raise SystemExit(main())

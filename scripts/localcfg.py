"""Machine-specific paths and hosts, kept out of the repository.

Lookup order for each key: an environment variable, then scripts/local_config.json
(gitignored, one flat JSON object), then the default the caller passes.
Keys in use: library, piano_root, scans_inbox, review_backup, pinocchio_host,
tutor_db, load_state, tutor_url.
"""
import json
import os
from pathlib import Path

_FILE = Path(__file__).resolve().parent / "local_config.json"


def get(key: str, env: str | None = None, default: str | None = None) -> str | None:
    if env and os.environ.get(env):
        return os.environ[env]
    try:
        value = json.loads(_FILE.read_text(encoding="utf-8")).get(key)
    except (OSError, ValueError, AttributeError):
        value = None
    return value or default

from __future__ import annotations

import os
from pathlib import Path


def load_env() -> None:
    """Load environment variables from .env files (dev convenience).

    Priority:
      1) backend/.env
      2) repo-root .env (optional fallback)

    Real OS environment variables always win (override=False).
    """

    def _load_simple_env(path: Path) -> None:
        """Minimal .env loader (fallback when python-dotenv isn't available).

        - Ignores blank lines and comments (# ...)
        - Supports optional 'export KEY=VALUE'
        - Supports quoted values with single or double quotes
        - Does NOT override existing OS env vars
        """

        try:
            if not path.exists() or not path.is_file():
                return

            text = path.read_text(encoding='utf-8-sig', errors='replace')
            for raw_line in text.splitlines():
                line = (raw_line or '').strip()
                if not line or line.startswith('#'):
                    continue

                if line.lower().startswith('export '):
                    line = line[7:].strip()

                if '=' not in line:
                    continue

                key, value = line.split('=', 1)
                key = (key or '').strip()
                if not key:
                    continue

                value = (value or '').strip()
                if (len(value) >= 2) and (
                    (value[0] == value[-1] == '"') or (value[0] == value[-1] == "'")
                ):
                    value = value[1:-1]

                # Do not override real OS env vars
                os.environ.setdefault(key, value)
        except Exception:
            # Best-effort: never crash app startup because of .env parsing
            return

    try:
        from dotenv import load_dotenv
    except Exception:
        load_dotenv = None

    backend_dir = Path(__file__).resolve().parent
    repo_root = backend_dir.parent

    backend_env = backend_dir / ".env"
    root_env = repo_root / ".env"

    if load_dotenv is not None:
        # Real OS environment variables always win (override=False).
        load_dotenv(backend_env, override=False)
        load_dotenv(root_env, override=False)
    else:
        _load_simple_env(backend_env)
        _load_simple_env(root_env)

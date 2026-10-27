"""Disposable loopback-only browser fixture; never use an existing application DB."""
import os
import logging
from pathlib import Path
import secrets
import sys
import tempfile

if os.environ.get('TECHSTORE_BROWSER_TEST') != '1':
    raise SystemExit('Run through the guarded Playwright configuration.')

root = Path(__file__).resolve().parents[2]
fixture_root = root / 'instance' / 'browser-tests'
fixture_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=fixture_root) as directory:
    os.environ.update({
        'USE_SQLITE': '1', 'DB_AUTO_INITIALIZE': '1',
        'SQLALCHEMY_DATABASE_URI': 'sqlite:///' + (Path(directory) / 'test.sqlite3').as_posix(),
        'JWT_SECRET_KEY': secrets.token_urlsafe(48),
        'ADMIN_USERNAME': 'browser-admin', 'ADMIN_EMAIL': 'browser-admin@example.com',
        'ADMIN_PASSWORD': 'Browser-test-only-42!',
        'EMAIL_MODE': 'file', 'EMAIL_FILE_DIR': directory,
        'PUBLIC_BASE_URL': 'http://127.0.0.1:5011',
        'PAYOS_CLIENT_ID': '', 'PAYOS_API_KEY': '', 'PAYOS_CHECKSUM_KEY': '',
        'SMTP_HOST': '', 'SMTP_USER': '', 'SMTP_PASS': '',
    })
    sys.path.insert(0, str(root / 'backend'))
    import app as backend
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    backend.app.run(host='127.0.0.1', port=5011, debug=False, use_reloader=False, threaded=True)

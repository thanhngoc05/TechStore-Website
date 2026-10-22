"""Check published local links without a running browser or network access."""
from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class FrontendFilesTests(unittest.TestCase):
    def test_local_html_links_and_assets_exist(self):
        missing = []

        class Links(HTMLParser):
            def handle_starttag(self, tag, attributes):
                for name, value in attributes:
                    if name not in ('href', 'src') or not value:
                        continue
                    url = urlsplit(value)
                    if url.scheme or url.netloc or not url.path:
                        continue
                    relative = unquote(url.path)
                    target = ROOT / relative.lstrip('/') if relative.startswith('/') else self.page.parent / relative
                    if not target.exists():
                        missing.append(f'{self.page.name}: {value}')

        for page in (ROOT / 'pages').glob('*.html'):
            parser = Links()
            parser.page = page
            parser.feed(page.read_text(encoding='utf-8-sig'))
        self.assertEqual(missing, [], '\n'.join(missing))

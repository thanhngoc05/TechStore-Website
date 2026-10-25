import unittest
from unittest.mock import patch

import test_backend as baseline
import serve
from waitress.adjustments import Adjustments


class ServerTests(unittest.TestCase):
    def test_default_server_options_are_accepted_by_waitress(self):
        options = serve.server_options({})
        adjustments = Adjustments(**options)
        self.assertEqual(adjustments.host, '127.0.0.1')
        self.assertEqual(adjustments.port, 5001)
        self.assertEqual(adjustments.threads, 4)
        self.assertTrue(adjustments.clear_untrusted_proxy_headers)

    def test_invalid_listener_settings_fail_before_server_start(self):
        for options in ({'PORT': '0'}, {'PORT': '65536'}, {'WSGI_THREADS': '0'},
                        {'WSGI_THREADS': '65'}, {'PORT': 'invalid'}, {'BIND_HOST': 'https://example.com'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                serve.server_options(options)

    def test_server_entrypoint_disables_debugger(self):
        with patch.dict(serve.os.environ, PORT='5001', WSGI_THREADS='4', BIND_HOST='127.0.0.1'), \
                patch.dict(serve.app.config, DEBUG=True), patch.object(serve, 'run_server') as run:
            serve.main()
            self.assertFalse(serve.app.debug)
            self.assertEqual(run.call_args.kwargs['host'], '127.0.0.1')
            self.assertIs(run.call_args.args[0], baseline.backend.app)

import unittest
from unittest.mock import patch

import test_backend as baseline
import serve
from waitress.adjustments import Adjustments
from waitress.proxy_headers import proxy_headers_middleware


class ServerTests(unittest.TestCase):
    def test_explicit_proxy_options_are_accepted_by_waitress(self):
        options = serve.server_options({'TRUSTED_PROXY': '127.0.0.1', 'TRUSTED_PROXY_COUNT': '2'})
        adjustments = Adjustments(**options)
        self.assertEqual(adjustments.trusted_proxy, '127.0.0.1')
        self.assertEqual(adjustments.trusted_proxy_count, 2)
        self.assertEqual(adjustments.trusted_proxy_headers, {'x-forwarded-for', 'x-forwarded-proto'})

    def test_invalid_proxy_settings_fail_before_server_start(self):
        for settings in ({'TRUSTED_PROXY': '*'}, {'TRUSTED_PROXY': 'localhost'},
                         {'TRUSTED_PROXY': '127.0.0.0/8'},
                         {'TRUSTED_PROXY_HEADERS': 'x-forwarded-for'},
                         {'TRUSTED_PROXY': '127.0.0.1', 'TRUSTED_PROXY_COUNT': '0'},
                         {'TRUSTED_PROXY': '127.0.0.1', 'TRUSTED_PROXY_COUNT': '6'},
                         {'TRUSTED_PROXY': '127.0.0.1', 'TRUSTED_PROXY_HEADERS': 'x-forwarded-host'}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                serve.server_options(settings)

    def test_only_trusted_peer_can_override_client_address_and_scheme(self):
        options = serve.server_options({'TRUSTED_PROXY': '127.0.0.1'})
        middleware = proxy_headers_middleware(lambda environ, start_response: environ,
            trusted_proxy=options['trusted_proxy'], trusted_proxy_count=options['trusted_proxy_count'],
            trusted_proxy_headers=options['trusted_proxy_headers'])
        for peer, expected in [('127.0.0.1', '198.51.100.23'), ('192.0.2.7', '192.0.2.7')]:
            environ = {'REMOTE_ADDR': peer, 'HTTP_X_FORWARDED_FOR': '198.51.100.23',
                       'HTTP_X_FORWARDED_PROTO': 'https', 'wsgi.url_scheme': 'http',
                       'SERVER_NAME': 'localhost', 'SERVER_PORT': '5001',
                       'HTTP_X_FORWARDED_HOST': 'attacker.example'}
            result = middleware(environ, lambda status, headers: None)
            self.assertEqual(result['REMOTE_ADDR'], expected)
            self.assertEqual(result['wsgi.url_scheme'], 'https' if peer == '127.0.0.1' else 'http')
            self.assertNotIn('HTTP_X_FORWARDED_HOST', result)
            if peer != '127.0.0.1':
                self.assertNotIn('HTTP_X_FORWARDED_FOR', result)

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

"""Run the Flask application through Waitress without enabling the debugger."""
import os
from ipaddress import ip_address

from waitress import serve as run_server
from app import app


def server_options(environ=None):
    settings = os.environ if environ is None else environ
    host = settings.get('BIND_HOST', '127.0.0.1').strip()
    if not host or any(character.isspace() for character in host) or '://' in host:
        raise ValueError('BIND_HOST must be a host or IP address without a URL scheme.')
    try:
        port = int(settings.get('PORT', '5001'))
        threads = int(settings.get('WSGI_THREADS', '4'))
    except (TypeError, ValueError) as error:
        raise ValueError('PORT and WSGI_THREADS must be integers.') from error
    if not 1 <= port <= 65535 or not 1 <= threads <= 64:
        raise ValueError('PORT must be 1..65535 and WSGI_THREADS must be 1..64.')
    options = {'host': host, 'port': port, 'threads': threads,
            'max_request_body_size': app.config['MAX_CONTENT_LENGTH'],
            'clear_untrusted_proxy_headers': True}
    proxy = settings.get('TRUSTED_PROXY', '').strip()
    headers = settings.get('TRUSTED_PROXY_HEADERS', '').lower().split()
    if not proxy:
        if headers:
            raise ValueError('TRUSTED_PROXY_HEADERS requires TRUSTED_PROXY.')
        return options
    try:
        ip_address(proxy)
        count = int(settings.get('TRUSTED_PROXY_COUNT', '1'))
    except (TypeError, ValueError) as error:
        raise ValueError('TRUSTED_PROXY must be one IP address and its count an integer.') from error
    if not 1 <= count <= 5:
        raise ValueError('TRUSTED_PROXY_COUNT must be 1..5.')
    headers = set(headers or ['x-forwarded-for', 'x-forwarded-proto'])
    if not headers <= {'x-forwarded-for', 'x-forwarded-proto'}:
        raise ValueError('Only x-forwarded-for and x-forwarded-proto may be trusted.')
    options.update(trusted_proxy=proxy, trusted_proxy_count=count, trusted_proxy_headers=headers)
    return options


def main():
    options = server_options()
    app.debug = False
    run_server(app, **options)


if __name__ == '__main__':
    main()

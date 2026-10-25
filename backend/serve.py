"""Run the Flask application through Waitress without enabling the debugger."""
import os

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
    return {'host': host, 'port': port, 'threads': threads,
            'max_request_body_size': app.config['MAX_CONTENT_LENGTH'],
            'clear_untrusted_proxy_headers': True}


def main():
    options = server_options()
    app.debug = False
    run_server(app, **options)


if __name__ == '__main__':
    main()

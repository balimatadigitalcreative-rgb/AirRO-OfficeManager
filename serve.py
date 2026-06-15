# AirRO Water — static file server with no-cache headers.
# Used by start.ps1 so the browser always loads the latest HTML/JS/CSS and
# never gets stuck on a stale cached build. Usage: python serve.py [port]
import sys
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        SimpleHTTPRequestHandler.end_headers(self)


TCPServer.allow_reuse_address = True
with TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'AirRO web server (no-cache) running at http://localhost:{PORT}')
    httpd.serve_forever()

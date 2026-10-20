"""Placeholder web server for the add-on's ingress panel.

Replaced by the real editor and player as development progresses.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8099
PAGE = b"""<!doctype html>
<html><head><meta charset="utf-8"><title>Govee Light Show</title></head>
<body style="font-family:sans-serif;padding:2rem">
<h1>Govee Light Show</h1>
<p>The editor is under construction.</p>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE)


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

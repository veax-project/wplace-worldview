"""Test server: static + CORS + POST /save/<name> to pull an image back from the browser."""
import http.server, os, socketserver

class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def end_headers(self):
        # Without a cache header, Chrome applies heuristic freshness and keeps
        # serving the old file after an edit: you think you are testing the new
        # code while you are actually re-reading the old one.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/save/"):
            self.send_error(404); return
        name = os.path.basename(self.path[6:])
        n = int(self.headers.get("Content-Length", 0))
        os.makedirs("proof", exist_ok=True)
        with open(os.path.join("proof", name), "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers()
        self.wfile.write(b"ok")

os.chdir(os.path.dirname(os.path.abspath(__file__)))
# ThreadingHTTPServer: without it the server stalls as soon as the browser
# opens several keep-alive connections in parallel.
http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(("127.0.0.1", 8792), H) as s:
    print("serving on http://127.0.0.1:8792")
    s.serve_forever()

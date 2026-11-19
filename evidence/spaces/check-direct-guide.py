"""Run the packed direct examples against an isolated, read-only HTTP fixture."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import requests

archive = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/tsdm-sdk-0.1.0.tgz")
with tarfile.open(archive) as package:
    guide = package.extractfile("package/docs/spaces.md").read().decode()
python = re.search(r"^```python\n(.*?)^```$", guide, re.M | re.S)[1]
curl = re.search(r"^```sh\n(.*?)^```$", guide, re.M | re.S)[1]
query = {key: [value] for key, value in dict(
    mod="space", do="wall", uid="502", tsdmapp="json", tsdmv="4", nodoc="1"
).items()}
fixtures = [
    {"type": "space_wall", "schema": 63, "ok": 1, "uid": 0, "page": 1,
     "owner": {"uid": 502, "username": "Fictional Cedar"},
     "comments": [{"cid": 94, "message": "Fictitious wall note"}]},
    {"ok": 0, "uid": 0, "login": 1, "message_key": "to_login",
     "message": "Sign in to read this wall"},
]
seen = []
status_query = {"id": ["tsdmapp:api"], "action": ["status"]}
status = {"ok": 1, "uid": 0, "v4": 1, "space_pages": ["wall"]}
wall_reads = []


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        target = urlsplit(self.path)
        parameters = parse_qs(target.query)
        seen.append({"method": "GET", "path": target.path, "query": parameters})
        if self.headers.get("Cookie"):
            self.send_error(400)
            return
        if target.path == "/plugin.php" and parameters == status_query:
            body = json.dumps(status).encode()
        elif target.path == "/home.php" and parameters == query:
            body = json.dumps(fixtures[0 if len(wall_reads) < 2 else 1]).encode()
            wall_reads.append(target)
        else:
            self.send_error(400)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server, tempfile.TemporaryDirectory() as temp:
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        jar = Path(temp, "cookies.txt")
        jar.write_text("")
        env = {**os.environ, "TSDM_ORIGIN": f"http://127.0.0.1:{server.server_port}",
               "TSDM_MEMBER": "502", "TSDM_COOKIE_JAR": str(jar), "NO_PROXY": "127.0.0.1"}
        env.pop("TSDM_COOKIE", None)
        def run(args):
            return subprocess.run(args, env=env, check=False, capture_output=True, text=True, timeout=30)

        read = run([sys.executable, "-c", python])
        raw = run(["/bin/sh", "-c", curl])
        refused = run([sys.executable, "-c", python])
        assert read.returncode == 0 and read.stdout.strip() == "[94]", read.stderr
        assert raw.returncode == 0 and json.loads(raw.stdout) == fixtures[0], raw.stderr
        assert refused.returncode == 1 and refused.stderr.strip() == fixtures[1]["message"], refused.stderr
        status_read = {"method": "GET", "path": "/plugin.php", "query": status_query}
        wall_read = {"method": "GET", "path": "/home.php", "query": query}
        status["space_pages"] = ["poke"]
        declined = run([sys.executable, "-c", python])
        declined_curl = run(["/bin/sh", "-c", curl])
        assert declined.returncode == 1 and declined.stderr.strip() == "Open the native wall in this session"
        assert declined_curl.returncode == 1 and not declined_curl.stdout
        assert seen == [status_read, wall_read] * 3 + [status_read, status_read], seen
    finally:
        server.shutdown()
        worker.join()

print(json.dumps({
    "evidence": "controlled direct guide over loopback",
    "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "guideSHA256": hashlib.sha256(guide.encode()).hexdigest(),
    "python": sys.version.split()[0],
    "requests": requests.__version__,
    "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0].split()[1],
    "requestsObserved": seen,
    "results": [
        {"example": "Python wall read", "expected": [94], "observed": json.loads(read.stdout)},
        {"example": "curl wall read", "expected": fixtures[0], "observed": json.loads(raw.stdout)},
        {"example": "Python declines an unadvertised wall", "expected": "Open the native wall in this session", "observed": declined.stderr.strip()},
        {"example": "curl declines an unadvertised wall", "expected": 1, "observed": declined_curl.returncode},
        {"example": "Python refuses login requirement", "expected": fixtures[1]["message"], "observed": refused.stderr.strip()},
    ],
}, ensure_ascii=False, sort_keys=True, indent=2))

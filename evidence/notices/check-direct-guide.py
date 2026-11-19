"""Extract the packed Python and curl snippets and check their loopback HTTP traffic."""

from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import parse_qsl, urlsplit

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as tar:
    guide = tar.extractfile("package/docs/notices.md").read().decode()
since = "1793491200"
cursor = "1794278273_26771"
first = {
    "ok": 1, "uid": 34, "time": 1794534229, "formhash": "fixture-first",
    "notices": [{"id": 26771, "dateline": 1794278273, "new": 1}],
    "has_more": 1, "next": cursor, "counts": {"notice": 2},
}
last = {
    "ok": 1, "uid": 34, "time": 1794534246, "formhash": "fixture-continuation",
    "notices": [{"id": 26545, "dateline": 1794000000, "new": 1}], "has_more": 0,
}
initial_get = {"method": "GET", "path": "/plugin.php", "query": {
    "id": "tsdmapp:api", "action": "notify", "since": since, "limit": "200",
}, "fields": {}}
continuation_get = {"method": "GET", "path": "/plugin.php", "query": {
    "id": "tsdmapp:api", "action": "notify", "limit": "200", "before": cursor,
}, "fields": {}}
seen_post = {"method": "POST", "path": "/plugin.php", "query": {
    "id": "tsdmapp:api", "action": "seen",
}, "fields": {"formhash": "fixture-first", "notice": "1794534229"}}


class FixtureHandler(BaseHTTPRequestHandler):
    def respond(self):
        parsed = urlsplit(self.path)
        fields = self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode()
        query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
        field_pairs = parse_qsl(fields, keep_blank_values=True)
        actual = {"method": self.command, "path": parsed.path,
                  "query": dict(query_pairs), "fields": dict(field_pairs)}
        self.server.trace.append(actual)
        index = len(self.server.trace) - 1
        if index >= len(self.server.plan):
            self.send_error(400)
            return
        expected, status, body = self.server.plan[index]
        if (actual != expected or len(query_pairs) != len(actual["query"])
                or len(field_pairs) != len(actual["fields"])):
            self.send_error(400)
            return
        if self.command == "POST" and self.headers.get_content_type() != "application/x-www-form-urlencoded":
            self.send_error(415)
            return
        if status is None:
            self.close_connection = True
            return
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    do_GET = respond
    do_POST = respond

    def log_message(self, *_args):
        pass


def run_case(server, command, flag, env, cases, output, success=True):
    server.trace = []
    server.plan = cases
    result = subprocess.run(command + flag, env=env, capture_output=True, text=True, timeout=30)
    expected = {"success": success, "stdout": output, "trace": [item[0] for item in cases]}
    observed = {"success": result.returncode == 0, "stdout": result.stdout.splitlines(), "trace": server.trace}
    assert expected == observed, (command, expected, observed, result.stderr)
    return {"expected": expected, "observed": observed}


scans = [(initial_get, 200, first), (continuation_get, 200, last)]
rows = ["26771 26545"]
confirm = ["--acknowledge"]
successful = {"ok": 1, "uid": 34, "notice": 1, "newer": 0}
results, snippets = {}, {}
with HTTPServer(("127.0.0.1", 0), FixtureHandler) as server, TemporaryDirectory() as directory:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        env = {**os.environ, "NOTICE_FIXTURE_ORIGIN": f"http://127.0.0.1:{server.server_port}"}
        for language, executable, suffix in (("python", sys.executable, "py"), ("sh", "bash", "sh")):
            snippet, = re.findall(rf"^```{language}\n(.*?)^```$", guide, re.M | re.S)
            file = Path(directory, f"notice-http.{suffix}")
            file.write_text(snippet)
            snippets[language] = sha256(snippet.encode()).hexdigest()
            command = [executable, str(file)]
            check = lambda flag, plan, output, success=True: run_case(server, command, flag, env, plan, output, success)
            results[language] = {
                "poll": check([], scans, rows),
                "deliberate acknowledgement": check(confirm, scans + [(seen_post, 200, successful)], rows + ["cleared"]),
                "newer unread": check(confirm, scans + [(seen_post, 200, {**successful, "newer": 1})], rows + ["newer-unread"]),
                "lost acknowledgement": check(confirm, scans + [(seen_post, None, None)], rows + ["unknown-effect"]),
                "wrong acknowledgement account": check(confirm, scans + [(seen_post, 200, {**successful, "uid": 35})], rows + ["unknown-effect"]),
                "replayed terminal page": check(confirm, scans[:1] + [(continuation_get, 200, {**first, "has_more": 0, "next": ""})], [], False),
                "terminal continuation token": check(confirm, scans[:1] + [(continuation_get, 200, {**last, "next": cursor})], [], False),
                "uncovered unread total": check(confirm, [(initial_get, 200, {**first, "counts": {"notice": 221}}), scans[1]], [], False),
                "rate-limited continuation": check(confirm, scans[:1] + [(continuation_get, 429, {"ok": 0})], [], False),
                "wrong continuation account": check(confirm, scans[:1] + [(continuation_get, 200, {**last, "uid": 35})], [], False),
            }
    finally:
        server.shutdown()
        thread.join()

print(json.dumps({
    "evidence": "controlled loopback HTTP using snippets from the exact SDK archive",
    "archiveSHA256": sha256(archive.read_bytes()).hexdigest(),
    "inputSHA256": sha256(Path(__file__).read_bytes()).hexdigest(),
    "snippetsSHA256": snippets, "python": sys.version.split()[0],
    "requests": requests.__version__,
    "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0],
    "jq": subprocess.check_output(["jq", "--version"], text=True).strip(),
    "results": results,
}, indent=2))

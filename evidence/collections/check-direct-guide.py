"""Replay the packaged Python requests and curl reads against a local fixture."""
import hashlib
import json
import re
import subprocess
import sys
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests


class Forum(BaseHTTPRequestHandler):
    fixture = '<h1><a href="/forum.php?mod=collection&amp;action=view&amp;ctid=91">Example Archive</a></h1>'
    observed = []

    def do_GET(self):
        self.observed.append({"method": self.command, "path": self.path, "cache": self.headers.get("Cache-Control")})
        body = self.fixture.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def check(archive):
    with tarfile.open(archive, "r:gz") as package:
        guide = package.extractfile("package/docs/collections.md").read().decode()
    expected = {"method": "GET", "path": "/forum.php?mod=collection&action=view&ctid=91", "cache": "no-cache"}
    checks = []
    with HTTPServer(("127.0.0.1", 0), Forum) as forum:
        worker = threading.Thread(target=forum.serve_forever)
        worker.start()
        try:
            origin = f"http://127.0.0.1:{forum.server_port}"
            for language, command in [("python", [sys.executable, "-c"]), ("sh", ["sh", "-c"])]:
                snippet = re.search(rf"^```{language}\n(.*?)^```$", guide, re.M | re.S).group(1)
                local = snippet.replace("https://forum.example.test", origin)
                output = subprocess.check_output(command + [local], text=True, timeout=15)
                assert Forum.fixture in output
                observed = Forum.observed.pop()
                assert observed == expected, observed
                checks.append({"example": language, "expected": expected, "observed": observed, "returnedHeading": "Example Archive"})
            assert not Forum.observed
        finally:
            forum.shutdown()
            worker.join()
    return {
        "evidence": "packaged examples against a loopback read fixture",
        "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "guideSHA256": hashlib.sha256(guide.encode()).hexdigest(),
        "tools": {"python": sys.version.split()[0], "requests": requests.__version__, "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0].split()[1]},
        "results": checks,
    }


if __name__ == "__main__":
    archive = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dist/tsdm-sdk-0.1.0.tgz")
    print(json.dumps(check(archive), ensure_ascii=False, indent=2))

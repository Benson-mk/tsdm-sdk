"""Exercise the packaged Python and curl helpers over loopback with fictitious data."""

from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import parse_qs, urlsplit
import json
import os
import re
import shlex
import subprocess
import sys
import tarfile

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile("package/docs/profile.md").read().decode()
python, signature_python = re.findall(r"^```python\n(.*?)^```$", guide, re.M | re.S)
shell, signature_shell = re.findall(r"^```sh\n(.*?)^```$", guide, re.M | re.S)

profile = "/home.php?mod=spacecp&ac=profile&op=info&tsdmapp=json"
sync = "/plugin.php?id=tsdmapp%3Aapi&action=sync"
devices = "/plugin.php?id=tsdmapp%3Aapi&action=device"
fixture_device = "8ff19e8b-e328-4d40-843d-c79267d29701"
signature = "[b]Fixture café[/b]"
formhash = "fixturehash"
register = {
    "formhash": formhash, "op": "register", "device": fixture_device,
    "platform": "linux", "app_version": "0.1.0",
}
steps = [
    ("GET", sync, None, None, 200, {"uid": 501, "updated": 0, "data": None, "supported": 1, "formhash": formhash, "ok": 1}),
    ("POST", profile, {"sightml": signature, "formhash": formhash, "profilesubmit": "true", "profilesubmitbtn": "true"}, None, 302, {}),
    ("POST", devices, register, fixture_device, 200, {"uid": 501, "ok": 1, "op": "register"}),
]
seen, entered, errors = [], [], []


class Forum(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.handle_step()

    def do_POST(self):
        self.handle_step()

    def handle_step(self):
        try:
            entered.append(self.path)
            method, path, fields, header, status, response = steps[len(seen) % len(steps)]
            actual_url, expected_url = urlsplit(self.path), urlsplit(path)
            assert (self.command, actual_url.path, parse_qs(actual_url.query)) == (method, expected_url.path, parse_qs(expected_url.query))
            assert self.headers["Cookie"] == "fixture_session=jar"
            assert self.headers["X-Tsdmapp-Device"] == header
            assert self.headers["Authorization"] is None
            if method == "GET":
                assert self.headers["Cache-Control"] == "no-cache"
            if fields:
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                if path == profile:
                    assert self.headers["Content-Type"].startswith("multipart/form-data; boundary=")
                    actual = dict(re.findall(rb'name="([^"]+)"\r\n\r\n([^\r\n]*)\r\n', raw))
                    assert {key.decode(): value.decode() for key, value in actual.items()} == fields
                else:
                    assert self.headers["Content-Type"] == "application/x-www-form-urlencoded"
                    assert parse_qs(raw.decode()) == {key: [value] for key, value in fields.items()}
            seen.append({"method": method, "path": path, "fields": fields, "status": status})
            self.send_response(status)
            if status == 302:
                self.send_header("Location", "/unexpected-redirect")
            body = json.dumps(response).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            errors.append(repr(error))
            self.send_error(500)


with HTTPServer(("127.0.0.1", 0), Forum) as server, TemporaryDirectory() as tmp:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        cookie_jar = Path(tmp) / "cookies.txt"
        cookie_jar.write_text("# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tfixture_session\tjar\n")
        os.environ.update(FORUM_ORIGIN=f"http://127.0.0.1:{server.server_port}",
                          COOKIE_JAR=str(cookie_jar), FORM_ACTION=profile,
                          FORM_HASH=formhash, SIGNATURE=signature,
                          NO_PROXY="127.0.0.1", no_proxy="127.0.0.1")
        scope = {"signature": signature}
        exec(python, scope)
        with requests.Session() as session:
            session.trust_env = False
            session.cookies.set("fixture_session", "jar", domain="127.0.0.1", path="/")
            scope["session"] = session
            assert scope["read"](session, sync).json()["uid"] == 501
            exec(signature_python, scope)
            assert scope["response"].status_code == 302
            written = scope["submit"](session, devices, list(register.items()), device=fixture_device)
            assert written.json()["op"] == "register"
        field_options = " ".join("--data-urlencode " + shlex.quote(f"{key}={value}") for key, value in register.items())
        script = shell + "\nread_forum " + shlex.quote(sync) + "\n" + signature_shell
        script += "\npost_forum " + shlex.quote(devices) + " --header " + shlex.quote("X-Tsdmapp-Device: " + fixture_device) + " " + field_options
        output = subprocess.check_output(["sh", "-ec", script], text=True)
        assert re.findall(r"HTTP/1\.0 (\d+)", output) == ["200", "302", "200"]
        assert '"op": "register"' in output
        assert not errors, errors
        assert len(entered) == len(seen) == 6
    finally:
        if errors:
            print(errors, file=sys.stderr)
        server.shutdown()
        worker.join()

print(json.dumps({"evidence": "controlled loopback HTTP", "archiveSHA256": sha256(archive.read_bytes()).hexdigest(),
                  "pythonRequests": seen[:3], "curl": seen[3:], "redirectFollowed": False}, indent=2))

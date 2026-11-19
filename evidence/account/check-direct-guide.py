#!/usr/bin/env python3
"""Run the packaged requests and curl helpers against a loopback-only fixture."""

import hashlib
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
from urllib.parse import parse_qs, urlencode

import requests


def ajax(html):
    return f"<?xml version='1.0'?><root><![CDATA[{html}]]></root>"


def steps():
    status = "/plugin.php?id=tsdmapp%3Aapi&action=status"
    center = "/home.php?mod=spacecp&ac=account"
    login = "/member.php?mod=logging&action=login"
    out = [
        ("guest status", status, None, '{"ok":1,"uid":0}', "offline-guest"),
        (
            "login form", login + "&infloat=yes&handlekey=login&inajax=1&ajaxtarget=fwin_content_login",
            None, ajax('<form><input name="formhash" value="fake-form"></form>'), None,
        ),
        ("verification image", "/misc.php?mod=seccode&idhash=fake-image&update=1", None, "fixture image", None),
        (
            "deliberate login", login + "&loginsubmit=yes&handlekey=login&inajax=1&loginhash=fake-login",
            {"formhash": "fake-form", "username": "fictional", "password": "fake-password", "seccodeverify": "fake-code"},
            ajax("<script>succeedhandle_login('/', 'Welcome', {'username':'fictional','uid':'31'});</script>"), "offline-member",
        ),
        ("returned identity", status, None, '{"ok":1,"uid":31}', None),
    ]
    for method, fields in (
        ("chgpassword", {"newpassword": "fake-next", "renewpassword": "fake-next"}),
        ("chgemail", {"email": "fictional@example.invalid"}),
        ("chgquestion", {"questionidnew": "2", "answernew": "fake-answer"}),
    ):
        dest = center + "&op=verify&method=" + method
        signed = dest + "&sign=fake-sign&idstring=fake-id&inajax=1"
        out.extend([
            (f"{method} own account center", center, None, "<script>var discuz_uid='31';</script>", None),
            (f"{method} verification form", dest + "&inajax=1", None, ajax('<input name="password" type="password">'), None),
            (
                f"{method} deliberate verification", dest + "&verify=password&security_submit=yes&inajax=1",
                {"password": "fake-current", "formhash": "fake-form", "security_submit": "true"},
                ajax(f'<script>showWindow("{method}", "{signed}");</script>'), None,
            ),
            (f"{method} signed form", signed, None, ajax("<form></form>"), None),
            (
                f"{method} deliberate submit", signed + "&submit=yes&tsdmapp=json", {"submit": "true", **fields},
                '{"type":"result","schema":13,"uid":31,"ok":0,"message_key":"account_change_success"}', None,
            ),
        ])
    out.extend([
        ("logout effect", "/member.php?mod=logging&action=logout&formhash=fake-form", None, "已退出", "offline-guest"),
        ("logout readback", status, None, '{"ok":1,"uid":0}', None),
        ("redirect stays with the caller", "/fixture-redirect", {"submit": "true"}, "", None),
    ])
    return out


def replay(exchange):
    queue = steps()
    differences = []
    observations = []
    current_cookie = None
    index = 0

    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            nonlocal index, current_cookie
            if index >= len(queue):
                differences.append("unexpected extra request")
                self.send_error(400)
                return
            name, target, fields, body, rotate = queue[index]
            index += 1
            expected_method = "GET" if fields is None else "POST"
            length = int(self.headers.get("Content-Length", "0"))
            actual_fields = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True)
            expected_fields = {key: [value] for key, value in (fields or {}).items()}
            if (
                self.command != expected_method or self.path != target
                or actual_fields != expected_fields
                or self.headers.get("Cookie") != current_cookie
                or (fields is not None and self.headers.get("Content-Type") != "application/x-www-form-urlencoded")
            ):
                differences.append(name)
                self.send_error(400)
                return
            code = 303 if target == "/fixture-redirect" else 200
            self.send_response(code)
            if code == 303:
                self.send_header("Location", "/unexpected-follow")
            if rotate:
                self.send_header("Set-Cookie", f"fixture={rotate}; Path=/; HttpOnly")
                current_cookie = f"fixture={rotate}"
            self.end_headers()
            self.wfile.write(body.encode())

        do_GET = do_POST = handle_request

        def log_message(self, *_):
            pass

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            for name, target, fields, expected_body, _ in queue:
                expected_status = 303 if target == "/fixture-redirect" else 200
                status, body = exchange(origin, target, fields)
                assert status == expected_status and body == expected_body.encode(), name
                observations.append({
                    "operation": name,
                    "method": "GET" if fields is None else "POST",
                    "expectedStatus": expected_status,
                    "observedStatus": status,
                    "responseMatched": True,
                })
        finally:
            server.shutdown()
            thread.join()
    assert not differences, differences
    assert index == len(queue)
    return observations


def main(archive):
    with tarfile.open(archive, "r:gz") as tar:
        guide = tar.extractfile("package/docs/account.md").read().decode()
    python = re.search(r"^```python\n([\s\S]+?)^```$", guide, re.M)[1]
    shell = re.search(r"^```sh\n([\s\S]+?)^```$", guide, re.M)[1]
    namespace = {"__name__": "fixture_guide"}
    exec(compile(python, "docs/account.md", "exec"), namespace)
    with requests.Session() as session:
        session.trust_env = False
        python_results = replay(lambda *args: namespace["fixture_exchange"](session, *args))
    with TemporaryDirectory(prefix="sdk-account-direct-") as folder:
        response = Path(folder, "response")
        jar = Path(folder, "jar")
        jar.touch(mode=0o600)

        def curl_exchange(origin, target, fields):
            result = subprocess.run(
                ["sh", "-c", shell + "\nfixture_exchange\n"],
                input=b"" if fields is None else urlencode(fields).encode(),
                env={**os.environ, "FIXTURE_ORIGIN": origin, "TARGET": target,
                     "METHOD": "GET" if fields is None else "POST", "JAR": str(jar), "RESPONSE": str(response)},
                capture_output=True, check=True,
            )
            return int(result.stdout), response.read_bytes()

        curl_results = replay(curl_exchange)
    assert python_results == curl_results
    print(json.dumps({
        "evidence": "controlled loopback server with synthetic responses and jar",
        "archiveSHA256": hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
        "python": sys.version.split()[0], "requests": requests.__version__,
        "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0],
        "bothClients": python_results,
    }, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])

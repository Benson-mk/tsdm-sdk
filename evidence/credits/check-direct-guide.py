"""Replay the packaged Python and curl credit examples on an inert loopback forum."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

archive = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/tsdm-sdk-0.1.0.tgz")
with tarfile.open(archive) as package:
    guide = package.extractfile("package/docs/credits.md").read()
blocks = {lang: re.search(rf"^```{lang}\n([\s\S]+?)^```$", guide.decode(), re.M).group(1)
          for lang in ("python", "sh")}
functions = {}
exec(compile(blocks["python"], "packed-credits-guide.py", "exec"), functions)
calls = []
results = []


def trace(method, target, fields=None, *, cookie="credits_fixture=loopback"):
    parsed = urlsplit(target)
    return {"method": method, "path": parsed.path, "query": parse_qs(parsed.query, keep_blank_values=True),
            "fields": {k: [v] for k, v in (fields or {}).items()}, "cookie": cookie}


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size).decode()
        request = trace(self.command, self.path, cookie=self.headers.get("Cookie"))
        request["fields"] = parse_qs(body, keep_blank_values=True)
        calls.append(request)
        if request["query"].get("test_redirect") == ["1"]:
            self.send_response(302)
            self.send_header("Location", "/unexpected-redirect")
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"fixture":"inert"}')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, expected, observed_body):
    assert calls == expected, (name, calls, expected)
    assert observed_body, name
    results.append({"name": name, "expected": expected, "actual": calls.copy()})
    calls.clear()


attendance = "/plugin.php?id=tsdmapp%3Aapi&action=checkin"
checkin = "/plugin.php?id=dsu_paulsign%3Asign&operation=qiandao&infloat=1&inajax=1&tsdmapp=json"
base = "/home.php?mod=spacecp&ac=credit"
log = base + "&op=log&tsdmapp=json&nodoc=1&exttype=2&income=1&optype=PRC&starttime=2026-11-01&endtime=2026-11-30&page=2"
group = "/home.php?mod=spacecp&ac=usergroup"
expiry = group + "&do=expiry&tsdmapp=json&tsdmform=1&nodoc=1"
switch = group + "&do=switch&groupid=22"
switch_open = switch + "&handlekey=switchgrouphk&infloat=yes&inajax=1&tsdmapp=json&tsdmform=1"
switch_post = switch + "&inajax=1&tsdmapp=json"
checkin_fields = {"formhash": "f1f2f3f4", "qdmode": "1", "qdxq": "kx", "todaysay": "Exact & 原文", "fastreply": "1"}
switch_fields = {"formhash": "f1f2f3f4", "groupsubmit": "true", "gid": "", "editsubmit_btn": "true",
                 "handlekey": "switchgrouphk", "referer": "https://forum.invalid/"}
with ThreadingHTTPServer(("127.0.0.1", 0), Forum) as server, TemporaryDirectory() as directory:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        origin = "http://127.0.0.1:" + str(server.server_port)
        session = requests.Session()
        session.trust_env = False
        session.cookies.set("credits_fixture", "loopback", domain="127.0.0.1", path="/")
        for name, route, options in [
            ("attendance", attendance, {}),
            ("balance", base + "&op=base&tsdmapp=json&nodoc=1&tsdmv=4", {}),
            ("log", log, {"exttype": 2, "income": 1, "optype": "PRC", "starttime": "2026-11-01", "endtime": "2026-11-30", "page": 2}),
            ("group", group + "&tsdmapp=json&nodoc=1&tsdmv=4", {}),
            ("group", group + "&tsdmapp=json&nodoc=1&tsdmv=4&gid=15", {"gid": 15}),
            ("expiry", expiry, {}),
        ]:
            r = functions["read_view"](session, origin, name, **options)
            observe("Python read " + name + (" detail" if options.get("gid") else ""), [trace("GET", route)], r.json() == {"fixture": "inert"})
        r = functions["open_switch"](session, origin, switch + "&handlekey=switchgrouphk", "22")
        observe("Python opens switch window", [trace("GET", switch_open)], r.status_code == 200)
        r = functions["submit_checkin"](session, origin, "f1f2f3f4", "kx", "Exact & 原文", approved=True)
        observed = functions["read_view"](session, origin, "attendance")
        observe("Python deliberate check-in followed by a separate read", [trace("POST", checkin, checkin_fields), trace("GET", attendance)], r.status_code == observed.status_code == 200)
        r = functions["submit_switch"](session, origin, switch, "22", switch_fields, approved=True)
        observe("Python deliberate group switch", [trace("POST", switch_post, switch_fields)], r.status_code == 200)
        r = functions["submit_switch"](session, origin, switch, "22", switch_fields)
        observe("Python switch without approval sends zero requests", [], r is None)
        try:
            functions["submit_switch"](session, origin, switch, "23", switch_fields, approved=True)
        except ValueError:
            observe("Python rejects a mismatched switch target", [], True)
        else:
            raise AssertionError("Expected rejection")

        jar = Path(directory) / "cookies.txt"
        jar.write_text("# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tcredits_fixture\tloopback\n")
        fields = Path(directory) / "switch.txt"
        fields.write_text(urlencode(switch_fields))
        env = dict(os.environ, NO_PROXY="127.0.0.1", FORUM_ORIGIN=origin, FORUM_COOKIE_JAR=str(jar),
                   FORMMODE="", FORMHASH="f1f2f3f4", FEELING="kx", TODAYSAY="Exact & 原文", SWITCH_URL=origin + switch_post,
                   SWITCH_FIELDS=str(fields))
        def shell(mode, approval="", **values):
            return subprocess.run(["sh", "-eu", "-c", blocks["sh"]],
                                  env=env | values | {"CREDITS_MODE": mode, "CREDITS_APPROVAL": approval}, capture_output=True)
        for route, name in [(attendance, "attendance"), (log, "bounded log"), (switch_open, "switch opener")]:
            r = shell("read", READ_URL=origin + route)
            observe("curl read " + name, [trace("GET", route)], r.returncode == 0 and b'{"fixture":"inert"}' in r.stdout)
        r = shell("check-in", "check-in")
        observe("curl deliberate check-in", [trace("POST", checkin, checkin_fields)], r.returncode == 0)
        r = shell("switch", "switch")
        observe("curl deliberate switch", [trace("POST", switch_post, switch_fields)], r.returncode == 0)
        r = shell("switch")
        observe("curl requires approval for switch", [], r.returncode == 2)
        redirect = attendance + "&test_redirect=1"
        r = shell("read", READ_URL=origin + redirect)
        observe("curl stops at the unresolved redirect", [trace("GET", redirect)], r.returncode == 0 and b"302" in r.stdout)
    finally:
        server.shutdown()
        worker.join()

sha = lambda data: hashlib.sha256(data).hexdigest()
print(json.dumps({"archiveSHA256": sha(archive.read_bytes()), "guideSHA256": sha(guide),
                  "python": sys.version.split()[0], "requests": requests.__version__,
                  "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0],
                  "limitations": ["Inert loopback responses", "No deployed forum traffic or account effects"],
                  "results": results}, ensure_ascii=False, indent=2))

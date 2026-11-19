"""Replay the packaged Python and curl discovery examples against a local forum."""

from hashlib import sha256
import json
import os
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
import re
from shlex import quote
import subprocess
import sys
import tarfile
from threading import Thread
from urllib.parse import parse_qs, urlsplit

archive, fixtures = map(Path, sys.argv[1:])
with tarfile.open(archive) as tarball:
    guide = tarball.extractfile("package/docs/discovery.md").read().decode()
python = re.findall(r"^```python\n(.*?)^```$", guide, re.M | re.S)
shell = re.findall(r"^```sh\n(.*?)^```$", guide, re.M | re.S)
assert len(python) == len(shell) == 3

routes = {
    ("/forum.php", "guide", "index"): "tsdmapp/guide_v7_index.json",
    ("/home.php", "space", "thread"): "tsdmapp/mythread_v9_thread.json",
    ("/home.php", "space", "reply"): "tsdmapp/mythread_v9_other_reply.json",
    ("/home.php", "space", "save"): "tsdmapp/mythread_v9_draft.json",
    ("/misc.php", "ranklist", "credit"): "ranklist/member_credit_x5.html",
    ("/misc.php", "ranklist", "heats"): "ranklist/thread_heats_x5.html",
    ("/misc.php", "tag", ""): "tag/tag_cloud_x5.html",
    ("/misc.php", "stat", ""): "site_stats/basic.html",
}
requests_seen = []
errors = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            assert not self.headers.get("Cookie") and not self.headers.get("Authorization")
            url = urlsplit(self.path)
            params = {key: values[0] for key, values in parse_qs(url.query).items()}
            requests_seen.append([url.path, params.copy()])
            if url.path == "/search.php":
                assert params.pop("mod") == "forum"
                assert params.pop("tsdmapp") == "json"
                assert params.pop("searchsubmit") == "yes"
                if "searchid" in params:
                    assert params == {"searchid": "1", "orderby": "lastpost", "ascdesc": "desc", "page": "2"}
                    fixture = "tsdmapp/search_v6_p2.json"
                else:
                    assert params == {"srchtxt": "网盘"}
                    fixture = "tsdmapp/search_v6_results.json"
            else:
                mod = params["mod"]
                view = params.get("filter") or params.get("view") or ""
                if mod == "space":
                    assert params["view"] == "me" and params["do"] == "thread"
                    view = params.get("filter") or params["type"]
                fixture = routes[(url.path, mod, view)]
                if mod in ("space", "guide"):
                    assert params.get("tsdmapp") == "json"
            body = (fixtures / fixture).read_bytes()
            self.send_response(200)
            kind = "application/json" if fixture.endswith(".json") else "text/html"
            self.send_header("Content-Type", kind + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as failure:
            errors.append(failure)
            self.send_error(500)

    def log_message(self, *_args):
        pass


with ThreadingHTTPServer(("127.0.0.1", 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    os.environ["ORIGIN"] = f"http://127.0.0.1:{server.server_port}"
    os.environ.pop("FORUM_COOKIE_JAR", None)
    os.environ.update(SEARCH_ID="1", RETURNED_ORDER="lastpost", RETURNED_DIRECTION="desc")
    try:
        scope = {"search_id": "1", "returned_order": "lastpost", "returned_direction": "desc"}
        exec(python[0], scope)
        stdout = StringIO()
        with redirect_stdout(stdout):
            exec(python[1], scope)
        search = scope["outcome"]
        assert (search["searchid"], search["count"], search["page"]) == (1, 211, 1)
        exec(python[2], scope)
        assert scope["page2"].json()["threads"][0]["tid"] == 9199821

        def run_shell(command):
            return subprocess.check_output(["bash", "-ec", shell[0] + command], text=True)

        first = run_shell(shell[1])
        assert " 200 " in first.splitlines()[0]
        assert json.loads(first.split("\n\n", 1)[1])["searchid"] == 1
        assert json.loads(run_shell(shell[2]))["threads"][0]["tid"] == 9199821

        paths = re.findall(r"^\|\s*(?:Guide index and lists|Member threads|Member replies|Saved drafts|Member rankings|Thread rankings|Tag cloud and detail|Statistics)\s*\|\s*`(/[^`]+)`", guide, re.M)
        assert len(paths) == len(routes)
        for path in paths:
            response = scope["get"](path)
            body = run_shell(f'forum_get "$ORIGIN"{quote(path)}\n')
            assert body == response.text
            if "text/html" in response.headers["Content-Type"]:
                assert scope["html"](response).select_one("div") is not None
        assert not errors and len(requests_seen) == 20
    finally:
        server.shutdown()
        thread.join()

print(json.dumps({
    "kind": "controlled loopback",
    "archive": archive.name,
    "sha256": sha256(archive.read_bytes()).hexdigest(),
    "python": sys.version.split()[0],
    "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0].split()[:2],
    "requests": requests_seen,
    "observed": {"searchId": 1, "count": 211, "page2FirstThread": 9199821, "readBodiesMatchedAcrossClients": len(paths)},
}, indent=2, ensure_ascii=False))

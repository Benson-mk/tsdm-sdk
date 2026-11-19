"""Run the packaged direct examples against a disposable fictitious forum."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile("package/docs/posts.md").read().decode()
python = re.search(r"^```python\n([\s\S]+?)^```$", guide, re.M)[1]
shell = re.search(r"^```sh\n([\s\S]+?)^```$", guide, re.M)[1]
requests = []
subject = "Fictitious subject"
message = "Fictitious controlled message."
date = "2099-04-03 14:05"
fixture_cookie = "fixture_session=fiction"


class Forum(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def record(self, fields=None):
        path = urlsplit(self.path)
        row = {"method": self.command, "path": path.path, "query": parse_qs(path.query, keep_blank_values=True),
               "cookie": self.headers.get("Cookie")}
        if fields is not None:
            row["fields"] = fields
        requests.append(row)
        return row["query"]

    def do_GET(self):
        query = self.record()
        action = query.get("action", [""])[0]
        edit = action == "edit"
        pid = int(query.get("pid", ["0"])[0])
        first = pid != 102
        fields = {"formhash": "fakehash", "posttime": "1700000000", "save": ""}
        if edit:
            fields.update(fid="7", tid="42", pid=str(pid), editsubmit="true")
            destination = "forum.php?mod=post&action=edit&extra=&editsubmit=yes"
        else:
            fields["topicsubmit"] = "true"
            destination = "forum.php?mod=post&action=newthread&fid=7&topicsubmit=yes"
        self.answer({"schema": 16, "type": "post", "ok": 1, "uid": 31, "action": action,
                     "fid": 7, "tid": 42 if edit else 0, "pid": pid, "first": int(first),
                     "subject": {"shown": 1, "value": subject if first else "Fictitious reply subject"}, "message": {"value": "Fictitious previous message."},
                     "thread": {"tid": 42, "draft": int(pid == 103)},
                     "draft": {"can_save": int(not edit or pid == 103), "publish": int(pid == 103)},
                     "cronpublish": {"inputs": [
                         {"name": "cronpublish", "type": "checkbox", "checked": 0, "value": "true"},
                         {"name": "cronpublishdate", "value": ""},
                     ]} if not edit else None,
                     "options": [{"name": "usesig", "type": "checkbox", "value": "1", "checked": 1},
                                 {"name": "htmlon", "type": "checkbox", "value": "0", "checked": 1, "disabled": 1}],
                     "attach": {"fields": {"attachnew[301][description]": "Fictitious attachment label"}} if edit else None,
                     "submit": {"method": "POST", "url": destination, "fields": fields}})

    def do_POST(self):
        self.record(parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode(), keep_blank_values=True))
        self.answer({"type": "result", "schema": 13, "ok": 1, "uid": 31, "kind": "redirect", "login": 0,
                     "url": "forum.php?mod=viewthread&tid=42"})


with HTTPServer(("127.0.0.1", 0), Forum) as forum:
    server = threading.Thread(target=forum.serve_forever, daemon=True)
    server.start()
    results = []
    try:
        for language, command in (("Python requests", [sys.executable, "-c", python]), ("curl", ["sh", "-c", shell])):
            for job, pid, approved in [("new-thread", None, True), ("edit-first", "101", True),
                                       ("edit-reply", "102", True), ("save-draft", None, True),
                                       ("save-draft", "103", True), ("publish-draft", "103", True),
                                       ("schedule", None, True), ("new-thread", None, False)]:
                env = {key: value for key, value in os.environ.items() if key not in {
                    "FORUM_ORIGIN", "FORUM_COOKIE", "MEMBER_ID", "BOARD_ID", "POST_MESSAGE", "POST_ACTION",
                    "THREAD_ID", "POST_ID", "POST_SUBJECT", "CATEGORY_ID", "FORUM_DATE", "POST_ACCEPT",
                }}
                env.update(FORUM_ORIGIN=f"http://127.0.0.1:{forum.server_port}", FORUM_COOKIE="fixture_session=fake", MEMBER_ID="31",
                           BOARD_ID="7", POST_SUBJECT=subject, POST_MESSAGE=message, POST_ACTION=job, FORUM_DATE=date)
                if pid:
                    env.update(THREAD_ID="42", POST_ID=pid)
                if approved:
                    env["POST_ACCEPT"] = "YES"
                start = len(requests)
                run = subprocess.run(command, env=env, capture_output=True, text=True, timeout=25)
                assert run.returncode == 0, (language, job, run.stderr)
                observed = requests[start:]
                action = "edit" if pid else "newthread"
                query = {"mod": ["post"], "action": [action], "fid": ["7"], "tsdmapp": ["json"], "nodoc": ["1"]}
                if pid:
                    query.update(tid=["42"], pid=[pid])
                expected = [{"method": "GET", "path": "/forum.php", "query": query, "cookie": "fixture_session=fake"}]
                if approved:
                    query = {"mod": ["post"], "action": [action], "tsdmapp": ["json"]}
                    fields = {"formhash": ["fakehash"], "posttime": ["1700000000"], "usesig": ["1"],
                              "save": ["1" if job == "save-draft" else ""], "message": [message]}
                    if pid:
                        query.update(extra=[""], editsubmit=["yes"])
                        fields.update(fid=["7"], tid=["42"], pid=[pid], editsubmit=["true"])
                        fields["attachnew[301][description]"] = ["Fictitious attachment label"]
                    else:
                        query.update(fid=["7"], topicsubmit=["yes"])
                        fields.update(topicsubmit=["true"], cronpublishdate=[date if job == "schedule" else ""])
                    if job == "schedule":
                        fields["cronpublish"] = ["true"]
                    fields["subject"] = ["Fictitious reply subject" if job == "edit-reply" else subject]
                    expected.append({"method": "POST", "path": "/forum.php", "query": query,
                                     "cookie": "fixture_session=fake", "fields": fields})
                    wire = json.loads(run.stdout.splitlines()[-1])
                    assert (wire["schema"], wire["kind"], wire["url"]) == (13, "redirect", "forum.php?mod=viewthread&tid=42"), wire
                else:
                    wire = None
                assert expected == observed, (language, job, expected, observed)
                results.append({"language": language, "operation": job, "approved": approved,
                                "expected": expected, "observed": observed, "wireResult": wire})
    finally:
        forum.shutdown()
        server.join()

print(json.dumps({"evidence": "controlled loopback HTTP", "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                  "guideSHA256": hashlib.sha256(guide.encode()).hexdigest(), "results": results}, indent=2))

"""Run the exact packaged Python and curl snippets against a fictitious loopback forum."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, urlsplit

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile("package/docs/special-threads.md").read().decode()
python = re.search(r"^```python\n([\s\S]+?)^```$", guide, re.M)[1]
shell = re.search(r"^```sh\n([\s\S]+?)^```$", guide, re.M)[1]
received = []
member = "31"
cookie = "fictional_session=controlled"
formhash = "fakehash"
editor = "forum.php?mod=post&action=newthread&fid=7"
thread = "forum.php?mod=viewthread&tid=42"
submit = editor + "&extra=&topicsubmit=yes"
common = {"formhash": formhash, "subject": "Fictitious subject", "message": "Fictitious message"}
creation = {
    "poll": ("special=1", {"special": "1", "polls": "yes", "tpolloption": "1", "polloptions": "Amber\nViolet", "maxchoices": "1"}),
    "bounty": ("special=3", {"special": "3", "rewardprice": "12"}),
    "activity": ("special=4", {"special": "4", "starttimefrom[0]": "2099-05-16 15:30", "activityplace": "Fictional room", "activityclass": "Workshop"}),
    "debate": ("special=5", {"special": "5", "affirmpoint": "Fictional affirmative", "negapoint": "Fictional negative"}),
    "red-packet": ("specialextra=hongbao", {"special": "127", "specialextra": "hongbao", "hb_total": "20", "hb_shares": "4", "hb_split": "2", "hb_expire": "24"}),
}
misc = "forum.php?mod=misc&action="
activity = misc + "activityapplies&fid=7&tid=42&pid=101"
debate = misc + "debatevote&tid=42"
participation = {
    "poll-vote": ("POST", misc + "votepoll&fid=7&tid=42&pollsubmit=yes", {"pollsubmit": "true", "pollanswers[0]": "201"}, "thread_poll_succeed"),
    "activity-apply": ("POST", activity + "&inajax=1", {"activitysubmit": "true", "handlekey": "activityapplies", "message": "Fictitious application"}, "activity_completion"),
    "activity-cancel": ("POST", activity, {"activitycancel": "true", "message": "Fictitious cancellation"}, "activity_cancel_success"),
    "debate-position": ("GET", debate + "&stand=2", {"inajax": "1"}, "debate_poll_succeed"),
    "debater-vote": ("GET", debate + "&pid=102", {"inajax": "1"}, "debate_poll_succeed"),
    "bounty-answer": ("POST", misc + "bestanswer&tid=42&pid=102&from=&bestanswersubmit=yes", {"optgroup": "", "operation": "", "page": "1"}, "reward_completion"),
}


def plan(method, url, fields):
    return {"method": method, "url": url, "fields": list(fields.items())}


cases = [(kind, editor + "&" + query, plan("POST", submit, {**common, **fields}), "post_newthread_succeed")
         for kind, (query, fields) in creation.items()]
cases += [(kind, thread, plan(method, url, ({"formhash": formhash} if method == "POST" else {}) | fields), key)
          for kind, (method, url, fields, key) in participation.items()]


class Forum(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log(self, fields=None):
        uri = urlsplit(self.path)
        query = parse_qs(uri.query, keep_blank_values=True)
        recorded = {"method": self.command, "path": uri.path, "query": query, "cookie": self.headers.get("Cookie")}
        if fields is not None:
            recorded["fields"] = [list(pair) for pair in fields]
        received.append(recorded)
        return query

    def do_GET(self):
        query = self.log()
        if query.get("action") == ["debatevote"]:
            return self.write_result()
        fixture_type = "post" if query.get("mod") == ["post"] else "thread"
        self.respond({"ok": 1, "type": fixture_type, "schema": 16 if fixture_type == "post" else 15,
                      "uid": int(member), "formhash": formhash, "fixture": self.server.case})

    def do_POST(self):
        source = self.rfile.read(int(self.headers["Content-Length"])).decode()
        self.log(parse_qsl(source, keep_blank_values=True))
        self.write_result()

    def write_result(self):
        self.respond({"ok": 1, "type": "result", "schema": 13, "uid": int(member), "login": 0,
                      "kind": "message", "message_key": self.server.key, "alert": "info" if self.server.case == "bounty-answer" else "right",
                      "url": thread})


def expected_request(method, path, fields=()):
    uri = urlsplit(path)
    query = parse_qs(uri.query, keep_blank_values=True)
    query.update(tsdmapp=["json"])
    record = {"method": method, "path": "/" + uri.path, "query": query, "cookie": cookie}
    if method == "POST":
        record["fields"] = [list(pair) for pair in fields]
    else:
        for name, value in fields:
            query.setdefault(name, []).append(value)
    return record


results = []
with tempfile.TemporaryDirectory(prefix="tsdm-special-direct-") as directory, HTTPServer(("127.0.0.1", 0), Forum) as forum:
    plan_file = Path(directory) / "plan.json"
    runner = threading.Thread(target=forum.serve_forever, daemon=True)
    runner.start()
    try:
        for language, program in (("Python requests", [sys.executable, "-c", python]), ("curl", ["sh", "-c", shell])):
            for case, access, reviewed, key in cases + [cases[0]]:
                approved = not (case == cases[0][0] and any(row["language"] == language and row["operation"] == case for row in results))
                forum.case, forum.key = case, key
                plan_file.write_text(json.dumps(reviewed))
                env = dict(os.environ, FORUM_ORIGIN=f"http://127.0.0.1:{forum.server_port}", FORUM_COOKIE=cookie,
                           MEMBER_ID=member, READ_PATH=access, SPECIAL_PLAN=str(plan_file), APPROVE_SPECIAL="YES" if approved else "")
                start = len(received)
                run = subprocess.run(program, env=env, capture_output=True, text=True, timeout=20)
                assert run.returncode == 0, (language, case, run.stderr)
                observed = received[start:]
                expected = [expected_request("GET", access, [("nodoc", "1")])]
                if approved:
                    expected.append(expected_request(reviewed["method"], reviewed["url"], reviewed["fields"]))
                    wire = json.loads(run.stdout.splitlines()[-1])
                    assert (wire["schema"], wire["message_key"], wire["url"]) == (13, key, thread)
                else:
                    wire = None
                assert expected == observed, (language, case, expected, observed)
                results.append({"language": language, "operation": case, "approved": approved, "expected": expected,
                                "observed": observed, "wireResult": wire})
    finally:
        forum.shutdown()
        runner.join()
print(json.dumps({"evidence": "controlled loopback HTTP", "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                  "guideSHA256": hashlib.sha256(guide.encode()).hexdigest(), "results": results}, indent=2))

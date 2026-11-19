"""Replay the packaged Python and curl snippets using a fictitious loopback forum."""

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from threading import Thread
from urllib.parse import parse_qsl, urlsplit

import requests


class Forum(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def exchange(self):
        url = urlsplit(self.path)
        query = dict(parse_qsl(url.query))
        body = dict(parse_qsl(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode()))
        self.server.received.append({
            "method": self.command, "path": url.path, "query": query, "body": body,
            "ajax": self.headers.get("X-Requested-With"),
            "session": self.headers.get("Cookie"),
        })
        answer = b""
        status = 200
        content_type = "application/json"
        if url.path == "/misc.php":
            content_type = "text/xml"
            answer = b"<root><![CDATA[Fictional Birch]]></root>"
        elif query.get("op") == "redirect":
            status = 302
        elif self.command == "POST" and query.get("mod") == "spacecp":
            answer = b'{"type":"result","schema":13,"uid":101,"kind":"handle"}'
        elif query.get("mod") == "spacecp":
            content_type = "text/xml"
            answer = b"<root><![CDATA[<form method=post></form>]]></root>"
        elif query.get("id") == "atplus:search":
            answer = b'{"ok":1,"recent":[],"friends":[]}' if body.get("op") == "init" else b'{"ok":1,"list":[]}'
        else:
            answer = b'{"ok":1,"uid":101}'
        self.send_response(status)
        if status == 302:
            self.send_header("Location", "/unexpected")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(answer)))
        self.end_headers()
        self.wfile.write(answer)

    do_GET = exchange
    do_POST = exchange


def snippets(archive):
    with tarfile.open(archive) as pack:
        guide = pack.extractfile("package/docs/members.md").read().decode()
    return tuple(re.findall(rf"^```{language}\n([\s\S]+?)^```$", guide, re.M)[0] for language in ("python", "sh"))


def main():
    archive = Path(sys.argv[1])
    python, shell = snippets(archive)
    helpers = {}
    exec(compile(python, "members-guide.md", "exec"), helpers)
    forum = ThreadingHTTPServer(("127.0.0.1", 0), Forum)
    forum.received = []
    thread = Thread(target=forum.serve_forever, daemon=True)
    thread.start()
    root = f"http://127.0.0.1:{forum.server_port}"
    session = requests.Session()
    session.trust_env = False
    session.cookies.set("controlled", "fictional")
    env = {**os.environ, "FORUM_ORIGIN": root, "FORUM_COOKIE_JAR": "controlled=fictional", "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"}
    expected = []

    def shell_call(command, *args):
        return subprocess.check_output(["sh", "-c", shell + f'\n{command} "$@"', command, *args], env=env)

    def urlencoded(fields):
        return [part for key, value in fields.items() for part in ("--data-urlencode", f"{key}={value}")]

    def exchange(method, path, query, body=None):
        entry = {"method": method, "path": "/" + path, "query": query, "body": body or {}, "ajax": "XMLHttpRequest", "session": "controlled=fictional"}
        expected.extend([entry, entry])

    try:
        reads = [
            {"uid": "204"}, {"username": "Fictional Birch"},
            {"do": "friend", "uid": "101"}, {"do": "friend", "uid": "204"},
            {"do": "friend", "uid": "101", "group": "1"},
            {"do": "friend", "view": "visitor"},
            {"do": "friend", "view": "online", "type": "member"},
            {"do": "favorite", "type": "forum"}, {"do": "favorite", "type": "thread"},
        ]
        for read in reads:
            query = {"mod": "space", **read}
            wire = {**query, "tsdmapp": "json", "nodoc": "1"}
            assert helpers["page"](session, root, "home.php", query).json() == {"ok": 1, "uid": 101}
            assert json.loads(shell_call("get_page", "home.php", *urlencoded(wire))) == {"ok": 1, "uid": 101}
            exchange("GET", "home.php", wire)

        for text, body, field in [(None, {"op": "init"}, "recent"), ("Fictional Birch", {"op": "search", "q": "Fictional Birch"}, "list")]:
            assert helpers["atplus"](session, root, text).json()[field] == []
            assert json.loads(shell_call("atplus", *urlencoded(body)))[field] == []
            exchange("POST", "plugin.php", {"id": "atplus:search"}, body)
        stock = {"mod": "getatuser", "inajax": "1"}
        native = b"<root><![CDATA[Fictional Birch]]></root>"
        assert helpers["stock_mentions"](session, root).content == native
        assert shell_call("get_page", "misc.php", *urlencoded(stock)) == native
        exchange("GET", "misc.php", stock)

        friend = {"mod": "spacecp", "ac": "friend", "op": "add", "uid": "204"}
        forms = [
            (friend, {"handlekey": "addfriendhk_204"}, {"addsubmit": "true", "gid": "1", "note": "Hello"}, True),
            (friend, {"handlekey": "afr_204", "infloat": "yes", "from": "notice"}, {"add2submit": "true", "gid": "1", "from": "notice"}, True),
        ]
        for kind, record_id in [("forum", "502"), ("thread", "501")]:
            favorite = {"mod": "spacecp", "ac": "favorite", "type": kind}
            forms += [
                ({**favorite, "id": "44"}, {"infloat": "yes", "handlekey": "k_favorite"}, {"favoritesubmit": "true", "description": "Saved"}, True),
                ({**favorite, "op": "delete", "favid": record_id}, {"infloat": "yes", "handlekey": "favdelete"}, {"deletesubmit": "true"}, False),
            ]
        for route, fields, body, v4 in forms:
            dialog = {**route, **fields, "inajax": "1", "tsdmapp": "json"}
            if v4:
                dialog.update(tsdmform="1", tsdmv="4", nodoc="1")
            assert "<form" in helpers["page"](session, root, "home.php", dialog, structured=False).text
            assert b"<form" in shell_call("get_page", "home.php", *urlencoded(dialog))
            exchange("GET", "home.php", dialog)
            query = {**route, "inajax": "1", "tsdmapp": "json", **({"tsdmv": "4"} if v4 else {})}
            body = {"formhash": "fictional_token", "handlekey": fields["handlekey"], **body}
            action = "home.php?" + "&".join(f"{key}={value}" for key, value in query.items())
            assert helpers["submit"](session, root, action, body).json()["schema"] == 13
            assert json.loads(shell_call("submit_form", action, *urlencoded(body)))["schema"] == 13
            exchange("POST", "home.php", query, body)

        assert helpers["submit"](session, root, "home.php?op=redirect", {}).status_code == 302
        assert shell_call("submit_form", "home.php?op=redirect") == b""
        exchange("POST", "home.php", {"op": "redirect"})
        assert forum.received == expected
        print(json.dumps({
            "evidence": "packaged direct HTTP helpers against a controlled loopback forum",
            "archiveSHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "python": sys.version.split()[0], "requests": requests.__version__,
            "curl": subprocess.check_output(["curl", "--version"], text=True).splitlines()[0],
            "expected": "each exchange twice, once per language, with exact query, form body and fixture session",
            "observed": forum.received[::2],
            "requestCount": len(forum.received),
            "redirectsFollowed": 0,
        }, ensure_ascii=False, indent=2))
    finally:
        forum.shutdown()
        forum.server_close()
        thread.join()


if __name__ == "__main__":
    main()

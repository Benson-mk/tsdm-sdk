from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit

readme, fixture_root = map(Path, sys.argv[1:])
examples = dict(re.findall(r"(?ms)^```(\w+)\n(.*?)^```$", readme.read_text()))
fixtures = {
    ("forumdisplay", "2"): "forum_fid2.html",
    ("viewthread", "9199345"): "thread_plain.html",
}
observed = []

class Guides(BaseHTTPRequestHandler):
    def do_GET(self):
        target = urlsplit(self.path)
        query = parse_qs(target.query)
        route = (query.get("mod", [None])[0], (query.get("fid") or query.get("tid") or [None])[0])
        name = fixtures.get(route)
        if target.path != "/forum.php" or not name or self.headers.get("Cookie") or self.headers.get("Authorization"):
            self.send_error(400)
            return
        observed.append(route)
        body = (fixture_root / "tsdmapp" / name).read_bytes()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

with ThreadingHTTPServer(("127.0.0.1", 0), Guides) as server, tempfile.TemporaryDirectory() as directory:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    env = {**os.environ, "FORUM_ORIGIN": origin, "BOARD_ID": "2", "NO_PROXY": "127.0.0.1"}
    try:
        python = subprocess.check_output([sys.executable, "-c", examples["python"]], env=env, text=True).strip()
        assert python == "2 9199345", python
        curl = re.findall(r"(?ms)^```sh\n(.*?)^```$", readme.read_text())[-1]
        curl = curl.replace("FORUM_ORIGIN=https://www.tsdm39.com\nBOARD_ID=17\n", "")
        first, second = curl.split("# Set THREAD_URL", 1)
        board_status = subprocess.check_output(["sh", "-ec", first], cwd=directory, env=env, text=True).strip()
        from bs4 import BeautifulSoup
        from urllib.parse import urljoin
        board = Path(directory, "board.html").read_bytes()
        thread = BeautifulSoup(board, "html.parser").select_one("#threadlisttableid a.kmtit")["href"]
        env["THREAD_URL"] = urljoin(origin, thread)
        thread_status = subprocess.check_output(["sh", "-ec", "# Set THREAD_URL" + second], cwd=directory, env=env, text=True).strip()
        assert [board_status, thread_status] == ["200", "200"]
        assert Path(directory, "thread.html").read_bytes() == (fixture_root / "tsdmapp/thread_plain.html").read_bytes()
        assert board == (fixture_root / "tsdmapp/forum_fid2.html").read_bytes()
        assert observed == list(fixtures) * 2
        print(json.dumps({"python": python, "curl": [board_status, thread_status], "requests": observed}))
    finally:
        server.shutdown()

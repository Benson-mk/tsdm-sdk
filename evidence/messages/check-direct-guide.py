"""Replay the packed Python and curl guide against a controlled local forum."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlsplit

archive = Path(sys.argv[1] if len(sys.argv) == 2 else 'dist/tsdm-sdk-0.1.0.tgz')
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/messages.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}

api = 'plugin.php?id=tsdmapp%3Aapi&action='
space = 'home.php?mod=space&do=pm&'
pm = 'home.php?mod=spacecp&ac=pm&'
mode = '&tsdmapp=json&nodoc=1'
ajax = '&touid=702&pmid=0&daterange=2&inajax=1'
message = {'formhash': ['fakehash'], 'message': ['Fake & + ✓']}
expected = {
    'private': ('GET', api + 'pmlist', {}, {'ok': 1, 'uid': 701, 'pms': [{'touid': 702}]}),
    'broadcasts': ('GET', api + 'pmlist&filter=announce', {}, {'ok': 1, 'uid': 701, 'announces': [{'id': 911}]}),
    'private-native': ('GET', space + 'filter=privatepm', {}, '<div id="pmlist_812">Fake native PM</div>'),
    'broadcasts-native': ('GET', space + 'filter=announcepm', {}, '<div id="gpmlist_911">Fake native broadcast</div>'),
    'history': ('GET', space + 'subop=view&touid=702' + mode, {}, {'ok': 1, 'uid': 701, 'schema': 11, 'messages': [{'pmid': 901}]}),
    'broadcast': ('GET', space + 'subop=viewg&pmid=911' + mode + '&tsdmv=4', {}, {'ok': 1, 'uid': 701, 'schema': 40, 'announce': {'id': 911}}),
    'dialog': ('GET', pm + 'op=showmsg' + ajax + '&handlekey=showmsg_702&infloat=yes&ajaxtarget=fwin_content_showMsgBox', {}, '<root><![CDATA[<form id="pmform_702">Fake dialog</form>]]></root>'),
    'recent': ('GET', pm + 'op=showmsg' + ajax + '&msgonly=1', {}, '<root><![CDATA[<li>Fake recent</li>]]></root>'),
    'send-dialog': ('POST', pm + 'op=send&touid=702&inajax=1', {**message, 'touid': ['702'], 'handlekey': ['showmsg_702'], 'messageappend': ['fake append'], 'pmsubmit': ['true']}, {'ok': 1, 'uid': 701, 'schema': 13, 'kind': 'handle', 'handlekey': 'showmsg_702'}),
    'send-history': ('POST', pm + 'op=send&pmid=901&daterange=0&handlekey=pmsend&pmsubmit=yes&topmuid=702', message, {'ok': 1, 'uid': 701, 'schema': 13, 'kind': 'handle', 'handlekey': 'pmsend'}),
    'prompt': ('GET', api + 'notify', {}, {'ok': 1, 'uid': 701, 'formhash': 'fakehash', 'counts': {'pm': 1, 'notice': 9}}),
    'clear': ('POST', api + 'seen', {'formhash': ['fakehash'], 'pm': ['1']}, {'ok': 1, 'uid': 701, 'pm': 1, 'notice': 0}),
    'homepage': ('GET', 'forum.php?mod=index' + mode, {}, {'ok': 1, 'uid': 701, 'checknewpm': pm + 'op=checknewpm&rand=1700000000'}),
    'check': ('GET', pm + 'op=checknewpm&rand=1700000000', {}, '/* Controlled script response */'),
}


def target(raw):
    parsed = urlsplit(raw)
    return parsed.path.lstrip('/'), parse_qs(parsed.query, keep_blank_values=True)


observed = []
active = None


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        observed.append((self.command, *target(self.path), parse_qs(data, keep_blank_values=True), self.headers.get('Cookie')))
        body = expected[active][-1]
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if isinstance(body, dict) else 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write((json.dumps(body) if isinstance(body, dict) else body).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def version(args):
    return subprocess.check_output(args, text=True).splitlines()[0]


rows = []
with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    env = {**os.environ, 'FORUM_ORIGIN': f'http://127.0.0.1:{server.server_port}', 'NO_PROXY': '127.0.0.1',
           'FORUM_COOKIE': 'controlled=701', 'MEMBER_ID': '701', 'PEER_UID': '702', 'BROADCAST_ID': '911',
           'REPLY_PMID': '901', 'FORMHASH': 'fakehash', 'MESSAGE_APPEND': 'fake append', 'MESSAGE': 'Fake & + ✓',
           'CHECK_RAND': '1700000000', 'CONFIRM': '1'}
    for lang, call in [('python', [sys.executable, '-']), ('sh', ['sh'])]:
        for active, (method, route, fields, response) in expected.items():
            before = len(observed)
            run = subprocess.run(call, input=blocks[lang], text=True, capture_output=True, check=True, env={**env, 'MODE': active})
            payload = run.stdout.rstrip('\n')
            if lang == 'sh':
                headers, payload = payload.split('\n\n', 1)
                assert headers.startswith('HTTP/1.0 200 '), (active, headers)
            result = json.loads(payload) if isinstance(response, dict) else payload
            request = (method, *target(route), fields, 'controlled=701')
            assert observed[before:] == [request], (lang, active, observed[before:], request)
            assert result == response, (lang, active, result)
            rows.append({'client': lang, 'mode': active, 'expected': {'request': request, 'response': response},
                         'observed': {'request': observed[-1], 'response': result}})
        before = len(observed)
        refused = subprocess.run(call, input=blocks[lang], text=True, capture_output=True,
                                 env={**env, 'MODE': 'send-dialog', 'CONFIRM': '0'})
        assert refused.returncode != 0 and len(observed) == before
        rows.append({'client': lang, 'mode': 'send-dialog without confirmation', 'expectedDispatches': 0,
                     'observedDispatches': len(observed) - before})
    server.shutdown()
print(json.dumps({'evidence': 'controlled loopback, packed direct guide', 'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': hashlib.sha256(guide).hexdigest(), 'python': version([sys.executable, '--version']),
                  'requests': version([sys.executable, '-c', 'import requests; print(requests.__version__)']),
                  'curl': version(['curl', '--version']), 'results': rows}, ensure_ascii=False, indent=2))

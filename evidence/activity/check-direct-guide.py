"""Trace the packed guide's actual scripts against an inert loopback forum."""
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

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/tsdm-sdk-0.1.0.tgz')
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/activity.md').read()
source = guide.decode()
python = re.search(r'^```python\n([\s\S]+?)^```$', source, re.M).group(1)
reads, effects = re.findall(r'^```sh\n([\s\S]+?)^```$', source, re.M)
namespace = {}
exec(compile(python, 'packed-activity-guide.py', 'exec'), namespace)

calls = []
results = []


def target(method, url, fields=None):
    parsed = urlsplit(url)
    return {'method': method, 'path': parsed.path,
            'query': {k: v for k, v in parse_qs(parsed.query, keep_blank_values=True).items()},
            'fields': {k: [v] for k, v in (fields or {}).items()}}


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        request = target(self.command, self.path)
        request['fields'] = parse_qs(body, keep_blank_values=True)
        request['cookie'] = self.headers.get('Cookie')
        calls.append(request)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        flags = {'ok':1,'v4':1,'uid':31,'thread_lists':['ratings','poll_voters','thread_mod','payments']}
        self.wfile.write(json.dumps(flags).encode() if request['path'] == '/plugin.php' else b'{"fixture":"inert"}')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, expected, verdict):
    expected = [dict(row, cookie='fixture_session=activity-replay') for row in expected]
    assert calls == expected, (name, calls, expected)
    assert verdict, name
    results.append({'name': name, 'expected': expected, 'actual': calls[:]})
    calls.clear()


with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server, TemporaryDirectory() as directory:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        orig = 'http://127.0.0.1:' + str(server.server_port)
        cookie = Path(directory) / 'cookies.txt'
        cookie.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tfixture_session\tactivity-replay\n')
        session = requests.Session()
        session.trust_env = False
        session.cookies.set('fixture_session', 'activity-replay', domain='127.0.0.1', path='/')
        guide_read = namespace['activity']
        guide_open = namespace['open_form']
        guide_submit = namespace['submit_once']
        def route(path, **params):
            return path + '?' + urlencode(params)
        for action, ids, flags in [
            ('viewratings', {'tid': '90', 'pid': '302'}, {'tsdmapp': 'json', 'tsdmv': '4', 'nodoc': '1'}),
            ('viewvote', {'tid': '90', 'polloptionid': '4', 'page': '2'}, {'tsdmapp': 'json', 'tsdmv': '4', 'nodoc': '1'}),
            ('viewthreadmod', {'tid': '90'}, {'tsdmapp': 'json', 'tsdmv': '4', 'nodoc': '1'}),
            ('viewpayments', {'tid': '90'}, {'tsdmapp': 'json', 'tsdmv': '4', 'nodoc': '1'}),
            ('viewwarning', {'tid': '90', 'uid': '31'}, {'inajax': '1'}),
            ('commentmore', {'tid': '90', 'pid': '302', 'page': '2'}, {'inajax': '1', 'tsdmapp': 'json', 'tsdmform': '1'}),
        ]:
            actual = guide_read(session, orig, action, **ids)
            read_url = route('/forum.php', mod='misc', action=action, **ids, **flags)
            status = [target('GET','/plugin.php?id=tsdmapp:api&action=status')] if 'tsdmv' in flags else []
            observe('Python ' + action, [*status, target('GET', read_url)], actual.json() == {'fixture': 'inert'})
        rate_open = '/forum.php?mod=misc&action=rate&tid=90&pid=302'
        rate_post = '/forum.php?mod=misc&action=rate&ratesubmit=yes&infloat=yes'
        rate_open_request = rate_open + '&infloat=yes&handlekey=rate&inajax=1&ajaxtarget=fwin_content_rate&tsdmapp=json&tsdmform=1'
        actual = guide_open(session, orig, rate_open, 'rate')
        observe('Python open rate', [target('GET', rate_open_request)], actual.status_code == 200)
        for name, dest, fields, choice in [
            ('rate', rate_post, {'formhash': 'fixture', 'tid': '90', 'pid': '302'}, {'score6': '-8', 'reason': 'Exact & 原文'}),
            ('report', '/misc.php?mod=report', {'formhash': 'fixture', 'rid': '302', 'rtype': 'post', 'fid': '7'}, {'message': 'Exact & 原文'}),
            ('comment', '/forum.php?mod=post&action=reply&comment=yes&tid=90&pid=302', {'formhash': 'fixture'}, {'message': 'Exact & 原文', 'commentitem[画质]': ''}),
        ]:
            actual = guide_submit(session, orig, dest, fields, choice)
            dest += '&tsdmapp=json' + ('&inajax=1' if dest.startswith('/forum.php') else '')
            observe('Python submit ' + name, [target('POST', dest, fields | choice)], actual.status_code == 200)
        env = dict(os.environ, FORUM_ORIGIN=orig, FORUM_COOKIE_JAR=str(cookie), TID='90', PID='302', WARNED_UID='31',
                   OFFERED_FORM_URL=orig + rate_open, HANDLE='rate', NO_PROXY='127.0.0.1')
        def shell(block, **values):
            return subprocess.check_output(['sh', '-eu', '-c', block], env=env | values, text=True)
        for side in ['add', 'subtract']:
            offered = '/forum.php?mod=misc&action=recommend&do=' + side + '&tid=90&hash=fixture'
            actual = namespace['evaluate_once'](session, orig, offered, '90', side)
            observe('Python deliberate evaluation ' + side,
                    [target('GET', offered + '&inajax=1&tsdmapp=json')], actual.status_code == 200)
        printed = shell(reads)
        observe('curl reads and form opener', [
            target('GET', '/plugin.php?id=tsdmapp:api&action=status'),
            target('GET', '/forum.php?mod=misc&action=viewratings&tid=90&pid=302&tsdmapp=json&tsdmv=4&nodoc=1'),
            target('GET', '/forum.php?mod=misc&action=viewwarning&tid=90&uid=31&inajax=1'),
            target('GET', rate_open_request),
        ], printed.count('{"fixture":"inert"}') == 3)
        body = Path(directory) / 'body.txt'
        fields = {'formhash': 'fixture', 'tid': '90', 'pid': '302', 'score6': '-8', 'reason': 'Exact & 原文'}
        body.write_text(urlencode(fields))
        post = rate_post + '&inajax=1&tsdmapp=json'
        printed = shell(effects, ACTIVITY_CONFIRM='submit-form', SUBMIT_URL=orig + post, FORM_BODY_FILE=str(body))
        observe('curl deliberate form POST', [target('POST', post, fields)], printed.count('{"fixture":"inert"}') == 1)
        for side in ['add', 'subtract']:
            evaluation = '/forum.php?mod=misc&action=recommend&do=' + side + '&tid=90&hash=fixture&inajax=1&tsdmapp=json'
            printed = shell(effects, ACTIVITY_CONFIRM='evaluate', EVALUATION_URL=orig + evaluation)
            observe('curl deliberate evaluation ' + side, [target('GET', evaluation)], printed.count('{"fixture":"inert"}') == 1)
        refused = subprocess.run(['sh', '-eu', '-c', effects], env=env | {'ACTIVITY_CONFIRM': ''}, capture_output=True)
        observe('curl without deliberate confirmation', [], refused.returncode == 2)
    finally:
        server.shutdown()
        worker.join()

print(json.dumps({'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': hashlib.sha256(guide).hexdigest(), 'python': sys.version.split()[0],
                  'requests': requests.__version__, 'curl': subprocess.check_output(['curl', '--version'], text=True).splitlines()[0],
                  'limitations': ['Inert loopback responses only', 'No forum network traffic or account effects'],
                  'results': results}, ensure_ascii=False, indent=2))

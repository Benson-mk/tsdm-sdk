"""Replay the packed direct examples against an inert loopback forum."""
from hashlib import sha256
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
from urllib.parse import parse_qsl, urlencode, urlsplit

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/moderation.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
helpers = {}
exec(compile(blocks['python'], 'moderation-guide.py', 'exec'), helpers)
fixture_cookie = 'fixture=fictional-moderator'
calls = []
results = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        request = urlsplit(self.path)
        payload = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        calls.append({'method': self.command, 'path': request.path,
                      'query': parse_qsl(request.query, keep_blank_values=True), 'body': payload,
                      'credentialMatched': self.headers.get('Cookie') == fixture_cookie,
                      'ajax': self.headers.get('X-Requested-With') == 'XMLHttpRequest'})
        effect = self.command == 'POST' or 'action=deleteattach' in request.query
        self.send_response(302 if effect else 200)
        if effect:
            self.send_header('Location', '/must-not-follow')
        self.end_headers()
        self.wfile.write(b'Fictional inert fixture')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, actual, expected, requests_expected):
    wanted = {'result': expected, 'requests': requests_expected}
    value = {'result': actual, 'requests': calls.copy()}
    assert wanted == value, (name, wanted, value)
    results.append({'name': name, 'expected': wanted, 'actual': value})
    calls.clear()


def request(method, query, body=''):
    return {'method': method, 'path': '/forum.php', 'query': query, 'body': body,
            'credentialMatched': True, 'ajax': True}


def outcome(response):
    return None if response is None else [response.status_code, response.headers.get('Location')]


with TemporaryDirectory() as temp, ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    jar = Path(temp) / 'cookie.txt'
    response_path = Path(temp) / 'response.txt'
    jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\t' + fixture_cookie.replace('=', '\t') + '\n')
    jar.chmod(0o600)

    def shell(method, operation, url, fields=(), *, approved=None, check=True):
        result = subprocess.run(['sh', '-eu', '-c', blocks['sh']], input=urlencode(fields), text=True, check=check,
            capture_output=True, env={**os.environ, 'NO_PROXY': '127.0.0.1', 'REQUEST_METHOD': method, 'OPERATION': operation,
                'OFFERED_URL': origin + url, 'APPROVED_EFFECT': approved or '', 'FORUM_ORIGIN': origin,
                'FORUM_COOKIE_JAR': str(jar), 'RESPONSE_FILE': str(response_path)})
        if result.returncode:
            return result.returncode
        if not response_path.exists():
            return None
        status, *headers = response_path.read_text().splitlines()
        location = next((line.split(': ', 1)[1] for line in headers if line.lower().startswith('location: ')), None)
        assert response_path.stat().st_mode & 0o777 == 0o600
        response_path.unlink()
        return [int(status.split()[1]), location]

    def url(query):
        return '/forum.php?' + urlencode(query)

    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set(*fixture_cookie.split('='), domain='127.0.0.1')
        reads = {
            'thread permission': [('mod','viewthread'), ('tid','80')],
            'batch window': [('mod','topicadmin'), ('action','moderate'), ('optgroup','3'), ('operation','delete'), ('fid','12'), ('moderate[]','80'), ('moderate[]','81')],
            'reply form': [('mod','topicadmin'), ('action','delpost'), ('fid','12'), ('tid','80'), ('topiclist[]','90')],
            'private IP': [('mod','topicadmin'), ('action','getip'), ('pid','90')],
            'type select': [('mod','ajax'), ('action','getthreadtypes'), ('fid','13'), ('inajax','1')],
            'attachment editor': [('mod','post'), ('action','edit'), ('fid','12'), ('tid','80'), ('pid','90')],
        }
        for name, query in reads.items():
            route = url(query)
            observe('requests reads ' + name, outcome(helpers['read_moderation'](session, origin, route)), [200, None], [request('GET', query)])
            observe('curl reads ' + name, shell('GET', 'read', route), [200, None], [request('GET', query)])
        actions = [
            ('stick', 1, [('sticklevel','1')]), ('digest', 1, [('digestlevel','2')]),
            ('highlight', 1, [('highlight_color','2')]), ('recommend', 1, [('isrecommend','1')]),
            ('move', 2, [('moveto','13'), ('threadtypeid','8')]), ('type', 2, [('typeid','8')]),
            ('delete', 3, []), ('bump', 3, []), ('down', 3, []), ('close', 4, []), ('open', 4, []),
            ('stamp', None, [('stamp','2')]), ('stamplist', None, [('stamplist','4')]),
            ('copy', None, [('copyto','13'), ('threadtypeid','8')]), ('merge', None, [('othertid','85')]),
            ('split', None, [('subject','Fictional split'), ('split','2,3')]), ('removereward', None, []), ('refund', None, []),
            ('delpost', None, [('topiclist[]','90')]), ('warn', None, [('topiclist[]','90'), ('warned','1')]),
            ('banpost', None, [('topiclist[]','90'), ('banned','1')]), ('stickreply', None, [('topiclist[]','90'), ('stickreply','1')]),
            ('delcomment', None, [('topiclist','72')]), ('removerate', None, [('pid','90'), ('logidarray[]','55 1 1234567890')]),
            ('repair', None, []), ('deleteattach', None, []),
        ]
        for operation, group, values in actions:
            method = 'GET' if operation == 'deleteattach' else 'POST'
            token = [('formhash','fictional-form-token')]
            if group:
                query = [('mod','topicadmin'), ('action','moderate'), ('optgroup',str(group)), ('modsubmit','yes')]
                fields = token + [('fid','12'), ('moderate[]','80'), ('moderate[]','81'), ('operations[]',operation)] + values
            elif operation == 'deleteattach':
                query = [('mod','ajax'), ('action','deleteattach'), ('inajax','yes')] + token + [('tid','80'), ('pid','90'), ('aids[]','96')]
                fields = []
            elif operation == 'repair':
                query = [('mod','topicadmin'), ('action',operation), ('fid','12'), ('tid','80')]
                fields = []
            else:
                mode, submit = ('misc','ratesubmit') if operation == 'removerate' else ('topicadmin','modsubmit')
                query = [('mod',mode), ('action',operation), (submit,'yes')]
                fields = token + [('tid','80')] + values
            route = url(query)
            expected = [request(method, query, urlencode(fields))]
            observe('requests approves ' + operation,
                    outcome(helpers['submit_moderation'](session, origin, operation, route, fields, approved=True)),
                    [302, '/must-not-follow'], expected)
            observe('curl approves ' + operation, shell(method, operation, route, fields, approved=operation),
                    [302, '/must-not-follow'], expected)
            if operation in {'deleteattach','repair','delete'}:
                observe('requests declines ' + operation,
                        outcome(helpers['submit_moderation'](session, origin, operation, route, fields)), None, [])
                observe('curl declines ' + operation, shell(method, operation, route, fields), None, [])
                try:
                    helpers['read_moderation'](session, origin, route)
                except ValueError:
                    observe('requests preview rejects effect ' + operation, True, True, [])
                else:
                    raise AssertionError('Effect route accepted as a read')
                observe('curl preview rejects effect ' + operation, shell('GET', 'read', route, check=False), 2, [])
    server.shutdown()
    thread.join()

print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(), 'guideSHA256': sha256(guide).hexdigest(),
                  'scope': 'Fictional requests and inert loopback responses. No moderation state transitions.', 'results': results}, indent=2))

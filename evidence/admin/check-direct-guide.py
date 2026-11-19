"""Replay the packaged Python and curl examples against an inert loopback forum."""
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
    guide = package.extractfile('package/docs/admin.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
helpers = {}
exec(compile(blocks['python'], 'admin-guide.py', 'exec'), helpers)
actor = '31'
fixture_cookie = 'fixture=fictional-admin-member'
fixture_token = '-'.join(('fictional', 'separate', 'admin', 'authorization'))
fixture_password = ' '.join(('fictional', 'passphrase', '+&!'))
fixture_answer = ' '.join(('fictional', 'security answer', '&'))
fixture_hash = '-'.join(('fictional', 'csrf'))
private_keys = {'password', 'answer', 'formhash'}
calls = []
results = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        token = self.headers.get('X-Tsdmapp-Admin')
        calls.append({'method': self.command, 'path': url.path,
                      'query': parse_qsl(url.query, keep_blank_values=True),
                      'body': body, 'token': 'matched' if token == fixture_token else 'absent' if token is None else 'unexpected',
                      'cookieMatched': self.headers.get('Cookie') == fixture_cookie,
                      'formEncoded': self.headers.get('Content-Type') == 'application/x-www-form-urlencoded'})
        values = dict(parse_qsl(body))
        action = dict(parse_qsl(url.query)).get('action')
        login = action == 'admin' and values.get('op') == 'login'
        redirect = action == 'adminreport' and values.get('op') == 'delete'
        self.send_response(302 if redirect else 200)
        self.send_header('Content-Type', 'application/json')
        if redirect:
            self.send_header('Location', '/must-not-follow')
        self.end_headers()
        result = {'uid': 31, 'ok': 1}
        if action == 'status':
            result['admin'] = 1
        if login:
            result['token'] = fixture_token
        self.wfile.write(json.dumps(result).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def expected(method, action, params, body, authorized):
    return {'method': method, 'path': '/plugin.php', 'query': [('id', 'tsdmapp:api'), ('action', action), *params],
            'body': urlencode(body or ()), 'token': 'matched' if authorized else 'absent', 'cookieMatched': True,
            'formEncoded': method == 'POST'}


def mask(items):
    return [dict(item, body=[(key, '[masked]' if key in private_keys else value)
                             for key, value in parse_qsl(item['body'], keep_blank_values=True)]) for item in items]


def observe(name, value, want, wanted_calls):
    # Compare the actual header and encoded body before retaining masked evidence.
    if value != want or calls != wanted_calls:
        raise AssertionError((name, want, value, mask(wanted_calls), mask(calls)))
    results.append({'name': name, 'expected': {'result': want, 'requests': mask(wanted_calls)},
                    'actual': {'result': value, 'requests': mask(calls)}})
    calls.clear()


def outcome(response):
    if response is None:
        return None
    return [response.status_code, response.headers.get('Location')]


with TemporaryDirectory() as temp, ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    jar, header, form, response_file = (Path(temp) / name for name in ('cookies', 'header', 'form', 'response'))
    jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\t' + fixture_cookie.replace('=', '\t') + '\n')
    header.write_text('X-Tsdmapp-Admin: ' + fixture_token + '\n')
    for file in (jar, header):
        file.chmod(0o600)
    capabilities = {action: {'read': 1, 'write': 1} for action in ('admincredit','admingroup','adminreport','adminban')}

    def shell(method, action, *, query=(), body=None, intent='', approved=False, authorized=False, check=True):
        if body is not None:
            form.write_text(urlencode(body))
            form.chmod(0o600)
        env = {**os.environ, 'NO_PROXY': '127.0.0.1', 'FORUM_ORIGIN': origin, 'FORUM_COOKIE_JAR': str(jar),
               'ADMIN_HEADER_FILE': str(header) if authorized else '', 'ADMIN_FORM_FILE': str(form),
               'ACTION': action, 'METHOD': method, 'READ_QUERY': urlencode(query), 'INTENT': intent,
               'APPROVED_EFFECT': intent if approved else '', 'RESPONSE_FILE': str(response_file)}
        process = subprocess.run(['sh', '-eu', '-c', blocks['sh']], capture_output=True, check=check, env=env)
        assert process.stdout == b''
        if process.returncode:
            return process.returncode
        if not response_file.exists():
            return None
        assert response_file.stat().st_mode & 0o777 == 0o600
        status, *headers = response_file.read_text().splitlines()
        location = next((row.split(': ', 1)[1] for row in headers if row.lower().startswith('location: ')), None)
        response_file.unlink()
        return [int(status.split()[1]), location]

    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set(*fixture_cookie.split('='), domain='127.0.0.1')
        request = helpers['admin_request']
        reads = [
            ('status', (), False), ('admin', (), False), ('admin', (), True),
            ('admincredit', [('uids','71,72'),('usernames','Fictional first\nFictional second')], True),
            ('admingroup', [('uid','71')], True), ('adminreport', [('op','new')], True),
            ('adminreport', [('op','resolved'),('page','2')], True), ('adminban', [('username','Fictional target')], True),
        ]
        for action, query, authorized in reads:
            calls_expected = [expected('GET', action, query, None, authorized)]
            label = action + ' ' + ('authorized' if authorized else 'discovery') + (' ' + query[0][1] if action == 'adminreport' else '')
            response = request(session, origin, actor, action, query=query, token=fixture_token if authorized else None, capabilities=capabilities)
            observe('requests reads ' + label, outcome(response), [200, None], calls_expected)
            observe('curl reads ' + label, shell('GET', action, query=query, authorized=authorized), [200, None], calls_expected)
        writes = [
            ('admin','login',[('op','login'),('password',fixture_password),('questionid','3'),('answer',fixture_answer)],False),
            ('admincredit','reward',[('uids','71,72'),('credits[2]','-3'),('reason','Fictional reason'),('notify','1'),('opid','controlled-credit-1')],True),
            ('admingroup','group',[('uid','71'),('groupid','22'),('expiry',''),('extgroupids[0]','15'),('opid','controlled-group-1')],True),
            ('adminreport','resolve',[('op','resolve'),('ids[0]','91'),('credits[91]','3'),('msg[91]','Fictitious review'),('opid','controlled-resolve-1')],True),
            ('adminreport','delete',[('op','delete'),('ids[0]','92'),('opid','controlled-delete-1')],True),
            ('adminban','ban',[('op','ban'),('uid','71'),('bannew','post'),('banexpirynew','7'),('clear[0]','post'),('opid','controlled-ban-1')],True),
            ('adminban','clear',[('op','clear'),('uid','71'),('cursor','0-0')],True),
            ('admin','logout',[('op','logout')],True),
        ]
        for action, intent, values, authorized in writes:
            body = values + [('formhash',fixture_hash)]
            token = fixture_token if authorized else None
            want = [302, '/must-not-follow'] if intent == 'delete' else [200, None]
            wanted_calls = [expected('POST', action, (), body, authorized)]
            response = request(session, origin, actor, action, fields=body, token=token, capabilities=capabilities, approved=True)
            if intent == 'login' and response.json().get('token') != fixture_token:
                raise AssertionError('The fictional token was not retained in the private response')
            observe('requests approves ' + intent, outcome(response), want, wanted_calls)
            observe('curl approves ' + intent, shell('POST', action, body=body, intent=intent, approved=True, authorized=authorized), want, wanted_calls)
            observe('requests declines ' + intent, request(session, origin, actor, action, fields=body, token=token, capabilities=capabilities), None, [])
            observe('curl declines ' + intent, shell('POST', action, body=body, intent=intent, authorized=authorized), None, [])
        try:
            request(session, origin, actor, 'adminreport', fields=[('op','delete'),('formhash',fixture_hash)],
                    token=fixture_token, capabilities={'adminreport':{'read':1,'write':0}}, approved=True)
        except ValueError:
            observe('requests refuses report write without the observed capability', True, True, [])
        else:
            raise AssertionError('A read-only capability authorized a write')
        observe('curl rejects tokenless private read', shell('GET','adminban',check=False), 2, [])
    server.shutdown()
    thread.join()

print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(), 'guideSHA256': sha256(guide).hexdigest(),
                  'scope': 'Inert loopback and fictional authorization. No deployed administrator effects.', 'results': results}, indent=2))

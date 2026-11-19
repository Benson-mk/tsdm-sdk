"""Replay the actual packed guide against an inert, private loopback forum."""
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
    guide = package.extractfile('package/docs/bank.md').read()
blocks = {lang: re.findall(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M)
          for lang in ('python', 'sh')}
helpers = {}
exec(compile(blocks['python'][0], 'bank-guide.py', 'exec'), helpers)
read_shell, submit_shell = blocks['sh']
cookie = 'fixture' + '=fictional-bank-visitor'
old_password = 'Fictional old phrase +1'
new_password = 'Fictional new phrase &2'
plugin = {'id': 'bank_ane:bank'}
bank = {'bankid': '1'}
calls = []
results = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        calls.append({'method': self.command, 'path': url.path, 'query': dict(parse_qsl(url.query)),
                      'body': raw, 'cookieMatched': self.headers.get('Cookie') == cookie,
                      'formEncoding': self.headers.get('Content-Type') == 'application/x-www-form-urlencoded'})
        self.send_response(302 if self.command == 'POST' else 200)
        if self.command == 'POST':
            self.send_header('Location', '/must-not-follow')
        self.end_headers()
        self.wfile.write(b'Inert bank fixture')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def request(method, query, fields=()):
    return {'method': method, 'path': '/plugin.php', 'query': {**plugin, **query},
            'body': urlencode(fields), 'cookieMatched': True, 'formEncoding': method == 'POST'}


def mask(items):
    return [dict(item, body=[(key, '<masked>' if 'pass' in key else value)
                             for key, value in parse_qsl(item['body'])]) for item in items]


def observe(name, value, expected_value, expected_calls):
    # Compare the raw encoded body and secret values before writing a receipt.
    if value != expected_value or calls != expected_calls:
        raise AssertionError((name, expected_value, value, mask(expected_calls), mask(calls)))
    results.append({'name': name, 'expected': {'result': expected_value, 'requests': mask(expected_calls)},
                    'actual': {'result': value, 'requests': mask(calls)}})
    calls.clear()


with TemporaryDirectory() as temp, ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    jar, response_file = (Path(temp) / name for name in ('cookies.txt', 'response.txt'))
    jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\t' + cookie.replace('=', '\t') + '\n')
    jar.chmod(0o600)
    path = origin + '/plugin.php?id=' + plugin['id']
    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set(*cookie.split('='), domain='127.0.0.1')

        def shell(block, *, data='', **env):
            return subprocess.run(['sh', '-eu', '-c', block], text=True, input=data, check=True, capture_output=True,
                                  env={**os.environ, 'NO_PROXY': '127.0.0.1', 'FORUM_ORIGIN': origin,
                                       'FORUM_COOKIE_JAR': str(jar), 'BANK_ID': '1', 'RECORD_ID': '7',
                                       'RESPONSE_FILE': str(response_file), **env}).stdout

        reads = [
            ('directory', {}, {}), ('lobby', bank, {'bank_id': '1'}),
            *((service, {**bank, 'action': action}, {'bank_id': '1'}) for service, action in
              [('savings', 'cur'), ('fixed', 'fix'), ('transfer', 'chg'), ('loans', 'len'), ('account', 'pas')]),
            ('logs', {**bank, 'action': 'log', 'show': '0', 'page': '1'}, {'bank_id': '1'}),
            ('logs', {**bank, 'action': 'log', 'show': '1', 'page': '1'}, {'bank_id': '1', 'received': True}),
            ('overview', {'mode': 'other'}, {}), ('rankings', {'mode': 'other', 'action': 'list'}, {}),
            ('trading', {'mode': 'other', 'action': 'buy'}, {}),
            ('withdrawal-confirmation', {**bank, 'action': 'fix', 'op': 'out', 'noid': '7'},
             {'bank_id': '1', 'record_id': '7'}),
        ]
        for service, query, args in reads:
            response = helpers['bank_read'](session, origin, service, **args)
            suffix = (' received' if args.get('received') else ' own') if service == 'logs' else ''
            observe(f'requests reads {service}{suffix}', response.status_code, 200, [request('GET', query)])
        observe('curl reads all 13 exact routes', shell(read_shell).count('Inert bank fixture'), 13,
                [request('GET', query) for _, query, _ in reads])
        for operation, op in [('repay-loan', 'gb'), ('cancel-loan', 'gu')]:
            query = {**bank, 'action': 'len', 'op': op, 'noid': '7'}
            link = path + '&' + urlencode(query)
            observe(operation + ' leaves an exact browser destination',
                    helpers['loan_destination'](origin, link, '1', '7', operation).removeprefix(origin),
                    link.removeprefix(origin), [])
        for operation, action, op, fields, record_key in [
            ('open-account', 'open', None, {'bankpass': new_password, 'bankpass2': new_password}, None),
            ('close-account', 'pas', 'cl', {'bankpass': old_password}, None),
            ('change-password', 'pas', 'cg', {'bankpass': old_password, 'newbankpass': new_password, 'newbankpass2': new_password}, None),
            ('deposit-current', 'cur', 'in', {'banknum': '200', 'bankpass': old_password}, None),
            ('withdraw-current', 'cur', 'out', {'banknum': '55', 'bankpass': old_password}, None),
            ('settle-interest', 'cur', 'ok', {}, None),
            ('deposit-fixed', 'fix', 'in', {'banknum': '100', 'daynum': '31', 'bankpass': old_password}, None),
            ('withdraw-fixed', 'fix', 'out', {'bankpass': old_password}, 'noid'),
            ('withdraw-fixed', 'fix', 'out', {'bankpass': old_password}, 'fixid'),
            ('transfer', 'chg', 'ok', {'banknum': '10', 'touser': 'Fictitious recipient', 'bankpass': old_password}, None),
            ('apply-loan', 'len', 'try', {'banknum': '100', 'daynum': '2', 'bankpass': old_password}, None),
        ]:
            controls = {**bank, 'action': action, 'formhash': 'controlled-token', **fields, 'banksubmit': 'true'}
            if op:
                controls['op'] = op
            if record_key:
                controls[record_key] = '7'
            payload = list(controls.items())
            expected = [request('POST', {'tsdmapp': 'json'}, payload)]
            response = helpers['submit_once'](session, origin, operation, path, payload, bank_id='1',
                                              approved=True, record_id=controls.get(record_key))
            result = {'status': 302, 'location': '/must-not-follow'}
            label = operation + (f' ({record_key})' if record_key else '')
            observe('requests posts ' + label, {'status': response.status_code, 'location': response.headers.get('Location')}, result, expected)
            shell(submit_shell, data=urlencode(payload), OPERATION=operation, APPROVED_EFFECT=operation,
                  OFFERED_POST_URL=path + '&' + urlencode({'tsdmapp': 'json'}))
            header = response_file.read_text().splitlines()
            location = next((line.split(': ', 1)[1] for line in header if line.lower().startswith('location: ')), None)
            observe('curl posts ' + label, {'status': int(header[0].split()[1]), 'location': location}, result, expected)
            assert response_file.stat().st_mode & 0o777 == 0o600
            response_file.unlink()
        observe('requests declined POST', helpers['submit_once'](session, origin, 'transfer', path, [], bank_id='1'), None, [])
        observe('curl declined POST', shell(submit_shell, OPERATION='transfer', APPROVED_EFFECT=''), '', [])
        assert not response_file.exists()
    server.shutdown()
    thread.join()
print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': sha256(guide).hexdigest(),
                  'limitations': ['Inert loopback with fictional member, password and transactions',
                                  'No deployed forum requests or account effects'],
                  'results': results}, indent=2))

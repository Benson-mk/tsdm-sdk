"""Exercise the packed Python and curl examples with a disposable forum."""
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
from urllib.parse import parse_qsl, urlencode, urlsplit

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/trades.md').read()
python = re.search(r'^```python\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
reads, write = re.findall(r'^```sh\n([\s\S]+?)^```$', guide.decode(), re.M)
namespace = {}
exec(compile(python, 'packed-trades-guide.py', 'exec'), namespace)

calls = []
results = []
secret = 'synthetic-test-password'
cookie = 'fixture_session=fictitious-member'
order_id = 'FictitiousOrder01'


def request(method, query, body=()):
    return {'method': method, 'path': '/forum.php', 'query': list(query.items()), 'body': list(body), 'cookie': cookie}


def public(call):
    return {**call, 'cookie': '[fictional session cookie supplied]', 'body': [(key, '[fictitious password supplied]' if key == 'password' else val)
                             for key, val in call['body']]}


def observe(name, *expected):
    assert calls == list(expected), name
    results.append({'name': name, 'expected': list(map(public, expected)), 'observed': list(map(public, calls))})
    calls.clear()


class Forum(BaseHTTPRequestHandler):
    def handle_form(self):
        target = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        calls.append({'method': self.command, 'path': target.path, 'query': parse_qsl(target.query),
                      'body': parse_qsl(body, keep_blank_values=True), 'cookie': self.headers.get('Cookie')})
        self.send_response(302 if self.command == 'POST' else 200)
        self.send_header('Location', '/forum.php?mod=trade&orderid=' + order_id)
        self.end_headers()

    do_GET = do_POST = handle_form

    def log_message(self, *_):
        pass


with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server, TemporaryDirectory() as directory:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        base = origin + '/forum.php?'
        cookie_jar = Path(directory) / 'cookies'
        cookie_jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tfixture_session\tfictitious-member\n')
        session = requests.Session()
        session.trust_env = False
        session.cookies.set('fixture_session', 'fictitious-member', domain='127.0.0.1', path='/')
        env = dict(os.environ, FORUM_ORIGIN=origin, FORUM_COOKIE_JAR=str(cookie_jar), TID='42', PID='101',
                   ORDERID=order_id, NO_PROXY='127.0.0.1', RESPONSE_FILE=str(Path(directory) / 'response'))
        targets = {'tid': '42', 'pid': '101'}
        fixtures = {
            'thread': dict(mod='viewthread', tid='42', tsdmapp='json', nodoc='1'),
            'purchase-form': dict(mod='misc', action='pay', **targets, infloat='yes', handlekey='pay', inajax='1',
                                  ajaxtarget='fwin_content_pay', tsdmapp='json', tsdmform='1'),
            'goods': dict(mod='viewthread', do='tradeinfo', **targets),
            'order-form': dict(mod='trade', **targets),
            'order': dict(mod='trade', orderid=order_id),
        }
        inspect = namespace['inspect']
        submit = namespace['submit_once']
        for step, query in fixtures.items():
            assert inspect(session, origin, step, **targets, orderid=order_id).status_code == 200
            observe('Python read ' + step, request('GET', query))
        subprocess.run(['sh', '-eu', '-c', reads], env=env, check=True, capture_output=True)
        observe('curl reads', *(request('GET', query) for query in fixtures.values()))
        effects = {
            'purchase': (dict(mod='misc', action='pay', paysubmit='yes', infloat='yes'),
                         [('formhash', 'fictional-purchase-hash'), ('referer', base + 'mod=viewthread&tid=42'),
                          ('tid', '42'), ('handlekey', 'pay'), ('paysubmit', 'true')]),
            'order': (dict(mod='trade', action='trade', **targets),
                      [('formhash', 'fictional-order-hash'), ('number', '2'), ('offline', '1'), ('transport', '3'),
                       ('buyermsg', 'Fictional & note'), ('tradesubmit', 'true')]),
            'payment': (dict(mod='trade', orderid=order_id),
                        [('formhash', 'fictional-order-hash'), ('offlinestatus', '4'), ('offlinesubmit', 'true'), ('message', '')]),
        }
        for step, (action, fields) in effects.items():
            query = {**action, **({'inajax': '1'} if step == 'purchase' else {}), 'tsdmapp': 'json'}
            selected = dict(**targets, orderid=order_id, password=secret if step == 'payment' else None)
            action_url = base + urlencode(action)
            assert submit(session, origin, step, action_url, fields, **selected) is None
            observe('Python declined ' + step)
            response = submit(session, origin, step, action_url, fields, approved=True, **selected)
            assert response.status_code == 302 and not response.history
            body = fields + ([('password', secret)] if step == 'payment' else [])
            observe('Python approved ' + step, request('POST', query, body))
            command = ['sh', '-eu', '-c', write]
            flags = dict(EFFECT=step, OFFERED_POST_URL=base + urlencode(query))
            subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': ''}, input=urlencode(body).encode(), check=True)
            observe('curl declined ' + step)
            subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': step}, input=urlencode(body).encode(), check=True)
            assert Path(env['RESPONSE_FILE']).read_bytes().startswith(b'HTTP/1.0 302')
            observe('curl approved ' + step, request('POST', query, body))
    finally:
        server.shutdown()
        worker.join()

for result in results:
    for request_record in result['expected'] + result['observed']:
        request_record['query'] = [(key, urlsplit(value).path + '?' + urlsplit(value).query if value.startswith('http://127.0.0.1:') else value)
                                   for key, value in request_record['query']]
        request_record['body'] = [(key, urlsplit(value).path + '?' + urlsplit(value).query if value.startswith('http://127.0.0.1:') else value)
                                  for key, value in request_record['body']]
print(json.dumps({'evidence': 'controlled loopback, packaged guide', 'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': hashlib.sha256(guide).hexdigest(), 'results': results}, indent=2))

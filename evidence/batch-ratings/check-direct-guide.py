"""Replay the exact packaged requests and curl examples against a disposable forum."""
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
    guide = package.extractfile('package/docs/batch-ratings.md').read()
python = re.search(r'^```python\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
read_script, write_script = re.findall(r'^```sh\n([\s\S]+?)^```$', guide.decode(), re.M)
namespace = {}
exec(compile(python, 'packed-batch-guide.py', 'exec'), namespace)
calls, results = [], []
cookie = 'fixture_session=fictitious-member'
redirect = '/plugin.php?id=batchrate:rate&brmode=result&batchid=52'


class Forum(BaseHTTPRequestHandler):
    def handle_exchange(self):
        route = urlsplit(self.path)
        pairs = parse_qsl(route.query, keep_blank_values=True)
        assert len(pairs) == len(dict(pairs))
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        request = {'method': self.command, 'path': route.path, 'query': dict(pairs),
                   'fields': parse_qsl(body, keep_blank_values=True), 'cookie': self.headers.get('Cookie')}
        calls.append(request)
        status = 302 if self.command == 'POST' or request['query'].get('bract') == 'continue' else 200
        self.send_response(status)
        if status == 302:
            self.send_header('Location', redirect)
        self.end_headers()

    do_GET = do_POST = handle_exchange

    def log_message(self, *_):
        pass


def trace(method, query, fields=()):
    return {'method': method, 'path': '/plugin.php', 'query': query, 'fields': list(fields), 'cookie': cookie}


def observe(name, *expected):
    assert calls == list(expected), name
    public = lambda row: {**row, 'cookie': '[fictitious member cookie supplied]'}
    results.append({'name': name, 'expected': list(map(public, expected)), 'observed': list(map(public, calls))})
    calls.clear()


with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server, TemporaryDirectory() as folder:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        jar = Path(folder) / 'cookies'
        jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tfixture_session\tfictitious-member\n')
        session = requests.Session()
        session.trust_env = False
        session.cookies.set('fixture_session', 'fictitious-member', domain='127.0.0.1', path='/')
        env = dict(os.environ, FORUM_ORIGIN=origin, FORUM_COOKIE_JAR=str(jar), FID='2', TID='42',
                   BATCH_ID='52', PAGE='2', NO_PROXY='127.0.0.1')
        page = dict(tsdmapp='json', nodoc='1')
        discover = [trace('GET', dict(id='tsdmapp:api', action='status')),
                    trace('GET', dict(id='tsdmapp:api', action='batchrate', fid='2', tid='42'))]
        for action, expected in zip(('status', 'batchrate'), discover):
            assert namespace['api_read'](session, origin, action, forum_id='2', thread_id='42').status_code == 200
            observe('Python discover ' + action, expected)
        reads = {
            'list': dict(id='batchrate:list', page='2'),
            'detail': dict(id='batchrate:list', bract='detail', batchid='52'),
            'resume': dict(id='batchrate:list', bract='continue', batchid='52'),
            'result': dict(id='batchrate:rate', brmode='result', batchid='52'),
        }
        for name, query in reads.items():
            response = namespace['batch_read'](session, origin, name, batch_id='52', page=2)
            assert not response.history and response.status_code == (302 if name == 'resume' else 200)
            if name == 'resume':
                assert response.headers['Location'] == redirect
            observe('Python read ' + name, trace('GET', query | page))
        subprocess.run(['sh', '-eu', '-c', read_script], env=env, check=True, capture_output=True)
        observe('curl discovers and reads every records route', *discover, *(trace('GET', query | page) for query in reads.values()))
        token = ('formhash', 'fictitious-hash')
        selection = [token, ('brmode', '3'), ('fid', '2'), ('tid', '42'), ('floors', '2~4')]
        settings = [('score6', '4'), ('reason', 'Fictitious & reason'), ('as_rated', '1'), ('mult[101]', '2')]
        effects = {
            'preview': (dict(id='batchrate:rate'), selection, None),
            'recalc': (dict(id='batchrate:rate', brmode='3'), selection + [('recalc', '1')] + settings, None),
            'create': (dict(id='batchrate:rate', brmode='3'), selection + [('ratesubmit', '1')] + settings, None),
            'run': (dict(id='batchrate:run'), [token, ('batchid', '52')], '52'),
            'revoke-item': (dict(id='batchrate:list', bract='undo_item'), [token, ('itemid', '70')], '70'),
            'revoke-batch': (dict(id='batchrate:list', bract='undo_batch'), [token, ('batchid', '52')], '52'),
        }
        for name, (query, fields, target) in effects.items():
            action = 'plugin.php?' + urlencode(query)
            effect = name not in {'preview', 'recalc'}
            flags = dict(OPERATION=name, OFFERED_POST_URL=origin + '/plugin.php?' + urlencode(query | {'tsdmapp': 'json'}))
            command = ['sh', '-eu', '-c', write_script]
            if effect:
                assert namespace['submit_once'](session, origin, name, action, fields, target_id=target) is None
                observe('Python declined ' + name)
                subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': ''}, input=urlencode(fields).encode(), check=True, capture_output=True)
                observe('curl declined ' + name)
            response = namespace['submit_once'](session, origin, name, action, fields, approved=effect, target_id=target)
            assert response.status_code == 302 and response.headers['Location'] == redirect and not response.history
            expected = trace('POST', query | {'tsdmapp': 'json'}, fields)
            observe('Python sends ' + name, expected)
            completed = subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': name if effect else ''}, input=urlencode(fields).encode(), check=True, capture_output=True)
            assert completed.stdout.startswith(b'HTTP/1.0 302')
            observe('curl sends ' + name, expected)
        try:
            namespace['submit_once'](session, origin, 'recalc', 'plugin.php?id=batchrate:rate', selection + [('ratesubmit', '1')])
        except ValueError:
            observe('Python recalc rejects a creation field before HTTP')
        else:
            raise AssertionError('Expected rejection')
    finally:
        server.shutdown()
        thread.join()

print(json.dumps({'evidence': 'controlled loopback, packaged guide', 'archiveSHA256': sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': sha256(guide).hexdigest(), 'results': results}, indent=2))

"""Exercise both direct HTTP recipes from the candidate tarball on loopback."""
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
    guide = package.extractfile('package/docs/tasks.md').read()
python = re.search(r'^```python\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
read_script, task_script, magic_script = re.findall(r'^```sh\n([\s\S]+?)^```$', guide.decode(), re.M)
namespace = {}
exec(compile(python, 'packed-tasks-guide.py', 'exec'), namespace)
calls, results = [], []
cookie = 'fixture_session=fictitious-member'
redirect = '/home.php?mod=task&do=draw&id=42'


class Forum(BaseHTTPRequestHandler):
    def handle_exchange(self):
        route = urlsplit(self.path)
        pairs = parse_qsl(route.query, keep_blank_values=True)
        assert len(pairs) == len(dict(pairs))
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        request = {'method': self.command, 'path': route.path, 'query': dict(pairs),
                   'fields': parse_qsl(body, keep_blank_values=True),
                   'xhr': self.headers.get('X-Requested-With'), 'cookie': self.headers.get('Cookie')}
        calls.append(request)
        status = 302 if request['query'].get('do') in {'apply', 'draw', 'delete'} or self.command == 'POST' else 200
        self.send_response(status)
        if status == 302:
            self.send_header('Location', redirect)
        self.end_headers()

    do_GET = do_POST = handle_exchange

    def log_message(self, *_):
        pass


def trace(method, query, fields=(), xhr=False):
    return {'method': method, 'path': '/home.php', 'query': query, 'fields': list(fields),
            'xhr': 'XMLHttpRequest' if xhr else None, 'cookie': cookie}


def observe(name, *expected):
    assert calls == list(expected), name
    public = lambda row: {**row, 'cookie': '[fictitious member cookie supplied]'}
    results.append({'name': name, 'expected': list(map(public, expected)), 'observed': list(map(public, calls))})
    calls.clear()


with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server, TemporaryDirectory() as folder:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        jar = Path(folder) / 'cookies'
        jar.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tfixture_session\tfictitious-member\n')
        session = requests.Session()
        session.trust_env = False
        session.cookies.set('fixture_session', 'fictitious-member', domain='127.0.0.1', path='/')
        env = dict(os.environ, FORUM_ORIGIN=origin, FORUM_COOKIE_JAR=str(jar), TID='42',
                   MID='fiction:card', MAGIC_ID='34', NO_PROXY='127.0.0.1')
        page = dict(tsdmapp='json', tsdmv='4', nodoc='1')
        write = dict(tsdmapp='json', tsdmv='4')
        reads = {tab: dict(mod='task', item=tab) for tab in ('new', 'doing', 'done')}
        for name, action in [('detail', 'view'), ('participants', 'parter')]:
            reads[name] = dict(mod='task', do=action, id='42')
        reads.update({tab: dict(mod='magic', action=tab) for tab in ('shop', 'mybox')})
        for direction, operation in zip(('usage', 'purchase', 'gift', 'receipt'), ('uselog', 'buylog', 'givelog', 'receivelog')):
            reads[direction] = dict(mod='magic', action='log', operation=operation)
        for step, params in reads.items():
            assert namespace['read'](session, origin, step, target='42').status_code == 200
            observe('Python read ' + step, trace('GET', params | page))
        assert namespace['read'](session, origin, 'receipt', page=2).status_code == 200
        observe('Python paged receipt log', trace('GET', reads['receipt'] | page | {'page': '2'}))
        windows = {}
        for operation, action, key, target in [('buy', 'shop', 'mid', 'fiction:card'), ('use', 'mybox', 'magicid', '34')]:
            query = dict(mod='magic', action=action, operation=operation, infloat='yes', handlekey='magics', inajax='1') | {key: target}
            windows[operation] = (query, target)
            assert namespace['magic_window'](session, origin, operation, target).status_code == 200
            observe('Python inspect ' + operation, trace('GET', query | page | {'tsdmform': '1'}, xhr=True))
            assert namespace['magic_window'](session, origin, operation, target, legacy=True).status_code == 200
            observe('Python legacy window ' + operation, trace('GET', query | {'tsdmapp': 'json'}, xhr=True))
        subprocess.run(['sh', '-eu', '-c', read_script], env=env, check=True, capture_output=True)
        observe('curl read lists, details, participants, both windows and all logs',
                *(trace('GET', params | page) for params in reads.values()),
                *(trace('GET', query | page | {'tsdmform': '1'}, xhr=True) for query, _ in windows.values()))
        for operation, action in [('apply', 'apply'), ('claim', 'draw'), ('abandon', 'delete')]:
            task_write = namespace['task_write']
            params = dict(mod='task', do=action, id='42')
            assert task_write(session, origin, operation, '42') is None
            observe('Python declined ' + operation)
            response = task_write(session, origin, operation, '42', approved=True)
            assert response.status_code == 302 and response.headers['Location'] == redirect and not response.history
            observe('Python approved ' + operation, trace('GET', params | write))
            if operation != 'abandon':
                assert task_write(session, origin, operation, '42', approved=True, legacy=True).status_code == 302
                observe('Python legacy ' + operation, trace('GET', params | {'inajax': '1', 'tsdmapp': 'json'}, xhr=True))
            command = ['sh', '-eu', '-c', task_script]
            subprocess.run(command, env=env | {'OPERATION': operation, 'APPROVED_EFFECT': ''}, check=True, capture_output=True)
            observe('curl declined ' + operation)
            completed = subprocess.run(command, env=env | {'OPERATION': operation, 'APPROVED_EFFECT': operation}, check=True, capture_output=True, text=True)
            assert completed.stdout.startswith('HTTP/1.0 302') and redirect in completed.stdout
            observe('curl approved ' + operation, trace('GET', params | write))
        for operation, (window, target) in windows.items():
            query = dict(mod='magic', action=window['action'], infloat='yes')
            action = 'home.php?' + urlencode(query)
            key, submit, inputs = ('mid', 'operatesubmit', ('magicnum', '2')) if operation == 'buy' else ('magicid', 'usesubmit', ('username', 'Fictitious & Member'))
            fields = [('formhash', 'fictitious-hash'), ('handlekey', 'magics'), ('operation', operation), (key, target), (submit, 'yes'), inputs]
            magic_write = namespace['magic_write']
            assert magic_write(session, origin, operation, target, action, fields) is None
            observe('Python declined ' + operation)
            response = magic_write(session, origin, operation, target, action, fields, approved=True)
            assert response.status_code == 302 and not response.history
            observe('Python approved ' + operation, trace('POST', query | write, fields, xhr=True))
            command = ['sh', '-eu', '-c', magic_script]
            flags = dict(OPERATION=operation, OFFERED_POST_URL=origin + '/home.php?' + urlencode(query | write))
            subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': ''}, input=urlencode(fields).encode(), check=True, capture_output=True)
            observe('curl declined ' + operation)
            completed = subprocess.run(command, env=env | flags | {'APPROVED_EFFECT': operation}, input=urlencode(fields).encode(), check=True, capture_output=True)
            assert completed.stdout.startswith(b'HTTP/1.0 302')
            observe('curl approved ' + operation, trace('POST', query | write, fields, xhr=True))
    finally:
        server.shutdown()
        worker.join()

print(json.dumps({'evidence': 'controlled loopback, packaged guide', 'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                  'guideSHA256': hashlib.sha256(guide).hexdigest(), 'results': results}, indent=2))

"""Run the packaged Pokémon HTTP examples against responses from a loopback forum."""
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from threading import Thread
from urllib.parse import parse_qsl, urlencode, urlsplit

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    roster = package.extractfile('package/docs/pokemon.md').read()
    battle = package.extractfile('package/docs/pokemon-battles.md').read()


def snippet(guide, language):
    return re.search(rf'^```{language}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)


functions = {}
for name, guide in [('roster', roster), ('battles', battle)]:
    exec(compile(snippet(guide, 'python'), name + '-guide.py', 'exec'), functions)

cookie = 'fixture=pokemon'
token = 'f1f2f3f4'
status = {'uid': 31, 'ok': 1, 'formhash': token}
scene = {'status': 'active', 'battle_id': 'battle_123.456', 'map_id': 3}
selection = {'requires_skill_selection': True, 'available_skills': [{'id': 15, 'pp': 0}]}
refusal = {'success': False, 'data': None, 'error': 'Game refused', 'code': 403}
missing = {**refusal, 'code': 404}
calls = []
results = []
responses = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        calls.append({
            'method': self.command, 'path': url.path, 'query': dict(parse_qsl(url.query)),
            'json': json.loads(body) if body else None, 'hash': self.headers.get('X-Pm-Formhash'),
            'contentType': self.headers.get('Content-Type'), 'fixtureCookie': self.headers.get('Cookie') == cookie,
        })
        reply = responses.pop(0)
        if reply is None:
            return
        code, data = reply
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def request(method, query, body=None, hash_value=None):
    return {'method': method, 'path': '/plugin.php', 'query': query, 'json': body,
            'hash': hash_value, 'contentType': 'application/json' if method == 'POST' else None,
            'fixtureCookie': True}


def observe(name, result, expected_result, *expected_trace):
    actual = {'result': result, 'requests': calls.copy()}
    expected = {'result': expected_result, 'requests': list(expected_trace)}
    assert actual == expected, (name, actual, expected)
    assert not responses, name
    results.append({'name': name, 'expected': expected, 'actual': actual})
    calls.clear()


matrix = [
    ('GET', 'shop', 'list', {'page': '2', 'type': '4'}, None, {'page': 2, 'items': [{'id': 30}]}),
    ('GET', 'shop', 'pets', {'page': '1'}, None, {'page': 1, 'pets': [{'id': 25}]}),
    ('POST', 'shop', 'buy', {}, {'item_id': 30, 'quantity': 2},
     {'total_cost': 60, 'remaining_money': 940, 'items_purchased': 1}),
    ('POST', 'shop', 'buy_pet', {}, {'pokemon_type_id': 25, 'quantity': 1},
     {'total_cost': 800, 'remaining_money': 140, 'pokemon_type_id': 25, 'quantity': 1, 'site': 2}),
    ('GET', 'battle', 'maps', {}, None, {'maps': [{'id': 3}]}),
    ('GET', 'battle', 'recover', {}, None, scene),
    ('GET', 'battle', 'get_battle_items', {}, None, {'items': [{'id': 30, 'nums': 2}]}),
    ('POST', 'battle', 'start', {}, {'map_id': 3, 'boss_pokemon_type_id': 149}, scene),
    ('POST', 'battle', 'turn', {}, {'battle_id': scene['battle_id'], 'skill_id': 15}, {'status': 'defeat'}),
    ('POST', 'battle', 'flee', {}, {'battle_id': scene['battle_id']}, {'status': 'fled'}),
    ('POST', 'battle', 'capture', {}, {'ball_id': 18}, {'status': 'captured'}),
    ('POST', 'battle', 'switch_pokemon', {}, {'battle_id': scene['battle_id'], 'pokemon_id': 7}, scene),
    ('POST', 'battle', 'use_item', {}, {'item_id': 30}, selection),
    ('POST', 'battle', 'use_item_on_skill', {}, {'item_id': 30, 'skill_id': 15}, scene),
]

with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    login = (31, 'fixture-login')

    def current():
        return login

    def shell(function, *args, data=None):
        env = {**os.environ, 'FORUM_ORIGIN': origin, 'FORUM_COOKIE': cookie, 'NO_PROXY': '127.0.0.1',
               'PM_FORMHASH': token, 'PM_BOUND_CONTINUITY': 'fixture-login', 'PM_CONTINUITY': login[1]}
        result = subprocess.run(['sh', '-c', snippet(roster, 'sh') + '\n"$@"', 'pokemon-guide', function, *args],
                                input=json.dumps(data) if data is not None else '', text=True,
                                capture_output=True, env=env, timeout=10)
        if result.returncode:
            return {'exit': result.returncode}
        if not result.stdout.strip():
            return None
        body, status_code = result.stdout.strip().rsplit('\n', 1)
        return {'status': int(status_code), 'body': json.loads(body)}

    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set(*cookie.split('=', 1), domain='127.0.0.1')
        responses.append((200, status))
        binding = functions['pokemon_bootstrap'](session, origin, current, mode='status')
        status_trace = request('GET', {'id': 'tsdmapp:api', 'action': 'status'})
        observe('requests status bootstrap', binding[3], 'status', status_trace)
        responses.append((200, status))
        observe('curl status bootstrap', shell('pm_open', 'status'), {'status': 200, 'body': status}, status_trace)

        def python(method, group, action, query, body, approved=True):
            return functions['battle_request'](session, origin, current, binding, method, group, action,
                                               query, body, approved=approved)

        def curl(method, group, action, query, body, approved=True):
            return shell('pm_call', 'yes' if approved else 'no', method, group, action, urlencode(query), data=body)

        for method, group, action, query, body, data in matrix:
            trace = request(method, {'id': 'pokemon:pokemon', 'endpoint': group, 'action': action, **query}, body, token)
            envelope = {'success': True, 'data': data, 'error': None, 'code': 0}
            responses.append((200, envelope))
            observe(f'requests {method} {group}/{action}', python(method, group, action, query, body),
                    {'kind': 'success', 'data': data}, trace)
            responses.append((200, envelope))
            observe(f'curl {method} {group}/{action}', curl(method, group, action, query, body),
                    {'status': 200, 'body': envelope}, trace)

        for label, method, group, action, body, reply, expected_python, expected_curl in [
            ('explicit recovery absence', 'GET', 'battle', 'recover', None, (200, missing),
             {'kind': 'success', 'data': None}, {'status': 200, 'body': missing}),
            ('code 404 on another route', 'GET', 'battle', 'maps', None, (200, missing),
             {'kind': 'refused', 'code': 404, 'message': 'Game refused'}, {'status': 200, 'body': missing}),
            ('battle refusal', 'POST', 'battle', 'capture', {'ball_id': 18}, (200, refusal),
             {'kind': 'refused', 'code': 403, 'message': 'Game refused'}, {'status': 200, 'body': refusal}),
            ('lost reply sends once', 'POST', 'battle', 'capture', {'ball_id': 18}, None,
             {'kind': 'uncertain'}, {'exit': 52}),
        ]:
            trace = request(method, {'id': 'pokemon:pokemon', 'endpoint': group, 'action': action}, body, token)
            responses.append(reply)
            observe('requests ' + label, python(method, group, action, {}, body), expected_python, trace)
            responses.append(reply)
            observe('curl ' + label, curl(method, group, action, {}, body), expected_curl, trace)

        capture = ('POST', 'battle', 'capture', {}, {'ball_id': 18})
        observe('requests decline sends nothing', python(*capture, approved=False), {'kind': 'cancelled'})
        observe('curl decline sends nothing', curl(*capture, approved=False), None)
        login = (31, 'replacement')
        observe('requests stale login sends nothing', python(*capture), {'kind': 'session-changed'})
        observe('curl stale login sends nothing', curl(*capture), {'exit': 3})
    server.shutdown()
    thread.join()

print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(),
                  'rosterGuideSHA256': sha256(roster).hexdigest(), 'battleGuideSHA256': sha256(battle).hexdigest(),
                  'results': results, 'limitations': ['Inert HTTP listener and synthetic responses',
                  'No deployment observations or account effects']}, indent=2))

"""Replay the packaged direct settings examples over inert loopback HTTP."""
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
    guide = package.extractfile('package/docs/moderator-settings.md').read()


def snippet(language):
    return re.search(rf'^```{language}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)


functions = {}
exec(compile(snippet('python'), 'packaged-settings-guide.py', 'exec'), functions)
cookie = 'fixture=moderator-settings'
login_id = 'fictional-moderator-login'
fixed = {'formhash': 'abcdef12'}
json_read = {'tsdmapp': 'json', 'nodoc': '1'}
v4_read = {**json_read, 'tsdmv': '4'}
json_write = {'tsdmapp': 'json'}
v4_write = {**json_write, 'tsdmv': '4'}
calls, results, responses = [], [], []


class Panel(BaseHTTPRequestHandler):
    def do_GET(self):
        target = urlsplit(self.path)
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        calls.append({'path': target.path, 'query': dict(parse_qsl(target.query, keep_blank_values=True)),
                      'method': self.command, 'form': dict(parse_qsl(raw, keep_blank_values=True)) if raw else None,
                      'moderatorCookie': self.headers.get('Cookie') == cookie,
                      'adminTokenPresent': self.headers.get('X-Tsdmapp-Admin') is not None,
                      'contentType': self.headers.get('Content-Type')})
        reply = responses.pop(0)
        if reply is None:
            return
        status, body = reply
        self.send_response(status)
        self.send_header('Content-Type', 'application/json' if isinstance(body, dict) else 'text/html')
        self.end_headers()
        self.wfile.write((json.dumps(body) if isinstance(body, dict) else body).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, received, expected, trace):
    actual = {'result': received, 'requests': calls.copy()}
    expected = {'result': expected, 'requests': trace}
    assert actual == expected, (name, actual, expected)
    assert not responses, name
    results.append({'name': name, 'expected': expected, 'actual': actual})
    calls.clear()


def expect(method, query, form):
    return {'path': '/forum.php', 'query': {'mod': 'modcp', **query}, 'method': method, 'form': form,
            'moderatorCookie': True, 'adminTokenPresent': False,
            'contentType': 'application/x-www-form-urlencoded' if method == 'POST' else None}


def structured(response_type, schema, **data):
    return {'ok': 1, 'uid': 31, 'type': response_type, 'schema': schema, **data}


forum_access = {'action': 'forumaccess'}
access_list = structured('modcp_forumaccess', 38, fid=10, list=[{'uid': 71, 'username': 'fixture member', 'reply': -1}])
access_deny = {**fixed, 'op': '', 'addsubmit': 'true', 'fid': '10', 'new_user': 'fixture member', 'new_reply': '-1'}
access_restore = {**fixed, 'op': '', 'addsubmit': 'true', 'fid': '10', 'new_user': 'fixture member', 'deleteaccess': '1'}
member = {'action': 'member'}
member_view = lambda mode: structured('modcp_member', 43, op=mode, member={'uid': 71, 'username': 'fixture member'})
member_edit = {**fixed, 'uid': '71', 'username': '', 'bionew': 'Fictional profile', 'signaturenew': 'Fixture signature', 'clearavatar': '1', 'editsubmit': 'true'}
member_ban = {**fixed, 'uid': '71', 'username': '', 'bannew': '4', 'banexpirynew': '3', 'reason': 'Fictional reason', 'bansubmit': 'true'}
member_lift = {**member_ban, 'bannew': '0', 'banexpirynew': ''}
receipt = lambda key: structured('result', 13, kind='message', message_key=key)
ipban = {**member, 'op': 'ipban'}
ip_list = structured('modcp_ipban', 44, list=[{'id': 44, 'ip': '192.0.2.7', 'can_delete': 1}])
ip_add = {**fixed, 'ipnew': '192.0.2.7', 'validitynew': '3', 'ipbansubmit': 'true'}
ip_delete = {**fixed, 'delete[0]': '44', 'ipbansubmit': 'true'}
home = {'action': 'home'}
notes = lambda items: structured('modcp_home', 39, notes=items)
note_add = {**fixed, 'op': 'addnote', 'submit': 'true', 'newmessage': 'Fixture note', 'newaccess[2]': '1', 'newexpiration': '5'}
note_delete = {**fixed, 'op': 'delete', 'notlistsubmit': 'yes', 'delete[0]': '91'}
forum = {'action': 'forum'}
rules = {**forum, 'op': 'editforum'}
rules_page = lambda text, edit: structured('modcp_editforum', 46, fid=10, rules=text, editable=edit)
rules_save = {**fixed, 'fid': '10', 'rulesnew': 'Fixture rules', 'editsubmit': 'true'}
rec_save = {**fixed, 'op': 'recommend', 'fid': '10', 'page': '1', 'check': '', 'delete[0]': '802',
            'order[801]': '3', 'subject[801]': 'Edited', 'expirationrecommend[801]': '2099-1-1 12:00',
            'order[802]': '2', 'subject[802]': 'Original', 'expirationrecommend[802]': '', 'editsubmit': 'yes'}
ann = {'action': 'announcement'}
ann_list = structured('modcp_announcement', 47, op='add', list=[{'id': 66, 'subject': 'Fixture announcement', 'editable': 1}])
ann_create = {**fixed, 'id': '', 'displayorder': '', 'subject': 'Fixture announcement', 'type': '0',
              'starttime': '2099-01-01', 'endtime': '2099-02-01', 'message[0]': 'Fixture message', 'message[1]': '', 'submit': 'true'}
ann_edit = {**ann_create, 'id': '66', 'displayorder': '7', 'type': '1', 'message[0]': '', 'message[1]': 'https://example.test/fixture'}
ann_delete = {**fixed, 'submit': 'true', 'delete[0]': '66'}
ann_form = structured('modcp_announcement', 47, op='edit', form={'id': 66, 'subject': 'Fixture announcement', 'displayorder': '7'})

matrix = [
    ('list forum access', 'GET', {**forum_access, 'fid': '10', 'page': '2', **json_read}, None, (200, {**access_list, 'page': 2})),
    ('search forum access', 'POST', {**forum_access, **json_write}, {**fixed, 'searchsubmit': 'true', 'fid': '10', 'suser': 'fixture member'}, (200, access_list)),
    ('deny forum access', 'POST', {**forum_access, **json_write}, access_deny, (200, {**access_list, 'result': {'done': 1}})),
    ('restore forum access', 'POST', {**forum_access, **json_write}, access_restore, (200, {**access_list, 'list': [], 'result': {'done': 1}})),
    ('protected access refusal', 'POST', {**forum_access, **json_write}, access_deny, (200, {**access_list, 'result': {'error': 1, 'error_key': 'whitelist'}})),
    ('find member editor by name', 'GET', {**member, 'op': 'edit', 'username': 'fixture member', **v4_read}, None, (200, member_view('edit'))),
    ('edit member fields', 'POST', {**member, 'op': 'edit', **v4_write}, member_edit, (200, receipt('members_edit_succeed'))),
    ('find member ban form by UID', 'GET', {**member, 'op': 'ban', 'uid': '71', **v4_read}, None, (200, member_view('ban'))),
    ('ban selected member', 'POST', {**member, 'op': 'ban', **v4_write}, member_ban, (200, receipt('modcp_member_ban_succeed'))),
    ('lift member ban', 'POST', {**member, 'op': 'ban', **v4_write}, member_lift, (200, receipt('modcp_member_ban_succeed'))),
    ('list IP bans', 'GET', {**ipban, **v4_read}, None, (200, ip_list)),
    ('add IP ban', 'POST', {**ipban, **v4_write}, ip_add, (200, {**ip_list, 'result': {'added': 1}})),
    ('delete selected IP ban', 'POST', {**ipban, **v4_write}, ip_delete, (200, {**ip_list, 'list': []})),
    ('read filtered log', 'GET', {'action': 'log', 'keyword': 'fictional subject', 'page': '2', **json_read}, None,
     (200, structured('modcp_log', 24, page=2, pages=3, keyword='fictional subject', entries=[{'id': 44, 'action': 'forum'}]))),
    ('list management notes', 'GET', {**home, **json_read}, None, (200, notes([]))),
    ('create management note', 'POST', {**home, **json_write}, note_add, (200, notes([{'id': 91, 'message': 'Fixture note', 'to_supermod': 1}]))),
    ('delete management note', 'POST', {**home, **json_write}, note_delete, (200, notes([]))),
    ('read forum rules', 'GET', {**rules, 'fid': '10', **v4_read}, None, (200, rules_page('Original', 1))),
    ('save forum rules', 'POST', {**rules, **v4_write}, rules_save, (200, rules_page('Fixture rules', 1))),
    ('locked native rules redraw', 'POST', rules, rules_save, (200, '<textarea name="rulesnew" readonly>Original</textarea>')),
    ('list recommendations', 'GET', {**forum, 'op': 'recommend', 'fid': '10'}, None, (200, '<input name="order[801]" value="1">')),
    ('save and remove recommendation rows', 'POST', forum, rec_save, (200, '<input name="order[801]" value="3">')),
    ('list announcements and create offer', 'GET', {**ann, **v4_read}, None, (200, ann_list)),
    ('create announcement', 'POST', {**ann, 'op': 'add', **v4_write}, ann_create, (200, {**ann_list, 'result': {'added': 1}})),
    ('read selected announcement editor', 'GET', {**ann, 'op': 'edit', 'id': '66', **v4_read}, None, (200, ann_form)),
    ('edit announcement link', 'POST', {**ann, 'op': 'edit', **v4_write}, ann_edit, (200, {**ann_form, 'result': {'edited': 1}})),
    ('delete selected announcement', 'POST', {**ann, 'op': 'manage', **v4_write}, ann_delete, (200, {**ann_list, 'list': []})),
    ('expired panel on announcement edit', 'POST', {**ann, 'op': 'edit', **v4_write}, ann_edit, (200, {'ok': 0, 'uid': 31, 'error': 'modcp_login'})),
    ('lost reply on selected announcement', 'POST', {**ann, 'op': 'edit', **v4_write}, ann_edit, None),
]

with ThreadingHTTPServer(('127.0.0.1', 0), Panel) as server, requests.Session() as session:
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    session.trust_env = False
    session.cookies.set(*cookie.split('=', 1), domain='127.0.0.1')

    def python(method, query, form, approved=True, active=login_id):
        response = functions['settings_request'](session, origin, lambda: active, login_id, method, query, form, approved=approved)
        if isinstance(response, str):
            return response
        return [response.status_code, response.json() if 'json' in response.headers.get('Content-Type', '') else response.text]

    def curl(method, query, form, approved=True, active=login_id):
        env = {**os.environ, 'FORUM_ORIGIN': origin, 'FORUM_COOKIE': cookie, 'PANEL_BOUND_LOGIN': login_id,
               'PANEL_CURRENT_LOGIN': active, 'NO_PROXY': '127.0.0.1'}
        response = subprocess.run(['sh', '-c', snippet('sh')+'\nsettings_request "$@"', 'guide',
                                   'yes' if approved else 'no', method, urlencode(query)],
                                  input=urlencode(form or {}), text=True, capture_output=True, env=env, timeout=10)
        if response.returncode:
            return {'exit': response.returncode}
        if not response.stdout:
            return None
        body, status = response.stdout[:-1].rsplit('\n', 1)
        return [int(status), json.loads(body) if body.startswith('{') else body]

    for name, method, query, form, reply in matrix:
        for driver, run, lost in [('requests', python, 'uncertain'), ('curl', curl, {'exit': 52})]:
            responses.append(reply)
            observe(driver + ' ' + name, run(method, query, form), list(reply) if reply else lost,
                    [expect(method, query, form)])
    for driver, run, declined, stale in [('requests', python, 'declined', 'binding-changed'),
                                        ('curl', curl, None, {'exit': 3})]:
        for name, method, query, values, _ in matrix:
            if method == 'POST':
                observe(driver + ' declines ' + name, run(method, query, values, approved=False), declined, [])
        observe(driver + ' rejects replaced moderator login', run('POST', rules, rules_save, active='new-login'), stale, [])
    observe('curl refuses reserved query override', curl('GET', {'action': 'forumaccess', 'mod': 'admincp'}, None), {'exit': 2}, [])
    server.shutdown()
    worker.join()

print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(), 'guideSHA256': sha256(guide).hexdigest(),
                  'results': results, 'limitations': ['Fictional moderator, members, addresses and content on loopback',
                                                     'No administrator grant or deployed forum effects']}, indent=2))

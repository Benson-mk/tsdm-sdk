"""Replay Python and curl from the packed guide against a disposable local forum."""
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
    guide = package.extractfile('package/docs/replies.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
ns = {}
exec(compile(blocks['python'], 'packed-replies-guide.py', 'exec'), ns)

page = '/forum.php?mod=post&action=reply&fid=2&tid=90&reppost=302'
submit = '/forum.php?mod=post&action=reply&fid=2&tid=90&replysubmit=yes&extra=fixture'
exact = '/forum.php?mod=redirect&goto=findpost&ptid=90&pid=303&tsdmapp=json&nodoc=1'
edit = '/forum.php?mod=post&action=edit&fid=2&tid=90&pid=303&tsdmapp=json'
quote = '[quote]Original post[/quote]'
message = 'A direct & + fixture reply'
source = quote + '\n' + message
fields = {'formhash': 'fakehash', 'reppid': '302', 'reppost': '302', 'noticeauthor': 'fake',
          'noticeauthormsg': 'Original post', 'noticetrimstr': quote, 'replysubmit': 'true'}
options = [{'name': 'usesig', 'type': 'checkbox', 'checked': 1, 'disabled': 0, 'value': '1'}]
form = {'type': 'post', 'schema': 16, 'action': 'reply', 'ok': 1, 'uid': 31, 'fid': 2, 'tid': 90,
        'submit': {'method': 'POST', 'url': submit, 'fields': fields}, 'subject': {'shown': 1, 'value': ''},
        'message': {'json': 0, 'value': ''}, 'options': options,
        'seccheck': {'seccode': 1, 'seccode_hash': 'cFixture', 'modid': 'forum::post',
                     'secqaa': 1, 'secqaa_hash': 'qFixture'}}
submitted = dict(fields, message=message, subject='', usesig='1', seccodeverify='human input', secanswer='human input',
                 seccodehash='cFixture', secqaahash='qFixture', seccodemodid='forum::post')
result = {'type': 'result', 'schema': 13, 'kind': 'handle', 'ok': 1, 'uid': 31,
          'message_key': 'post_reply_mod_succeed', 'values': {'reply_mod': '1'}}
thread = {'type': 'thread', 'schema': 15, 'ok': 1, 'uid': 31, 'thread': {'tid': 90},
          'posts': [{'pid': 303, 'authorid': 31, 'body_html': 'Rendered'}]}
stored = {'type': 'post', 'schema': 16, 'action': 'edit', 'ok': 1, 'uid': 31, 'fid': 2, 'tid': 90,
          'pid': 303, 'first': 0, 'message': {'json': 0, 'value': source}, 'subject': {'value': ''}, 'options': options}


def target(value):
    url = urlsplit(value)
    return url.path, parse_qs(url.query, keep_blank_values=True)


calls = []
response = None


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        path, query = target(self.path)
        for key in list(query):
            if key.isdecimal():
                query['fixture-clock'] = query.pop(key)
        calls.append({'method': self.command, 'path': path, 'query': query,
                      'fields': parse_qs(body, keep_blank_values=True), 'cookie': self.headers.get('Cookie'),
                      'referer': urlsplit(self.headers.get('Referer', '')).path})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if isinstance(response, dict) else 'text/plain')
        self.end_headers()
        self.wfile.write((json.dumps(response) if isinstance(response, dict) else response).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def expectation(method, url, body=None, referer=''):
    path, query = target(url)
    return {'method': method, 'path': path, 'query': query,
            'fields': {k: [v] for k, v in (body or {}).items()}, 'cookie': 'fixture=31', 'referer': referer}


rows = []
verification_cases = []


def observe(client, mode, expected, returned, expected_returned):
    actual = calls[-len(expected):] if expected else []
    assert actual == expected, (client, mode, actual, expected)
    assert returned == expected_returned, (client, mode, returned, expected_returned)
    rows.append({'client': client, 'mode': mode, 'expected': {'requests': expected, 'result': expected_returned},
                 'observed': {'requests': actual, 'result': returned}})


with TemporaryDirectory() as directory, ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    session = requests.Session()
    session.trust_env = False
    session.cookies.set('fixture', '31')
    response = form
    opened = ns['open_reply'](session, origin, page).json()
    observe('requests', 'open quote', [expectation('GET', page + '&tsdmapp=json')], opened, form)
    for field, hash_id, modid in [('seccode', 'cFixture', 'forum::post'), ('secqaa', 'qFixture', None)]:
        for answer in [None, 'human input']:
            response = ('<root><![CDATA[Fixture question?]]></root>' if field == 'secqaa'
                        else 'src="misc.php?mod=seccode&idhash=cFixture&update=opaque"') if answer is None else '<root><![CDATA[succeed]]></root>'
            query = {'mod': field, 'idhash': hash_id, 'action': 'update' if answer is None else 'check'}
            if modid:
                query['modid'] = modid
            if field == 'secqaa' or answer is not None:
                query['inajax'] = '1'
            query.update({'fixture-clock': ''} if answer is None else {'secverify': answer})
            returned = ns['verify_field'](session, origin, page, field, hash_id, modid, answer).text
            expected = expectation('GET', '/misc.php?' + urlencode(query), referer='/forum.php')
            observe('requests', f'{field} {query["action"]}', [expected], returned, response)
            verification_cases.append(('refresh' if answer is None else 'check', field, hash_id, modid, answer, expected, response))
    response = result
    sent = ns['send_reply'](session, origin, opened, 31, 2, 90, message, approved=True,
                           answers={'seccode': 'human input', 'secqaa': 'human input'}).json()
    post = expectation('POST', submit + '&inajax=1&tsdmapp=json', submitted)
    observe('requests', 'deliberate send', [post], sent, result)
    # Dispatch two separate GETs through the real requests session, selecting the fixture by target.
    original_get = session.get
    def get(url, **kwargs):
        global response
        response = thread if 'mod=redirect' in url else stored
        return original_get(url, **kwargs)
    session.get = get
    recovery = [expectation('GET', exact), expectation('GET', edit)]
    checked = ns['check_reply'](session, origin, 31, 2, 90, 303, source, '', {'usesig': 1})
    observe('requests', 'exact readback', recovery, checked, 'confirmed, attribution unresolved')
    checked = ns['check_reply'](session, origin, 31, 2, 90, 303, 'wrong source', '', {'usesig': 1})
    observe('requests', 'mismatched readback', recovery, checked, 'inconclusive')

    body_path = Path(directory) / 'fields.txt'
    body_path.write_text(urlencode(submitted))
    env = {**os.environ, 'FORUM_ORIGIN': origin, 'NO_PROXY': '127.0.0.1', 'FORUM_COOKIE': 'fixture=31',
           'REPLY_PAGE': origin + page, 'SUBMIT_URL': origin + submit + '&inajax=1&tsdmapp=json',
           'FORM_BODY_FILE': str(body_path), 'BOARD_ID': '2', 'THREAD_ID': '90', 'POST_ID': '303'}
    for mode, expected, response in [('open', expectation('GET', page + '&tsdmapp=json'), form),
                                     ('native', expectation('GET', page), '<form id="postform">Fixture form</form>'),
                                     ('submit', post, result), ('exact', recovery[0], thread), ('stored', recovery[1], stored)]:
        run = subprocess.run(['sh'], input=blocks['sh'], text=True, capture_output=True, check=True,
                             env={**env, 'MODE': mode, 'CONFIRM': '1'})
        header, body = run.stdout.split('\n\n', 1)
        assert header.startswith('HTTP/1.0 200 ')
        observe('curl', mode, [expected], json.loads(body) if isinstance(response, dict) else body, response)
    for mode, field, hash_id, modid, answer, expected, response in verification_cases:
        run = subprocess.run(['sh'], input=blocks['sh'], text=True, capture_output=True, check=True,
                             env={**env, 'MODE': mode, 'VERIFY_FIELD': field, 'VERIFY_HASH': hash_id,
                                  'VERIFY_MODID': modid or '', 'VERIFY_ANSWER': answer or ''})
        header, body = run.stdout.split('\n\n', 1)
        assert header.startswith('HTTP/1.0 200 ')
        observe('curl', f'{field} {mode}', [expected], body, response)
    before = len(calls)
    blocked = subprocess.run(['sh'], input=blocks['sh'], text=True, capture_output=True,
                             env={**env, 'MODE': 'submit', 'CONFIRM': '0'})
    assert blocked.returncode and len(calls) == before
    observe('curl', 'submit without confirmation', [], len(calls) - before, 0)
    assert len(calls) == sum(len(row['expected']['requests']) for row in rows)
    assert sum(call['method'] == 'POST' for call in calls) == 2
    server.shutdown()

digest = lambda content: hashlib.sha256(content).hexdigest()
print(json.dumps({'evidence': 'controlled loopback, packed direct guide', 'archiveSHA256': digest(archive.read_bytes()),
                  'guideSHA256': digest(guide), 'fixtureSHA256': digest(Path(__file__).read_bytes()),
                  'python': sys.version.split()[0], 'requests': requests.__version__,
                  'curl': subprocess.check_output(['curl', '--version'], text=True).splitlines()[0],
                  'results': rows}, indent=2))

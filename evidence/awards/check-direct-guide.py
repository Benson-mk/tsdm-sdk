"""Run the packaged Python and curl helpers against a disposable inert forum."""
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
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/tsdm-sdk-0.1.0.tgz')
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/awards.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
namespace = {}
exec(compile(blocks['python'], 'awards-guide.py', 'exec'), namespace)
calls = []
results = []


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode()
        calls.append({'method': self.command, 'path': url.path,
                      'query': parse_qs(url.query), 'fields': parse_qs(body),
                      'fixtureCookie': self.headers.get('Cookie') == 'fixture=awards'})
        if url.query.endswith('page=2'):
            self.send_response(302)
            self.send_header('Location', '/must-not-follow')
        else:
            self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"fixture":"inert"}')

    do_POST = do_GET

    def log_message(self, *_):
        pass


def expected(method, query, fields=None):
    return {'method': method, 'path': '/plugin.php', 'query': {k: [v] for k,v in query.items()},
            'fields': {k: [v] for k,v in (fields or {}).items()}, 'fixtureCookie': True}


def observe(name, value, status, requests_expected):
    actual = {'status': value, 'requests': calls.copy()}
    wanted = {'status': status, 'requests': requests_expected}
    assert wanted == actual, (name, wanted, actual)
    results.append({'name': name, 'expected': wanted, 'actual': actual})
    calls.clear()


medal = 'dsu_medalCenter:memcp'
title = 'tsdmtitle:tsdmtitle'
reads = [(view, {'id': 'tsdmapp:api', 'action': view}) for view in
         ('medals','mymedals','medalgrant','titles','titleshop','titleexchange','titleissue','bggrant')]
reads += [('achievements', {'id':'tsdmtitle:achi','tsdmapp':'json','tsdmv':'4','nodoc':'1'})]
forms = [
    ('claim', medal, 'action', 'claim', {'medalid':'101','method':'5','credit':'2','dsumcsubmit':'1'}),
    ('sethide', medal, 'action', 'sethide', {'myMedalHide[11]':'1','dsumcsubmit':'1'}),
    ('grantgrid', medal, 'action','grantgrid', {'grant_users':'45','grant_medalids':'21','grant_reason':'Event','grantconfirm':'1'}),
    ('grantrevoke', medal, 'action','grantrevoke', {'logid':'6','dsumcsubmit':'1'}),
    ('grantrevokebatch', medal,'action','grantrevokebatch', {'batch':'5','dsumcsubmit':'1'}),
    ('settitle', title,'action','settitle', {'settitlesubmit':'true','settitleid':'0'}),
    ('buy',title,'action','buy', {'buysubmit':'true','buyid':'11'}),
    ('exchange',title,'action','exchange', {'exchangesubmit':'true','exchangeid':'7'}),
    ('issue',title,'action','issue', {'issuesubmit':'true','issueop':'revoke','issueusers':'45\nfixture recipient','issuetitles':'31','issuedays':'0','issuenote':'Event'}),
    ('background','background:memcp','ac','slotadd', {'slotaddsubmit':'true','slotadduid':'45,999999','slotaddtime':'7天','slotaddurl':'1209-1.jpg','slotaddnotify':'1'}),
]
with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    with requests.Session() as session:
        session.trust_env = False
        session.cookies.set('fixture','awards',domain='127.0.0.1')

        def shell(function, *args, data=''):
            env = {**os.environ, 'FORUM_ORIGIN': origin, 'FORUM_COOKIE': 'fixture=awards', 'NO_PROXY':'127.0.0.1'}
            result = subprocess.run(['sh','-c', blocks['sh'] + '\n"$@"','awards-guide',function,*args],
                input=data, text=True, capture_output=True, check=True, env=env)
            return int(result.stdout.splitlines()[-1]) if result.stdout.strip() else None

        def status(response):
            return None if response is None else response.status_code

        for view, query in reads:
            for implementation, response in (
                ('requests', lambda: status(namespace['read_awards'](session,origin,view,{}))),
                ('curl', lambda: shell('awards_read',view)),
            ):
                observe(f'{implementation} reads {view}', response(), 200, [expected('GET',query)])
        for name, plugin, key, action, form in forms:
            fields = {'formhash':'abcd1234',**form}
            query = {'id':plugin,key:action,'tsdmapp':'json'}
            observe(f'requests submits {name}', status(namespace['send_award'](session,origin,name,fields,approved=True)),
                    200,[expected('POST',query,fields)])
            observe(f'curl submits {name}', shell('awards_send','yes',name,data=urlencode(fields)),
                    200,[expected('POST',query,fields)])
        observe('requests declined sends zero calls', status(namespace['send_award'](session,origin,'claim',{},approved=False)),None,[])
        observe('curl declined sends zero calls',shell('awards_send','no','claim'),None,[])
        query = {'id':medal,'action':'apply','medalid':'593','applytype':'5'}
        observe('requests declines effectful legacy GET', status(namespace['legacy_medal'](session,origin,593,5,approved=False)),None,[])
        observe('curl declines effectful legacy GET',shell('awards_legacy_medal','no','593','5'),None,[])
        observe('requests deliberately sends legacy GET', status(namespace['legacy_medal'](session,origin,593,5,approved=True)),200,[expected('GET',query)])
        observe('curl deliberately sends legacy GET',shell('awards_legacy_medal','yes','593','5'),200,[expected('GET',query)])
        query = {'id':'tsdmapp:api','action':'titles','page':'2'}
        observe('requests preserves a redirect as a response',status(namespace['read_awards'](session,origin,'titles',{'page':'2'})),302,[expected('GET',query)])
        observe('curl preserves a redirect as a response',shell('awards_read','titles','--data-urlencode','page=2'),302,[expected('GET',query)])
    server.shutdown()
    thread.join()
print(json.dumps({'archiveSHA256': sha256(archive.read_bytes()).hexdigest(), 'guideSHA256': sha256(guide).hexdigest(),
                  'limitations':['Inert loopback HTTP, fictional cookie and controls', 'No deployment observations'],
                  'results': results}, ensure_ascii=False, indent=2))

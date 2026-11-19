"""Exercise both packaged host examples against a fictional moderator on loopback."""
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
from tempfile import TemporaryDirectory
from urllib.parse import parse_qsl, urlencode, urlsplit

import requests

archive = Path(sys.argv[1])
with tarfile.open(archive) as package:
    guide = package.extractfile('package/docs/moderator-queues.md').read()


def snippets(language):
    return re.findall(rf'^```{language}\n([\s\S]+?)^```$', guide.decode(), re.M)


functions = {}
exec(compile('\n'.join(snippets('python')), 'packaged-moderator-guide.py', 'exec'), functions)
cookie = 'fixture=moderator'
admin_cookie = 'fixture=administrator'
admin_token = 'fictional-admin-token'
login_id = 'fixture-login'
formhash = ('formhash', 'abcdef12')
json_read = {'tsdmapp': 'json', 'nodoc': '1'}
mod = ('mod', 'modcp')
result = lambda key, **extra: {'ok': 1, 'uid': 31, 'type': 'result', 'schema': 13,
                              'kind': 'message', 'message_key': key, **extra}
calls = []
results = []
responses = []


class Panel(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        admin = url.path == '/plugin.php'
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        calls.append({'method': self.command, 'path': url.path, 'query': dict(parse_qsl(url.query, keep_blank_values=True)),
                      'fields': [list(pair) for pair in parse_qsl(raw.decode(), keep_blank_values=True)],
                      'contentType': self.headers.get('Content-Type'), 'fictionalCookie': self.headers.get('Cookie') == (admin_cookie if admin else cookie),
                      'administratorToken': self.headers.get('X-Tsdmapp-Admin') == admin_token if admin else self.headers.get('X-Tsdmapp-Admin') is not None})
        reply = responses.pop(0)
        if reply is None:
            return
        status, body = reply
        self.send_response(status)
        if status == 302:
            self.send_header('Location', '/forum.php?mod=modcp&action=home')
        self.send_header('Content-Type', 'application/json' if isinstance(body, dict) else 'text/html')
        self.end_headers()
        self.wfile.write((json.dumps(body) if isinstance(body, dict) else body).encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def observe(name, value, expected, traces):
    assert value == expected, (name, value, expected)
    assert calls == traces, (name, calls, traces)
    assert not responses, name
    results.append({'name': name, 'expected': [expected, traces], 'actual': [value, calls.copy()]})
    calls.clear()


def expected_trace(method, query, fields):
    return {'method': method, 'path': '/forum.php', 'query': dict([mod, *query.items()]),
            'fields': [list(pair) for pair in fields or []], 'fictionalCookie': True, 'administratorToken': False,
            'contentType': 'application/x-www-form-urlencoded' if method == 'POST' else None}


home = {'ok': 1, 'uid': 31, 'type': 'modcp_home', 'schema': 39, 'counts': {'moderate': 3}}
login_form = '<form action="forum.php?mod=modcp&action=login" method="post"><input type="password" name="cppwd"></form>'
post_page = {'ok': 1, 'uid': 31, 'fid': 10, 'type': 'modcp_post', 'schema': 37, 'posts': [{'pid': 901}, {'pid': 902}]}
thread_page = {'ok': 1, 'uid': 31, 'fid': 10, 'type': 'modcp_thread', 'schema': 36, 'threads': [{'tid': 801}]}
report_page = {'ok': 1, 'uid': 31, 'fid': 10, 'type': 'modcp_report', 'schema': 28, 'reports': [{'id': 501, 'uid': 77}]}
matrix = [
    ('dashboard asks for password', 'GET', {'action': 'home', **json_read}, None, (200, login_form)),
    ('approved panel login', 'POST', {'action':'login'}, [formhash, ('fid','0'), ('submit','yes'), ('login_panel','yes'), ('cppwd','fictional-password')], (302, '')),
    ('dashboard access rechecked', 'GET', {'action':'home', **json_read}, None, (200, home)),
]
for operation, filters, page in [('thread', {'submit':'true'}, thread_page), ('post', {'searchsubmit':'true','posttableid':'0'}, post_page)]:
    target = {'action':'thread', 'op':operation, 'fid':'10'}
    matrix.extend([
        (operation + ' management page', 'GET', {**target, **json_read}, None, (200, page)),
        (operation + ' stored search', 'GET', {**target, 'do':'search', **filters, 'keywords':'fixture', **json_read}, None, (200, page)),
        (operation + ' result continuation','GET',{**target,'do':'list','page':'2',**({'posttableid':'0'} if operation == 'post' else {}),**json_read},None,(200,{**page,'page':2})),
    ])
matrix.append(('delete selected posts with partial result', 'POST', {'action':'thread','op':'post','tsdmapp':'json'},
               [formhash, ('fid','10'), ('do','delete'), ('posttableid','0'), ('deletesubmit','true'), ('delete[0]','901'), ('delete[1]','902'), ('nocredit','1')],
               (200,{**post_page,'posts':[{'pid':902}],'message_key':'modcp_thread_delete_succeed'})))
for op, item, decision in [('threads','801','validate'),('replies','901','ignore'),('members','105','delete')]:
    members = op == 'members'
    target = {'action':'moderate','op':op,**({} if members else {'fid':'10'})}
    queue = {'ok':1,'uid':31,'type':'modcp_moderate','schema':42,'op':op,('members' if members else 'items'):[{('uid' if members else 'id'):int(item)}]}
    read = {**target,'filter':'0',**json_read,'tsdmv':'4'}
    fields = [formhash, ('filter','0')]
    if not members:
        fields.append(('fid','10'))
    fields.extend([('modact',decision),('modsubmit','1')])
    if not members:
        fields.append(('handlekey','mods'))
    fields.extend([('moderate[0]' if members else 'moderate[]',item),('reason','fictional reason')])
    matrix.extend([
        (op + ' queue read','GET',read,None,(200,queue)),
        (op + ' verdict','POST',{**target,**({} if members else {'infloat':'yes','inajax':'1'}),'tsdmapp':'json','tsdmv':'4'},fields,(200,result('modcp_mod_succeed'))),
    ])
    if members:
        matrix.append(('registration selection rechecked','GET',read,None,(200,{**queue,'members':[]})))
report = {'action':'report','fid':'10'}
resolve = [formhash,('reportsubmit','true'),('reportids[0]','501'),('reportuids[501]','77'),('creditsvalue[501]','2'),('msg[501]','reviewed')]
matrix.extend([
    ('report listing','GET',{**report,**json_read},None,(200,report_page)),
    ('report resolution','POST',report,resolve,(200,result('modcp_report_success'))),
    ('report refusal','POST',report,resolve,(200,result('quickclear_noperm',alert='error'))),
    ('report loss sends once','POST',report,resolve,None),
])
for family, identity in [('recyclebin','801'),('recyclebinpost','901')]:
    shown = f'<input type="checkbox" name="moderate[]" value="{identity}"><button onclick="modthreads(\'restore\')">Restore</button>'
    empty = '<p class="emp">No results</p>'
    start = {'action':family,'fid':'10'}
    matrix.extend([
        (family + ' view','GET',start,None,(200,shown)),
        (family + ' search','POST',{'action':family,'op':'search'},[formhash,('fid','10'),('keywords','fixture'),('searchsubmit','true')],(200,shown)),
    ])
    for operation in ['restore','delete']:
        fields = [formhash, *([('posttableid','0')] if family == 'recyclebinpost' else []),
                  ('op',operation),('oldop','list'),('dosubmit','submit'),('moderate[0]',identity)]
        returned = empty if operation == 'restore' else shown
        matrix.extend([
            (family + ' ' + operation, 'POST', {**start,'page':'1'},fields,(200,returned)),
            (family + ' ' + operation + ' readback', 'GET', start,None,(200,returned)),
        ])

with ThreadingHTTPServer(('127.0.0.1',0),Panel) as server, requests.Session() as session:
    worker = Thread(target=server.serve_forever,daemon=True)
    worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    session.trust_env = False
    session.cookies.set(*cookie.split('=',1),domain='127.0.0.1')

    def python(method, query, fields, approved=True, current=login_id):
        response = functions['panel_request'](session,origin,lambda:current,login_id,method,query,fields,approved=approved)
        if isinstance(response,str):
            return response
        return [response.status_code, response.json() if 'json' in response.headers.get('Content-Type','') else response.text]

    def curl(method, query, fields, approved=True, current=login_id):
        env = {**os.environ,'FORUM_ORIGIN':origin,'FORUM_COOKIE':cookie,'PANEL_BOUND_LOGIN':login_id,
               'PANEL_CURRENT_LOGIN':current,'NO_PROXY':'127.0.0.1'}
        out = subprocess.run(['sh','-c',snippets('sh')[0]+'\npanel_request "$@"','guide','yes' if approved else 'no',method,urlencode(query)],
                             input=urlencode(fields or []),text=True,capture_output=True,env=env,timeout=10)
        if out.returncode:
            return {'exit':out.returncode}
        if not out.stdout:
            return None
        body, status = out.stdout[:-1].rsplit('\n',1)
        return [int(status),json.loads(body) if body.startswith('{') else body]

    for name, method, query, fields, reply in matrix:
        expectation = [expected_trace(method,query,fields)]
        for label, invoke, dropped in [('requests',python,'uncertain'),('curl',curl,{'exit':52})]:
            responses.append(reply)
            observe(label+' '+name,invoke(method,query,fields),list(reply) if reply is not None else dropped,expectation)
    for label, invoke, decline, stale, refusal in [('requests',python,'declined','binding-changed','panel-report-delete-unavailable'),
                                                  ('curl',curl,None,{'exit':3},{'exit':4})]:
        observe(label+' declined report effect',invoke('POST',report,resolve,False),decline,[])
        observe(label+' replaced login prevents effect',invoke('POST',report,resolve,current='other-login'),stale,[])
        observe(label+' panel report deletion unavailable',invoke('POST',{'action':'report','op':'delete'},[]),refusal,[])
    admin_intent = {'kind':'admin-report-deletion','origin':origin,'forumId':'10','reportIds':['501']}
    admin_hash = 'd00df00d'
    admin_bound = 'fictional-administrator-login'
    operation_id = 'sdk38-fixture-report-delete'
    admin_fields = [('op','delete'),('ids[0]','501'),('opid',operation_id),('formhash',admin_hash)]
    admin_expected = {'method':'POST','path':'/plugin.php','query':{'id':'tsdmapp:api','action':'adminreport'},
                      'fields':[list(pair) for pair in admin_fields],'contentType':'application/x-www-form-urlencoded',
                      'fictionalCookie':True,'administratorToken':True}
    admin_result = {'ok':1,'uid':32,'type':'adminreport','op':'delete','deleted':[501]}
    admin_refused = {'ok':0,'uid':32,'type':'adminreport','error':'admin_noperm'}
    with requests.Session() as administrator, TemporaryDirectory() as temp:
        administrator.trust_env = False
        administrator.cookies.set(*admin_cookie.split('=',1),domain='127.0.0.1')
        header_file = Path(temp) / 'admin-header'
        header_file.write_text('X-Tsdmapp-Admin: ' + admin_token + '\n')
        header_file.chmod(0o600)

        def python_admin(approved=True, writable=True, current=admin_bound, selection=None):
            if selection is None:
                selection = python_selection
            response = functions['delete_admin_reports'](administrator,origin,lambda:current,admin_bound,admin_token,admin_hash,
                                                          writable,selection,admin_intent,operation_id,approved=approved)
            return response if isinstance(response,str) else [response.status_code,response.json()]

        def curl_admin_call(function, *args, current=admin_bound, data=None):
            env = {**os.environ,'ADMIN_ORIGIN':origin,'ADMIN_COOKIE':admin_cookie,'ADMIN_BOUND_LOGIN':admin_bound,
                   'ADMIN_CURRENT_LOGIN':current,'ADMIN_TOKEN_HEADER_FILE':str(header_file),'NO_PROXY':'127.0.0.1'}
            out = subprocess.run(['sh','-c',snippets('sh')[1]+'\n"$@"','guide',function,*args],
                                 input=urlencode(data or []),text=True,capture_output=True,env=env,timeout=10)
            if out.returncode:
                return {'exit':out.returncode}
            if not out.stdout:
                return None
            data, status = out.stdout[:-1].rsplit('\n',1)
            return [int(status),json.loads(data)]

        def curl_admin(approved=True, writable=True, current=admin_bound):
            return curl_admin_call('admin_report_delete','yes' if approved else 'no','yes' if writable else 'no',
                                   current=current,data=admin_fields)

        admin_page = {'ok':1,'uid':32,'type':'adminreport','schema':29,'op':'resolved','reports':[{'id':501,'fid':10}]}
        admin_read = {**admin_expected,'method':'GET','query':{**admin_expected['query'],'op':'resolved'},
                      'fields':[], 'contentType':None}
        responses.append((200,admin_page))
        listing = functions['admin_report_page'](administrator,origin,lambda:admin_bound,admin_bound,admin_token,'resolved')
        payload = listing.json()
        observe('requests administrator independently reselects report',[listing.status_code,payload],[200,admin_page],[admin_read])
        python_selection = frozenset((str(row['fid']),str(row['id'])) for row in payload['reports'])
        responses.append((200,admin_page))
        shell_listing = curl_admin_call('admin_report_page','resolved')
        observe('curl administrator independently reselects report',shell_listing,[200,admin_page],[admin_read])
        assert [(str(row['fid']),str(row['id'])) for row in shell_listing[1]['reports']] == [('10','501')]

        for label, invoke, decline, stale, denied, lost in [
            ('requests',python_admin,'declined','binding-changed','admin-report-delete-unavailable','uncertain'),
            ('curl',curl_admin,None,{'exit':3},{'exit':4},{'exit':52}),
        ]:
            observe(label+' administrator deletion declined',invoke(approved=False),decline,[])
            observe(label+' administrator binding changed',invoke(current='different-admin'),stale,[])
            observe(label+' administrator write permission absent',invoke(writable=False),denied,[])
            for case, response, expected in [('role-specific report deletion',(200,admin_result),[200,admin_result]),
                                             ('administrator denial',(403,admin_refused),[403,admin_refused]),
                                             ('administrator reply lost',None,lost)]:
                responses.append(response)
                observe(label+' '+case,invoke(),expected,[admin_expected])
        observe('requests administrator selection must be independently observed',python_admin(selection=frozenset({('11','501')})),
                'invalid-selection',[])

    server.shutdown()
    worker.join()

print(json.dumps({'archiveSHA256':sha256(archive.read_bytes()).hexdigest(),'guideSHA256':sha256(guide).hexdigest(),
                  'results':results,'limitations':['Fictional accounts and targets on inert loopback','No live requests or effects']},indent=2))

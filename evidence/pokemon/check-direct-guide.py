"""Replay each packaged requests and curl roster route on a loopback forum."""
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
    guide = package.extractfile('package/docs/pokemon.md').read()
blocks = {lang: re.search(rf'^```{lang}\n([\s\S]+?)^```$', guide.decode(), re.M).group(1)
          for lang in ('python', 'sh')}
functions = {}
exec(compile(blocks['python'], 'pokemon-guide.py', 'exec'), functions)
calls = []
results = []
status_available = True


class Forum(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        query = {k: v[-1] for k,v in parse_qs(url.query).items()}
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        calls.append({'method': self.command, 'path': url.path, 'query': query,
                      'json': json.loads(body) if body else None,
                      'hash': self.headers.get('X-Pm-Formhash'),
                      'contentType': self.headers.get('Content-Type'),
                      'fixtureCookie': self.headers.get('Cookie') == 'fixture=pokemon'})
        response_type = 'application/json'
        code = 200
        if query.get('id') == 'tsdmapp:api':
            result = json.dumps({'ok': 1, 'uid': 31, 'formhash': 'f1f2f3f4'}) if status_available else '{}'
            code = 200 if status_available else 404
        elif query.get('id') == 'pokemon:game':
            result = '<script>const formhash = "a1b2c3d4";</script>'
            response_type = 'text/html'
        elif query.get('pokemon_id') == '9999':
            return
        elif query.get('pokemon_id') == '501':
            result = json.dumps({'success': False, 'error': 'No permission', 'code': 403, 'data': None})
        else:
            result = json.dumps({'success': True, 'data': {'action': query['action']}, 'error': None, 'code': 0})
        self.send_response(code)
        self.send_header('Content-Type',response_type)
        self.end_headers()
        self.wfile.write(result.encode())

    do_POST = do_GET

    def log_message(self, *_):
        pass


def request(method, query, data=None, token=None):
    return {'method':method,'path':'/plugin.php','query':query,'json':data,'hash':token,
            'contentType':'application/json' if method=='POST' else None,'fixtureCookie':True}


def observe(name, actual_result, expected_result, expected_calls):
    actual={'result':actual_result,'requests':calls.copy()}
    expected={'result':expected_result,'requests':expected_calls}
    assert actual==expected,(name,actual,expected)
    results.append({'name':name,'expected':expected,'actual':actual})
    calls.clear()


matrix = [
    ('GET','config','global_config',{},None),
    ('GET','evolution','evolution_path',{'pmid':'25'},None),
    ('GET','pokemon','list',{},None),
    ('GET','pokemon','detail',{'pokemon_id':'7'},None),
    ('GET','pokemon','learnable_skills',{'pokemon_id':'7'},None),
    ('GET','pokemon','equipment',{'pokemon_id':'7'},None),
    ('GET','user','profile',{},None),
    ('GET','user','inventory',{'page':'2','type':'4'},None),
    ('GET','user','badge_status',{},None),
    ('POST','pokemon','set_first',{'pokemon_id':'7'},{}),
    ('POST','pokemon','move_pokemon',{'pokemon_id':'7','site':'2'},{}),
    ('POST','pokemon','rename',{}, {'id':7,'name':'Blue'}),
    ('POST','pokemon','release',{}, {'id':7}),
    ('POST','pokemon','learn_skill',{}, {'pokemon_id':7,'skill_id':15,'slot_index':1}),
    ('POST','pokemon','forget_skill',{}, {'pokemon_id':7,'skill_id':15}),
    ('POST','pokemon','equip_item',{}, {'pokemon_id':7,'myitem_id':99,'slot_index':0}),
    ('POST','pokemon','unequip_item',{}, {'pokemon_id':7,'slot_index':0}),
    ('POST','user','heal',{'pokemon_id':'7'},{}),
    ('POST','user','heal_and_flee',{'pokemon_id':'7'},{}),
    ('POST','user','refresh_badge',{}, {'hide':True}),
    ('POST','user','use_item',{}, {'item_id':12,'pokemon_id':7}),
]
with ThreadingHTTPServer(('127.0.0.1', 0), Forum) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    state = [(31,'run-1')]
    def current(): return state[0]
    with requests.Session() as session:
        session.trust_env=False
        session.cookies.set('fixture','pokemon',domain='127.0.0.1')

        def shell(function, *args, data='', token='f1f2f3f4', bound='run-1'):
            env={**os.environ,'FORUM_ORIGIN':origin,'FORUM_COOKIE':'fixture=pokemon','NO_PROXY':'127.0.0.1',
                 'PM_FORMHASH':token,'PM_BOUND_CONTINUITY':bound,'PM_CONTINUITY':current()[1]}
            result=subprocess.run(['sh','-c',blocks['sh']+'\n"$@"','pokemon-guide',function,*args],
                                  input=data,text=True,capture_output=True,env=env)
            if result.returncode: return {'exit':result.returncode}
            if not result.stdout.strip(): return None
            body,status=result.stdout.strip().rsplit('\n',1)
            return {'status':int(status),'body':json.loads(body) if body.startswith('{') else body}

        get_status = request('GET',{'id':'tsdmapp:api','action':'status'})
        get_game = request('GET',{'id':'pokemon:game'})
        bootstrap=functions['pokemon_bootstrap']
        call=functions['pokemon_call']
        binding=bootstrap(session,origin,current,mode='status')
        observe('requests status bootstrap',binding[3],'status',[get_status])
        observe('curl status bootstrap',shell('pm_open','status'),
                {'status':200,'body':{'ok':1,'uid':31,'formhash':'f1f2f3f4'}},[get_status])
        status_available=False
        native=bootstrap(session,origin,current)
        observe('requests fallback bootstrap',native[3],'game-page',[get_status,get_game])
        observe('curl game-page bootstrap',shell('pm_open','game-page'),
                {'status':200,'body':'<script>const formhash = "a1b2c3d4";</script>'},[get_game])
        observe('requests fallback token used',call(session,origin,current,native,'GET','user','badge_status',{},None),
                {'kind':'success','data':{'action':'badge_status'}},[request('GET',{'id':'pokemon:pokemon','endpoint':'user','action':'badge_status'},token='a1b2c3d4')])
        observe('curl game-page token used',shell('pm_call','yes','GET','user','badge_status','',token='a1b2c3d4'),
                {'status':200,'body':{'success': True,'data':{'action':'badge_status'},'error':None,'code':0}},
                [request('GET',{'id':'pokemon:pokemon','endpoint':'user','action':'badge_status'},token='a1b2c3d4')])
        status_available=True
        for method,group,action,args,data in matrix:
            target={'id':'pokemon:pokemon','endpoint':group,'action':action,**args}
            trace=[request(method,target,data,'f1f2f3f4')]
            result=call(session,origin,current,binding,method,group,action,args,data,approved=True)
            observe(f'requests {method} {group}/{action}',result,{'kind':'success','data':{'action':action}},trace)
            result=shell('pm_call','yes',method,group,action,urlencode(args),data=json.dumps(data) if data is not None else '')
            observe(f'curl {method} {group}/{action}',result,{'status':200,'body':{'success':True,'data':{'action':action},'error':None,'code':0}},trace)
        for target, result_kind in [('501','refused'),('9999','uncertain')]:
            params={'pokemon_id':target}
            trace=[request('POST',{'id':'pokemon:pokemon','endpoint':'user','action':'heal',**params},{},'f1f2f3f4')]
            result=call(session,origin,current,binding,'POST','user','heal',params,{},approved=True)
            observe(f'requests {result_kind} never resends',result['kind'],result_kind,trace)
            result=shell('pm_call','yes','POST','user','heal',urlencode(params),data='{}')
            observed=result['body']['code'] if 'body' in result else result['exit']
            observe(f'curl {result_kind} never resends',observed,403 if target=='501' else 52,trace)
        observe('requests declined effect sends nothing',call(session,origin,current,binding,'POST','pokemon','release',{}, {'id':7}),{'kind':'cancelled'},[])
        observe('curl declined effect sends nothing',shell('pm_call','no','POST','pokemon','release','',data='{"id":7}'),None,[])
        state[0]=(31,'new-login')
        observe('requests stale continuity sends nothing',call(session,origin,current,binding,'POST','pokemon','release',{}, {'id':7},approved=True),{'kind':'session-changed'},[])
        observe('curl stale continuity sends nothing',shell('pm_call','yes','POST','pokemon','release','',data='{"id":7}'),{'exit':3},[])
    server.shutdown()
    thread.join()
print(json.dumps({'archiveSHA256':sha256(archive.read_bytes()).hexdigest(),'guideSHA256':sha256(guide).hexdigest(),
    'results':results,'limitations':['Inert HTTP listener with synthetic plugin responses','No deployment observations or game changes']},ensure_ascii=False, indent=2))

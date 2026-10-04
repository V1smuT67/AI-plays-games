"""Local Tetris lab and authenticated adapter API. Python 3.10+, no pip packages."""
import argparse
import json
import os
from pathlib import Path
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import webbrowser
from engine import BASE, rotations, validate, placements, choose_local

ROOT = Path(__file__).resolve().parent

def gpt_move(state, board, model, key):
    legal = list(placements(board,state['piece']))
    if state.get('allowed_moves') is not None:
        legal = [m for m in legal if [m['rotation'],m['x']] in state['allowed_moves']]
    if not legal:
        return None,{}
    prompt = {'board':[''.join(map(str,row)) for row in board],
              'piece':state['piece'],'next':state.get('next'),
              'rotations':rotations(state['piece']),
              'legal_moves':[[m['rotation'],m['x']] for m in legal]}
    schema = {'type':'object','properties':{'rotation':{'type':'integer'},'x':{'type':'integer'}},
              'required':['rotation','x'],'additionalProperties':False}
    payload = {'model':model,'store':False,'max_output_tokens':1024,
               'instructions':'Play Tetris. Board rows are top to bottom; 1 occupied, 0 empty. '
               'Choose one legal [rotation,x] hard-drop placement to maximize long-term lines and survival. '
               'Rotation cells are normalized; x is leftmost occupied column, zero based. Return only JSON.',
               'input':json.dumps(prompt,separators=(',',':')),
               'text':{'format':{'type':'json_schema','name':'tetris_move','strict':True,'schema':schema}}}
    req = Request('https://api.openai.com/v1/responses',data=json.dumps(payload).encode(),
                  headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=60) as response:
            data = json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'OpenAI HTTP {exc.code}. Check model, API key, balance and access.') from None
    except (URLError,TimeoutError):
        raise RuntimeError('OpenAI connection failed or timed out; no automatic retry.') from None
    if data.get('status') != 'completed':
        raise RuntimeError('OpenAI response incomplete; no move applied.')
    raw = ''.join(c.get('text','') for item in data.get('output',[]) if item.get('type')=='message'
                  for c in item.get('content',[]) if c.get('type')=='output_text')
    try:
        action = json.loads(raw)
        if not isinstance(action,dict) or type(action.get('rotation')) is not int or type(action.get('x')) is not int:
            raise ValueError()
        move = next(m for m in legal if (m['rotation'],m['x'])==(action['rotation'],action['x']))
    except (ValueError,StopIteration,TypeError):
        raise RuntimeError('Model returned an invalid move; no local fallback.') from None
    return move,data.get('usage',{})

class Lab:
    def __init__(self,args):
        self.args,self.token = args,secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.requests = 0
        self.log = ROOT/'logs'/('session-'+time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(3)+'.jsonl')
        self.log.parent.mkdir(exist_ok=True)

    def decide(self,state):
        board = validate(state)
        mode = state.get('mode','local')
        if mode not in ('local','gpt'):
            raise ValueError('mode must be local or gpt')
        started = time.perf_counter()
        usage = {}
        with self.lock:
            record = {'time':time.time(),'state':state,'mode':mode,
                      'model':self.args.model if mode=='gpt' else None}
            try:
                if mode == 'gpt':
                    key = os.environ.get('OPENAI_API_KEY')
                    if not key or not self.args.model:
                        raise ValueError('Set OPENAI_API_KEY and start server with --model MODEL_ID')
                    if self.requests >= self.args.max_requests:
                        raise ValueError('GPT request limit reached. Restart explicitly to reset it.')
                    self.requests += 1
                    move,usage = gpt_move(state,board,self.args.model,key)
                else:
                    move = choose_local(board,state['piece'],state.get('next'),state.get('allowed_moves'))
                result = {'move':move,'mode':mode,'usage':usage,'gpt_requests':self.requests,
                          'elapsed_ms':round((time.perf_counter()-started)*1000,2)}
                record['result'] = result
            except Exception as exc:
                record['error'] = str(exc)
                raise
            finally:
                with self.log.open('a',encoding='utf-8') as f:
                    f.write(json.dumps(record,ensure_ascii=False)+'\n')
        return result

def handler(lab):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass

        def send(self,status,data,content_type='application/json; charset=utf-8'):
            raw = data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(raw)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            port = self.server.server_port
            return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

        def do_GET(self):
            if not self.allowed():
                return self.send(403,{'error':'Invalid host'})
            if self.path == '/':
                return self.send(200,(ROOT/'index.html').read_bytes(),'text/html; charset=utf-8')
            if self.path == '/online':
                return self.send(200,(ROOT/'online.html').read_bytes(),'text/html; charset=utf-8')
            if self.path == '/meta':
                return self.send(200,{'shapes':{p:rotations(p) for p in BASE},
                    'gpt_ready':bool(os.environ.get('OPENAI_API_KEY') and lab.args.model),
                    'model':lab.args.model,'max_requests':lab.args.max_requests})
            return self.send(404,{'error':'Not found'})

        def do_POST(self):
            if not self.allowed() or not secrets.compare_digest(self.headers.get('X-Tetris-Token',''),lab.token):
                return self.send(403,{'error':'Invalid local API token'})
            if self.path != '/move':
                return self.send(404,{'error':'Not found'})
            try:
                n = int(self.headers.get('Content-Length','0'))
                if not 0<n<=32768:
                    raise ValueError('Body limit: 32 KB')
                data = json.loads(self.rfile.read(n))
                self.send(200,lab.decide(data))
            except (ValueError,KeyError,TypeError) as exc:
                self.send(400,{'error':str(exc)})
            except RuntimeError as exc:
                self.send(502,{'error':str(exc)})
            except Exception:
                self.send(500,{'error':'Internal error; check the session log'})
    return Handler

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--model',default=os.environ.get('OPENAI_MODEL',''))
    parser.add_argument('--max-requests',type=int,default=100)
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--online',action='store_true',help='Open setup for the external website adapter')
    args = parser.parse_args()
    lab = Lab(args)
    server = ThreadingHTTPServer(('127.0.0.1',args.port),handler(lab))
    url = f'http://127.0.0.1:{server.server_port}/'+('online' if args.online else '')+'#'+lab.token
    (ROOT/'logs'/'connection.json').write_text(json.dumps({'url':url,'pid':os.getpid()}),encoding='utf-8')
    print('Tetris AI:',url,flush=True)
    print('Adapter token:',lab.token,flush=True)
    print('Logs:',lab.log,flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__=='__main__':
    main()

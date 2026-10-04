import argparse
import io
import json
import random
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import engine
import server

class EngineTests(unittest.TestCase):
    def test_adapter_reachable_moves(self):
        board=((0,)*10,)*20
        move=engine.choose_local(board,'I','O',[[1,7]])
        self.assertEqual((move['rotation'],move['x']),(1,7))
        self.assertIsNone(engine.choose_local(board,'I','O',[]))
        with self.assertRaises(ValueError):
            engine.validate({'board':[list(r) for r in board],'piece':'I','allowed_moves':[[99,0]]})
    def test_rotations(self):
        self.assertEqual({p:len(engine.rotations(p)) for p in engine.BASE},
                         {'I':2,'O':1,'T':4,'S':2,'Z':2,'J':4,'L':4})
        for p in engine.BASE:
            for cells in engine.rotations(p):
                self.assertEqual(len(set(cells)),4)
                self.assertEqual(min(x for x,y in cells),0)
                self.assertEqual(min(y for x,y in cells),0)

    def test_line_clear(self):
        board=((0,0,0,0),)*3+((1,1,0,0),)
        move=next(m for m in engine.placements(board,'O') if m['x']==2)
        self.assertEqual(move['lines'],1)
        self.assertEqual(move['board'],((0,0,0,0),)*3+((0,0,1,1),))

    def test_no_teleport_through_ceiling(self):
        board=((1,0,1,0),)+((0,0,0,0),)*3
        self.assertEqual(list(engine.placements(board,'O')),[])

    def test_placement_conservation_and_collision(self):
        rng=random.Random(7)
        for _ in range(20):
            board=tuple((0,)*10 for _ in range(12))+tuple(tuple(int(rng.random()<.3) for _ in range(10)) for _ in range(8))
            for piece in engine.BASE:
                for move in engine.placements(board,piece):
                    for x,y in move['cells']:
                        self.assertEqual(board[y][x],0)
                    self.assertEqual(sum(map(sum,move['board'])),sum(map(sum,board))+4-10*move['lines'])
                    self.assertEqual(len(move['board']),20)
                    self.assertTrue(all(not all(row) for row in move['board']))

    def test_invalid_input(self):
        for state in [None,{}, {'board':[[0]*4]*4,'piece':[]},
                      {'board':[[True]*4]*4,'piece':'I'},
                      {'board':[[0]*4,[0]*5,[0]*4,[0]*4],'piece':'I'}]:
            with self.assertRaises(ValueError):engine.validate(state)

    def test_local_clears_lines(self):
        board=((0,)*10,)*20
        rng=random.Random(42)
        sequence=[]
        for _ in range(15):
            bag=list(engine.BASE);rng.shuffle(bag);sequence+=bag
        lines=0
        for i in range(100):
            move=engine.choose_local(board,sequence[i],sequence[i+1])
            self.assertIsNotNone(move, f'top out at {i}')
            board=move['board'];lines+=move['lines']
        self.assertGreater(lines,20)

class GPTTests(unittest.TestCase):
    def response(self,action):
        return io.BytesIO(json.dumps({'status':'completed','output':[{'type':'message','content':[
            {'type':'output_text','text':json.dumps(action)}]}],'usage':{'input_tokens':5}}).encode())

    def test_valid_gpt_response_and_no_scores(self):
        state={'board':[[0]*10 for _ in range(20)],'piece':'I','next':'O'}
        with patch('server.urlopen',return_value=self.response({'rotation':0,'x':0})) as mock:
            move,usage=server.gpt_move(state,engine.validate(state),'example-model','fake-key')
        self.assertEqual(move['x'],0)
        payload=json.loads(mock.call_args.args[0].data)
        self.assertFalse(payload['store'])
        self.assertNotIn('score',json.loads(payload['input']))
        self.assertEqual(usage['input_tokens'],5)

    def test_invalid_gpt_response_stops(self):
        state={'board':[[0]*10 for _ in range(20)],'piece':'I'}
        with patch('server.urlopen',return_value=self.response({'rotation':0,'x':999})):
            with self.assertRaises(RuntimeError):
                server.gpt_move(state,engine.validate(state),'example-model','fake-key')

class APITests(unittest.TestCase):
    def test_authenticated_move_and_request_limit(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(server,'ROOT',Path(temp)):
            lab=server.Lab(argparse.Namespace(model='example',max_requests=0))
            http=ThreadingHTTPServer(('127.0.0.1',0),server.handler(lab))
            thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
            try:
                url=f'http://127.0.0.1:{http.server_port}/move'
                state={'board':[[0]*10 for _ in range(20)],'piece':'T'}
                def req(token):
                    return Request(url,data=json.dumps(state).encode(),headers={'X-Tetris-Token':token})
                with self.assertRaises(HTTPError) as err:urlopen(req('wrong'))
                self.assertEqual(err.exception.code,403)
                with urlopen(req(lab.token)) as response:result=json.load(response)
                self.assertEqual(result['mode'],'local')
                self.assertIsNotNone(result['move'])
                with patch.dict('os.environ',{'OPENAI_API_KEY':'fake'}),patch('server.gpt_move') as gpt:
                    with self.assertRaises(ValueError):lab.decide(dict(state,mode='gpt'))
                    gpt.assert_not_called()
                self.assertTrue(lab.log.exists())
            finally:
                http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()

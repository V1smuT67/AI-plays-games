"""Implement GameAdapter for a particular game; this runner handles decision requests."""
import json
from typing import Protocol
from urllib.request import Request, urlopen

class GameAdapter(Protocol):
    def read_state(self) -> dict | None:
        """Pause at spawn. Return board (locked cells only), piece, next; None on game over."""
        ...

    def apply_move(self, move: dict) -> None:
        """Map normalized rotation/x to game controls, hard drop, wait for line clear.
        Verify the resulting locked board equals move['board']; raise on desync.
        No wall kicks, hold or slides are modeled by the engine.
        """
        ...

def run(game: GameAdapter, token: str, mode='local', limit=100, port=8765):
    """One request per piece. Ctrl+C stops. Never blindly retries an applied move."""
    for _ in range(limit):
        state = game.read_state()
        if state is None:
            break
        state = dict(state,mode=mode)
        request = Request(f'http://127.0.0.1:{port}/move',
                          data=json.dumps(state).encode(),headers={
                              'Content-Type':'application/json','X-Tetris-Token':token})
        with urlopen(request,timeout=90) as response:
            result = json.load(response)
        if result['move'] is None:
            break
        game.apply_move(result['move'])

"""Dependency-free Tetris placement engine. Coordinates: top-left, x right, y down."""
from functools import lru_cache

BASE = {
    'I': ((0,0),(1,0),(2,0),(3,0)), 'O': ((0,0),(1,0),(0,1),(1,1)),
    'T': ((1,0),(0,1),(1,1),(2,1)), 'S': ((1,0),(2,0),(0,1),(1,1)),
    'Z': ((0,0),(1,0),(1,1),(2,1)), 'J': ((0,0),(0,1),(1,1),(2,1)),
    'L': ((2,0),(0,1),(1,1),(2,1)),
}

def normalize(cells):
    mx, my = min(x for x,y in cells), min(y for x,y in cells)
    return tuple(sorted((x-mx,y-my) for x,y in cells))

@lru_cache(maxsize=7)
def rotations(piece):
    cells, result = normalize(BASE[piece]), []
    for _ in range(4):
        if cells not in result:
            result.append(cells)
        cells = normalize(tuple((-y,x) for x,y in cells))
    return tuple(result)

def validate(state):
    if not isinstance(state, dict):
        raise ValueError('State must be an object')
    board = state.get('board')
    if not isinstance(board, list) or not 4 <= len(board) <= 40:
        raise ValueError('board: 4..40 rows required')
    if not isinstance(board[0], list) or not 4 <= len(board[0]) <= 20:
        raise ValueError('board: 4..20 columns required')
    w = len(board[0])
    if any(not isinstance(row,list) or len(row)!=w or
           any(type(v) is not int or v not in (0,1) for v in row) for row in board):
        raise ValueError('board must be rectangular with integer 0/1 cells')
    if any(all(row) for row in board):
        raise ValueError('Remove completed lines before sending state')
    if not isinstance(state.get('piece'),str) or state['piece'] not in BASE:
        raise ValueError('piece must be I O T S Z J L')
    if state.get('next') is not None and (not isinstance(state['next'],str) or state['next'] not in BASE):
        raise ValueError('next must be I O T S Z J L or null')
    allowed = state.get('allowed_moves')
    if allowed is not None and (not isinstance(allowed,list) or len(allowed)>80 or
        any(not isinstance(m,list) or len(m)!=2 or any(type(v) is not int for v in m)
            or not 0<=m[0]<4 or not 0<=m[1]<w for m in allowed)):
        raise ValueError('allowed_moves must contain [rotation,x] pairs')
    return tuple(tuple(row) for row in board)

def placements(board, piece):
    h,w = len(board),len(board[0])
    for r,cells in enumerate(rotations(piece)):
        for x in range(w-max(cx for cx,cy in cells)):
            def fits(y):
                return all(y+cy < h and (y+cy < 0 or not board[y+cy][x+cx]) for cx,cy in cells)
            y = -1-max(cy for cx,cy in cells)
            while fits(y+1):
                y += 1
            if any(y+cy < 0 for cx,cy in cells):
                continue
            new = [list(row) for row in board]
            for cx,cy in cells:
                new[y+cy][x+cx] = 1
            kept = [tuple(row) for row in new if not all(row)]
            cleared = h-len(kept)
            result = ((0,)*w,)*cleared + tuple(kept)
            yield {'rotation':r,'x':x,'y':y,'cells':[[x+cx,y+cy] for cx,cy in cells],
                   'lines':cleared,'board':result}

def score(board, lines):
    h,w = len(board),len(board[0])
    heights,holes = [],0
    for x in range(w):
        first = next((y for y in range(h) if board[y][x]),h)
        heights.append(h-first)
        holes += sum(not board[y][x] for y in range(first,h))
    roughness = sum(abs(a-b) for a,b in zip(heights,heights[1:]))
    return 0.76*lines - 0.51*sum(heights) - 0.36*holes - 0.18*roughness

def choose_local(board, piece, next_piece=None, allowed_moves=None):
    best,best_score = None,float('-inf')
    for move in placements(board,piece):
        if allowed_moves is not None and [move['rotation'],move['x']] not in allowed_moves:
            continue
        value = score(move['board'],move['lines'])
        if next_piece:
            future = max((score(m['board'], m['lines']) for m in placements(move['board'],next_piece)),default=-100000)
            value = 0.2*value + 0.8*future + 0.76*move['lines']
        if value > best_score:
            best,best_score = move,value
    return best

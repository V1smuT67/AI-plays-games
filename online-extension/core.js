// Pure geometry; online-tetris.ru stores matrices as [x][y], not [row][column].
(function(root){
  const key=cells=>JSON.stringify(cells.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
  function normalize(cells){const mx=Math.min(...cells.map(c=>c[0])),my=Math.min(...cells.map(c=>c[1]));return cells.map(([x,y])=>[x-mx,y-my]);}
  function cellsOf(matrix){const cells=[];matrix.forEach((col,x)=>col.forEach((v,y)=>{if(v)cells.push([x,y]);}));return cells;}
  function boardOf(g){return Array.from({length:g.settings.nTilesY},(_,y)=>Array.from({length:g.settings.nTilesX},(_,x)=>g.playfield[x]?.[y]?1:0));}
  function typeOf(g,type,shapes){const k=key(normalize(cellsOf(g.tetrominos[type][0])));for(const [p,rs]of Object.entries(shapes))if(rs.some(r=>key(r)===k))return p;throw Error('Неизвестная геометрия фигуры.');}
  function plans(g,shapes){
    const board=boardOf(g), start={...g.tetromino}, piece=typeOf(g,start.type,shapes);
    const matrix=t=>cellsOf(g.tetrominos[start.type][t]);
    function fits(x,y,t){return matrix(t).every(([cx,cy])=>x+cx>=0&&x+cx<board[0].length&&y+cy<board.length&&(y+cy<0||!board[y+cy][x+cx]));}
    const queue=[{x:start.x,turn:start.turn,path:[]}],seen=new Set(),result=new Map();
    for(let i=0;i<queue.length;i++){
      const n=queue[i],id=`${n.x},${n.turn}`;if(seen.has(id))continue;seen.add(id);
      if(!fits(n.x,start.y,n.turn))continue;
      let y=start.y;while(fits(n.x,y+1,n.turn))y++;
      const cells=matrix(n.turn),minx=Math.min(...cells.map(c=>c[0]));
      const rotation=shapes[piece].findIndex(r=>key(r)===key(normalize(cells)));
      if(rotation<0)throw Error('Повороты сайта изменились.');
      if(cells.every(c=>y+c[1]>=0)){
        const x=n.x+minx,k=`${rotation},${x}`;
        if(!result.has(k))result.set(k,{...n,rotation,xNormalized:x,y,cells:cells.map(([cx,cy])=>[n.x+cx,y+cy])});
      }
      for(const dx of [-1,1])if(fits(n.x+dx,start.y,n.turn))queue.push({x:n.x+dx,turn:n.turn,path:[...n.path,dx<0?'left':'right']});
      // Only simple rotations with no wall correction; every step is verified when applied.
      const turn=(n.turn+1)%4;
      if(n.x>=0 && !(start.type===0&&n.x>6) && fits(n.x,start.y,turn))queue.push({x:n.x,turn,path:[...n.path,'rotateLeft']});
    }
    let next=null;
    if(g.userSettings.showhint && g.showNextCount>=1){const t=(g._randomBag||[])[0]??(g._randomBag2||[])[0];if(t!==undefined)next=typeOf(g,t,shapes);}
    return {state:{board,piece,next,allowed_moves:[...result.values()].map(p=>[p.rotation,p.xNormalized])},plans:result};
  }
  const api={key,normalize,cellsOf,boardOf,typeOf,plans};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TetrisSiteGeometry=api;
})(globalThis);

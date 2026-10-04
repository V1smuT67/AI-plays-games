const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'online-extension');
function mount(pathname){
 const ids=Object.fromEntries(['status','limit','tempo','tempoValue','start','stop','save'].map(id=>[id,{value:id==='limit'?'100':'350',textContent:''}]));
 const ui={innerHTML:'',getElementById:id=>ids[id]};
 const host={style:{},attachShadow:()=>ui};let interval;
 class Game {startNewGame(){}drawAllCells(){}toggleGamePause(){this.pauses++;this.paused=!this.paused;}}
 const chunk=[];chunk.push=entry=>entry[2](()=>({Z:Game}));
 const storage=new Map();
 const ctx={location:{hostname:'online-tetris.ru',origin:'https://online-tetris.ru',pathname},
 document:{getElementById:()=>null,createElement:()=>host,documentElement:{append(){}},addEventListener(){}},
 window:{webpackChunk:chunk,addEventListener(){}},TetrisSiteGeometry:{},
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
 setInterval:fn=>{interval=fn;return 1;},clearInterval(){},setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(path.join(root,'page.js'),'utf8'),ctx);
 assert(interval,'panel should mount');interval();
 const game=new Game();Object.assign(game,{className:'local',pvpGame:pathname==='/'?null:'classic',gameStarted:true,isDead:false,paused:false,pauses:0});game.startNewGame();
 ids.stop.onclick();assert.equal(game.pauses,pathname==='/'?1:0,'PvP must never pause');
 ids.tempo.value='850';ids.tempo.oninput();assert.equal(storage.get('tetris-ai-delay-ms'),'850');assert.equal(ids.tempoValue.textContent,'850');
 assert(ui.innerHTML.includes('id="tempo"'));
}
async function backgroundTest(){
 let listener,fetches=0;
 const ctx={URL,AbortSignal,chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}},storage:{local:{get:async()=>({enabled:true,mode:'gpt',connection:'http://127.0.0.1:8765/#long-enough-local-token'})}}},fetch:async()=>{fetches++;throw Error('should not fetch');}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
 const result=await new Promise(resolve=>listener({kind:'tetris-request',operation:'move',state:{}},{id:'test',tab:{id:1},url:'https://online-tetris.ru/pvp/classic'},resolve));
 assert.equal(result.ok,false);assert.match(result.error,/PvP/);assert.equal(fetches,0);
}
(async()=>{mount('/');mount('/pvp/classic');mount('/pvp/season');await backgroundTest();console.log('PASS: Solo/PvP panel, no PvP pause, speed persistence, GPT rejection before network.');})().catch(e=>{console.error(e);process.exitCode=1;});

(() => {
  if(location.hostname!=='online-tetris.ru'||!/^\/(?:pvp\/(?:classic|season)\/?)?$/.test(location.pathname)||document.getElementById('tetris-ai-panel'))return;
  const onPvpPage=location.pathname.startsWith('/pvp/');
  const geo=globalThis.TetrisSiteGeometry;
  let game=null,hooked=false,running=false,busy=false,version=0,requestId=0,completed=0,records=[];
  const pending=new Map();
  const host=document.createElement('div');host.id='tetris-ai-panel';
  host.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483647';
  const ui=host.attachShadow({mode:'closed'});
  ui.innerHTML=`<style>:host{all:initial}section{width:290px;padding:16px;background:#152131;color:#eaf2fa;font:14px system-ui;border:1px solid #6a8e9b;border-radius:12px;box-shadow:0 8px 30px #0005}b{font-size:18px}p{line-height:1.4;overflow-wrap:anywhere}button,input{font:inherit;padding:7px;border-radius:5px;border:1px solid #748aa1;background:#263b50;color:white;margin:4px 2px}button{cursor:pointer}input{width:65px}small{color:#b2c5d8}</style><section><b>Tetris AI · эксперимент</b><p id="status">Подключение к движку сайта…</p><label>Лимит фигур <input id="limit" type="number" min="1" max="1000" value="100"></label><label style="display:block;margin-top:10px">Задержка между фигурами: <output id="tempoValue">350</output> мс<input style="display:block;width:100%" id="tempo" type="range" min="0" max="2000" step="50" value="350"></label><div><button id="start">Старт ИИ</button><button id="stop">Стоп</button><button id="save">Журнал</button></div><small>Esc = стоп · Темп меняется на ходу. В PvP матч продолжается после остановки бота. GPT — только Solo.</small></section>`;
  document.documentElement.append(host);
  const $=id=>ui.getElementById(id),status=text=>$('status').textContent=text;
  try{$('tempo').value=String(Math.max(0,Math.min(2000,Number(localStorage.getItem('tetris-ai-delay-ms')??350)||0)));}catch{}
  $('tempoValue').textContent=$('tempo').value;
  $('tempo').oninput=()=>{$('tempoValue').textContent=$('tempo').value;try{localStorage.setItem('tetris-ai-delay-ms',$('tempo').value);}catch{}};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function pause(){if(!onPvpPage&&!game?.pvpGame&&game?.gameStarted&&!game.paused&&!game.isDead)game.toggleGamePause();}
  function stop(message=onPvpPage?'Бот остановлен. Матч продолжается — управляй вручную.':'Остановлено. Игра на паузе.') {running=false;version++;pause();status(message);}
  window.addEventListener('keydown',e=>{if(e.key==='Escape')stop();},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop('Вкладка скрыта — остановлено.');});
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='tetris-ai-response')return;
    const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);clearTimeout(p.timer);
    e.data.ok?p.resolve(e.data.data):p.reject(Error(e.data.error||'Ошибка расширения.'));
  });
  function request(operation,state){return new Promise((resolve,reject)=>{
    const id=++requestId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Нет ответа. Проверь сервер и настройки расширения.'));},80000);
    pending.set(id,{resolve,reject,timer});window.postMessage({channel:'tetris-ai-request',id,operation,state},location.origin);
  });}
  function capture(g){if(g.className==='local')game=g;}
  function attach(){
    try{
      if(!Array.isArray(window.webpackChunk))return false;
      let require;window.webpackChunk.push([['tetris-ai-'+Date.now()],{},r=>{require=r;}]);
      if(!require)return false;
      const Klass=require(933).Z,proto=Klass?.prototype;
      if(!proto?.startNewGame||!proto?.drawAllCells||!proto?.toggleGamePause)throw Error('Версия движка не поддерживается.');
      for(const name of ['startNewGame','drawAllCells']){
        const original=proto[name];proto[name]=function(...args){capture(this);return original.apply(this,args);};
      }
      hooked=true;status(onPvpPage?'Подключено к PvP. Дождись начала матча, затем нажми «Старт ИИ».':'Подключено. Нажми «Играть Solo», затем «Старт ИИ».');return true;
    }catch(e){status('Не удалось подключиться: '+e.message);return false;}
  }
  let attempts=0;const timer=setInterval(()=>{if(hooked||attach()||++attempts>=40){clearInterval(timer);if(!hooked)status('Движок сайта не загрузился. Обнови страницу после восстановления сайта.');}},500);
  function key(action){
    const config=game.userSettings.control[action];if(!config)throw Error('Неизвестная клавиша '+action);
    const options={bubbles:true,cancelable:true,code:config.key,key:config.key,keyCode:config.keyCode,which:config.keyCode};
    document.dispatchEvent(new KeyboardEvent('keydown',options));document.dispatchEvent(new KeyboardEvent('keyup',options));
  }
  function fingerprint(){return JSON.stringify([game.tetrominoCnt,game.tetromino,geo.boardOf(game)]);}
  async function run(){
    if(busy)return;
    if(!hooked||!game?.gameStarted||game.isDead)return status(onPvpPage?'Дождись начала матча на сайте.':'Сначала запусти новую игру Solo на сайте.');
    if(onPvpPage&&!game.pvpGame)return status('Дождись начала настоящего матча: тренировочное поле не подключено.');
    if(game.paused&&onPvpPage)return status('Сначала возобнови матч на сайте.');
    busy=true;running=true;const runId=++version;completed=0;records=[];
    const limit=Math.max(1,Math.min(1000,Number($('limit').value)||100));
    // This is an experiment, so do not submit automated scores to the public leaderboard.
    if(!onPvpPage)game.saveResult=false;pause();
    try{
      const meta=await request('meta');
      if(onPvpPage&&meta.selected_mode!=='local')throw Error('Для PvP выбери локальный ИИ в настройках расширения.');
      let stale=0;
      while(running&&version===runId&&completed<limit&&!game.isDead){
        pause();const snapshot=fingerprint(),n=game.tetrominoCnt;
        const batch=geo.plans(game,meta.shapes);
        if(!batch.state.allowed_moves.length)throw Error('Нет безопасного достижимого хода.');
        status(`${meta.selected_mode==='gpt'?'GPT':'Локальный ИИ'} выбирает ход ${completed+1}…`);
        const answer=await request('move',batch.state);
        if(!running||version!==runId)break;
        if(snapshot!==fingerprint()){
          if(onPvpPage&&++stale<=5){records.push({event:'stale-plan',turn:completed+1});continue;}
          throw Error('Поле меняется быстрее, чем приходит решение. Управление остановлено.');
        }
        stale=0;
        if(!answer.move)throw Error('Нет допустимого хода.');
        const move=answer.move,plan=batch.plans.get(`${move.rotation},${move.x}`);
        if(!plan||geo.key(plan.cells)!==geo.key(move.cells))throw Error('План не совпадает с правилами сайта.');
        if(!onPvpPage)game.toggleGamePause(false);
        if(game.paused)throw Error('Игра на паузе.');
        // All inputs are synchronous: gravity cannot interrupt this action sequence.
        for(const action of plan.path){key(action);if(game.tetrominoCnt!==n)throw Error('Фигура зафиксировалась до завершения управления.');}
        if(game.tetromino.turn!==plan.turn||game.tetromino.x!==plan.x)throw Error('Сайт не выполнил перемещение.');
        key('drop');
        const deadline=Date.now()+2500;
        while(game.tetrominoCnt===n&&!game.isDead&&Date.now()<deadline&&running)await sleep(16);
        pause();if(!running||version!==runId)break;
        if(game.tetrominoCnt===n&&!game.isDead)throw Error('Сайт не подтвердил сброс фигуры.');
        const actual=geo.boardOf(game);
        records.push({turn:completed+1,state:batch.state,result:answer,actual,score:game.score,lines:game.linesCnt,delay_ms:Number($('tempo').value)});
        if(JSON.stringify(actual)!==JSON.stringify(move.board))throw Error('Поле после хода отличается от ожидаемого. Автоигра остановлена.');
        completed++;status(`Ходов: ${completed}/${limit} · линии: ${game.linesCnt} · очки: ${Math.round(game.score)} · ${answer.mode}`);
        const waitUntil=Date.now()+Number($('tempo').value);
        while(running&&version===runId&&Date.now()<waitUntil)await sleep(Math.min(50,waitUntil-Date.now()));
      }
      if(version===runId)status(`Готово: ${completed} ходов, ${game.linesCnt} линий. ${onPvpPage?'Матч продолжается — управляй вручную.':'Игра на паузе.'}`);
    }catch(e){records.push({error:e.message});status('Остановлено: '+e.message);}
    finally{running=false;busy=false;pause();}
  }
  $('start').onclick=run;$('stop').onclick=()=>stop();
  $('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({site:location.origin,records},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='online-tetris-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
})();

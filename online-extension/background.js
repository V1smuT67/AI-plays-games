// The page never receives the local server token or the OpenAI key.
let active = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab ||
      new URL(sender.url).origin !== 'https://online-tetris.ru' ||
      !/^\/(?:pvp\/(?:classic|season)\/?)?$/.test(new URL(sender.url).pathname) || message?.kind !== 'tetris-request') return;
  (async () => {
    if (active) throw Error('Предыдущий запрос ещё выполняется.');
    active = true;
    try {
      const { connection, enabled, mode } = await chrome.storage.local.get(['connection','enabled','mode']);
      if (!enabled) throw Error('Открой значок расширения и включи доступ к серверу.');
      const u = new URL(connection || 'http://invalid');
      if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || !u.hash.slice(1))
        throw Error('В настройках нужен полный адрес сервера с #токеном.');
      const headers = { 'Content-Type': 'application/json', 'X-Tetris-Token': u.hash.slice(1) };
      let response;
      if (message.operation === 'meta') {
        response = await fetch(u.origin+'/meta',{signal:AbortSignal.timeout(10000)});
      } else if (message.operation === 'move') {
        if (new URL(sender.url).pathname.startsWith('/pvp/') && mode==='gpt') throw Error('В PvP выбери локальный ИИ: GPT поддерживается только в Solo.');
        const state = message.state;
        if (!state || JSON.stringify(state).length>16000) throw Error('Некорректное поле.');
        response = await fetch(u.origin+'/move', {method:'POST',headers,
          body:JSON.stringify({...state,mode:mode==='gpt'?'gpt':'local'}),signal:AbortSignal.timeout(75000)});
      } else throw Error('Неизвестная операция.');
      const data = await response.json();
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      return {...data,selected_mode:mode==='gpt'?'gpt':'local'};
    } finally { active = false; }
  })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));
  return true;
});

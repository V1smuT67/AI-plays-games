(() => {
  let busy = false;
  window.addEventListener('message', async event => {
    const m=event.data;
    if(event.source!==window || event.origin!==location.origin || m?.channel!=='tetris-ai-request')return;
    if(!Number.isSafeInteger(m.id) || !['meta','move'].includes(m.operation))return;
    if(busy)return;
    busy=true;
    try {
      const result=await chrome.runtime.sendMessage({kind:'tetris-request',operation:m.operation,state:m.state});
      window.postMessage({channel:'tetris-ai-response',id:m.id,...result},location.origin);
    } catch(error) {
      window.postMessage({channel:'tetris-ai-response',id:m.id,ok:false,error:error.message},location.origin);
    } finally { busy=false; }
  });
})();

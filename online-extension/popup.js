const $=id=>document.getElementById(id);
chrome.storage.local.get(['connection','mode','enabled']).then(c=>{
  $('connection').value=c.connection||'';$('mode').value=c.mode||'local';$('enabled').checked=!!c.enabled;
});
$('save').onclick=async()=>{
  try {
    const u=new URL($('connection').value.trim());
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.hash.length<20)throw Error('Нужен полный локальный адрес с #токеном.');
    await chrome.storage.local.set({connection:u.href,mode:$('mode').value,enabled:$('enabled').checked});
    $('status').textContent='Сохранено. Можно запускать ИИ на сайте.';
  }catch(e){$('status').textContent=e.message;}
};

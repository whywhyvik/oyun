import {live} from './client.js';
export function esc(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
export function toast(message,type=''){
  let el=document.querySelector('#toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';document.body.appendChild(el)}
  el.textContent=message;el.className=`toast show ${type}`;clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast',2500);
}
export function bindConnection(){
  const el=document.querySelector('[data-connection]');if(!el)return;
  const text=el.querySelector('[data-presence-count]')||el.querySelector('span');
  live.on('connect',()=>{el.classList.add('online');if(text&&text.textContent==='Bağlanıyor')text.textContent='1 çevrimiçi'});
  live.on('presence:update',data=>{el.classList.add('online');if(text)text.textContent=`${Math.max(0,Number(data?.count)||0)} çevrimiçi`});
  live.on('disconnect',()=>{el.classList.remove('online');if(text)text.textContent='Bağlantı yok'});
}
export function asyncButton(button,task){return async(...args)=>{if(button.disabled)return;const old=button.innerHTML;button.disabled=true;button.innerHTML='İşleniyor…';try{await task(...args)}finally{button.disabled=false;button.innerHTML=old}}}
export function copyText(text){navigator.clipboard?.writeText(text).then(()=>toast('Oda kodu kopyalandı.')).catch(()=>toast('Kopyalama başarısız.','error'))}
export function queryCode(){return new URLSearchParams(location.search).get('code')?.trim().toUpperCase()||''}

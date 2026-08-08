import {requireProfile} from '../core/storage.js';
import {live} from '../core/client.js';
import {mountHeader} from '../core/header.js';
import {toast} from '../core/ui.js';
import {routeRoom} from '../core/router.js';
import {bindDiscordLinks} from '../core/config.js';

const profile=requireProfile();if(!profile)throw new Error('profile required');
mountHeader(profile);
bindDiscordLinks(document.querySelector('main')||document);
const modal=document.querySelector('#createModal');
const goRoom=code=>{live.setRoomCode(code);location.href=`/room.html?room=${encodeURIComponent(code)}`};
const normalizeCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);

async function join(code){
  code=normalizeCode(code);
  if(code.length!==5)return toast('5 haneli oda kodunu gir.','error');
  const res=await live.emit('room:join',{code,profile});
  if(!res.ok)return toast(res.error,'error');
  goRoom(res.code);
}
async function quick(event){
  const button=document.querySelector(event==='room:quick-play'?'#quickPlay':'#quickJoin');
  const old=button?.textContent;if(button){button.disabled=true;button.textContent='Eşleşme aranıyor…'}
  const res=await live.emit(event,{profile});
  if(button){button.disabled=false;button.textContent=old}
  if(!res.ok)return toast(res.error,'error');
  goRoom(res.code);
}

live.on('room:state',room=>{
  if(room?.code===live.roomCode)routeRoom(room);
});
live.on('room:kicked',()=>{live.clearRoomCode();toast('Odadan çıkarıldın.','error')});
document.querySelector('#quickPlay').onclick=()=>quick('room:quick-play');
document.querySelector('#quickJoin').onclick=()=>quick('room:quick-join');
document.querySelector('#joinForm').onsubmit=e=>{e.preventDefault();join(document.querySelector('#joinCode').value)};
document.querySelector('#joinCode').addEventListener('input',e=>e.target.value=normalizeCode(e.target.value));
document.querySelector('#openCreate').onclick=()=>modal.showModal();
document.querySelector('#cancelCreate').onclick=()=>modal.close();
document.querySelector('#createForm').onsubmit=async e=>{
  e.preventDefault();
  const payload={profile,maxPlayers:Number(document.querySelector('#maxPlayers').value),rounds:Number(document.querySelector('#rounds').value),isPrivate:document.querySelector('#privacy').value==='private'};
  const res=await live.emit('room:create',payload);
  if(!res.ok)return toast(res.error,'error');
  goRoom(res.code);
};

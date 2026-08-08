import {requireProfile} from '../core/storage.js';
import {avatar} from '../core/avatars.js';
import {live} from '../core/client.js';
import {mountHeader} from '../core/header.js';
import {esc,toast} from '../core/ui.js';
import {routeRoom} from '../core/router.js';

const profile=requireProfile();if(!profile)throw new Error('profile required');mountHeader(profile);
const root=document.querySelector('#resultsRoot');let room=null;
const myId=()=>room?.meId||room?.players.find(p=>p.id===live.clientId)?.id||null;
const isHost=()=>Boolean(room?.isHost||(myId()&&room?.hostId===myId()));
function applyState(state){if(!state)return;if(room?.code===state.code&&Number(state.version||0)<=Number(room.version||0))return;room=state;render()}
function podiumCard(p,place){if(!p)return '<div></div>';const medals={1:'🥇',2:'🥈',3:'🥉'};return `<article class="podium-card ${place===1?'first':''}"><div class="medal">${medals[place]}</div><div style="width:84px;margin:8px auto">${avatar(p.avatar)}</div><strong>${esc(p.name)}</strong><span>${p.score} puan</span></article>`}
function render(){
  if(!room)return;if(room.status!=='finished')return routeRoom(room);const r=room.rankings||[];const order=[r[1],r[0],r[2]];
  root.innerHTML=`<section class="winner-stage"><span class="eyebrow">FINAL SIRALAMASI</span><h1><span class="gradient-text">${room.totalRounds} tur tamamlandı.</span></h1><p class="lead" style="margin-inline:auto">Tüm turların toplam puanları hesaplandı. Maçın kazananları burada.</p></section><div class="podium">${podiumCard(order[0],2)}${podiumCard(order[1],1)}${podiumCard(order[2],3)}</div><section class="card card-pad"><div class="panel-title"><div><h3>Tam sıralama</h3><p>Toplam maç puanları.</p></div><span class="badge good">Maç bitti</span></div><div class="ranking-list">${r.map(p=>`<div class="ranking-row"><div class="ranking-pos">#${p.rank}</div><div>${avatar(p.avatar)}</div><div><b>${esc(p.name)}</b>${p.id===myId()?'<div class="tiny">Sen</div>':''}</div><div class="ranking-score">${p.score}</div></div>`).join('')}</div>${isHost()?`<div class="results-actions"><button id="replay" class="btn btn-primary btn-lg">Aynı Ayarlarla Tekrar Oyna</button><button id="backLobby" class="btn btn-secondary btn-lg">Oda Lobisine Dön</button><button id="leaveFinal" class="btn btn-ghost btn-lg">Ana Lobiye Dön</button></div>`:`<div class="empty-state" style="margin-top:18px;padding:22px">Oda sahibi tekrar oyun başlatabilir veya odayı lobiye döndürebilir.</div><div class="results-actions"><button id="leaveFinal" class="btn btn-secondary btn-lg">Ana Lobiye Dön</button></div>`}</section>`;
  root.querySelector('#replay')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;const x=await live.emit('game:replay-now');if(!x.ok){e.currentTarget.disabled=false;return toast(x.error,'error')}if(x.state)routeRoom(x.state)});
  root.querySelector('#backLobby')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;const x=await live.emit('game:back-lobby');if(!x.ok){e.currentTarget.disabled=false;return toast(x.error,'error')}if(x.state)routeRoom(x.state)});
  root.querySelector('#leaveFinal')?.addEventListener('click',async()=>{await live.emit('room:leave');location.href='/lobby.html'});
}
function showReconnect(msg='Final ekranına yeniden bağlanılıyor…'){if(room)return;root.innerHTML=`<section class="card card-pad"><div class="empty-state"><h3>${esc(msg)}</h3><p>Oda oturumun korunuyor.</p><button id="retry" class="btn btn-primary" style="margin-top:12px">Tekrar Bağlan</button></div></section>`;root.querySelector('#retry')?.addEventListener('click',syncNow)}
async function syncNow(){const r=await live.syncRoom({retries:5,delayMs:600});if(r.ok&&r.state){applyState(r.state);return}showReconnect(r.error)}
live.on('room:state',applyState);live.on('connect',()=>{if(!room)syncNow()});live.on('room:kicked',()=>{live.clearRoomCode();location.href='/lobby.html'});
const cachedRoom=live.getCachedRoomState();if(cachedRoom?.status==='finished')applyState(cachedRoom);else showReconnect();syncNow();

import {requireProfile} from '../core/storage.js';
import {avatar} from '../core/avatars.js';
import {live} from '../core/client.js';
import {mountHeader} from '../core/header.js';
import {copyText,esc,toast} from '../core/ui.js';
import {routeRoom} from '../core/router.js';

const profile=requireProfile();if(!profile)throw new Error('profile required');
mountHeader(profile);
const root=document.querySelector('#roomRoot');
let room=null;
let readyBusy=false;
let startBusy=false;
const myId=()=>room?.meId||room?.players.find(p=>p.id===live.clientId)?.id||null;
const isHost=()=>Boolean(room?.isHost||(myId()&&room?.hostId===myId()));
const me=()=>room?.players.find(p=>p.id===myId());

function applyState(state){
  if(!state)return;
  if(room?.code===state.code&&Number(state.version||0)<=Number(room.version||0))return;
  room=state;
  render();
}

function renderRecovery(message='Oda bağlantısı yeniden kuruluyor…'){
  if(room)return;
  root.innerHTML=`<section class="card card-pad"><div class="empty-state"><h3>${esc(message)}</h3><p>Sayfayı yenilemen gerekmez. Oda oturumun korunuyor.</p><button id="retrySync" class="btn btn-primary" style="margin-top:12px">Tekrar Bağlan</button><button id="leaveBroken" class="btn btn-ghost" style="margin-top:12px">Lobiye Dön</button></div></section>`;
  root.querySelector('#retrySync')?.addEventListener('click',syncNow);
  root.querySelector('#leaveBroken')?.addEventListener('click',async()=>{await live.emit('room:leave');location.href='/lobby.html'});
}

function render(){
  if(!room)return;
  if(room.status!=='waiting')return routeRoom(room);
  const readyCount=room.players.filter(p=>p.ready).length;
  const allReady=room.players.length>=2&&readyCount===room.players.length;
  const host=isHost();
  const pending=room.startPending;
  const pendingText=pending?`Başlatma isteği hazır · ${pending.direct?'1 tur':`${pending.rounds} tur`} · herkes hazır olunca otomatik başlayacak.`:'';

  root.innerHTML=`<section class="card card-pad"><div class="room-summary"><div><span class="eyebrow">OYUN LOBİSİ</span><h1>${room.isPrivate?'Özel':'Açık'} Oda</h1></div><div class="code-card"><div><div class="tiny">ODA KODU</div><div class="room-code">${esc(room.code)}</div></div><button id="copyCode" class="btn btn-ghost icon-btn" title="Kodu kopyala">⧉</button></div></div>${pending?`<div class="host-note" style="margin:14px 0"><b>Başlatma beklemede:</b> ${esc(pendingText)}</div>`:''}<div class="panel-title"><div><h3>Oyuncular</h3><p>${room.players.length}/${room.maxPlayers} kişi lobide.</p></div><span class="badge ${allReady?'good':'warn'}">${readyCount}/${room.players.length} hazır</span></div><div class="players-grid">${room.players.map(p=>`<article class="player-card"><div style="width:58px">${avatar(p.avatar)}</div><div style="min-width:0"><strong>${esc(p.name)} ${p.id===myId()?'<span class="tiny">(sen)</span>':''}</strong><div class="player-meta">${p.id===room.hostId?'<span class="badge warn">★ Oda sahibi</span>':''}<span class="badge ${p.ready?'good':''}">${p.ready?'Hazır':'Bekliyor'}</span></div></div>${host&&p.id!==myId()?`<button class="btn btn-danger icon-btn kick-btn" data-kick="${esc(p.id)}" title="Oyuncuyu çıkar">×</button>`:''}</article>`).join('')}</div></section><aside class="room-controls"><section class="card card-pad"><div class="panel-title"><div><h3>Hazır mısın?</h3><p>Herkes hazır olduğunda oyun başlayabilir.</p></div></div><div class="ready-meter"><div style="display:flex;justify-content:space-between;gap:10px"><b>${readyCount} hazır</b><span class="tiny">${room.players.length} oyuncu</span></div><div class="ready-meter-bar"><span style="width:${room.players.length?Math.round(readyCount/room.players.length*100):0}%"></span></div></div><button id="readyBtn" class="btn ${me()?.ready?'btn-secondary':'btn-success'} btn-wide btn-lg" style="margin-top:12px">${me()?.ready?'Hazırı Kaldır':'Hazır Ol'}</button></section><section class="card card-pad"><div class="panel-title"><div><h3>Maç ayarları</h3><p>${host?'Tur sayısını sen belirleyebilirsin.':'Ayarları oda sahibi yönetiyor.'}</p></div></div><div class="field"><label>Tur sayısı</label><select id="roundSelect" class="select" ${host?'':'disabled'}>${Array.from({length:20},(_,i)=>i+1).map(n=>`<option value="${n}" ${room.configuredRounds===n?'selected':''}>${n} tur</option>`).join('')}</select></div><div class="divider"></div>${host?`<button id="startGame" class="btn btn-primary btn-wide btn-lg" ${room.players.length<2?'disabled':''}>${allReady?'Oyunu Başlat':'Başlatmayı Hazırla'}</button><button id="directGame" class="btn btn-secondary btn-wide" style="margin-top:9px" ${room.players.length<2?'disabled':''}>${allReady?'Direkt Başlat · 1 Tur':'1 Turluk Başlatmayı Hazırla'}</button><p class="host-note" style="margin:12px 0 0">Hazır olmayan varsa başlatma isteği bekler; son oyuncu hazır olduğunda oyun otomatik açılır.</p>`:`<div class="empty-state" style="padding:22px 12px">Oda sahibinin oyunu başlatması bekleniyor.</div>`}<button id="leaveRoom" class="btn btn-danger btn-wide" style="margin-top:10px">Lobiden Ayrıl</button></section></aside>`;

  root.querySelector('#copyCode').onclick=()=>copyText(room.code);
  root.querySelector('#readyBtn').onclick=async()=>{
    if(readyBusy)return;
    const button=root.querySelector('#readyBtn');
    const desired=!Boolean(me()?.ready);
    readyBusy=true;
    if(button){button.disabled=true;button.textContent=desired?'Hazır kaydediliyor…':'Hazır kaldırılıyor…'}
    const r=await live.emit('room:ready',{ready:desired});
    readyBusy=false;
    if(!r.ok){render();return toast(r.error,'error')}
    if(r.state)applyState(r.state);else render();
    if(r.autoStarted)toast('Herkes hazır. Oyun başlıyor!');
  };
  root.querySelector('#leaveRoom').onclick=async()=>{await live.emit('room:leave');location.href='/lobby.html'};
  root.querySelectorAll('[data-kick]').forEach(b=>b.onclick=async()=>{const r=await live.emit('room:kick',{playerId:b.dataset.kick});if(!r.ok)toast(r.error,'error')});
  if(host){
    root.querySelector('#roundSelect').onchange=async e=>{const r=await live.emit('room:set-rounds',{rounds:Number(e.target.value)});if(!r.ok)toast(r.error,'error');else if(r.state)applyState(r.state)};
    root.querySelector('#startGame').onclick=()=>requestStart(false);
    root.querySelector('#directGame').onclick=()=>requestStart(true);
  }
}

async function requestStart(direct){
  if(startBusy)return;
  startBusy=true;
  const buttons=[root.querySelector('#startGame'),root.querySelector('#directGame')].filter(Boolean);
  const old=buttons.map(b=>b.textContent);
  buttons.forEach(b=>b.disabled=true);
  const pressed=direct?root.querySelector('#directGame'):root.querySelector('#startGame');
  if(pressed)pressed.textContent='Başlatılıyor…';
  const r=await live.emit('room:start',{direct});
  startBusy=false;
  if(!r.ok){buttons.forEach((b,i)=>{b.disabled=false;b.textContent=old[i]});return toast(r.error,'error')}
  if(r.state){applyState(r.state);routeRoom(r.state)}
  if(r.pending)toast('Başlatma hazır. Son oyuncu hazır olunca oyun otomatik başlayacak.');
  else if(!r.alreadyStarted)toast('Oyun başlıyor!');
}

async function syncNow(){
  const r=await live.syncRoom({retries:4,delayMs:500});
  if(r.ok&&r.state){applyState(r.state);return true}
  renderRecovery(r.error||'Oda bağlantısı kurulamadı.');
  return false;
}

live.on('room:state',applyState);
live.on('room:notice',msg=>toast(msg));
live.on('connect',()=>{if(!room)syncNow()});
live.on('room:kicked',()=>{live.clearRoomCode();toast('Oda sahibi seni çıkardı.','error');setTimeout(()=>location.href='/lobby.html',450)});

const cachedRoom=live.getCachedRoomState();
if(cachedRoom?.status==='waiting')applyState(cachedRoom);else renderRecovery();
syncNow();

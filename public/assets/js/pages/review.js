import {requireProfile} from '../core/storage.js';
import {avatar} from '../core/avatars.js';
import {live} from '../core/client.js';
import {mountHeader} from '../core/header.js';
import {esc,toast} from '../core/ui.js';
import {routeRoom} from '../core/router.js';

const profile=requireProfile();if(!profile)throw new Error('profile required');mountHeader(profile);
const root=document.querySelector('#reviewRoot');let room=null;let selected=new Set();let selectionKey='';
const myId=()=>room?.meId||null;
const categories=()=>room?.categories||[];
function applyState(state){if(!state)return;if(room?.code===state.code&&Number(state.version||0)<=Number(room.version||0))return;room=state;render()}
function syncSelection(){
  const key=`${room.code}:${room.round}:${myId()}`;
  if(selectionKey===key)return;
  selectionKey=key;
  selected=new Set((room.reviewItems||[]).filter(i=>i.rejectedByMe).map(i=>i.id));
}
function render(){
  if(!room)return;if(room.status!=='review')return routeRoom(room);syncSelection();
  const items=room.reviewItems||[];const submitted=room.reviewSubmitted;const total=room.players.length;const done=room.reviewSubmittedCount||0;
  const byPlayer=new Map(room.players.map(p=>[p.id,items.filter(i=>i.playerId===p.id)]));
  root.innerHTML=`<div class="game-header"><div><span class="eyebrow">TOPLU CEVAP KONTROLÜ</span><h2 style="margin:6px 0 0">Tur ${room.round} / ${room.totalRounds} · Harf ${esc(room.letter)}</h2></div><span class="badge ${done===total?'good':'warn'}">${done}/${total} gönderdi</span></div><section class="card review-board-card"><div class="review-board-head"><div><h2>Tüm cevaplar</h2><p>Kabul / Reddet düğmesi yok. Yanlış veya geçersiz gördüğün cevapların yanındaki <b>Geçersiz</b> kutusuna tik at.</p></div><div class="score-legend"><span class="badge good">Benzersiz +10</span><span class="badge warn">Aynı +5</span><span class="badge danger">Oybirliğiyle geçersiz −5</span></div></div><div class="review-player-list">${room.players.map(p=>{
    const pItems=byPlayer.get(p.id)||[];const own=p.id===myId();
    return `<article class="review-player-card"><header><span class="review-avatar">${avatar(p.avatar)}</span><div><strong>${esc(p.name)}${own?' <small>(sen)</small>':''}</strong><span>${esc(room.letter)} harfi · ${pItems.filter(i=>i.answer).length}/${categories().length} cevap</span></div></header><div class="review-answer-grid">${categories().map(c=>{
      const item=pItems.find(i=>i.type===c.key);if(!item)return'';
      const wrong=Boolean(item.answer&&!item.startsCorrect),empty=!item.answer,checked=selected.has(item.id)||wrong;
      const disabled=own||submitted||wrong||empty;
      return `<label class="review-answer-cell ${wrong?'invalid':''} ${empty?'empty':''} ${checked&&!own?'marked':''}"><span class="review-category">${esc(c.label)}</span><strong>${item.answer?esc(item.answer):'—'}</strong><span class="answer-meta">${empty?'Boş · 0 puan':wrong?'Yanlış harf · geçersiz':item.duplicate?'Aynı cevap · 5 puan':'Benzersiz · 10 puan'}</span>${own?'<span class="own-answer-note">Kendi cevabın</span>':empty?'<span class="own-answer-note">Boş cevap</span>':wrong?'<span class="invalid-auto">✓ Otomatik geçersiz</span>':`<span class="reject-check"><input type="checkbox" data-reject="${esc(item.id)}" ${checked?'checked':''} ${disabled?'disabled':''}><i></i> Geçersiz</span>`}</label>`;
    }).join('')}</div></article>`;
  }).join('')}</div><div class="review-submit-bar">${submitted?`<div class="review-wait"><b>Değerlendirmen gönderildi ✓</b><span>Diğer oyuncular bekleniyor. Herkes gönderince sayfa otomatik değişecek.</span></div>`:`<div><b>${selected.size} cevap işaretledin</b><span>İstersen hiç işaretlemeden de gönderebilirsin.</span></div><button id="submitReview" class="btn btn-primary btn-lg">Değerlendirmeyi Gönder</button>`}</div></section>`;
  if(!submitted){
    root.querySelectorAll('[data-reject]').forEach(input=>input.onchange=e=>{if(e.target.checked)selected.add(e.target.dataset.reject);else selected.delete(e.target.dataset.reject);e.target.closest('.review-answer-cell')?.classList.toggle('marked',e.target.checked);renderCounter()});
    root.querySelector('#submitReview')?.addEventListener('click',submitReview);
  }
}
function renderCounter(){const el=root.querySelector('.review-submit-bar>div>b');if(el)el.textContent=`${selected.size} cevap işaretledin`}
async function submitReview(){const btn=root.querySelector('#submitReview');if(btn){btn.disabled=true;btn.textContent='Gönderiliyor…'}const r=await live.emit('game:review-submit',{rejectedIds:[...selected]});if(!r.ok){toast(r.error,'error');if(btn){btn.disabled=false;btn.textContent='Değerlendirmeyi Gönder'}return}if(r.state){applyState(r.state);routeRoom(r.state)}}
function showReconnect(msg='Cevap ekranına yeniden bağlanılıyor…'){if(room)return;root.innerHTML=`<section class="card review-card"><div class="empty-state"><h3>${esc(msg)}</h3><p>Sayfayı yenilemen gerekmez; bağlantı otomatik tekrar deneniyor.</p><button id="retry" class="btn btn-primary" style="margin-top:12px">Şimdi Yeniden Bağlan</button></div></section>`;root.querySelector('#retry')?.addEventListener('click',syncNow)}
async function syncNow(){const r=await live.syncRoom({retries:5,delayMs:450});if(r.ok&&r.state){applyState(r.state);return}showReconnect(r.error)}
live.on('room:state',applyState);live.on('connect',()=>syncNow());live.on('room:kicked',()=>{live.clearRoomCode();location.href='/lobby.html'});
const cachedRoom=live.getCachedRoomState();if(cachedRoom?.status==='review')applyState(cachedRoom);else showReconnect();syncNow();

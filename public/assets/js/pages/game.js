import {requireProfile} from '../core/storage.js';
import {live} from '../core/client.js';
import {mountHeader} from '../core/header.js';
import {esc,toast} from '../core/ui.js';
import {routeRoom} from '../core/router.js';

const profile=requireProfile();if(!profile)throw new Error('profile required');mountHeader(profile);
const root=document.querySelector('#gameRoot');
const letters=['A','B','C','Ç','D','E','F','G','Ğ','H','I','İ','J','K','L','M','N','O','Ö','P','R','S','Ş','T','U','Ü','V','Y','Z'];
const fallbackCategories=[
  {key:'name',label:'İsim'},{key:'city',label:'Şehir'},{key:'animal',label:'Hayvan'},{key:'plant',label:'Bitki'},
  {key:'item',label:'Eşya'},{key:'country',label:'Ülke'},{key:'job',label:'Meslek'},{key:'food',label:'Yemek'},
  {key:'brand',label:'Marka'},{key:'famous',label:'Ünlü'}
];
let room=null,draft={},draftKey='',submitInFlight=false,countdownTimer=null;
const myId=()=>room?.meId||null;
const me=()=>room?.players.find(p=>p.id===myId());
const categories=()=>room?.categories?.length?room.categories:fallbackCategories;
const chooser=()=>room?.players.find(p=>p.id===room?.currentChooserId)||null;
const versionOf=x=>Number(x?.version||0);

function draftStorageKey(){return room?.code&&room?.round&&room?.letter?`isimsehir-draft:${room.code}:${room.round}:${room.letter}`:''}
function loadDraft(){
  const key=draftStorageKey();
  try{const saved=key?JSON.parse(sessionStorage.getItem(key)||'null'):null;draft=Object.fromEntries(categories().map(c=>[c.key,String(saved?.[c.key]||'')]))}catch{draft=Object.fromEntries(categories().map(c=>[c.key,'']))}
}
function saveDraft(){const key=draftStorageKey();if(!key)return;try{sessionStorage.setItem(key,JSON.stringify(draft))}catch{}}
function clearDraft(){const key=draftStorageKey();if(key)sessionStorage.removeItem(key)}
function ensureDraft(){const key=`${room?.code}:${room?.round}:${room?.letter}`;if(draftKey!==key){draftKey=key;loadDraft()}}

function progressHtml(){
  const total=Math.min(room.totalRounds||1,20);
  return `<div class="round-progress" aria-label="Tur ilerlemesi">${Array.from({length:total},(_,i)=>`<span class="${i<room.round-1?'done':i===room.round-1?'current':''}"></span>`).join('')}</div>`;
}
function letterHistoryHtml({picker=false}={}){
  const used=new Set(room.usedLetters||[]);
  return `<div class="letter-history ${picker?'letter-picker':''}" aria-label="Harfler">${letters.map(l=>{
    const current=l===room.letter,wasUsed=used.has(l),disabled=picker&&wasUsed;
    if(picker)return `<button type="button" class="letter-chip pickable ${disabled?'used':''}" data-letter="${esc(l)}" ${disabled?'disabled':''} title="${disabled?'Bu harf daha önce seçildi':'Bu harfi seç'}">${esc(l)}${disabled?'<i>×</i>':''}</button>`;
    return `<span class="letter-chip ${current?'current':''} ${wasUsed&&!current?'used':''}" title="${wasUsed&&!current?'Bu harf önceki turda kullanıldı':current?'Bu turun harfi':'Henüz kullanılmadı'}">${esc(l)}${wasUsed&&!current?'<i>×</i>':''}</span>`;
  }).join('')}</div>`;
}
function headerHtml(){return `<div class="game-header"><div><span class="eyebrow">ODA ${esc(room.code)}</span><h2 style="margin:6px 0 0">Tur ${room.round} / ${room.totalRounds}</h2></div>${progressHtml()}</div>`}

function sameAnswerRound(a,b){return a?.status==='answering'&&b?.status==='answering'&&a.round===b.round&&a.letter===b.letter}
function applyState(state){
  if(!state)return;
  if(room?.code===state.code&&versionOf(state)<versionOf(room))return;
  if(room?.code===state.code&&versionOf(state)===versionOf(room))return;
  const prev=room;
  const formWasActive=Boolean(root.querySelector('#answerForm'));
  const prevMine=prev?.players?.find(p=>p.id===prev?.meId)?.submitted;
  room=state;
  const nextMine=me()?.submitted;

  // Aynı cevap turunda canlı oyuncu durumu / sayaç başladı gibi güncellemeler inputları asla yeniden oluşturmaz.
  if(sameAnswerRound(prev,room)&&formWasActive&&!prevMine&&!nextMine){
    updateAnsweringMeta();
    updateCountdown();
    return;
  }
  render();
}

function render(){
  stopCountdown();
  if(!room)return;
  if(room.status==='letter')return renderLetterSelection();
  if(room.status==='answering')return renderAnswering();
  return routeRoom(room);
}

function renderLetterSelection(){
  const currentChooser=chooser();
  const myTurn=currentChooser?.id===myId();
  root.innerHTML=headerHtml()+`<section class="card game-card"><div class="letter-turn-banner"><div><span class="eyebrow">HARF SEÇME SIRASI</span><h1>${myTurn?'Sıra sende!':`${esc(currentChooser?.name||'Oyuncu')} seçiyor`}</h1><p>${myTurn?'Bu tur için kullanılmamış bir harf seç. İstersen rastgele seçimi de kullanabilirsin.':'Harf seçildiği anda cevap ekranı herkeste otomatik açılacak.'}</p></div><div class="chooser-badge">${myTurn?'Sen seçiyorsun':esc(currentChooser?.name||'—')}</div></div>${letterHistoryHtml({picker:myTurn})}${myTurn?`<div class="letter-actions"><button id="randomLetter" class="btn btn-secondary btn-lg">🎲 Rastgele Harf Seç</button><span class="tiny">Çarpılı harfler önceki turlarda kullanıldı ve tekrar seçilemez.</span></div>`:`<div class="wait-box"><h2>Harf bekleniyor…</h2><p>Sayfayı yenileme; seçim yapılınca otomatik devam edecek.</p></div>`}</section>`;
  if(myTurn){
    root.querySelectorAll('[data-letter]').forEach(btn=>btn.onclick=()=>pickLetter({letter:btn.dataset.letter},btn));
    root.querySelector('#randomLetter')?.addEventListener('click',e=>pickLetter({random:true},e.currentTarget));
  }
}

async function pickLetter(payload,button){
  const all=[...root.querySelectorAll('[data-letter],#randomLetter')];all.forEach(b=>b.disabled=true);
  const old=button?.textContent;if(button)button.textContent='Seçiliyor…';
  const r=await live.emit('game:choose-letter',payload);
  if(!r.ok){toast(r.error,'error');all.forEach(b=>{if(!b.classList.contains('used'))b.disabled=false});if(button&&old)button.textContent=old;return}
  if(r.state)applyState(r.state);
}

function timerHtml(){
  if(!room.deadline)return `<div class="answer-timer neutral" data-answer-timer><b>Süre yok</b><span>Herkes rahatça yazabilir. İlk oyuncu Bitti dediğinde 60 saniye başlayacak.</span></div>`;
  return `<div class="answer-timer warning" data-answer-timer><b data-countdown>01:00</b><span>Bir oyuncu bitirdi · kalan süre dolunca tur otomatik kapanır.</span></div>`;
}

function renderAnswering(){
  ensureDraft();submitInFlight=false;
  const submitted=me()?.submitted;
  const currentChooser=chooser();
  root.innerHTML=headerHtml()+`<section class="card game-card"><div class="random-letter-banner"><div><span class="eyebrow">BU TURUN HARFİ</span><div class="big-letter">${esc(room.letter||'—')}</div></div><div class="random-letter-copy"><h2>${esc(room.letter||'—')} ile başlayan cevapları yaz</h2><p>Harfi <b>${esc(currentChooser?.name||'bir oyuncu')}</b> seçti. Süre başlangıçta yok; ilk oyuncu Bitti dediği anda kalan herkes için 60 saniye başlar.</p></div></div>${letterHistoryHtml()}${timerHtml()}${submitted?`<div class="wait-box"><h2>Cevapların kilitlendi ✓</h2><p>Diğer oyuncuların bitirmesi bekleniyor. Herkes bitirince toplu değerlendirme ekranı otomatik açılacak.</p></div>`:`<form id="answerForm"><div class="category-answer-grid">${categories().map((c,i)=>`<div class="answer-box"><div class="field"><label for="answer-${esc(c.key)}"><span class="category-number">${i+1}</span>${esc(c.label)}</label><input id="answer-${esc(c.key)}" data-answer="${esc(c.key)}" class="input" maxlength="36" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" placeholder="${esc(room.letter)} ile başlayan ${esc(c.label.toLocaleLowerCase('tr-TR'))}" value="${esc(draft[c.key]||'')}"></div></div>`).join('')}</div><div class="answer-submit-row"><div><b>Cevapların hazır mı?</b><span>Bitti dediğinde cevapların kilitlenir.</span></div><button id="finishAnswers" class="btn btn-primary btn-lg" type="submit">Bitti · Cevapları Kilitle</button></div></form>`}<div class="submission-status"></div></section>`;
  updateAnsweringMeta();
  startCountdown();
  if(!submitted){
    root.querySelectorAll('[data-answer]').forEach(input=>input.addEventListener('input',e=>{draft[e.target.dataset.answer]=e.target.value;saveDraft()}));
    root.querySelector('#answerForm').onsubmit=submitAnswers;
  }
}

async function submitAnswers(e){
  e.preventDefault();if(submitInFlight)return;submitInFlight=true;
  const submit=root.querySelector('#finishAnswers');
  if(submit){submit.disabled=true;submit.textContent='Gönderiliyor…'}
  // DOM'daki son değerleri doğrudan al; input event/cache yarışı yüzünden cevap kaybolmasın.
  const answers={};
  for(const c of categories()){
    const input=root.querySelector(`[data-answer="${CSS.escape(c.key)}"]`);
    answers[c.key]=String(input?.value??draft[c.key]??'').trim();
    draft[c.key]=answers[c.key];
  }
  saveDraft();
  const r=await live.emit('game:submit',{answers});
  submitInFlight=false;
  if(!r.ok){
    if(r.state){applyState(r.state);routeRoom(r.state);return}
    toast(r.error,'error');
    if(submit){submit.disabled=false;submit.textContent='Bitti · Cevapları Kilitle'}
    return;
  }
  clearDraft();
  if(r.state){applyState(r.state);routeRoom(r.state)}
}

function updateAnsweringMeta(){
  const box=root.querySelector('.submission-status');if(!box||!room)return;
  box.innerHTML=room.players.map(p=>`<span class="player-state ${p.submitted?'done':''}">${p.submitted?'✓':'○'} ${esc(p.name)}</span>`).join('');
  const timer=root.querySelector('[data-answer-timer]');
  if(timer){
    timer.classList.toggle('warning',Boolean(room.deadline));
    timer.classList.toggle('neutral',!room.deadline);
    if(room.deadline&&!timer.querySelector('[data-countdown]'))timer.innerHTML='<b data-countdown>01:00</b><span>Bir oyuncu bitirdi · kalan süre dolunca tur otomatik kapanır.</span>';
    if(!room.deadline)timer.innerHTML='<b>Süre yok</b><span>Herkes rahatça yazabilir. İlk oyuncu Bitti dediğinde 60 saniye başlayacak.</span>';
  }
}

function updateCountdown(){
  const el=root.querySelector('[data-countdown]');if(!el||!room?.deadline)return;
  const ms=Math.max(0,Number(room.deadline)-Date.now());
  const secs=Math.ceil(ms/1000);el.textContent=`${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;
  if(ms<=0)el.textContent='00:00';
}
function startCountdown(){stopCountdown();updateCountdown();if(room?.deadline)countdownTimer=setInterval(updateCountdown,250)}
function stopCountdown(){if(countdownTimer)clearInterval(countdownTimer);countdownTimer=null}

function showReconnect(msg='Oyun oturumuna yeniden bağlanılıyor…'){if(room)return;root.innerHTML=`<section class="card game-card"><div class="empty-state"><h3>${esc(msg)}</h3><p>Sayfayı yenilemen gerekmez; bağlantı otomatik olarak tekrar deneniyor.</p><button id="retry" class="btn btn-primary" style="margin-top:12px">Şimdi Yeniden Bağlan</button></div></section>`;root.querySelector('#retry')?.addEventListener('click',syncNow)}
async function syncNow(){const r=await live.syncRoom({retries:4,delayMs:450});if(r.ok&&r.state){applyState(r.state);return}showReconnect(r.error)}
live.on('room:state',applyState);live.on('connect',()=>{if(!room)syncNow()});live.on('room:kicked',()=>{live.clearRoomCode();location.href='/lobby.html'});
const cachedRoom=live.getCachedRoomState();if(cachedRoom&&['letter','answering'].includes(cachedRoom.status))applyState(cachedRoom);else showReconnect();syncNow();

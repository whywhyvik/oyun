import {loadProfile,saveProfile} from '../core/storage.js';
import {avatar,avatarIds,avatarMeta} from '../core/avatars.js';
import {mountHeader} from '../core/header.js';
import {esc,toast} from '../core/ui.js';
import {live} from '../core/client.js';
import {routeRoom} from '../core/router.js';

let profile=loadProfile();
const hadSavedProfile=Boolean(profile.name);
if(!hadSavedProfile){profile.gender='';profile.avatar='';}
mountHeader(profile,{showProfile:hadSavedProfile});
const form=document.querySelector('#profileForm');
const nameInput=document.querySelector('#nameInput');
const picker=document.querySelector('#avatarPicker');
const preview=document.querySelector('#profilePreview');
const genderHint=document.querySelector('#genderHint');
const names=['Luna','Atlas','Mira','Aras','Lina','Deniz','Ege','Ada','Nova','Kuzey','Arya','Poyraz','Masal','Mavi','Rüzgar'];
nameInput.value=profile.name||'';
let dragStartX=null;

function currentIndex(){const list=avatarIds[profile.gender]||[];return Math.max(0,list.indexOf(profile.avatar));}
function stepAvatar(dir){
  const list=avatarIds[profile.gender]||[];if(!list.length)return;
  const next=(currentIndex()+dir+list.length)%list.length;profile.avatar=list[next];render();
}
function chooseGender(gender){profile.gender=gender;profile.avatar=avatarIds[gender][0];render();}
function render(){
  document.querySelectorAll('[data-gender]').forEach(b=>b.classList.toggle('active',b.dataset.gender===profile.gender));
  if(!profile.gender){
    picker.innerHTML='<div class="avatar-gate"><strong>Önce cinsiyetini seç</strong><span>Kız veya Erkek seçtikten sonra karakterler tek tek burada görünecek.</span></div>';
    preview.classList.add('hidden');if(genderHint)genderHint.textContent='Önce Kız veya Erkek seç.';return;
  }
  const list=avatarIds[profile.gender];const idx=currentIndex();const id=list[idx];
  picker.innerHTML=`<div class="avatar-carousel"><button class="carousel-arrow" type="button" data-prev aria-label="Önceki karakter">‹</button><button class="avatar-stage" type="button" data-select-avatar aria-label="Bu karakteri seç">${avatar(id,'avatar-showcase')}<span class="avatar-character-name">${esc(avatarMeta[id]?.name||'Karakter')}</span><span class="avatar-selected-mark">Seçili</span></button><button class="carousel-arrow" type="button" data-next aria-label="Sonraki karakter">›</button></div><div class="avatar-dots">${list.map((x,i)=>`<button type="button" data-dot="${i}" class="${i===idx?'active':''}" aria-label="${i+1}. karakter"></button>`).join('')}</div><div class="swipe-note">← Kaydır veya oklarla değiştir →</div>`;
  picker.querySelector('[data-prev]').onclick=()=>stepAvatar(-1);picker.querySelector('[data-next]').onclick=()=>stepAvatar(1);
  picker.querySelectorAll('[data-dot]').forEach(b=>b.onclick=()=>{profile.avatar=list[Number(b.dataset.dot)];render()});
  const stage=picker.querySelector('.avatar-stage');
  stage.addEventListener('pointerdown',e=>{dragStartX=e.clientX;stage.setPointerCapture?.(e.pointerId)});
  stage.addEventListener('pointerup',e=>{if(dragStartX===null)return;const dx=e.clientX-dragStartX;dragStartX=null;if(Math.abs(dx)>38)stepAvatar(dx<0?1:-1)});
  preview.classList.remove('hidden');
  preview.innerHTML=`<div style="width:58px">${avatar(profile.avatar)}</div><div><strong>${esc(nameInput.value.trim()||'Oyuncu adın')}</strong><span>${profile.gender==='female'?'Kız karakter':'Erkek karakter'} · Profil önizleme</span></div>`;
  if(genderHint)genderHint.textContent=`${profile.gender==='female'?'Kız':'Erkek'} karakterleri · ${idx+1}/${list.length}`;
}

document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>chooseGender(b.dataset.gender));
nameInput.addEventListener('input',render);
document.querySelector('#randomName').onclick=()=>{nameInput.value=`${names[Math.floor(Math.random()*names.length)]}${Math.floor(Math.random()*90+10)}`;render()};
form.onsubmit=async e=>{e.preventDefault();const name=nameInput.value.trim();if(name.length<2)return toast('Oyuncu adı en az 2 karakter olmalı.','error');if(!profile.gender||!profile.avatar)return toast('Önce cinsiyet ve karakter seç.','error');profile={...profile,id:profile.id||crypto.randomUUID(),name:name.slice(0,22)};saveProfile(profile);const submit=form.querySelector('[type=submit]');if(submit){submit.disabled=true;submit.textContent='Kaydediliyor…'}if(live.roomCode&&live.getMemberToken()){const r=await live.emit('room:update-profile',{profile});if(r.ok&&r.state){routeRoom(r.state);return}}location.href='/lobby.html'};
render();

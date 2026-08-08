'use strict';
const http=require('http');
const {spawn}=require('child_process');
const path=require('path');
const fs=require('fs');
const PORT=3199;
const ROOT=path.join(__dirname,'..');
const DATA=path.join(ROOT,'data','rooms.json');
try{fs.rmSync(path.join(ROOT,'data'),{recursive:true,force:true})}catch{}
let child=null,logs='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function start(){logs='';child=spawn(process.execPath,[path.join(ROOT,'server.js')],{env:{...process.env,PORT:String(PORT),LAST_PLAYER_TIMEOUT_MS:'1400',DISCONNECTED_MEMBER_TTL_MS:'1800000'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);}
function stop(){return new Promise(resolve=>{if(!child)return resolve();const c=child;child=null;c.once('exit',()=>resolve());c.kill('SIGTERM');setTimeout(()=>{try{c.kill('SIGKILL')}catch{}resolve()},600).unref?.()})}
function request(pathname,{method='GET',body}={}){return new Promise((resolve,reject)=>{const raw=body?JSON.stringify(body):null;const req=http.request({hostname:'127.0.0.1',port:PORT,path:pathname,method,headers:raw?{'content-type':'application/json','content-length':Buffer.byteLength(raw)}:{}},res=>{let out='';res.on('data',d=>out+=d);res.on('end',()=>{try{resolve(JSON.parse(out))}catch{resolve(out)}})});req.on('error',reject);if(raw)req.write(raw);req.end()})}
const action=(clientId,event,payload={})=>request('/api/action',{method:'POST',body:{clientId,event,payload}});
async function waitServer(){for(let i=0;i<60;i++){try{const h=await request('/health');if(h?.ok)return h}catch{}await sleep(80)}throw new Error('Sunucu başlamadı. '+logs)}
function answers(letter,suffix=''){const keys=['name','city','animal','plant','item','country','job','food','brand','famous'];return Object.fromEntries(keys.map((k,i)=>[k,`${letter}${suffix}${i}`]))}
(async()=>{try{
  start();let health=await waitServer();
  if(health.lastPlayerTimeoutMs!==1400)throw new Error('Test sayacı ayarı uygulanmadı.');

  let created=await action('host-a','room:create',{profile:{id:'profile-host-123',name:'Kurucu',gender:'male',avatar:'m1'},maxPlayers:5,rounds:2,isPrivate:true});
  if(!created.ok||!created.code||!created.memberToken||!created.state.isHost)throw new Error('Oda oluşturulamadı.');
  const code=created.code,hostToken=created.memberToken,hostId=created.state.meId;
  // Kullanıcının kodu küçük harf/tire/boşlukla yazması da aynı odaya girmeli.
  const typed=` ${code.slice(0,2).toLowerCase()}-${code.slice(2)} `;
  let g1=await action('g1-a','room:join',{code:typed,profile:{id:'profile-g1-456',name:'Misafir1',gender:'female',avatar:'f1'}});
  if(!g1.ok||g1.code!==code||g1.state.code!==code)throw new Error('Oda kodu normalizasyonuyla katılım çalışmıyor.');
  const g1Token=g1.memberToken,g1Id=g1.state.meId;
  let g2=await action('g2-a','room:join',{code,profile:{id:'profile-g2-789',name:'Misafir2',gender:'male',avatar:'m2'}});
  if(!g2.ok||g2.code!==code)throw new Error('İkinci oyuncu kodla katılamadı.');
  const g2Token=g2.memberToken,g2Id=g2.state.meId;

  // Oda diske gerçekten yazılmalı ve kısa sunucu restartında kod kaybolmamalı.
  if(!fs.existsSync(DATA))throw new Error('Oda kalıcı depoya yazılmadı.');
  await stop();await sleep(120);start();await waitServer();
  let r=await action('host-after-restart','room:sync',{roomCode:code,memberToken:hostToken,profileId:'profile-host-123'});
  if(!r.ok||r.state.code!==code||!r.state.isHost||r.state.meId!==hostId)throw new Error('Sunucu restartında oda/host geri yüklenmedi.');
  const afterRestartJoin=await action('restart-joiner','room:join',{code:`${code.slice(0,3)} ${code.slice(3).toLowerCase()}`,profile:{id:'profile-restart-join',name:'RestartJoin',gender:'female',avatar:'f2'}});
  if(!afterRestartJoin.ok||afterRestartJoin.code!==code)throw new Error('Sunucu restartından sonra oda koduyla yeni oyuncu giremedi.');
  await action('restart-joiner','room:leave',{roomCode:code,memberToken:afterRestartJoin.memberToken,profileId:'profile-restart-join'});

  // Token hiç gönderilmese bile kalıcı profil kimliğiyle üyelik kurtarılmalı ve yeni/aynı token geri dönmeli.
  r=await action('g1-recovered','room:sync',{roomCode:code,profileId:'profile-g1-456'});
  if(!r.ok||r.state.meId!==g1Id||!r.memberToken)throw new Error('Profil kimliğiyle oyun oturumu kurtarılamadı.');
  const g1RecoveredToken=r.memberToken;
  r=await action('g2-refresh','room:sync',{roomCode:code,memberToken:g2Token,profileId:'profile-g2-789'});
  if(!r.ok||r.state.meId!==g2Id)throw new Error('Misafir oturumu yenilenemedi.');

  const actors={
    [hostId]:{client:'host-after-restart',token:hostToken,profileId:'profile-host-123'},
    [g1Id]:{client:'g1-recovered',token:g1RecoveredToken,profileId:'profile-g1-456'},
    [g2Id]:{client:'g2-refresh',token:g2Token,profileId:'profile-g2-789'}
  };
  const pay=id=>({roomCode:code,memberToken:actors[id].token,profileId:actors[id].profileId});

  for(const id of [hostId,g1Id,g2Id]){
    r=await action(actors[id].client,'room:ready',{...pay(id),ready:true});
    if(!r.ok||!r.state.players.find(p=>p.id===id)?.ready)throw new Error('Hazır durumu kaydedilemedi.');
  }
  r=await action(actors[hostId].client,'room:start',{...pay(hostId),direct:false});
  if(!r.ok||r.state.status!=='letter')throw new Error('Oyun başlatılamadı.');
  const chooser=r.state.currentChooserId;
  r=await action(actors[chooser].client,'game:choose-letter',{...pay(chooser),letter:'A'});
  if(!r.ok||r.state.status!=='answering')throw new Error('Harf seçilemedi.');
  if(r.state.deadline!==null)throw new Error('Kimse bitirmeden süre başladı.');

  // İlk Bitti anında 60 sn (testte 1.4 sn) başlamalı; iki kişi hâlâ yazıyor olabilir.
  r=await action(actors[hostId].client,'game:submit',{...pay(hostId),answers:answers('A','h')});
  if(!r.ok||r.state.status!=='answering'||!r.state.deadline||r.state.players.filter(p=>!p.submitted).length!==2)throw new Error('İlk Bitti sonrası ortak sayaç başlamadı.');
  const deadline=r.state.deadline;

  // Bitti isteğini farklı transport + token ile de kabul et; oturum doğrulama kilitlenmemeli.
  r=await action('g1-new-transport','game:submit',{roomCode:code,memberToken:g1RecoveredToken,profileId:'profile-g1-456',answers:answers('A','g1')});
  if(!r.ok||r.state.deadline!==deadline||r.state.players.filter(p=>!p.submitted).length!==1)throw new Error('Bitti yeni bağlantıda gönderilemedi veya sayaç resetlendi.');
  r=await action(actors[g2Id].client,'game:submit',{...pay(g2Id),answers:answers('A','g2')});
  if(!r.ok||r.state.status!=='review'||r.state.deadline!==null)throw new Error('Tüm Bitti cevapları değerlendirmeye geçirmedi.');

  // Değerlendirme -> 2. tur -> süre sonu otomatik bitirme.
  await action(actors[hostId].client,'game:review-submit',{...pay(hostId),rejectedIds:[]});
  await action('g1-new-transport','game:review-submit',{roomCode:code,memberToken:g1RecoveredToken,profileId:'profile-g1-456',rejectedIds:[]});
  r=await action(actors[g2Id].client,'game:review-submit',{...pay(g2Id),rejectedIds:[]});
  if(!r.ok||r.state.status!=='letter'||r.state.round!==2)throw new Error('2. tura geçilemedi.');
  const chooser2=r.state.currentChooserId;
  r=await action(actors[chooser2].client,'game:choose-letter',{...pay(chooser2),letter:'B'});
  if(!r.ok)throw new Error('2. tur harfi seçilemedi.');
  r=await action(actors[hostId].client,'game:submit',{...pay(hostId),answers:answers('B','h')});
  if(!r.state.deadline)throw new Error('İlk Bitti sonrası 2. tur sayacı başlamadı.');
  await sleep(1650);
  r=await action(actors[g2Id].client,'room:sync',{...pay(g2Id)});
  if(!r.ok||r.state.status!=='review')throw new Error('Süre sonunda kalan cevaplar otomatik kapanmadı.');

  console.log('✓ Smoke test geçti: kodla giriş, restartta oda koruma, token kaybında oturum kurtarma, Bitti gönderimi ve ilk Bitti sonrası ortak 60 sn sayacı çalışıyor.');
  process.exitCode=0;
}catch(err){console.error('✗ Smoke test başarısız:',err.message);console.error(logs);process.exitCode=1}finally{await stop();try{fs.rmSync(path.join(ROOT,'data'),{recursive:true,force:true})}catch{}}})();

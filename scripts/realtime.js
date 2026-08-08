'use strict';
const http=require('http');
const {spawn}=require('child_process');
const path=require('path');
const fs=require('fs');
const PORT=3201;
const ROOT=path.join(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child;

function request(pathname,{method='GET',body}={}){
  return new Promise((resolve,reject)=>{
    const raw=body?JSON.stringify(body):null;
    const req=http.request({hostname:'127.0.0.1',port:PORT,path:pathname,method,headers:raw?{'content-type':'application/json','content-length':Buffer.byteLength(raw)}:{}},res=>{
      let out='';res.on('data',d=>out+=d);res.on('end',()=>{try{resolve(JSON.parse(out))}catch{resolve(out)}})
    });
    req.on('error',reject);if(raw)req.write(raw);req.end();
  });
}
const action=(clientId,event,payload={})=>request('/api/action',{method:'POST',body:{clientId,event,payload}});
async function waitServer(){for(let i=0;i<60;i++){try{const h=await request('/health');if(h?.ok)return}catch{}await sleep(60)}throw new Error('Sunucu başlamadı')}

function openSSE(clientId,roomCode,memberToken){
  const events=[];const waiters=[];
  const params=new URLSearchParams({clientId,roomCode,memberToken});
  const req=http.request({hostname:'127.0.0.1',port:PORT,path:`/api/events?${params}`,method:'GET',headers:{accept:'text/event-stream'}},res=>{
    let buffer='';
    res.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      let ix;
      while((ix=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,ix);buffer=buffer.slice(ix+2);
        if(!block||block.startsWith(':'))continue;
        let event='message',data='';
        for(const line of block.split('\n')){
          if(line.startsWith('event:'))event=line.slice(6).trim();
          else if(line.startsWith('data:'))data+=line.slice(5).trim();
        }
        let parsed=data;try{parsed=JSON.parse(data)}catch{}
        const rec={event,data:parsed,at:Date.now()};events.push(rec);
        for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(w.event===event&&w.predicate(parsed)){waiters.splice(i,1);clearTimeout(w.timer);w.resolve(rec)}}
      }
    });
  });
  req.end();
  return {
    wait(event,predicate=()=>true,timeout=900){
      const found=events.find(x=>x.event===event&&predicate(x.data));if(found)return Promise.resolve(found);
      return new Promise((resolve,reject)=>{const w={event,predicate,resolve,timer:setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(new Error(`${event} ${timeout}ms içinde gelmedi`))},timeout)};waiters.push(w)})
    },
    close(){try{req.destroy()}catch{}}
  };
}

function answers(letter,s=''){const keys=['name','city','animal','plant','item','country','job','food','brand','famous'];return Object.fromEntries(keys.map((k,i)=>[k,`${letter}${s}${i}`]))}

(async()=>{
  let hs,gs;
  try{
    fs.rmSync(path.join(ROOT,'data'),{recursive:true,force:true});
    child=spawn(process.execPath,[path.join(ROOT,'server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','ignore','pipe']});
    await waitServer();
    let h=await action('rt-host','room:create',{profile:{id:'rt-ph',name:'Host',gender:'male',avatar:'m1'},maxPlayers:4,rounds:1,isPrivate:true});
    let g=await action('rt-guest','room:join',{code:h.code,profile:{id:'rt-pg',name:'Guest',gender:'female',avatar:'f1'}});
    const hp={roomCode:h.code,memberToken:h.memberToken,profileId:'rt-ph'};
    const gp={roomCode:h.code,memberToken:g.memberToken,profileId:'rt-pg'};
    hs=openSSE('rt-host',h.code,h.memberToken);gs=openSSE('rt-guest',h.code,g.memberToken);
    await Promise.all([hs.wait('room:state',x=>x.code===h.code,1200),gs.wait('room:state',x=>x.code===h.code,1200)]);

    let t=Date.now();
    await action('rt-host','room:ready',{...hp,ready:true});
    await gs.wait('room:state',x=>x.players?.some(p=>p.name==='Host'&&p.ready),900);
    if(Date.now()-t>900)throw new Error('Hazır güncellemesi gecikmeli yayımlandı');

    t=Date.now();
    await action('rt-guest','room:ready',{...gp,ready:true});
    await hs.wait('room:state',x=>x.players?.some(p=>p.name==='Guest'&&p.ready),900);
    if(Date.now()-t>900)throw new Error('Misafir hazır güncellemesi gecikmeli yayımlandı');

    t=Date.now();
    let started=await action('rt-host','room:start',{...hp,direct:true});
    await gs.wait('room:state',x=>x.status==='letter',900);
    if(Date.now()-t>900)throw new Error('Başlatma diğer oyuncuya gecikmeli ulaştı');
    let again=await action('rt-host','room:start',{...hp,direct:true});
    if(!again.ok||!again.alreadyStarted)throw new Error('Çift Başlat idempotent değil');

    const chooser=started.state.currentChooserId;
    const chooserIsHost=chooser===started.state.meId;
    const actor=chooserIsHost?'rt-host':'rt-guest';
    const pay=chooserIsHost?hp:gp;
    await action(actor,'game:choose-letter',{...pay,letter:'A'});
    await Promise.all([hs.wait('room:state',x=>x.status==='answering'&&x.letter==='A',900),gs.wait('room:state',x=>x.status==='answering'&&x.letter==='A',900)]);

    t=Date.now();
    await action('rt-host','game:submit',{...hp,answers:answers('A','h')});
    await gs.wait('room:state',x=>x.status==='answering'&&x.deadline&&x.players?.some(p=>p.name==='Host'&&p.submitted),900);
    if(Date.now()-t>900)throw new Error('Bitti durumu diğer oyuncuya gecikmeli ulaştı');

    t=Date.now();
    const last=await action('rt-guest','game:submit',{...gp,answers:answers('A','g')});
    await hs.wait('room:state',x=>x.status==='review',900);
    if(Date.now()-t>900)throw new Error('Tur sonu değerlendirme ekranı gecikmeli yayımlandı');
    const duplicate=await action('rt-guest','game:submit',{...gp,answers:answers('A','g')});
    if(!duplicate.ok||duplicate.state.status!=='review')throw new Error('Çift Bitti idempotent değil');

    await action('rt-host','game:review-submit',{...hp,rejectedIds:[]});
    t=Date.now();
    await action('rt-guest','game:review-submit',{...gp,rejectedIds:[]});
    await hs.wait('room:state',x=>x.status==='finished',900);
    if(Date.now()-t>900)throw new Error('Final geçişi gecikmeli yayımlandı');

    console.log('✓ Realtime test geçti: Hazır, Başlat, Bitti, tur/final geçişleri iki istemciye anında yayınlanıyor; çift tıklamalar idempotent.');
  }catch(e){console.error('✗ Realtime test başarısız:',e.message);process.exitCode=1}
  finally{hs?.close();gs?.close();if(child){child.kill('SIGTERM');await sleep(120);try{child.kill('SIGKILL')}catch{}}try{fs.rmSync(path.join(ROOT,'data'),{recursive:true,force:true})}catch{}}
})();

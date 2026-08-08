const ROOM_CACHE_KEY='isimsehir-room-state-cache';
const MEMBERSHIP_KEY='isimsehir-room-memberships';
const ROOM_KEY='isimsehir-room-code';

function normalizeCode(value=''){
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
}
function profileId(){try{return String(JSON.parse(localStorage.getItem('isimsehir-profile')||'null')?.id||'')}catch{return''}}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function stateVersion(state){return Number(state?.version||0)}

export class LiveClient{
  constructor(){
    this.handlers=new Map();
    this.clientId=sessionStorage.getItem('isimsehir-client-id')||crypto.randomUUID();
    sessionStorage.setItem('isimsehir-client-id',this.clientId);
    const queryRoom=normalizeCode(new URLSearchParams(location.search).get('room'));
    this.roomCode=queryRoom||normalizeCode(sessionStorage.getItem(ROOM_KEY))||normalizeCode(localStorage.getItem(ROOM_KEY));
    if(this.roomCode){sessionStorage.setItem(ROOM_KEY,this.roomCode);localStorage.setItem(ROOM_KEY,this.roomCode)}
    // Eski sürümde token sadece sessionStorage'daydı. Kalıcı depoya otomatik taşı.
    try{const old=JSON.parse(sessionStorage.getItem(MEMBERSHIP_KEY)||'{}')||{};const cur=JSON.parse(localStorage.getItem(MEMBERSHIP_KEY)||'{}')||{};localStorage.setItem(MEMBERSHIP_KEY,JSON.stringify({...old,...cur}))}catch{}
    this.lastRoomState=this.readCachedRoomState();
    this.connected=false;
    this.backgroundSyncBusy=false;
    this.lastRecoverySyncAt=0;
    this.lastEventAt=0;
    this.connect();
    this.startRecoverySync();
  }

  on(event,fn){
    if(!this.handlers.has(event))this.handlers.set(event,new Set());
    this.handlers.get(event).add(fn);
    return()=>this.handlers.get(event)?.delete(fn);
  }
  fire(event,data){for(const fn of this.handlers.get(event)||[])fn(data)}

  readMemberships(){
    try{return JSON.parse(localStorage.getItem(MEMBERSHIP_KEY)||sessionStorage.getItem(MEMBERSHIP_KEY)||'{}')||{}}catch{return{}}
  }
  getMemberToken(code=this.roomCode){
    const key=normalizeCode(code);if(!key)return'';
    return String(this.readMemberships()[key]||'');
  }
  setMemberToken(code,token){
    const key=normalizeCode(code);if(!key||!token)return;
    const map=this.readMemberships();map[key]=String(token);
    localStorage.setItem(MEMBERSHIP_KEY,JSON.stringify(map));
    sessionStorage.setItem(MEMBERSHIP_KEY,JSON.stringify(map));
  }
  clearMemberToken(code=this.roomCode){
    const key=normalizeCode(code);if(!key)return;
    const map=this.readMemberships();delete map[key];
    localStorage.setItem(MEMBERSHIP_KEY,JSON.stringify(map));
    sessionStorage.setItem(MEMBERSHIP_KEY,JSON.stringify(map));
  }

  setRoomCode(code=''){
    this.roomCode=normalizeCode(code);
    if(this.roomCode){sessionStorage.setItem(ROOM_KEY,this.roomCode);localStorage.setItem(ROOM_KEY,this.roomCode)}
    else{sessionStorage.removeItem(ROOM_KEY);localStorage.removeItem(ROOM_KEY)}
  }
  clearRoomCode(){
    const old=this.roomCode;
    this.setRoomCode('');
    if(old)this.clearMemberToken(old);
    this.lastRoomState=null;
    sessionStorage.removeItem(ROOM_CACHE_KEY);
  }

  readCachedRoomState(){
    try{
      const cached=JSON.parse(sessionStorage.getItem(ROOM_CACHE_KEY)||'null');
      if(!cached?.state?.code||!cached?.at)return null;
      if(this.roomCode&&cached.state.code!==this.roomCode)return null;
      return cached;
    }catch{return null}
  }
  cacheRoomState(state){
    if(!state?.code)return false;
    const current=this.lastRoomState?.state;
    if(current?.code===state.code&&stateVersion(state)<stateVersion(current))return false;
    this.setRoomCode(state.code);
    this.lastRoomState={state,at:Date.now()};
    try{sessionStorage.setItem(ROOM_CACHE_KEY,JSON.stringify(this.lastRoomState))}catch{}
    return true;
  }
  acceptRoomState(state,{fire=true}={}){
    if(!state?.code)return false;
    const prev=this.lastRoomState?.state;
    const prevVersion=stateVersion(prev),nextVersion=stateVersion(state);
    if(prev?.code===state.code&&nextVersion<prevVersion)return false;
    if(prev?.code===state.code&&nextVersion===prevVersion&&JSON.stringify(prev)===JSON.stringify(state))return false;
    if(!this.cacheRoomState(state))return false;
    if(fire)this.fire('room:state',state);
    return true;
  }
  getCachedRoomState(maxAge=30*60*1000){
    const cached=this.lastRoomState||this.readCachedRoomState();
    if(!cached?.state)return null;
    if(this.roomCode&&cached.state.code!==this.roomCode)return null;
    if(Date.now()-cached.at>maxAge)return null;
    return cached.state;
  }

  startRecoverySync(){
    if(this.backgroundSyncTimer)clearInterval(this.backgroundSyncTimer);
    const tick=async(force=false)=>{
      if(this.backgroundSyncBusy||!this.roomCode||document.hidden)return;
      const now=Date.now();
      // Canlı SSE ana kanal. Ancak bazı hosting/VPN/proxy katmanları SSE paketlerini tamponlayabiliyor.
      // 800ms'lik sürüm uzlaştırması sadece daha yeni room.version geldiğinde UI'yi günceller;
      // aynı state'i yeniden çizmez ve oyun inputlarını bozmaz.
      const minGap=force?0:600;
      if(now-this.lastRecoverySyncAt<minGap)return;
      this.lastRecoverySyncAt=now;
      this.backgroundSyncBusy=true;
      try{ await this.emit('room:sync'); }finally{this.backgroundSyncBusy=false}
    };
    this.backgroundSyncTimer=setInterval(()=>tick(false),650);
    window.addEventListener('focus',()=>tick(true));
    window.addEventListener('pageshow',()=>tick(true));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick(true)});
  }

  connect(){
    if(this.es){try{this.es.close()}catch{}}
    const params=new URLSearchParams({clientId:this.clientId});
    if(this.roomCode){
      params.set('roomCode',this.roomCode);
      const token=this.getMemberToken(this.roomCode);if(token)params.set('memberToken',token);
    }
    this.es=new EventSource(`/api/events?${params}`);
    for(const event of ['rooms:list','room:joined','room:state','room:notice','room:kicked','presence:update']){
      this.es.addEventListener(event,e=>{try{
        const data=JSON.parse(e.data);
        if(event==='room:joined'&&data?.code){
          this.setRoomCode(data.code);
          if(data.memberToken)this.setMemberToken(data.code,data.memberToken);
        }
        this.lastEventAt=Date.now();
        if(event==='room:state')return void this.acceptRoomState(data,{fire:true});
        this.fire(event,data);
      }catch{this.fire(event,e.data)}})
    }
    this.es.onopen=()=>{this.connected=true;this.lastEventAt=Date.now();this.fire('connect')};
    this.es.onerror=()=>{this.connected=false;this.fire('disconnect')};
  }

  async emit(event,payload={},authRetry=true){
    try{
      const bodyPayload={...payload};
      if(!bodyPayload.profileId){const pid=profileId();if(pid)bodyPayload.profileId=pid}
      const targetCode=normalizeCode(bodyPayload.roomCode||bodyPayload.code||this.roomCode);
      if(this.roomCode&&!bodyPayload.roomCode)bodyPayload.roomCode=this.roomCode;
      const token=this.getMemberToken(targetCode);
      if(token&&!bodyPayload.memberToken)bodyPayload.memberToken=token;

      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),10000);
      let res;
      try{
        res=await fetch('/api/action',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({clientId:this.clientId,event,payload:bodyPayload}),
          signal:controller.signal,
          cache:'no-store'
        });
      }finally{clearTimeout(timeout)}
      const out=await res.json();
      if(out?.code)this.setRoomCode(out.code);
      if(out?.code&&out?.memberToken)this.setMemberToken(out.code,out.memberToken);
      // Mutation veya sync cevabı yeni bir state taşıyorsa aynı EventSource olayı gelmesini beklemeden
      // sayfaya uygula. Böylece Başlat/Hazır/Bitti tıklaması kendi cihazında anında ilerler.
      if(out?.state)this.acceptRoomState(out.state,{fire:true});
      if(event==='room:leave'&&out?.ok)this.clearRoomCode();

      // Mobil/VPN geçişlerinde storage/transport yarışı oluşursa kullanıcıya ilk tıkta hata gösterme.
      // Oda oturumunu profil kimliği + oda koduyla bir kez kurtar, sonra aynı işlemi otomatik tekrarla.
      if(authRetry&&event!=='room:sync'&&!out?.ok&&this.roomCode&&/oturum|doğrulanamadı|aktif oda/i.test(String(out?.error||''))){
        const recovered=await this.emit('room:sync',{},false);
        if(recovered?.ok)return this.emit(event,payload,false);
      }
      return out;
    }catch(err){
      return {ok:false,error:err?.name==='AbortError'?'Bağlantı yanıt vermedi. Tekrar deneyebilirsin.':'Sunucuya ulaşılamadı.'};
    }
  }

  async syncRoom({retries=4,delayMs=500}={}){
    let last={ok:false,error:'Odaya bağlanılamadı.'};
    for(let i=0;i<retries;i++){
      last=await this.emit('room:sync');
      if(last.ok)return last;
      if(i<retries-1)await sleep(delayMs*Math.min(i+1,3));
    }
    return last;
  }
}

export const live=new LiveClient();

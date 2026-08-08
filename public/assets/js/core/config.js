import {toast} from './ui.js';
let configPromise;
export function getAppConfig(){
  if(!configPromise)configPromise=fetch('/api/config',{cache:'no-store'}).then(r=>r.json()).catch(()=>({discordInviteUrl:''}));
  return configPromise;
}
export async function bindDiscordLinks(root=document){
  const cfg=await getAppConfig();
  root.querySelectorAll('[data-discord-link]').forEach(link=>{
    if(cfg.discordInviteUrl){
      link.href=cfg.discordInviteUrl;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.classList.remove('is-unconfigured');
    }else{
      link.href='#';
      link.classList.add('is-unconfigured');
      link.addEventListener('click',e=>{e.preventDefault();toast('Discord davet bağlantısını config.json dosyasına ekle.','error')},{once:false});
    }
  });
}

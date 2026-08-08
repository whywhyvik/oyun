import {avatar} from './avatars.js';
import {bindConnection,esc} from './ui.js';
import {bindDiscordLinks} from './config.js';
export function mountHeader(profile,{showProfile=true}={}){
  const host=document.querySelector('#siteHeader');if(!host)return;
  host.innerHTML=`<header class="topbar"><div class="shell topbar-inner"><a class="brand brand-image" href="/lobby.html" aria-label="İsim Şehir ana lobi"><img src="/assets/img/game-logo.png" alt="İsim Şehir"></a><div class="top-actions"><a class="discord-mini" data-discord-link href="#" aria-label="Discord sunucusuna katıl"><img src="/assets/img/discord-icon.png" alt="Discord"></a>${showProfile&&profile?.name?`<a class="profile-pill" href="/"><span style="width:38px">${avatar(profile.avatar)}</span><span class="profile-pill-copy"><strong>${esc(profile.name)}</strong><small>Profili düzenle</small></span></a>`:''}<div class="connection" data-connection title="Aktif bağlantı sayısı"><i></i><span data-presence-count>Bağlanıyor</span></div></div></div></header>`;
  bindConnection();bindDiscordLinks(host);
}

const routeFor={waiting:'/room.html',letter:'/game.html',answering:'/game.html',review:'/review.html',finished:'/results.html'};
export function routeRoom(room){
  const target=routeFor[room?.status];if(!target)return;
  const code=String(room?.code||'').trim().toUpperCase();
  const currentRoom=String(new URLSearchParams(location.search).get('room')||'').trim().toUpperCase();
  if(location.pathname===target&&(!code||currentRoom===code))return;
  const url=code?`${target}?room=${encodeURIComponent(code)}`:target;
  location.replace(url);
}
export function leaveToLobby(){location.href='/lobby.html'}

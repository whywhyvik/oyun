const PROFILE_KEY='isimsehir-profile';
export function loadProfile(){
  try{const v=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');if(v?.id)return v;}catch{}
  return {id:crypto.randomUUID(),name:'',gender:'',avatar:''};
}
export function saveProfile(profile){localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}
export function requireProfile(){const p=loadProfile();if(!p.name||!p.gender||!p.avatar){location.replace('/');return null;}return p;}

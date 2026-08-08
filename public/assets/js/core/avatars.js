export const avatarIds={female:['f1','f2','f3','f4'],male:['m1','m2','m3','m4']};
export const avatarMeta={
  f1:{name:'Enerjik',gender:'female'},f2:{name:'Gece',gender:'female'},f3:{name:'Güneş',gender:'female'},f4:{name:'Kitapsever',gender:'female'},
  m1:{name:'Oyuncu',gender:'male'},m2:{name:'Havalı',gender:'male'},m3:{name:'Neşeli',gender:'male'},m4:{name:'Gölge',gender:'male'}
};
export function avatar(id='f1',className=''){
  const safe=avatarMeta[id]?id:'f1';
  return `<div class="avatar ${className}" data-avatar="${safe}"><img src="/assets/img/avatars/${safe}.webp" alt="" loading="lazy" draggable="false"></div>`;
}

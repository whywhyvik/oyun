'use strict';
const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');
const root=path.join(__dirname,'..');
const files=[path.join(root,'server.js')];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())walk(full);else if(item.name.endsWith('.js'))files.push(full)}}
walk(path.join(root,'public','assets','js'));
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
console.log(`✓ ${files.length} JavaScript dosyası sözdizimi kontrolünden geçti.`);

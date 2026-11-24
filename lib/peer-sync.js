'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { writeAtomic } = require('./store');
const prefix = 'data/users/local/';
const validDoc = /^(planner-(cal|plans|ideas|tools|timers)|board-[a-zA-Z0-9_-]{1,100})$/;
const validAsset = /^(?:(?:thumbs|vectors)\/)?([a-f0-9]{64})\.(png|jpg|jpeg|gif|webp|avif|svg|mp4|webm|mov|mkv|json)$/;
const safeKey = k => !['__proto__','constructor','prototype'].includes(k);
function merge(base, local, remote, conflict, preferLocal) {
  if (equal(local,remote) || equal(remote,base)) return local;
  if (equal(local,base)) return remote;
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (obj(local) && obj(remote) && (base === undefined || obj(base))) {
    const out = {};
    for (const k of new Set([...Object.keys(local),...Object.keys(remote)])) {
      if (!safeKey(k)) throw Error('Недопустимое поле документа');
      const value = merge(base?.[k],local[k],remote[k],conflict,preferLocal);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
  if (Array.isArray(local) && Array.isArray(remote) && [local,remote,base || []].every(a=>Array.isArray(a)&&a.every(x=>obj(x)&&typeof x.id==='string'))) {
    const map = a => new Map((a || []).map(x=>[x.id,x]));
    const a=map(base), l=map(local), r=map(remote);
    const ids = m => [...m.keys()];
    const lead = equal(ids(l),ids(a)) ? r : equal(ids(r),ids(a)) || preferLocal ? l : r;
    return [...new Set([...lead.keys(),...l.keys(),...r.keys()])].map(id=>merge(a.get(id),l.get(id),r.get(id),conflict,preferLocal)).filter(Boolean);
  }
  conflict();
  return preferLocal ? local : remote;
}
async function copyAsset(source, target, key) {
  const match = validAsset.exec(key);
  if (!match || (key.endsWith('.json') !== key.startsWith('vectors/'))) throw Error('Недопустимое вложение');
  const dst=path.join(target,key), src=path.join(source,key);
  try { await fs.promises.access(dst); return; } catch(e) { if(e.code!=='ENOENT')throw e; }
  await fs.promises.mkdir(path.dirname(dst),{recursive:true});
  const tmp=dst+'.'+crypto.randomUUID()+'.tmp', hash=crypto.createHash('sha256');
  let bytes=0;
  try {
    await pipeline(fs.createReadStream(src),new Transform({transform(chunk,enc,cb){
      bytes+=chunk.length;
      if(bytes>2*1024**3)return cb(Error('Слишком большое вложение'));
      hash.update(chunk);cb(null,chunk);
    }}),fs.createWriteStream(tmp,{flags:'wx'}));
    if(!key.startsWith('thumbs/') && hash.digest('hex')!==match[1])throw Error('Контрольная сумма вложения не совпала');
    await fs.promises.rename(tmp,dst);
  } finally { await fs.promises.unlink(tmp).catch(()=>{}); }
}
function createSync({dir,store,media,backups,flush,changed,activity}) {
  const config=path.join(dir,'peer-sync.json');
  let cfg;
  try {cfg=JSON.parse(fs.readFileSync(config,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
  cfg ||= {id:crypto.randomUUID(),root:'',base:{}};
  let busy=false, text='Синхронизация отключена';
  const state=()=>({enabled:!!cfg.root,busy,text});
  const save=()=>writeAtomic(config,JSON.stringify(cfg));
  const report=s=>{text=s;activity(state());};
  function setup(root){
    if(busy)throw Error('Дождитесь завершения передачи');
    if(root){
      if(!store.flush())throw Error('Не удалось сохранить документы');
      backups.snapshot('manual');
    }
    cfg={id:cfg.id,root:root?path.join(root,'Planer-Sync-v1'):'',base:{}};
    save();report(root?'Подключено':'Синхронизация отключена');
  }
  async function tick(){
    if(!cfg.root || busy)return;
    busy=true;
    try{
      const folder=cfg.root, own=path.join(folder,cfg.id+'.json');
      await fs.promises.mkdir(folder,{recursive:true});
      const peers=(await fs.promises.readdir(folder)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)&&f!==path.basename(own));
      if(peers.length>1)throw Error('Для двух ПК нужна отдельная общая папка');
      const peer=peers[0];
      if(peer && (await fs.promises.stat(path.join(folder,peer))).size>128*1024**2)throw Error('Слишком большой документ обмена');
      const remote=peer?JSON.parse(await fs.promises.readFile(path.join(folder,peer),'utf8')):null;
      if(remote && (remote.v!==1 || !remote.docs || !Array.isArray(remote.assets)))throw Error('Неверный формат данных');
      const sharedMedia=path.join(folder,'media');
      for(const key of remote?.assets || [])await copyAsset(sharedMedia,media.mediaDir,key);
      if(!await flush() || !store.flush())throw Error('Ожидаем сохранения документов');
      const docs={}, incoming=remote?.docs || {}, base=cfg.base || {};
      for(const f of fs.readdirSync(store.docsDir)){
        const k=f.replace(/^data__users__local__/,'').replace(/\.json$/,'');
        if(f==='data__users__local__'+k+'.json' && validDoc.test(k))docs[k]=store.get(prefix+k);
      }
      const edits=[], conflicts=[];
      if(remote)for(const k of new Set([...Object.keys(incoming),...Object.keys(base)])){
        if(!validDoc.test(k))throw Error('Недопустимое имя документа');
        let collision=false;
        const echoed=equal(incoming[k],cfg.lastSent?.[k]);
        const result=echoed && cfg.lastSent ? docs[k] : merge(base[k],docs[k],incoming[k],()=>{collision=true;},cfg.id<peer.slice(0,-5));
        if(collision)conflicts.push(k);
        if(!equal(docs[k],result))edits.push(k);
        if(result===undefined)delete docs[k];else docs[k]=result;
      }
      if(conflicts.length){
        backups.snapshot('manual');
        const conflictDir=path.join(dir,'backups','sync-conflicts',crypto.randomUUID());
        for(const k of conflicts)writeAtomic(path.join(conflictDir,k+'.json'),JSON.stringify({local:store.get(prefix+k),remote:incoming[k]}));
      }
      for(const k of edits){if(k in docs)store.set(prefix+k,docs[k]);else store.remove(prefix+k);}
      if(edits.length){if(!store.flush())throw Error('Ошибка сохранения');changed(edits.map(k=>prefix+k));}
      const refs=new Set(JSON.stringify(docs).match(/[a-f0-9]{64}/g)||[]),assets=[];
      for(const sub of ['','vectors','thumbs']){
        const list=await fs.promises.readdir(path.join(media.mediaDir,sub));
        for(const file of list){
          const key=sub?sub+'/'+file:file, match=validAsset.exec(key);
          if(match && refs.has(match[1])){await copyAsset(media.mediaDir,sharedMedia,key);assets.push(key);}
        }
      }
      const content=JSON.stringify({v:1,docs,assets:assets.sort()});
      const digest=crypto.createHash('sha256').update(content).digest('hex');
      if(digest!==cfg.published || !fs.existsSync(own))writeAtomic(own,content);
      if(cfg.published!==digest || !equal(base,incoming)){cfg.base=incoming;cfg.lastSent=docs;cfg.published=digest;save();}
      report(conflicts.length?'Обе версии конфликтующих документов сохранены в backups/sync-conflicts':peer?(equal(incoming,docs) && equal(remote.assets,assets) ? 'Обе копии совпали в ' : 'Изменения переданы в общую папку в ')+new Date().toLocaleTimeString('ru'):'Ожидаем второй ПК');
    }catch(e){report('Обмен отложен: '+e.message);}
    finally{busy=false;activity(state());}
  }
  return {tick,setup,state};
}
module.exports={createSync,merge,copyAsset};

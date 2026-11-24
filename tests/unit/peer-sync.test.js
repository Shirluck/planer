'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('../../lib/store');
const {createBackups}=require('../../lib/backups');
const {createSync,merge,copyAsset}=require('../../lib/peer-sync');
test('два независимых профиля обмениваются правками, медиа и удалениями',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'planer-sync-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const share=path.join(root,'share'), doc='data/users/local/board-test';
  function peer(name){
    const dir=path.join(root,name),store=createStore(dir);
    store.migrate();
    const mediaDir=path.join(dir,'media');
    for(const sub of ['thumbs','vectors'])fs.mkdirSync(path.join(mediaDir,sub),{recursive:true});
    const sync=createSync({dir,store,media:{mediaDir},backups:createBackups({dir,store}),flush:async()=>true,changed:()=>{},activity:()=>{}});
    sync.setup(share);return {store,sync,mediaDir};
  }
  const a=peer('a'),b=peer('b');
  const bytes=Buffer.from('fixture'),id=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(a.mediaDir,id+'.png'),bytes);
  a.store.set(doc,{items:[{id:'card',mediaId:id,x:0,y:0}]});
  await a.sync.tick();await b.sync.tick();await a.sync.tick();
  assert.deepEqual(b.store.get(doc),a.store.get(doc));
  assert.deepEqual(fs.readFileSync(path.join(b.mediaDir,id+'.png')),bytes);
  a.store.set(doc,{items:[{id:'card',mediaId:id,x:10,y:0}]});
  b.store.set(doc,{items:[{id:'card',mediaId:id,x:0,y:20}]});
  await a.sync.tick();await b.sync.tick();await a.sync.tick();
  assert.deepEqual(a.store.get(doc).items[0],{id:'card',mediaId:id,x:10,y:20});
  assert.deepEqual(b.store.get(doc),a.store.get(doc));
  b.store.remove(doc);await b.sync.tick();await a.sync.tick();
  assert.equal(a.store.get(doc),null);
});
test('одновременная правка одного поля помечается конфликтом',()=>{
  let conflict=false;
  assert.equal(merge('до','первая','вторая',()=>{conflict=true;},true),'первая');
  assert.ok(conflict);
});
test('вложение с неверным хешем или путём не принимается',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'planer-asset-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const name='a'.repeat(64)+'.png', dst=path.join(root,'dst');
  fs.writeFileSync(path.join(root,name),'bad');
  await assert.rejects(copyAsset(root,dst,name));
  await assert.rejects(copyAsset(root,dst,'../'+name));
  assert.equal(fs.existsSync(path.join(dst,name)),false);
});

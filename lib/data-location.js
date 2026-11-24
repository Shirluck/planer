'use strict';
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./store');
const entries = ['docs', 'media', 'backups', 'settings.json', 'peer-sync.json', 'api-key.bin',
  'planner-data.json', 'planer-meta.json', 'tray-hint-shown'];

function createLocation(profile) {
  const config = path.join(profile, 'data-location.json');
  let active = profile, pending = '';
  const save = (current, next) => writeAtomic(config, JSON.stringify({active:current,pending:next}));
  function targetFor(parent) {
    const target = path.join(fs.realpathSync(parent), 'Planer-Data');
    for (const folder of [profile, active]) {
      const relative = path.relative(folder, target);
      if (!relative || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative)))
        throw Error('Выберите папку за пределами текущего хранилища.');
    }
    if (fs.existsSync(target)) throw Error('В этой папке уже есть Planer-Data. Выберите другую папку.');
    return target;
  }
  async function start() {
    if (fs.existsSync(config)) {
      const saved = JSON.parse(fs.readFileSync(config,'utf8'));
      if (typeof saved.active !== 'string' || !path.isAbsolute(saved.active)) throw Error('Повреждены настройки расположения данных.');
      active = saved.active; pending = saved.pending || '';
      if (active !== profile && !fs.existsSync(path.join(active,'planer-meta.json')))
        throw Error('Подключите диск с данными Планера и откройте программу снова: '+active);
    }
    if (!pending) return '';
    let temp;
    try {
      const target = targetFor(path.dirname(pending));
      if (target !== pending) throw Error('Изменился путь назначения.');
      temp = await fs.promises.mkdtemp(path.join(path.dirname(target),'.planer-copy-'));
      for (const name of entries) {
        const source = path.join(active,name);
        if (fs.existsSync(source)) await fs.promises.cp(source,path.join(temp,name),{recursive:true,
          filter:async file => { if ((await fs.promises.lstat(file)).isSymbolicLink()) throw Error('В хранилище найдена символическая ссылка.'); return true; }});
      }
      if (!fs.existsSync(path.join(temp,'planer-meta.json'))) throw Error('Не найдены исходные данные.');
      await fs.promises.rename(temp,target); temp = null;
      save(target,''); active = target; pending = '';
      return '';
    } catch (err) {
      pending = ''; save(active,'');
      return 'Перенос не выполнен. Сохранение продолжится в '+active+'. '+err.message;
    } finally {
      if (temp) await fs.promises.rm(temp,{recursive:true,force:true}).catch(()=>{});
    }
  }
  function choose(parent) {
    const next = targetFor(parent); save(active,next); pending=next;
  }
  function cancel() { save(active,''); pending=''; }
  return {start,choose,cancel,state:()=>({active,pending})};
}
module.exports = {createLocation};

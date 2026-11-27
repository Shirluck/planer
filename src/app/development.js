(() => {
  const api = window.electronAPI;
  const button = document.querySelector('#developmentBtn');
  button.append(icon('globe', 17), h('span', {class:'tm-btn-name'}, 'Развитие'));
  const path = 'data/users/local/planner-development';
  const sections = [
    ['design', 'Для дизайнера', 'Дизайн'],
    ['science', 'Для общего развития', 'Научно-популярное'],
    ['trend', 'В тренде', 'Популярное за сутки']
  ];

  function displayDate(key) {
    return new Date(key + 'T12:00:00').toLocaleDateString('ru-RU', {day:'numeric', month:'long'});
  }
  function snippet(html) {
    const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', laquo:'«', raquo:'»', mdash:'—', ndash:'–'};
    const text = html.replace(/<[^>]*>/g, ' ').replace(/&([a-z]+);/gi, (raw, name) => entities[name] ?? raw)
      .replace(/\s+/g, ' ').replace(/\s*Читать (далее|дальше).*$/i, '').trim();
    return text.length > 360 ? text.slice(0, 357).replace(/\s+\S*$/, '') + '…' : text;
  }
  function feedEntries(xml, gallery) {
    if (/<!DOCTYPE/i.test(xml)) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const entries = [];
    for (const item of doc.querySelectorAll('channel > item')) {
      const field = name => item.querySelector(name)?.textContent.trim() || '';
      const pattern = gallery ? /^https:\/\/www\.behance\.net\/(gallery\/\d+\/[\w%.-]+)\/?$/i :
        /^https:\/\/habr\.com\/(ru\/(?:companies\/[\w-]+\/)?(?:articles|news|blog)\/\d+)\/?(?:\?[^#]*)?$/i;
      const link = field('link').match(pattern);
      if (!link) continue;
      const html = field('description');
      const image = html.match(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i);
      const title = field('title').slice(0, 240), summary = snippet(html);
      if (title && (gallery || summary)) entries.push({
        title, summary, url:(gallery?'https://www.behance.net/':'https://habr.com/') + link[1] + '/',
        imageUrl:image?.[1].replace(/&amp;/g,'&') || ''
      });
    }
    return entries;
  }
  function picture(card) {
    if (!/^[a-f0-9]{64}$/.test(card.imageId || '')) return null;
    const img = h('img', {class:'dev-cover', src:'media://'+card.imageId, loading:'lazy', alt:''});
    img.onerror=()=>img.remove();
    return img;
  }
  let pending = null;
  async function load(day) {
    const history = await api.dbGet(path) || {};
    const cards = {...history[day]};
    const used = new Set(Object.values(history).flatMap(row => Object.values(row).flat().map(card => card.url)));
    const sources = sections.map(([key])=>key).reverse().concat('behance');
    const missing = sources.filter(key=>!cards[key] || (key!=='behance' && cards[key].imageUrl===undefined));
    const feeds = await Promise.allSettled(missing.map(key=>api.developmentFeed(key)));
    let changed = false;
    for (const [i,key] of missing.entries()) {
      if (feeds[i].status!=='fulfilled') continue;
      const gallery=key==='behance', entries=feedEntries(feeds[i].value,gallery);
      if (cards[key]) {
        const same=entries.find(a=>a.url===cards[key].url);
        cards[key]={...cards[key],imageUrl:same?.imageUrl || ''};
      } else {
        const picks=[];
        for (const article of entries) {
          if (used.has(article.url)) continue;
          picks.push(article);used.add(article.url);
          if(picks.length===(gallery?3:1))break;
        }
        if(!picks.length)continue;
        cards[key]=gallery?picks:picks[0];
      }
      changed=true;
    }
    await Promise.all(Object.values(cards).flat().map(async article=>{
      if(article.imageUrl && !article.imageId){
        const id=await api.developmentCover(article.imageUrl).catch(()=>null);
        if(id){article.imageId=id;changed=true;}
      }
    }));
    if (changed) {
      history[day] = cards;
      const keys = Object.keys(history).sort().slice(-90);
      await api.dbSet(path, Object.fromEntries(keys.map(key => [key, history[key]])));
    }
    return history;
  }
  button.onclick = () => {
    if (document.querySelector('.dev-dialog')) return;
    const dlg = h('dialog', {class:'st-box dev-dialog', 'aria-label':'Развитие'});
    const body = h('div', {class:'st-body'});
    const date = h('span', {class:'dev-date'});
    dlg.append(h('header', {class:'st-head'}, h('h2', {}, 'Развитие'), date,
      h('span', {class:'spacer'}), tool('x','Закрыть',()=>dlg.close())), body);
    let showing = '';
    async function render() {
      const day = todayKey();
      showing = day;
      date.textContent = displayDate(day);
      body.replaceChildren(h('p', {role:'status'}, 'Загружаем подборку…'));
      try {
        if (!pending) pending = load(day).finally(() => { pending = null; });
        const history = await pending;
        if (!dlg.open || showing !== day) return;
        const today = history[day] || {};
        body.replaceChildren();
        const previous = Object.keys(history).filter(k => k < day).sort().reverse();
        for (const [key, label, source] of sections) {
          const from = today[key] ? day : previous.find(k => history[k][key]);
          const article = from && history[from][key];
          const card = h('section', {class:'dev-card'}, h('small', {}, label));
          if (article) {
            const image=picture(article); if(image)card.append(image);
            card.append(h('h3', {}, article.title), h('p', {}, article.summary));
            if (from !== day) card.append(h('p', {class:'st-note'}, 'Сохранено за '+displayDate(from)));
            card.append(h('button', {type:'button', class:'tb-btn', onclick:()=>api.openUrl(article.url)},
              'Хабр · '+source+' ↗'));
          } else card.append(h('p', {}, 'Свежий материал пока недоступен.'));
          body.append(card);
        }
        const galleryDay=today.behance?day:previous.find(k=>history[k].behance);
        const gallery=h('section',{class:'dev-gallery'},h('h3',{},'Работы с Behance'),h('small',{},'Выбор редакции Behance'));
        if(galleryDay){
          if(galleryDay!==day)gallery.append(h('p',{class:'st-note'},'Сохранено за '+displayDate(galleryDay)));
          const projects=h('div',{class:'dev-projects'});
          for(const p of history[galleryDay].behance){
            projects.append(h('button',{type:'button',class:'dev-project',onclick:()=>api.openUrl(p.url)},picture(p),h('strong',{},p.title)));
          }
          gallery.append(projects);
        }else gallery.append(h('p',{},'Подборка работ пока недоступна.'));
        body.append(gallery);
        if (!today.behance || sections.some(([key]) => !today[key])) retry();
      } catch {
        if (!dlg.open) return;
        body.replaceChildren(h('p', {role:'status'}, 'Не удалось открыть подборку.'));
        retry();
      }
    }
    function retry() {
      body.append(h('button', {type:'button', class:'tb-btn', onclick:render}, 'Попробовать ещё раз'));
    }
    document.body.append(dlg);
    dlg.showModal();
    const timer = setInterval(() => { if (!pending && showing !== todayKey()) render(); }, 15000);
    dlg.onclose = () => {
      clearInterval(timer); dlg.remove(); (button.offsetWidth ? button : headerMore).focus();
    };
    render();
  };
})();

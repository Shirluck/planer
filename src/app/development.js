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
  function selectArticle(xml, used) {
    if (/<!DOCTYPE/i.test(xml)) return null;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    for (const item of doc.querySelectorAll('channel > item')) {
      const field = name => item.querySelector(name)?.textContent.trim() || '';
      const link = field('link').match(/^https:\/\/habr\.com\/(ru\/(?:companies\/[\w-]+\/)?(?:articles|news|blog)\/\d+)\/?(?:\?[^#]*)?$/i);
      if (!link) continue;
      const url = 'https://habr.com/' + link[1] + '/';
      const title = field('title').slice(0, 240);
      const summary = snippet(field('description'));
      if (title && summary && !used.has(url)) return {url, title, summary};
    }
    return null;
  }

  let pending = null;
  async function load(day) {
    const history = await api.dbGet(path) || {};
    const cards = {...history[day]};
    const missing = sections.filter(([key]) => !cards[key]);
    const used = new Set(Object.values(history).flatMap(row => Object.values(row).map(card => card.url)));
    const feeds = await Promise.allSettled(missing.map(([key]) => api.developmentFeed(key)));
    let changed = false;
    // Даём узкой подборке трендов первый выбор при пересечении рубрик.
    for (let i = missing.length - 1; i >= 0; i--) {
      if (feeds[i].status !== 'fulfilled') continue;
      const article = selectArticle(feeds[i].value, used);
      if (article) {
        cards[missing[i][0]] = article;
        used.add(article.url);
        changed = true;
      }
    }
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
            card.append(h('h3', {}, article.title), h('p', {}, article.summary));
            if (from !== day) card.append(h('p', {class:'st-note'}, 'Сохранено за '+displayDate(from)));
            card.append(h('button', {type:'button', class:'tb-btn', onclick:()=>api.openUrl(article.url)},
              'Хабр · '+source+' ↗'));
          } else card.append(h('p', {}, 'Свежий материал пока недоступен.'));
          body.append(card);
        }
        if (sections.some(([key]) => !today[key])) retry();
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

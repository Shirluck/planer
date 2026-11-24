/* Локальные тренировки. Результат каждого режима хранится на этом устройстве. */
(() => {
  const modes = {digits:'Цифры', words:'Слова', grid:'Клетки'};
  const words = 'мост чай снег кадр лес ключ луна шар маяк лист стол сыр сад кот дом кит луч след море зонт мел дым торт лёд'.split(' ');
  const button = document.querySelector('#memoryBtn');
  button.append(icon('bulb',17), h('span',{class:'tm-btn-name'},'Память'));
  button.onclick = () => {
    if (document.querySelector('.memory-dialog')) return;
    const dlg = h('dialog',{class:'memory-dialog st-box','aria-label':'Тренировка памяти'});
    document.body.append(dlg);
    let mode = 'digits', phase = 'start', answer = [], selected = new Set(), result = '', level = 1;
    const best = name => Number(localStorage.getItem('memory-best-' + name)) || 0;
    const control = (label, fn) => h('button',{type:'button',class:'tb-btn',onclick:fn},label);
    function start() {
      const n = Math.min(3 + level - 1, 12);
      const pool = mode === 'words' ? [...words] : Array.from({length:16}, (_,i)=>String(i));
      answer = Array.from({length:n}, () => mode === 'digits' ? String(Math.floor(Math.random()*10)) :
        pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
      selected = new Set(); phase = 'show'; draw();
    }
    function finish(values) {
      const correct = mode === 'grid' ? answer.length === values.length && answer.every(v=>values.includes(v)) :
        answer.join(' ') === values.join(' ');
      result = correct ? 'Верно! Уровень ' + level + ' пройден.' : 'Ответ: ' +
        (mode === 'grid' ? answer.map(v=>Number(v)+1).sort((a,b)=>a-b).join(', ') : answer.join(mode==='digits'?'':' '));
      if (correct) { localStorage.setItem('memory-best-'+mode,String(Math.max(level,best(mode)))); level=Math.min(10,level+1); }
      phase='result'; draw();
    }
    function draw() {
      const body=h('div',{class:'st-body'});
      const tabs=h('div',{class:'st-btns'},Object.entries(modes).map(([key,name])=>{
        const b=control(name,()=>{mode=key;phase='start';level=1;draw();});
        b.setAttribute('aria-pressed',String(mode===key));return b;
      }));
      dlg.replaceChildren(h('div',{class:'st-head'},h('h2',{},'Память'),h('span',{class:'spacer'}),tool('x','Закрыть',()=>dlg.close())),body);
      body.append(tabs,h('p',{class:'st-note'},'Уровень '+level+' · Личный рекорд: '+best(mode)));
      if (phase==='start' || phase==='result') {
        body.append(h('p',{},phase==='result'?result:({digits:'Запомните последовательность цифр и введите её по памяти.',words:'Запомните слова, затем введите их в том же порядке.',grid:'Запомните отмеченные клетки и повторите рисунок.'})[mode]),control(phase==='result'?'Следующий раунд':'Начать',start));return;
      }
      const recall=phase==='recall';
      if (mode==='grid') {
        const grid=h('div',{class:'mem-grid'});
        for(let i=0;i<16;i++) {
          const v=String(i), marked=recall?selected.has(v):answer.includes(v);
          const b=control(String(i+1),()=>{if(selected.has(v))selected.delete(v);else selected.add(v);b.setAttribute('aria-pressed',String(selected.has(v)));});
          b.disabled=!recall;b.setAttribute('aria-pressed',String(marked));grid.append(b);
        }
        body.append(grid);
        if(recall) body.append(control('Проверить',()=>finish([...selected])));
      } else if(recall) {
        const input=h('input',{class:'mem-input','aria-label':'Ваш ответ',placeholder:mode==='digits'?'Введите цифры':'Слова через пробел',autocomplete:'off'});
        const submit=()=>finish(mode==='digits'?[...input.value.replace(/\s/g,'')]:input.value.trim().toLowerCase().split(/\s+/));
        input.onkeydown=e=>{if(e.key==='Enter')submit();};
        body.append(input,control('Проверить',submit));input.focus();
      } else body.append(h('p',{class:'mem-sequence'},answer.join(mode==='words'?' · ':' ')));
      if(!recall) body.append(control('Запомнил',()=>{phase='recall';draw();}));
    }
    dlg.onclose=()=>{dlg.remove();button.focus();};
    draw();dlg.showModal();
  };
})();

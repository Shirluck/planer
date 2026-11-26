(() => {
  const button=document.querySelector('#memoryBtn');
  button.append(icon('bulb',17),h('span',{class:'tm-btn-name'},'Память'));
  const control=(label,fn,primary=false)=>h('button',{type:'button',class:'tb-btn'+(primary?' primary':''),onclick:fn},label);
  function shuffle(values){
    const out=[...values];
    for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
    return out;
  }
  button.onclick=()=>{
    if(document.querySelector('.memory-dialog'))return;
    const dlg=h('dialog',{class:'memory-dialog st-box','aria-label':'Память'});
    const body=h('div',{class:'st-body'});
    dlg.append(h('div',{class:'st-head'},h('h2',{},'Память'),h('span',{class:'spacer'}),tool('x','Закрыть',()=>dlg.close())),body);
    dlg.onclose=()=>{dlg.remove();(button.offsetWidth?button:headerMore).focus();};
    const games=[
      ['matrix','Матрица','Запомните расположение пяти клеток.','▦'],
      ['schulte','Таблица Шульте','Найдите числа от 1 до 25 по порядку.','25'],
      ['math','Арифметика','Решите пять примеров в уме.','±'],
      ['double','Дубль','Выберите общий символ двух наборов.','◆'],
      ['odd','Лишнее число','Найдите число, отличающееся одной цифрой.','42'],
      ['sort','Сортировщик','Распределите числа на чётные и нечётные.','⇄'],
      ['pairs','Мемори','Открывайте карточки и собирайте пары.','♧']
    ];
    function catalog(){
      const list=h('div',{class:'brain-list'});
      for(const [key,name,description,mark] of games){
        list.append(h('button',{type:'button',class:'brain-row',onclick:()=>play(key)},
          h('span',{class:'brain-mark','aria-hidden':'true'},mark),
          h('span',{},h('strong',{},name),h('small',{},description)),h('span',{'aria-hidden':'true'},'›')));
      }
      body.replaceChildren(list);
    }
    function play(key){
      const [,name,description]=games.find(g=>g[0]===key);
      body.replaceChildren(control('‹ К тренажёрам',catalog),h('h3',{},name),h('p',{},description));
      const status=h('p',{role:'status'}),board=h('div',{class:'brain-board'}),actions=h('div',{class:'st-btns'});
      body.append(status,board,actions);
      const start=performance.now(),symbols=[...'★●▲◆♣♥☀☂♫✿'];
      let errors=0,step=0;
      const range=n=>Array.from({length:n},(_,i)=>i);
      const rand=n=>Math.floor(Math.random()*n);
      const tile=(label,click)=>{const b=control(label,()=>click(b));board.append(b);return b;};
      const mistake=()=>{status.textContent+=' · Ошибка';errors++;};
      function finish(){
        const ms=Math.max(1,Math.round(performance.now()-start));
        board.replaceChildren();actions.replaceChildren();
        status.textContent='Готово · '+(ms/1000).toFixed(1)+' с · ошибок: '+errors;
        actions.append(control('Сыграть ещё',()=>play(key),true));
      }
      if(key==='schulte'){
        status.textContent='Найдите 1';
        for(const n of shuffle(range(25)))tile(String(n+1),b=>{
          if(n!==step){mistake();return;}
          b.disabled=true;if(++step===25)finish();else status.textContent='Найдите '+(step+1);
        });
      }else if(key==='matrix'){
        const targets=new Set(shuffle(range(16)).slice(0,5)),picked=new Set();
        board.classList.add('brain-four');
        for(const i of range(16)){
          const b=tile(' ',()=>{
            if(picked.has(i))picked.delete(i);else picked.add(i);
            b.setAttribute('aria-pressed',String(picked.has(i)));
          });
          b.disabled=true;b.setAttribute('aria-label','Клетка '+(i+1));b.setAttribute('aria-pressed',String(targets.has(i)));
        }
        actions.append(control('Запомнил',()=>{
          for(const b of board.children){b.disabled=false;b.setAttribute('aria-pressed','false');}
          status.textContent='Отметьте пять клеток по памяти';
          actions.replaceChildren(control('Проверить',()=>{
            if(picked.size===5&&[...picked].every(x=>targets.has(x)))finish();else mistake();
          }));
        }));
      }else if(key==='pairs'){
        let first=null,miss=null;
        board.classList.add('brain-four');
        for(const symbol of shuffle([...symbols.slice(0,6),...symbols.slice(0,6)])){
          tile('?',b=>{
            if(miss){for(const card of miss){card.textContent='?';card.disabled=false;}miss=null;}
            b.textContent=symbol;b.disabled=true;
            if(!first){first=b;return;}
            if(first.textContent===symbol){if(++step===6)finish();}
            else{miss=[first,b];mistake();}
            first=null;
          });
        }
      }else{
        function next(){
          board.replaceChildren();status.textContent='Раунд '+(step+1)+' из 5';
          const answer=ok=>{if(!ok){mistake();return;}if(++step===5)finish();else next();};
          if(key==='double'){
            const [common,...rest]=shuffle(symbols);
            status.textContent+=' · '+shuffle([common,...rest.slice(0,4)]).join('  ');
            for(const s of shuffle([common,...rest.slice(4,8)]))tile(s,()=>answer(s===common));
          }else if(key==='odd'){
            const n=10+rand(89),target=rand(20);
            for(const i of range(20))tile(String(i===target?n+(n%10===9?-1:1):n),()=>answer(i===target));
          }else if(key==='sort'){
            const n=10+rand(90);status.textContent+=' · '+n;
            for(const [i,label] of ['Чётное','Нечётное'].entries())tile(label,()=>answer(n%2===i));
          }else{
            const a=2+rand(18),b=2+rand(9),op=rand(3),n=[a+b,a-b,a*b][op];
            status.textContent+=' · '+a+' '+['+','−','×'][op]+' '+b+' = ?';
            for(const v of shuffle([n,n+1,n-2,n+3]))tile(String(v),()=>answer(v===n));
          }
        }
        next();
      }
    }

    document.body.append(dlg);catalog();dlg.showModal();
  };
})();

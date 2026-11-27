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
    dlg.onclose=()=>{stopTimers();dlg.remove();(button.offsetWidth?button:headerMore).focus();};
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
      stopTimers();
      const list=h('div',{class:'brain-list'});
      for(const [key,name,description,mark] of games){
        list.append(h('button',{type:'button',class:'brain-row',onclick:()=>play(key)},
          h('span',{class:'brain-mark','aria-hidden':'true'},mark),
          h('span',{},h('strong',{},name),h('small',{},description)),h('span',{'aria-hidden':'true'},'›')));
      }
      body.replaceChildren(list);
    }
    let timers=[],clock;
    function stopTimers(){for(const timer of timers)clearTimeout(timer);timers=[];clearInterval(clock);}
    function later(fn,ms){timers.push(setTimeout(fn,ms));}
    function play(key,level=1){
      stopTimers();
      const [,name,description]=games.find(g=>g[0]===key);
      const goal=key==='schulte'?25:key==='pairs'?4+level*2:key==='matrix'?3:4+level;
      const head=h('div',{class:'arena-heading'},control('‹ К тренажёрам',catalog),h('span',{},'Уровень '+level));
      const time=h('b',{},'0:00'),accuracy=h('b',{},'0'),score=h('b',{},'0 / '+goal);
      const metric=(label,value)=>h('div',{},h('small',{},label),value);
      const hud=h('div',{class:'arena-hud'},metric('Пройдено',score),metric('Ошибки',accuracy),metric('Время',time));
      const progress=h('progress',{class:'arena-progress',max:goal,value:0,'aria-label':'Ход игры'});
      const status=h('p',{class:'arena-prompt',role:'status'}),board=h('div',{class:'brain-board','data-game':key});
      const actions=h('div',{class:'st-btns'});
      body.replaceChildren(head,h('h3',{class:'arena-title'},name),h('p',{class:'arena-description'},description),hud,progress,status,board,actions);
      const start=performance.now(),symbols=[...'★●▲◆♣♥☀☂♫✿☾⚑'];
      let errors=0,step=0;
      const elapsed=()=>Math.floor((performance.now()-start)/1000);
      clock=setInterval(()=>{const s=elapsed();time.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');},250);
      const range=n=>Array.from({length:n},(_,i)=>i);
      const rand=n=>Math.floor(Math.random()*n);
      const tile=(label,click)=>{const b=control(label,()=>click(b));board.append(b);return b;};
      function mistake(){
        accuracy.textContent=String(++errors);
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)board.animate([{opacity:.55},{opacity:1}],{duration:220});
      }
      function advance(){
        progress.value=++step;score.textContent=step+' / '+goal;
        if(step===goal){finish();return true;}return false;
      }
      function finish(){
        stopTimers();board.replaceChildren();
        status.textContent='Готово · '+elapsed()+' с · ошибок: '+errors;
        actions.replaceChildren(control('Сыграть ещё',()=>play(key,level)));
        if(level<3)actions.append(control('Следующий уровень',()=>play(key,level+1),true));
      }
      if(key==='schulte'){
        const offset=(level-1)*25;
        status.textContent='Найдите '+(offset+1);
        for(const n of shuffle(range(25)))tile(String(offset+n+1),b=>{
          if(n!==step){mistake();return;}
          b.disabled=true;if(!advance())status.textContent='Найдите '+(step+offset+1);
        });
      }else if(key==='matrix'){
        const size=level===3?5:4;
        board.style.gridTemplateColumns='repeat('+size+',1fr)';
        function pattern(){
          const count=3+level+step,targets=new Set(shuffle(range(size*size)).slice(0,count)),picked=new Set();
          board.replaceChildren();actions.replaceChildren();status.textContent='Запомните узор · '+count+' клеток';
          for(const i of range(size*size)){
            const b=tile('',()=>{
              if(picked.has(i))picked.delete(i);else picked.add(i);
              b.setAttribute('aria-pressed',String(picked.has(i)));
            });
            b.disabled=true;b.setAttribute('aria-label','Клетка '+(i+1));b.setAttribute('aria-pressed',String(targets.has(i)));
          }
          later(()=>{
            for(const b of board.children){b.disabled=false;b.setAttribute('aria-pressed','false');}
            status.textContent='Восстановите узор · '+count+' клеток';
            actions.replaceChildren(control('Проверить',()=>{
              if(picked.size===count&&[...picked].every(x=>targets.has(x))){
                if(!advance())pattern();
              }else{
                mistake();actions.replaceChildren();status.textContent='Посмотрите на узор ещё раз';
                for(const [i,b] of [...board.children].entries()){b.disabled=true;b.setAttribute('aria-pressed',String(targets.has(i)));}
                later(()=>{picked.clear();for(const b of board.children){b.disabled=false;b.setAttribute('aria-pressed','false');}
                  status.textContent='Попробуйте ещё раз';actions.append(check);},1600);
              }
            },true));
            const check=actions.firstChild;
          },2500+count*200);
        }
        pattern();
      }else if(key==='pairs'){
        let first=null,locked=true;
        board.classList.add('brain-four');
        const deck=shuffle([...symbols.slice(0,goal),...symbols.slice(0,goal)]);
        status.textContent='Запомните пары · карточки скоро перевернутся';
        function face(b,open){
          b.dataset.face=open?'up':'down';
          b.setAttribute('aria-label','Карточка '+(b.index+1)+(open?' · '+deck[b.index]:' · закрыта'));
        }
        deck.forEach((symbol,index)=>{
          const b=tile('',()=>{
            if(locked||b===first||b.disabled)return;
            face(b,true);
            if(!first){first=b;status.textContent='Выберите вторую карточку';return;}
            const other=first;first=null;
            if(deck[other.index]===symbol){
              for(const card of [other,b]){card.disabled=true;card.dataset.matched='true';}
              if(!advance())status.textContent='Пара найдена';
            }else{
              mistake();locked=true;status.textContent='Разные символы';
              later(()=>{face(b,false);face(other,false);locked=false;status.textContent='Найдите пару';},900);
            }
          });
          b.index=index;
          b.append(h('span',{class:'pair-flip','aria-hidden':'true'},h('span',{class:'pair-front'},symbol),h('span',{class:'pair-back'},'✧')));
          face(b,true);
        });
        function hide(){if(!locked||!actions.firstChild)return;actions.replaceChildren();for(const b of board.children)face(b,false);locked=false;status.textContent='Найдите пару';}
        actions.append(control('Я запомнил',hide,true));later(hide,4000+level*500);
      }else{
        function next(){
          board.replaceChildren();status.textContent='Раунд '+(step+1)+' из '+goal;
          const answer=ok=>{if(!ok){mistake();return;}if(!advance())next();};
          if(key==='double'){
            const [common,...rest]=shuffle(symbols);
            status.textContent+=' · '+shuffle([common,...rest.slice(0,4)]).join('  ');
            for(const s of shuffle([common,...rest.slice(4,8)]))tile(s,()=>answer(s===common));
          }else if(key==='odd'){
            const n=10+rand(89),target=rand(15+level*5);
            for(const i of range(15+level*5))tile(String(i===target?n+(n%10===9?-1:1):n),()=>answer(i===target));
          }else if(key==='sort'){
            const n=10+rand(90);status.textContent+=' · '+n;
            for(const [i,label] of ['Чётное','Нечётное'].entries())tile(label,()=>answer(n%2===i));
          }else{
            const a=2+rand(12*level),b=2+rand(9),op=rand(3),n=[a+b,a-b,a*b][op];
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

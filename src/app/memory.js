(() => {
  const M=window.PlanerMemory, names={word:'Связи',grid:'Световая карта',order:'Монтажная цепочка'};
  const button=document.querySelector('#memoryBtn');
  button.append(icon('bulb',17),h('span',{class:'tm-btn-name'},'Память'));
  const doc='planner-memory';
  const time=t=>new Date(t).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const control=(label,fn,primary=false)=>h('button',{type:'button',class:'tb-btn'+(primary?' primary':''),onclick:fn},label);
  function shuffle(values){
    const out=[...values];
    for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
    return out;
  }
  let opening=false;
  button.onclick=async()=>{
    if(opening || document.querySelector('.memory-dialog'))return;
    opening=true;
    let data;
    try {data=await extraStore.get(doc) || {v:1,custom:[],attempts:[]};
      if(data.v!==1 || !Array.isArray(data.custom)||!Array.isArray(data.attempts))throw Error();
    }catch{toast('Не удалось открыть журнал памяти.');return;}
    finally{opening=false;}
    const dlg=h('dialog',{class:'memory-dialog st-box','aria-label':'Память'});
    const body=h('div',{class:'st-body'});
    let busy=false,mode='word',queue=[],index=0,hits=0,total=0,tab='Занятие';
    const deck=()=>[...M.cards,...data.custom];
    const tabs=h('nav',{class:'st-tabs','aria-label':'Память'});
    function chrome(){
      tabs.replaceChildren(...['Занятие','Мои карточки','Прогресс'].map(label=>{
        const b=control(label,()=>{tab=label;home();});b.setAttribute('aria-pressed',String(tab===label));return b;
      }));
      body.replaceChildren(tabs);
    }
    async function persist(next){
      if(busy)return false;
      busy=true;body.inert=true;
      try {await extraStore.set(doc,next);data=next;return true;}
      catch{toast('Не удалось сохранить результат. Повторите попытку.');return false;}
      finally{busy=false;body.inert=false;}
    }
    function home(){
      chrome();
      if(tab==='Мои карточки'){library();return;}
      if(tab==='Прогресс'){progress();return;}
      const modes=h('div',{class:'st-btns'},Object.entries(names).map(([k,name])=>{
        const b=control(name,()=>{mode=k;home();});b.setAttribute('aria-pressed',String(mode===k));return b;
      }));
      const p=M.plan(deck().filter(c=>c.kind===mode),data.attempts,Date.now());
      body.append(modes,h('p',{},({word:'Вспомните ответ по вопросу. Добавляйте материал, который нужен вам в работе.',grid:'Запомните расположение огней, затем восстановите карту по её названию.',order:'Посмотрите раскадровку и соберите кадры в том же порядке по памяти.'})[mode]),
        h('p',{class:'st-note'},'К повторению: '+p.due.length+' · Новых: '+p.fresh.length));
      if(p.due.length || p.fresh.length)body.append(control('Начать занятие',()=>{
        const review=p.due.slice(0,6),fresh=shuffle(p.fresh).slice(0,Math.min(3,6-review.length));
        queue=[...fresh.map(c=>({c,study:true})),...[...review,...fresh].map(c=>({c,study:false}))];
        index=hits=0;total=review.length+fresh.length;round();
      },true));
      else if(Number.isFinite(p.next))body.append(h('p',{},'Следующее повторение — '+time(p.next)));
    }
    function library(){
      const question=h('input',{maxlength:240,required:true,'aria-label':'Вопрос',placeholder:'Что хотите запомнить?'});
      const answer=h('input',{maxlength:240,required:true,'aria-label':'Ответ',placeholder:'Короткий ответ'});
      body.append(h('form',{class:'memory-fields',onsubmit:async e=>{
        e.preventDefault();const cue=question.value.trim(),value=answer.value.trim();if(!cue||!value||!value.split('|').every(x=>x.trim()))return;
        if(await persist({...data,custom:[...data.custom,{id:newId(),kind:'word',cue,answer:value}]})){home();toast('Карточка добавлена в «Связи»');}
      }},h('label',{},'Вопрос',question),h('label',{},'Ответ',answer),h('small',{},'Допустимые варианты можно разделить знаком |.'),
      h('button',{type:'submit',class:'tb-btn primary'},'Добавить карточку')));
      for(const c of data.custom)body.append(h('p',{},c.cue));
    }
    function progress(){
      const now=Date.now(),note=(label,m)=>h('div',{class:'mem-stat'},h('b',{},m.total?Math.round(100*m.right/m.total)+'%':'—'),h('span',{},label),h('small',{},m.right+' из '+m.total+' попыток'));
      body.append(h('h3',{},'Что удалось вспомнить после перерыва'),
        h('p',{class:'st-note'},'Учитываются ответы до показа подсказки. Пропуск с открытием ответа считается ошибкой.'),
        h('div',{class:'mem-stats'},note('Спустя сутки и более',M.metric(data.attempts,M.day,0,now+1)),note('Спустя неделю и более',M.metric(data.attempts,7*M.day,0,now+1))),
        h('h3',{},'Ответы после суток · по неделям'));
      for(let i=3;i>=0;i--){
        const end=now+1-i*7*M.day,start=end-7*M.day,m=M.metric(data.attempts,M.day,start,end);
        body.append(h('div',{class:'mem-week'},new Date(start).toLocaleDateString('ru',{day:'numeric',month:'short'}),
          h('progress',{max:Math.max(1,m.total),value:m.right,'aria-label':'Верно из '+m.total}),m.total?m.right+' / '+m.total:'Нет проверок'));
      }
      if(!data.attempts.some(a=>a.gap>=M.day))body.append(h('p',{class:'st-note'},'Первая оценка появится после повторения с перерывом хотя бы 24 часа.'));
    }
    function round(){
      body.replaceChildren();
      if(index===queue.length){
        body.append(h('h3',{},'Занятие завершено'),h('p',{},'Верно с первой попытки: '+hits+' из '+total+'.'),control('К расписанию',home,true));return;
      }
      const {c,study}=queue[index];
      body.append(h('p',{class:'st-note'},names[c.kind]+' · '+(study?'Знакомство':'Попытка '+(queue.slice(0,index).filter(x=>!x.study).length+1)+' из '+total)),h('h3',{},c.cue));
      const selected=[];
      let input;
      if(c.kind==='word'){
        if(study)body.append(h('p',{class:'mem-sequence'},c.answer.split('|')[0]));
        else{input=h('input',{class:'mem-input','aria-label':'Ваш ответ',placeholder:'Ваш ответ',autocomplete:'off'});body.append(input);input.focus();}
      }else if(c.kind==='grid'){
        const grid=h('div',{class:'mem-grid','aria-label':'Карта четыре на четыре'});
        for(let i=0;i<16;i++){
          const b=control(String(i+1),()=>{const j=selected.indexOf(i);if(j<0)selected.push(i);else selected.splice(j,1);b.setAttribute('aria-pressed',String(selected.includes(i)));});
          b.disabled=study;b.setAttribute('aria-pressed',String(study&&c.answer.includes(i)));grid.append(b);
        }body.append(grid);
      }else if(study)body.append(h('ol',{},c.answer.map(x=>h('li',{},x))));
      else{
        const line=h('p',{'aria-live':'polite'},'Выберите первый кадр');
        const buttons=h('div',{class:'st-btns'});
        for(const word of shuffle(c.answer)){
          const b=control(word,()=>{selected.push(word);b.disabled=true;line.textContent=selected.join(' → ');});buttons.append(b);
        }
        body.append(line,buttons,control('Собрать заново',round));
      }
      const advance=()=>{index++;round();};
      if(study){body.append(control('Запомнил',advance,true));return;}
      async function grade(skip){
        const attempt=input?input.value:selected;
        if(!skip && !attempt.length){input?.focus();return;}
        const correct=!skip && M.matches(c,attempt);
        const last=data.attempts.filter(a=>a.card===c.id).at(-1);
        const result={id:newId(),card:c.id,...M.schedule(last,correct,Date.now())};
        if(!await persist({...data,attempts:[...data.attempts,result]}))return;
        if(correct)hits++;
        const solution=c.kind==='grid'?c.answer.map(n=>n+1).join(', '):c.kind==='order'?c.answer.join(' → '):c.answer.split('|')[0];
        body.replaceChildren(h('p',{class:'st-note'},c.cue),h('h3',{role:'status'},correct?'Верно':'Запомните ответ'),h('p',{class:'mem-sequence'},solution),
          h('p',{},'Следующая проверка — '+time(result.due)),control('Дальше',advance,true));
        body.querySelector('button').focus();
      }
      body.append(h('div',{class:'st-btns'},control('Проверить',()=>grade(false),true),control('Не помню',()=>grade(true))));
      if(input)input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)grade(false);};
    }
    dlg.append(h('div',{class:'st-head'},h('h2',{},'Память'),h('span',{class:'spacer'}),tool('x','Закрыть',()=>{if(!busy)dlg.close();})),body);
    dlg.oncancel=e=>{if(busy)e.preventDefault();};
    dlg.onclose=()=>{dlg.remove();(button.offsetWidth?button:headerMore).focus();};
    document.body.append(dlg);home();dlg.showModal();
  };
})();

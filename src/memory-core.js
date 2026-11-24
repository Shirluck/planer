/* План занятий и статистика используют фактическое время ответов. */
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.PlanerMemory=factory();
})(globalThis,()=>{
  const hour=3600000, day=24*hour;
  const intervals=[1,3,7,14,30];
  const cards=[];
  function seed(kind, rows){
    rows.forEach(([cue,answer],i)=>cards.push({id:kind+i,kind,cue,answer}));
  }
  seed('word',[
    ['Сколько кадров занимает секунда при 25 fps?','25'],
    ['Как по-английски называется непрозрачность слоя?','opacity'],
    ['Какой параметр слоя в After Effects открывает клавиша S?','scale|масштаб'],
    ['Сколько кадров в половине секунды при 24 fps?','12'],
    ['Как по-английски называется точка привязки слоя?','anchor point'],
    ['Какое соотношение сторон у вертикального видео 1080 × 1920?','9:16']
  ]);
  seed('grid',[
    ['Окна ночного города',[0,5,8]],['Огни на сцене',[1,3,10,14]],
    ['Панели пульта',[4,6,11]],['Свет в мастерской',[0,7,9,13]]
  ]);
  seed('order',[
    ['Тизер кофейни',['Зерно','Пар','Чашка','Вывеска']],
    ['Прогулка по городу',['Мост','Окно','Трамвай','Фонарь']],
    ['Заставка мастерской',['Бумага','Карандаш','Эскиз','Подпись']],
    ['Ролик о поездке',['Билет','Часы','Платформа','Поезд']]
  ]);
  const norm=s=>String(s).trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ');
  function matches(card,attempt){
    if(card.kind==='word')return card.answer.split('|').some(a=>norm(a)===norm(attempt));
    if(attempt.length!==card.answer.length)return false;
    return card.kind==='grid'?card.answer.every(x=>attempt.includes(x)):card.answer.every((x,i)=>attempt[i]===x);
  }
  function schedule(last,correct,now){
    const stage=correct?Math.min((last?.stage||0)+1,intervals.length):0;
    return {at:now,correct,stage,gap:last?Math.max(0,now-last.at):0,due:now+(correct?intervals[stage-1]*day:10*60000)};
  }
  function plan(deck,attempts,now){
    const latest=new Map(attempts.map(a=>[a.card,a]));
    const due=deck.filter(c=>latest.has(c.id)&&latest.get(c.id).due<=now).sort((a,b)=>latest.get(a.id).due-latest.get(b.id).due);
    const fresh=deck.filter(c=>!latest.has(c.id));
    return {due,fresh,next:Math.min(...[...latest.values()].map(x=>x.due).filter(t=>t>now))};
  }
  function metric(attempts,minGap,start,end){
    const samples=attempts.filter(x=>x.gap>=minGap && x.at>=start && x.at<end);
    return {right:samples.filter(x=>x.correct).length,total:samples.length};
  }
  return {cards,matches,schedule,plan,metric,day};
});

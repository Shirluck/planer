const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../../src/memory-core');
test('новый материал, отсроченная попытка и возврат после ошибки',()=>{
  const c=M.cards[0],at=1e12;
  const first={card:c.id,...M.schedule(null,true,at)};
  assert.equal(first.due,at+M.day);
  assert.deepEqual(M.metric([first],M.day,0,Infinity),{right:0,total:0});
  assert.equal(M.plan([c],[first],first.due-1).due.length,0);
  assert.equal(M.plan([c],[first],first.due).due.length,1);
  const retry={card:c.id,...M.schedule(first,false,first.due)};
  assert.equal(retry.due,first.due+600000);
  const immediate=M.schedule(retry,true,retry.due);
  assert.deepEqual(M.metric([first,retry,immediate],M.day,0,Infinity),{right:0,total:1});
  assert.equal(M.metric([retry],7*M.day,0,Infinity).total,0);
});
test('проверка слов, карт и последовательностей',()=>{
  assert.ok(M.matches({kind:'word',answer:'ёлка|ель'},'  Елка '));
  assert.ok(M.matches({kind:'grid',answer:[2,5]},[5,2]));
  assert.equal(M.matches({kind:'order',answer:['А','Б']},['Б','А']),false);
});

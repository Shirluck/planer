const {test,expect}=require('@playwright/test');
const {launch,tmpDataDir,rmDir,closeApp}=require('./helpers');
test('Память открывает только игры и сохраняет старые данные',async()=>{
  const dir=tmpDataDir('memory');
  const {app,page}=await launch(dir);
  try{
    const legacy={v:1,custom:[{id:'old',kind:'word',cue:'Вопрос',answer:'Ответ'}],attempts:[]};
    await page.evaluate(d=>extraStore.set('planner-memory',d),legacy);
    await page.click('#memoryBtn');
    const dialog=page.locator('.memory-dialog');
    await expect(dialog.locator('.brain-row')).toHaveCount(7);
    await expect(dialog.getByText(/Мои карточки|Прогресс|Занятие/)).toHaveCount(0);
    await dialog.getByRole('button',{name:/Матрица/}).click();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>extraStore.get('planner-memory'))).toEqual(legacy);
  }finally{await closeApp(app);rmDir(dir);}
});
test('Мемори: знакомство, переворот, промах, сбор пар и следующий уровень',async()=>{
  const dir=tmpDataDir('memory-pairs');const {app,page}=await launch(dir);
  try{
    await page.click('#memoryBtn');
    await page.getByRole('button',{name:/Мемори/}).click();
    const cards=page.locator('.brain-board button');
    await expect(cards).toHaveCount(12);
    const symbols=await cards.locator('.pair-front').allTextContents();
    await expect(page.locator('[data-face=down]')).toHaveCount(12,{timeout:8000});
    const other=symbols.findIndex(s=>s!==symbols[0]);
    await cards.nth(0).click();await cards.nth(other).click();
    await expect(page.locator('[data-face=down]')).toHaveCount(12);
    for(const symbol of new Set(symbols)){
      for(const i of symbols.keys())if(symbols[i]===symbol)await cards.nth(i).click();
    }
    await expect(page.locator('.arena-prompt')).toContainText('ошибок: 1');
    await page.getByText('Следующий уровень').click();
    await expect(cards).toHaveCount(16);
  }finally{await closeApp(app);rmDir(dir);}
});

const {test,expect}=require('@playwright/test');
const {launch,tmpDataDir,rmDir,closeApp}=require('./helpers');
test('личная карточка, отсроченная проверка и журнал после перезапуска',async()=>{
  const dir=tmpDataDir('memory');let {app,page}=await launch(dir);
  try{
    await page.locator('#memoryBtn').click();
    const dialog=page.locator('.memory-dialog');
    await dialog.getByText('Мои карточки',{exact:true}).click();
    await dialog.getByLabel('Вопрос').fill('Мой термин');await dialog.getByLabel('Ответ',{exact:true}).fill('ёлка|ель');
    await dialog.getByText('Добавить карточку').click();await expect(dialog.getByText('Мой термин')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(async()=>{
      const d=await extraStore.get('planner-memory'),at=Date.now()-8*PlanerMemory.day;
      d.attempts.push({id:newId(),card:d.custom[0].id,at,due:at+PlanerMemory.day,stage:1,correct:true,gap:0});
      await extraStore.set('planner-memory',d);
    });
    await page.locator('#memoryBtn').click();
    await dialog.getByText('Начать занятие').click();
    for(let i=0;i<3;i++)await dialog.getByText('Запомнил').click();
    await expect(dialog.getByText('Мой термин')).toBeVisible();
    await dialog.getByLabel('Ваш ответ').fill('Елка');await dialog.getByLabel('Ваш ответ').press('Enter');
    await expect(dialog.getByRole('status')).toHaveText('Верно');
    await closeApp(app);({app,page}=await launch(dir));
    await page.locator('#memoryBtn').click();const reopened=page.locator('.memory-dialog');
    await reopened.getByText('Прогресс',{exact:true}).click();
    await expect(reopened.locator('.mem-stat').last()).toContainText('1 из 1');
    await reopened.screenshot({path:'tests/screens/memory-progress.png'});
  }finally{await closeApp(app);rmDir(dir);}
});
test('карта и монтажная цепочка принимают ответ и показывают разбор',async()=>{
  const dir=tmpDataDir('memory-games');const {app,page}=await launch(dir);
  try{
    for(const name of ['Световая карта','Монтажная цепочка']){
      await page.locator('#memoryBtn').click();const d=page.locator('.memory-dialog');
      await d.getByText(name,{exact:true}).click();await d.getByText('Начать занятие').click();
      for(let i=0;i<3;i++)await d.getByText('Запомнил').click();
      if(name==='Световая карта')await d.locator('.mem-grid button').first().click();
      else await d.locator('.st-btns button').first().click();
      await d.getByText('Проверить',{exact:true}).click();await expect(d.getByRole('status')).toHaveText('Запомните ответ');
      await page.keyboard.press('Escape');
    }
  }finally{await closeApp(app);rmDir(dir);}
});

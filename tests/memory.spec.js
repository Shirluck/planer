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

const {test,expect}=require('@playwright/test');
const {launch,tmpDataDir,rmDir,closeApp}=require('./helpers');
test('каталог тренажёров и завершение таблицы Шульте',async()=>{
  const dir=tmpDataDir('brain-catalog');
  const {app,page}=await launch(dir);
  try{
    await expect(page.locator('#toolsBtn')).toHaveCount(0);
    await page.click('#memoryBtn');
    const dialog=page.locator('.memory-dialog');
    await expect(dialog.locator('.brain-row')).toHaveCount(7);
    await dialog.getByRole('button',{name:/Таблица Шульте/}).click();
    for(let i=1;i<=25;i++)await dialog.getByRole('button',{name:String(i),exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('ошибок: 0');
    await dialog.getByText('К тренажёрам',{exact:false}).click();
    await expect(dialog.locator('.brain-row')).toHaveCount(7);
  }finally{await closeApp(app);rmDir(dir);}
});

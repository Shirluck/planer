const {test,expect}=require('@playwright/test');
const {launch,tmpDataDir,rmDir,closeApp,DOC}=require('./helpers');

test('три статьи на день, сохранение, новый день и недоступная лента',async()=>{
  const dir=tmpDataDir('development');
  const {app,page}=await launch(dir,{size:[1280,800]});
  try{
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('development:feed');
      global.feedCalls=[];
      ipcMain.handle('development:feed',(_,key)=>{
        global.feedCalls.push(key);
        if(global.offlineScience && key==='science')throw Error('Нет сети');
        if(key==='behance')return '<rss><channel>'+Array.from({length:6},(_,i)=>'<item><title>Проект '+i+'</title><link>https://www.behance.net/gallery/'+(i+1)+'/Test</link><description>Работа</description></item>').join('')+'</channel></rss>';
        const base={design:10,science:20,trend:30}[key];
        return '<rss><channel>'+[base,base+1].map(n=>'<item><title>Материал '+n+'</title><link>https://habr.com/ru/articles/'+n+'/</link><description><![CDATA[<p>Содержание</p>]]></description></item>').join('')+'</channel></rss>';
      });
    });
    await expect(page.locator('#developmentBtn')).toHaveCount(1);
    await expect(page.locator('#developmentBtn svg')).toHaveCount(1);
    const open=()=>page.click('#developmentBtn');
    const cards=page.locator('.dev-card h3');
    await open();
    await expect(cards).toHaveText(['Материал 10','Материал 20','Материал 30']);
    await page.keyboard.press('Escape');await open();
    await expect(cards).toHaveCount(3);
    await expect(page.locator('.dev-project')).toHaveCount(3);
    expect(await app.evaluate(()=>global.feedCalls.length)).toBe(4);
    await page.keyboard.press('Escape');
    await page.evaluate(async path=>{
      const h=await electronAPI.dbGet(path);
      await electronAPI.dbSet(path,{[addDays(todayKey(),-1)]:h[todayKey()]});
    },DOC('planner-development'));
    await app.evaluate(()=>{global.offlineScience=true;});
    await open();
    await expect(cards).toHaveText(['Материал 11','Материал 20','Материал 31']);
    await expect(page.getByText(/Сохранено за/)).toBeVisible();
    await app.evaluate(()=>{global.offlineScience=false;});
    await page.getByText('Попробовать ещё раз').click();
    await expect(cards).toHaveText(['Материал 11','Материал 21','Материал 31']);
    expect(await app.evaluate(()=>global.feedCalls.length)).toBe(9);
  }finally{await closeApp(app);rmDir(dir);}
});

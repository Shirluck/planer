const {test,expect}=require('@playwright/test');
const {tmpDataDir,rmDir,launch,closeApp}=require('./helpers');

test('бессрочная задача видна один раз, переносится мышью между секциями',async()=>{
  const dir=tmpDataDir('undated');
  const {app,page}=await launch(dir,{size:[1280,800]});
  try {
    const input=page.getByRole('textbox',{name:'Новая задача без срока',exact:true});
    await input.fill('Когда-нибудь !!!');await input.press('Enter');
    const backlog=page.locator('.undated-list'), today=page.locator('.list[data-key=day]');
    await expect(backlog.locator('.txt')).toHaveValue('Когда-нибудь');
    for(let i=0;i<2;i++){
      await expect(page.locator('.wk-day')).toHaveCount(7);
      await expect(page.locator('.wk-task')).toHaveCount(0);
      await page.locator('.col[data-key=week] .col-tools button').first().click();
    }
    async function drag(from,to){
      const a=await from.locator('.txt').boundingBox(), b=await to.boundingBox();
      await page.mouse.move(a.x+10,a.y+8);await page.mouse.down();
      await page.mouse.move(b.x+b.width/2,b.y+b.height-8,{steps:20});await page.mouse.up();
    }
    await drag(backlog,today);await expect(today.locator('.item')).toHaveCount(1);
    await drag(today,backlog);await expect(backlog.locator('.item')).toHaveCount(1);
    await expect(page.locator('.wk-task')).toHaveCount(0);
  }finally{await closeApp(app);rmDir(dir);}
});

test('порядок столбцов после перетаскивания и перезапуска',async()=>{
  const dir=tmpDataDir('column-order');
  let {app,page}=await launch(dir,{size:[1280,800]});
  try {
    const first=page.locator('#board > .col').first();
    await expect(first).toHaveAttribute('data-key','day');
    await page.locator('.col[data-key=week] .col-title').dragTo(first,{targetPosition:{x:12,y:25}});
    await expect(first).toHaveAttribute('data-key','week');
    await closeApp(app);
    ({app,page}=await launch(dir));
    await expect(page.locator('#board > .col').first()).toHaveAttribute('data-key','week');
  }finally{await closeApp(app);rmDir(dir);}
});

test('компактная шапка и сворачивание списка без срока',async()=>{
  const dir=tmpDataDir('compact-layout');
  const {app,page}=await launch(dir,{size:[760,560]});
  try {
    await expect(page.locator('#headerMore')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#headerMore').click();
    await page.locator('.menu-it').getByText('Добавить столбец',{exact:true}).click();
    await expect(page.locator('.column-compose')).toBeVisible();
    await page.keyboard.press('Escape');
    const input=page.getByRole('textbox',{name:'Новая задача без срока',exact:true});
    await input.fill('Потом');await input.press('Enter');
    const toggle=page.locator('.undated-toggle');
    await toggle.click();await expect(page.locator('.undated-list')).toBeHidden();
    await toggle.click();await expect(page.locator('.undated-list .txt')).toHaveValue('Потом');
  }finally{await closeApp(app);rmDir(dir);}
});

async page => {
  const base='.superpowers/brainstorm/49-1789040875/';
  await page.reload();
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('[data-screen="preparation"]').click();
  await page.locator('[data-step="2"]').first().click();
  const alignment=await page.locator('.team-pane').evaluateAll(panels=>panels.map(panel=>{
    const headings=[...panel.querySelectorAll('.member-columns>span')];
    const cells=[...panel.querySelectorAll('.member-row:first-child>div')];
    return {caption:headings[0].textContent,nameDelta:Math.abs(headings[1].getBoundingClientRect().x-cells[0].getBoundingClientRect().x),goldDelta:Math.abs(headings[2].getBoundingClientRect().x-cells[1].getBoundingClientRect().x)};
  }));
  if(alignment.some(x=>x.caption!=='Avatar'||x.nameDelta>2||x.goldDelta>2))throw Error('Table alignment failed: '+JSON.stringify(alignment));
  await page.screenshot({path:base+'review-teams.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const languageWidth=await page.locator('#language').evaluate(el=>el.getBoundingClientRect().width);
  if(languageWidth<90)throw Error('Language selector too narrow');
  if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Mobile overflow');
  await page.screenshot({path:base+'review-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:base+'review-laptop.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#language').selectOption('en');
  await page.screenshot({path:base+'review-english.png',fullPage:true});
  await page.locator('[data-screen="catalog"]').click();
  await page.screenshot({path:base+'review-catalog.png',fullPage:true});
  await page.locator('[data-screen="battlefields"]').click();
  await page.locator('[data-edit-battle]').first().click();
  await page.screenshot({path:base+'review-battle-editor.png',fullPage:true});
  await page.locator('[data-app="close-dialog"]').click();
  await page.locator('#language').selectOption('tr');
  await page.locator('[data-screen="home"]').click();
  await page.locator('[data-open-record]').first().click();
  // Ensure a live run with undo history exists independent of prior session state.
  if ((await page.locator('[data-app="undo-run"]').count()) === 0) {
    await page.locator('[data-screen="preparation"]').click();
    await page.locator('[data-step="3"]').first().click();
    await page.locator('[data-action="start"]').click();
  }
  if ((await page.locator('[data-app="undo-run"]').count()) === 0) throw Error('Live run did not open');
  if ((await page.locator('[data-app="undo-run"]').isDisabled())) {
    await page.locator('[data-app="next-candidate"]').click();
    await page.locator('[data-live-contribution][data-team="0"]').first().fill('1');
    await page.locator('[data-confirm-bid="0"]').click();
    await page.locator('[data-app="open-sale"]').click();
    await page.locator('[data-app="confirm-dialog"]').click();
  }
  await page.locator('[data-app="undo-run"]').click();
  await page.setViewportSize({width:1280,height:900});
  if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Live laptop overflow');
  await page.screenshot({path:base+'review-live-laptop.png',fullPage:true});
  await page.setViewportSize({width:1920,height:1080});
  await page.screenshot({path:base+'review-live-large.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('[data-screen="home"]').click();
  return {alignment,languageWidth,mobileOverflow:false,liveLaptopOverflow:false};
}

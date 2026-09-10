async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-layout="a"]').click();
  await page.locator('#sell').click();
  const dialog = await page.locator('#sale-dialog').innerText();
  await page.locator('#cancel-sale').click();
  const cancelled = await page.locator('#sale-dialog').evaluate(el => !el.open);
  await page.locator('#sell').click();
  await page.locator('#confirm-sale').click();
  const sold = await page.locator('.sold-notice').isVisible();
  await page.locator('#undo-sale').click();
  const undone = !(await page.locator('.sold-notice').isVisible());
  const scroll = await page.locator('.members').evaluateAll(els => els.map(el => ({ scrolls: el.scrollHeight > el.clientHeight, height: el.clientHeight })));
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  if (!cancelled || !sold || !undone || !noOverflow || scroll.some(s => !s.scrolls)) throw new Error('Layout verification failed');
  return { dialog, cancelled, sold, undone, scroll, noOverflow };
}

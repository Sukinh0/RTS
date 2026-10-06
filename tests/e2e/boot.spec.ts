import { expect, test } from '@playwright/test';

test('browser loads and navigates the map', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('RTS V1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-ticks'))).toBeGreaterThan(0);
  const canvas = page.locator('#game canvas');
  const beforeZoom = Number(await page.locator('#game').getAttribute('data-zoom'));
  await canvas.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-zoom'))).toBeGreaterThan(beforeZoom);
  const beforePan = await page.locator('#game').getAttribute('data-camera-x');
  await page.keyboard.down('d');
  await expect.poll(async () => page.locator('#game').getAttribute('data-camera-x')).not.toBe(beforePan);
  await page.keyboard.up('d');
  await expect.poll(async () => {
    const status = await page.locator('#team-status').textContent();
    return Number(status?.match(/(\d+) moedas/)?.[1] ?? 0);
  }).toBeGreaterThan(100);
  const afterKeyboard = await page.locator('#game').getAttribute('data-camera-x');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => page.locator('#game').getAttribute('data-camera-x')).not.toBe(afterKeyboard);
});

test('debug mode inspects a cell', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.locator('#game canvas').click({ position: { x: 480, y: 300 } });
  await expect(page.locator('#inspect')).toContainText('Célula');
  await expect(page.locator('#game')).toHaveAttribute('data-cell', /\d+,\d+/);
});

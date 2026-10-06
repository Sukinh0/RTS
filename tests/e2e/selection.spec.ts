import { expect, test, type Page } from '@playwright/test';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await expect(root).toHaveAttribute('data-zoom', /\d/);
  await expect(root).toHaveAttribute('data-camera-x', /-?\d/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const zoom = Number(await root.getAttribute('data-zoom'));
  const scrollX = Number(await root.getAttribute('data-camera-x'));
  const scrollY = Number(await root.getAttribute('data-camera-y'));
  return {
    x: box.x + ((((x + 0.5) * 12 - scrollX - 480) * zoom) + 480) * box.width / 960,
    y: box.y + ((((y + 0.5) * 12 - scrollY - 300) * zoom) + 300) * box.height / 600,
  };
}

test('single click, Shift click, and box selection update the HUD', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#team-status')).toHaveText(/Azul · \d+ moedas · 50 madeira · 2\/60 unidades/);

  const first = await screenCell(page, 25, 99);
  await page.mouse.click(first.x, first.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1');
  await expect(page.locator('#selection-details')).toContainText('Operário · HP 10/10');

  const second = await screenCell(page, 25, 101);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1,blue-worker-2');

  const start = await screenCell(page, 24, 98);
  const end = await screenCell(page, 26, 102);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1,blue-worker-2');
  await expect(page.locator('#selection-count')).toHaveText('2 selecionados');

  const base = await screenCell(page, 21, 101);
  await page.mouse.click(base.x, base.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-base');
  await expect(page.locator('#selection-details')).toContainText('Base · HP 150/150');
});

test('right click orders movement and starts cooldown', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const worker = await screenCell(page, 25, 99);
  await page.mouse.click(worker.x, worker.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1');
  await expect(page.locator('#game')).toHaveAttribute('data-explored-cells', '0');
  await page.evaluate(() => {
    const values: number[] = [];
    const root = document.querySelector('#game')!;
    new MutationObserver(() => {
      const value = root.getAttribute('data-selected-visual-x');
      if (value !== null) values.push(Number(value));
    }).observe(root, { attributes: true, attributeFilter: ['data-selected-visual-x'] });
    (window as Window & { __motionTrace?: number[] }).__motionTrace = values;
  });

  const destination = await screenCell(page, 30, 99);
  await page.mouse.click(destination.x, destination.y, { button: 'right' });
  await expect(page.locator('#command-feedback')).toContainText('1 ordem(ns)');
  await expect(page.locator('#selection-details')).toContainText('(30, 99)');
  await expect(page.locator('#selection-details')).toContainText('cooldown');
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-selected-visual-x'))).toBe(30);
  const visualSamples = await page.evaluate(() => (window as Window & { __motionTrace?: number[] }).__motionTrace ?? []);
  expect(visualSamples.some((x) => x > 25 && x < 30)).toBe(true);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-explored-cells'))).toBeGreaterThan(0);

  const next = await screenCell(page, 35, 99);
  await page.mouse.click(next.x, next.y, { button: 'right' });
  await expect(page.locator('#command-feedback')).toContainText('cooldown');

  const explored = await screenCell(page, 25, 94);
  await page.mouse.click(explored.x, explored.y);
  await expect(page.locator('#inspect')).toContainText('fog explored');
});

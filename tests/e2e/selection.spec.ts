import { expect, test, type Page } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await expect(root).toHaveAttribute('data-zoom', /\d/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  // Phaser camera.scrollX/Y do not equal the world coordinates at the screen
  // top-left when zoomed. Ask Phaser for the world point under canvas center,
  // then map the target using zoom and canvas dimensions. No evaluate() needed.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root).toHaveAttribute('data-pointer-world', /,/);
  const [worldX, worldY] = (await root.getAttribute('data-pointer-world'))!.split(',').map(Number);
  const zoom = Number(await root.getAttribute('data-zoom'));
  const backingWidth = Number(await canvas.getAttribute('width'));
  const backingHeight = Number(await canvas.getAttribute('height'));
  if (!zoom || !backingWidth || !backingHeight) throw new Error('Invalid Phaser canvas geometry');
  return {
    x: box.x + box.width / 2 + ((x + 0.5) * 12 - worldX) * zoom * box.width / backingWidth,
    y: box.y + box.height / 2 + ((y + 0.5) * 12 - worldY) * zoom * box.height / backingHeight,
  };
}

test('single click, Shift click, and box selection update the HUD', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#team-status')).toHaveText(/Azul · \d+ moedas · 50 madeira · 0 pedra · 2\/60 unidades/);

  const first = await screenCell(page, 25, 99);
  await page.mouse.click(first.x, first.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1');
  await expect(page.locator('#selection-count')).toHaveText('Operário');
  await expect(page.locator('#selection-details')).toContainText('HP 10/10');
  await expect(page.locator('#selection-count')).toHaveAttribute('data-tooltip-description', /dano 4; alcance 1/i);

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
  await expect(page.locator('#selection-count')).toHaveText('Operário ×2');

  const base = await screenCell(page, 21, 101);
  await page.mouse.click(base.x, base.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-base');
  await expect(page.locator('#selection-count')).toHaveText('Base');
  await expect(page.locator('#selection-details')).toContainText('HP 150/150');
});

test('right click orders movement and starts cooldown', async ({ page }) => {
  await page.goto('/?debug=1&noai=1');
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
  await expect(page.locator('#selection-details')).toContainText(/Movendo|Parado/);
  await expect(page.locator('#selection-details')).not.toContainText('(30, 99)');
  // The logical unit reaches the exact cell; the rendered sprite interpolates
  // toward the endpoint and can settle at 29.92 with subpixel smoothing.
  await expect.poll(async () => page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation!;
    const unit = sim.entities.get('blue-worker-1');
    return unit?.category === 'unit' ? unit.x : null;
  })).toBe(30);
  await expect.poll(async () => {
    const rendered = Number(await page.locator('#game').getAttribute('data-selected-visual-x'));
    return Math.abs(rendered - 30) <= 0.1;
  }).toBe(true);
  const visualSamples = await page.evaluate(() => (window as Window & { __motionTrace?: number[] }).__motionTrace ?? []);
  expect(visualSamples.some((x) => x > 25 && x < 30)).toBe(true);
  await expect(page.locator('#game')).toHaveAttribute('data-explored-cells', '0');

  const next = await screenCell(page, 35, 99);
  await page.mouse.click(next.x, next.y, { button: 'right' });
  await expect(page.locator('#command-feedback')).toContainText('1 ordem(ns)');

  const nearby = await screenCell(page, 25, 94);
  await page.mouse.click(nearby.x, nearby.y);
  await expect(page.locator('#inspect')).toContainText('fog visible');
});

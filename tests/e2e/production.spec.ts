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

test('worker can build a house and the house can produce an operative', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: { teams: { blue: { coins: number; wood: number } } } }).__simulation;
    if (sim) {
      sim.teams.blue.coins = 1000;
      sim.teams.blue.wood = 1000;
    }
  });

  // Select blue worker 1 at (25, 99)
  const workerPos = await screenCell(page, 25, 99);
  await page.mouse.click(workerPos.x, workerPos.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1');

  // Action bar buttons should be visible for worker
  const buildHouseBtn = page.locator('#btn-build-house');
  await expect(buildHouseBtn).toBeVisible();

  // Click build house to enter placement mode
  await buildHouseBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('posicionar a Casa');

  // Place house at valid open spot (24, 96)
  const buildSpot = await screenCell(page, 24, 96);
  await page.mouse.click(buildSpot.x, buildSpot.y);
  await expect(page.locator('#command-feedback')).toContainText('Construção de Casa iniciada');

  // Select the house
  const houseSpot = await screenCell(page, 24, 96);
  await page.mouse.click(houseSpot.x, houseSpot.y);
  await expect(page.locator('#selection-details')).toContainText('Casa');

  // Wait for construction to finish (8 seconds build time)
  await expect.poll(async () => {
    return page.locator('#btn-produce-worker').isVisible();
  }, { timeout: 20_000 }).toBe(true);

  // Queue training of an operative
  const trainBtn = page.locator('#btn-produce-worker');
  await trainBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('Operário adicionado à fila');

  // Unit count should increase from 2 to 3 after production finishes (6 seconds)
  await expect.poll(async () => {
    const text = await page.locator('#team-status').textContent();
    return text?.includes('3/60 unidades');
  }, { timeout: 20_000 }).toBe(true);
});

test('base does not produce units and requires house to train workers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Select blue base at (21, 101)
  const basePos = await screenCell(page, 21, 101);
  await page.mouse.click(basePos.x, basePos.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-base');

  // Train worker button must NOT be visible on base
  const trainBtn = page.locator('#btn-produce-worker');
  await expect(trainBtn).not.toBeVisible();
});


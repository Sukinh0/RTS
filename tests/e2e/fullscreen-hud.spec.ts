import { expect, test, type Page } from '@playwright/test';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root).toHaveAttribute('data-pointer-world', /,/);
  const pointerWorld = (await root.getAttribute('data-pointer-world'))!.split(',').map(Number);
  const zoom = Number(await root.getAttribute('data-zoom'));
  const backing = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  return {
    x: box.x + box.width / 2 + ((x + 0.5) * 12 - pointerWorld[0]) * zoom * box.width / backing.width,
    y: box.y + box.height / 2 + ((y + 0.5) * 12 - pointerWorld[1]) * zoom * box.height / backing.height,
  };
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  test(`full-width command dock fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?noai=1');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
    const bounds = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!.getBoundingClientRect();
      const bottom = document.querySelector('#bottom-command-hud')!.getBoundingClientRect();
      const top = document.querySelector('.top-hud')!.getBoundingClientRect();
      const game = document.querySelector('#game')!.getBoundingClientRect();
      return { canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height }, game: { x: game.x, y: game.y, width: game.width, height: game.height }, margin: getComputedStyle(document.body).margin, bottom: { x: bottom.x, y: bottom.y, right: bottom.right, bottom: bottom.bottom, width: bottom.width }, top: { x: top.x, y: top.y, right: top.right } };
    });
    expect(bounds.canvas, JSON.stringify(bounds)).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    expect(bounds.bottom.x).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom.bottom).toBeLessThanOrEqual(viewport.height);
    expect(bounds.bottom.x).toBe(0);
    expect(bounds.bottom.width, `Command dock should span the viewport: ${bounds.bottom.width}px`).toBe(viewport.width);
    expect(bounds.top.x).toBeGreaterThanOrEqual(0);
    expect(bounds.top.right).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `artifacts/fullscreen-hud-${viewport.width}x${viewport.height}.png` });
  });
}

test('contextual HUD stays compact across selection states at 1920x1080', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-empty.png' });

  const firstWorker = await screenCell(page, 25, 99);
  await page.mouse.click(firstWorker.x, firstWorker.y);
  await expect(page.locator('#selection-count')).toHaveText('Operário');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-one-worker.png' });
  const secondWorker = await screenCell(page, 25, 101);
  await page.keyboard.down('Shift');
  await page.mouse.click(secondWorker.x, secondWorker.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('Operário ×2');
  await expect(page.locator('#selection-status')).toBeEmpty();
  await page.locator('#btn-build-house').hover();
  await expect(page.locator('#game-tooltip strong')).toHaveText('Casa');
  await expect(page.locator('#game-tooltip span')).toContainText(/Custa ✦ 150 · ▰ 100/);
  await expect(page.locator('#game-tooltip span')).toContainText(/construção.*s/i);
  await page.mouse.move(900, 480);
  const workerHudWidth = await page.locator('#bottom-command-hud').evaluate((element) => element.getBoundingClientRect().width);
  expect(workerHudWidth).toBe(1920);
  await page.screenshot({ path: 'artifacts/hud-simple-1920-two-workers.png' });

  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: { entities: { spawnUnit: (team: 'blue', kind: 'soldier' | 'archer' | 'builder', x: number, y: number) => unknown; createBuilding: (team: 'blue', kind: 'barracks', x: number, y: number, completed?: boolean) => unknown }; fog: { update: () => void } } }).__simulation!;
    simulation.entities.spawnUnit('blue', 'soldier', 48, 100);
    simulation.entities.spawnUnit('blue', 'archer', 49, 100);
    simulation.entities.spawnUnit('blue', 'builder', 54, 100);
    simulation.entities.createBuilding('blue', 'barracks', 35, 96, true);
    simulation.fog.update();
  });
  const soldier = await screenCell(page, 48, 100);
  await page.mouse.click(soldier.x, soldier.y);
  await expect(page.locator('#selection-count')).toHaveText('Soldado');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-soldier.png' });
  const archer = await screenCell(page, 49, 100);
  await page.keyboard.down('Shift');
  await page.mouse.click(archer.x, archer.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('2 unidades');
  await page.locator('#btn-formation-line').click();
  await expect(page.locator('#selection-status')).toContainText('Linha');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-mixed-formation.png' });

  const base = await screenCell(page, 21, 101);
  await page.mouse.click(base.x, base.y);
  await expect(page.locator('#selection-count')).toHaveText('Base');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-base.png' });
  const barracks = await screenCell(page, 36, 97);
  await page.mouse.click(barracks.x, barracks.y);
  await expect(page.locator('#selection-count')).toHaveText('Quartel');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-barracks.png' });
  const builder = await screenCell(page, 54, 100);
  await page.mouse.click(builder.x, builder.y);
  await expect(page.locator('#selection-count')).toHaveText('Construtor');
  await page.screenshot({ path: 'artifacts/hud-simple-1920-builder.png' });
  await page.locator('#btn-toggle-sandbox').click();
  await expect(page.locator('#sandbox-section')).toBeVisible();
  await page.screenshot({ path: 'artifacts/hud-simple-1920-sandbox.png' });
});

test('compact selected HUD fits 1366x768 with workers and a mixed group', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const first = await screenCell(page, 25, 99);
  await page.mouse.click(first.x, first.y);
  const second = await screenCell(page, 25, 101);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('Operário ×2');
  const workerWidth = await page.locator('#bottom-command-hud').evaluate((element) => element.getBoundingClientRect().width);
  expect(workerWidth).toBe(1366);
  await page.screenshot({ path: 'artifacts/hud-simple-1366-two-workers.png' });

  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: { entities: { spawnUnit: (team: 'blue', kind: 'soldier' | 'archer', x: number, y: number) => unknown }; fog: { update: () => void } } }).__simulation!;
    simulation.entities.spawnUnit('blue', 'soldier', 48, 100);
    simulation.entities.spawnUnit('blue', 'archer', 49, 100);
    simulation.fog.update();
  });
  const soldier = await screenCell(page, 48, 100);
  await page.mouse.click(soldier.x, soldier.y);
  const archer = await screenCell(page, 49, 100);
  await page.keyboard.down('Shift');
  await page.mouse.click(archer.x, archer.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('2 unidades');
  await page.screenshot({ path: 'artifacts/hud-simple-1366-mixed-group.png' });
});

test('resource tooltips are reusable, focused and clamped inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const gold = page.locator('#resource-bar .resource-pill').first();
  await gold.focus();
  const tooltip = page.locator('#game-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('strong')).toHaveText('Ouro');
  const rect = await tooltip.boundingBox();
  if (!rect) throw new Error('Tooltip is not visible');
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(1366);
  expect(rect.y + rect.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: 'artifacts/fullscreen-hud-resource-tooltip.png' });
});

test('captures selection, troop tooltip, building, and Builder comparison states', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: { entities: { spawnUnit: (team: 'blue', kind: 'soldier', x: number, y: number) => unknown }; fog: { update: () => void } } }).__simulation!;
    simulation.entities.spawnUnit('blue', 'soldier', 28, 100);
    simulation.fog.update();
  });
  const soldier = await screenCell(page, 28, 100);
  await page.mouse.click(soldier.x, soldier.y);
  await expect(page.locator('#selection-count')).toHaveText('Soldado');
  await page.screenshot({ path: 'artifacts/fullscreen-hud-troops-selected.png' });
  await page.mouse.move(soldier.x, soldier.y);
  await expect(page.locator('#game-tooltip')).toBeVisible();
  await expect(page.locator('#game-tooltip strong')).toHaveText('Soldado');
  await page.screenshot({ path: 'artifacts/fullscreen-hud-troop-tooltip.png' });

  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: { entities: { createBuilding: (team: 'blue', kind: 'barracks', x: number, y: number, completed?: boolean) => unknown }; fog: { update: () => void } } }).__simulation!;
    simulation.entities.createBuilding('blue', 'barracks', 35, 96, false);
    simulation.fog.update();
  });
  const barracks = await screenCell(page, 36, 97);
  await page.mouse.click(barracks.x, barracks.y);
  await expect(page.locator('#selection-count')).toHaveText('Quartel');
  await page.screenshot({ path: 'artifacts/fullscreen-hud-barracks-selected.png' });

  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: { entities: { spawnUnit: (team: 'blue', kind: 'builder', x: number, y: number) => unknown }; fog: { update: () => void } } }).__simulation!;
    simulation.entities.spawnUnit('blue', 'builder', 26, 99);
    simulation.fog.update();
  });
  const builder = await screenCell(page, 26, 99);
  await page.mouse.move(builder.x, builder.y);
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, -1000);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-zoom'))).toBeGreaterThan(2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-count')).toHaveText('');
  await expect(page.locator('#game-tooltip strong')).toHaveText('Construtor');
  await page.locator('#game-tooltip').evaluate((element) => { (element as HTMLElement).hidden = true; });
  await page.screenshot({ path: 'artifacts/fullscreen-hud-worker-builder-comparison.png' });

  await page.locator('#btn-toggle-sandbox').click();
  await expect(page.locator('#sandbox-section')).toBeVisible();
  await page.screenshot({ path: 'artifacts/fullscreen-hud-sandbox.png' });
});

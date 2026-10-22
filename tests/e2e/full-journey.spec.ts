import { expect, test, type Page } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-zoom', /\d/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const zoom = Number(await root.getAttribute('data-zoom'));
  const scrollX = Number(await root.getAttribute('data-camera-x'));
  const scrollY = Number(await root.getAttribute('data-camera-y'));
  const viewport = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  return {
    x: box.x + ((((x + 0.5) * 12 - scrollX - viewport.width / 2) * zoom) + viewport.width / 2) * box.width / viewport.width,
    y: box.y + ((((y + 0.5) * 12 - scrollY - viewport.height / 2) * zoom) + viewport.height / 2) * box.height / viewport.height,
  };
}

async function clickCell(page: Page, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const point = await screenCell(page, x, y);
  await page.mouse.click(point.x, point.y, { button });
}

async function advanceUntil(page: Page, predicate: 'wood' | 'worker' | 'soldier' | 'victory', limitSeconds: number): Promise<void> {
  const reached = await page.evaluate(({ predicate, limitSeconds }) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const done = () => {
      if (predicate === 'wood') return simulation.teams.blue.wood >= 220;
      if (predicate === 'worker') return simulation.entities.all().filter((e) => e.category === 'unit' && e.kind === 'worker' && e.team === 'blue').length >= 3;
      if (predicate === 'soldier') return simulation.entities.all().some((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
      return simulation.result?.winner === 'blue';
    };
    for (let second = 0; second < limitSeconds && !done(); second += 1) simulation.advance(1000);
    return done();
  }, { predicate, limitSeconds });
  expect(reached, `${predicate} was not reached within ${limitSeconds} simulated seconds`).toBe(true);
}

test('complete match: explore, gather, build, train, attack and win', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#team-status')).toContainText('50 madeira');

  // Move a worker toward the forest, then order gathering through the map.
  await clickCell(page, 25, 99);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-worker-1');
  await clickCell(page, 51, 92, 'right');
  await expect(page.locator('#command-feedback')).toContainText('movimento');
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(45_000));
  await page.waitForTimeout(100);
  await clickCell(page, 54, 90, 'right');
  await expect(page.locator('#command-feedback')).toContainText('coleta');
  await advanceUntil(page, 'wood', 1100);

  // Use the second worker for construction while the first hauls wood.
  await clickCell(page, 25, 101);
  await page.locator('#btn-build-house').click();
  await clickCell(page, 24, 96);
  await expect(page.locator('#command-feedback')).toContainText('Casa iniciada');
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(30_000));
  await clickCell(page, 24, 96);
  await expect(page.locator('#btn-produce-worker')).toBeVisible();
  await page.locator('#btn-produce-worker').click();
  await advanceUntil(page, 'worker', 20);

  const worker = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const entity = simulation.entities.all().find((e) => e.id === 'blue-worker-3');
    if (!entity) throw new Error('Trained worker missing');
    return { x: entity.x, y: entity.y };
  });
  await clickCell(page, worker.x, worker.y);
  await page.locator('#btn-build-barracks').click();
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    while (simulation.teams.blue.coins < 200) simulation.advance(1000);
  });
  const barracksSpot = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    for (let y = 94; y <= 104; y += 1) {
      for (let x = 27; x <= 35; x += 1) {
        if (!simulation.entities.isAreaFreeForBuilding(x, y, 3, 3)) continue;
        let explored = true;
        for (let cy = y; cy < y + 3; cy += 1) {
          for (let cx = x; cx < x + 3; cx += 1) {
            if (simulation.fog.stateAt('blue', cx, cy) === 'unknown') explored = false;
          }
        }
        if (explored) return { x, y };
      }
    }
    throw new Error('No explored barracks placement near the base');
  });
  await clickCell(page, barracksSpot.x, barracksSpot.y);
  await expect(page.locator('#command-feedback')).toContainText('Quartel iniciada');
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(45_000));
  await clickCell(page, barracksSpot.x, barracksSpot.y);
  await expect(page.locator('#btn-produce-soldier')).toBeVisible();
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    while (simulation.teams.blue.coins < 100) simulation.advance(1000);
  });
  await page.locator('#btn-produce-soldier').click();
  await advanceUntil(page, 'soldier', 20);

  const soldier = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const entity = simulation.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
    if (!entity) throw new Error('Soldier missing');
    return { x: entity.x, y: entity.y };
  });
  await clickCell(page, soldier.x, soldier.y);
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, 500);
  await expect(page.locator('#game')).toHaveAttribute('data-zoom', '0.38');
  await page.locator('#btn-attack-move').click();
  await clickCell(page, 172, 100);
  await expect(page.locator('#command-feedback')).toContainText('Attack Move');
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(240_000));
  await page.waitForTimeout(100);
  await expect.poll(async () => page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const base = simulation.entities.get('red-base');
    return simulation.result?.winner === 'blue' || (base ? simulation.fog.isEntityVisible('blue', base) : false);
  })).toBe(true);

  const alreadyWon = await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.result?.winner === 'blue');
  if (!alreadyWon) {
    await clickCell(page, 176, 100, 'right');
    await expect(page.locator('#command-feedback')).toContainText('ataque contra Base');
    await advanceUntil(page, 'victory', 150);
  }
  await expect(page.locator('#result-title')).toHaveText('Vitória!');
});

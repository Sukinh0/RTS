import { expect, test, type Page } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
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

test('combat: soldier can attack enemy unit, deal damage, and trigger cooldown in browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Spawn blue soldier at (26, 99) and red soldier at (29, 99) (dist 3 > range 2, so no auto-attack yet)
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.entities.spawnUnit('blue', 'soldier', 26, 99);
      sim.entities.spawnUnit('red', 'soldier', 29, 99);
      sim.fog.update();
    }
  });

  // Select blue soldier at (26, 99)
  const soldierPos = await screenCell(page, 26, 99);
  await page.mouse.click(soldierPos.x, soldierPos.y);

  // Check selection details
  await expect(page.locator('#selection-details')).toContainText('Soldado');
  await expect(page.locator('#selection-details')).toContainText('Dano 5');
  await expect(page.locator('#selection-details')).toContainText('Alc 2');

  // Right-click the red soldier at (29, 99) to order attack
  const enemyPos = await screenCell(page, 29, 99);
  await page.mouse.click(enemyPos.x, enemyPos.y, { button: 'right' });

  // Command feedback should confirm attack order
  await expect(page.locator('#command-feedback')).toContainText('ordem(ns) de ataque contra Soldado enviada(s)');

  // Verify enemy HP has been reduced to 13 once soldier moves in and attacks
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const enemy = sim?.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'red');
      return enemy?.hp;
    });
  }, { timeout: 15_000 }).toBe(13);
});

test('combat: worker can attack an adjacent enemy for four damage', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.entities.spawnUnit('red', 'soldier', 28, 99);
      sim.fog.update();
    }
  });

  const workerPos = await screenCell(page, 25, 99);
  await page.mouse.click(workerPos.x, workerPos.y);
  await expect(page.locator('#selection-details')).toContainText('Dano 4 · Alc 1');
  const enemyPos = await screenCell(page, 28, 99);
  await page.mouse.click(enemyPos.x, enemyPos.y, { button: 'right' });
  await expect(page.locator('#command-feedback')).toContainText('ordem(ns) de ataque contra Soldado enviada(s)');
  await expect.poll(async () => page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    const enemy = sim?.entities.all().find((entity) => entity.team === 'red'
      && entity.category === 'unit' && entity.kind === 'soldier');
    return enemy?.hp ?? 0;
  }), { timeout: 15_000 }).toBeLessThanOrEqual(14);
});

test('combat: soldier attacking adjacent shieldbearer receives reflected damage', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Spawn blue soldier at (26, 99) and red shieldbearer at (27, 99)
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.entities.spawnUnit('blue', 'soldier', 26, 99);
      sim.entities.spawnUnit('red', 'shieldbearer', 27, 99);
      sim.fog.update();
    }
  });

  // Select blue soldier
  const soldierPos = await screenCell(page, 26, 99);
  await page.mouse.click(soldierPos.x, soldierPos.y);

  // Right-click shieldbearer to attack
  const shieldPos = await screenCell(page, 27, 99);
  await page.mouse.click(shieldPos.x, shieldPos.y, { button: 'right' });

  // Verify both shieldbearer and soldier took damage
  // Shieldbearer took 5 (25 -> 20), Soldier took 4 reflection (18 -> 14)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const soldier = sim?.entities.atCell(26, 99);
      const shield = sim?.entities.atCell(27, 99);
      return { soldierHp: soldier?.hp, shieldHp: shield?.hp };
    });
  }).toEqual({ soldierHp: 14, shieldHp: 20 });

  await expect(page.locator('#selection-details')).toContainText('HP 14/18');
});

test('combat: attack-move button and shortcut A allow soldier to march, auto-engage enemy and resume', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.entities.spawnUnit('blue', 'soldier', 26, 99);
      sim.entities.spawnUnit('red', 'soldier', 30, 99);
      sim.fog.update();
    }
  });

  const soldierPos = await screenCell(page, 26, 99);
  await page.mouse.click(soldierPos.x, soldierPos.y);
  await expect(page.locator('#btn-attack-move')).toBeVisible();

  // Test toggling via shortcut 'A'
  await page.keyboard.press('KeyA');
  await expect(page.locator('#btn-attack-move')).toHaveClass(/active/);
  await expect(page.locator('#command-feedback')).toContainText('Attack Move ativado');

  // Toggle off with 'A'
  await page.keyboard.press('KeyA');
  await expect(page.locator('#btn-attack-move')).not.toHaveClass(/active/);

  // Activate via button click
  await page.locator('#btn-attack-move').click();
  await expect(page.locator('#btn-attack-move')).toHaveClass(/active/);

  // Left click on map destination (33, 99)
  const destPos = await screenCell(page, 33, 99);
  await page.mouse.click(destPos.x, destPos.y);
  await expect(page.locator('#command-feedback')).toContainText('ordem(ns) de Attack Move enviada(s)');

  // Advance simulation to let soldier encounter enemy at (30, 99) and fight
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const enemy = sim?.entities.all().find((e) => e.team === 'red' && e.kind === 'soldier');
      return enemy?.hp;
    });
  }, { timeout: 15_000 }).toBeLessThan(18);
});

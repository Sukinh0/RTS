import { expect, test, type Page } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';
import type { GameEntity } from '../../src/core/entities/EntityStore';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await expect(root).toHaveAttribute('data-zoom', /\d/);
  await expect(root).toHaveAttribute('data-camera-x', /-?\d/);
  await expect(root).toHaveAttribute('data-camera-y', /-?\d/);
  // Use Phaser's exposed camera measurements instead of forcing a mousemove
  // and canvas JS evaluation. The latter blocks under CI software rendering.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const zoom = Number(await root.getAttribute('data-zoom'));
  const cameraX = Number(await root.getAttribute('data-camera-x'));
  const cameraY = Number(await root.getAttribute('data-camera-y'));
  const backingWidth = Number(await canvas.getAttribute('width'));
  const backingHeight = Number(await canvas.getAttribute('height'));
  if (!zoom || !backingWidth || !backingHeight) throw new Error('Invalid Phaser camera/canvas geometry');
  return {
    x: box.x + ((x + 0.5) * 12 - cameraX) * zoom * box.width / backingWidth,
    y: box.y + ((y + 0.5) * 12 - cameraY) * zoom * box.height / backingHeight,
  };
}

test('worker can build a house and the house can produce an operative', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
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
  await expect(page.locator('#selection-count')).toHaveText('Casa');

  // Complete actual construction through deterministic simulation ticks rather
  // than waiting on slow SwiftShader wall-clock frames in GitHub Actions.
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(20_000));
  await expect(page.locator('#btn-produce-worker')).toBeVisible({ timeout: 20_000 });

  // Queue training of an operative
  const trainBtn = page.locator('#btn-produce-worker');
  await trainBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('Operário adicionado à fila');
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(7_000));

  // Unit count should increase from 2 to 3 after production finishes (6 seconds)
  await expect.poll(async () => {
    const text = await page.locator('#team-status').textContent();
    return text?.includes('3/60 unidades');
  }, { timeout: 20_000 }).toBe(true);
});

test('base does not produce units and requires house to train workers', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Select blue base at (21, 101)
  const basePos = await screenCell(page, 21, 101);
  await page.mouse.click(basePos.x, basePos.y);
  await expect(page.locator('#game')).toHaveAttribute('data-selected-ids', 'blue-base');

  // Train worker button must NOT be visible on base
  const trainBtn = page.locator('#btn-produce-worker');
  await expect(trainBtn).not.toBeVisible();
});

test('house can produce a builder and builder has construction action bar', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.coins = 1000;
      sim.teams.blue.wood = 1000;
      sim.entities.createBuilding('blue', 'house', 24, 96, false);
      sim.fog.update();
    }
  });

  // Select the house at (24, 96)
  const houseSpot = await screenCell(page, 24, 96);
  await page.mouse.click(houseSpot.x, houseSpot.y);
  await expect(page.locator('#selection-count')).toHaveText('Casa');

  const produceBuilderBtn = page.locator('#btn-produce-builder');
  await expect(produceBuilderBtn).toBeVisible();
  await produceBuilderBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('Construtor adicionado à fila');

  // Training still runs through the genuine production system, but is
  // clock-stepped to avoid timing-dependent failures in software-rendered CI.
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(8_000));
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim?.entities.all().some((e: GameEntity) => e.kind === 'builder' && e.team === 'blue');
    });
  }, { timeout: 15_000 }).toBe(true);

  // Find builder position and select it
  const builderCoord = await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    const b = sim?.entities.all().find((e: GameEntity) => e.kind === 'builder' && e.team === 'blue');
    return b ? { x: b.x, y: b.y, id: b.id } : null;
  });
  expect(builderCoord).not.toBeNull();

  const builderPos = await screenCell(page, builderCoord!.x, builderCoord!.y);
  await page.mouse.click(builderPos.x, builderPos.y);

  // Verify builder header in action bar and construction buttons
  await expect(page.locator('#action-bar')).toContainText('Construir');
  await expect(page.locator('#btn-build-house')).toBeVisible();
  await expect(page.locator('#btn-build-barracks')).toBeVisible();
  await expect(page.locator('#btn-build-barricade')).toBeVisible();
});

test('builder can construct a barricade requiring wood and stone', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.wood = 20;
      sim.teams.blue.stone = 10;
      sim.entities.spawnUnit('blue', 'builder', 24, 95);
      sim.fog.update();
    }
  });

  // Select builder at (24, 95)
  const builderPos = await screenCell(page, 24, 95);
  await page.mouse.click(builderPos.x, builderPos.y);
  await expect(page.locator('#action-bar')).toContainText('Construir');

  const buildBarricadeBtn = page.locator('#btn-build-barricade');
  await expect(buildBarricadeBtn).toBeVisible();
  await buildBarricadeBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('posicionar a Barricada');

  // Place barricade at (24, 96)
  const targetPos = await screenCell(page, 24, 96);
  await page.mouse.click(targetPos.x, targetPos.y);
  await expect(page.locator('#command-feedback')).toContainText('Construção de Barricada iniciada');

  // Verify resources deducted (10 wood, 5 stone)
  const resources = await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    return sim ? { wood: sim.teams.blue.wood, stone: sim.teams.blue.stone } : null;
  });
  expect(resources?.wood).toBe(10);
  expect(resources?.stone).toBe(5);

  // Verify cell is impassable
  const isPassable = await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    return sim?.map.isPassable(24, 96);
  });
  expect(isPassable).toBe(false);
});

test('HUD displays civilian and military capacity and reports capacity limits', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Verify starting capacity in HUD
  await expect(page.locator('#capacity-status')).toHaveText('Civil 2/2 · Mil 0/0');

  // Add resources and completed house
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.coins = 1000;
      sim.teams.blue.wood = 1000;
      sim.entities.createBuilding('blue', 'house', 24, 96, false);
      sim.fog.update();
    }
  });

  // Select house at (24, 96)
  const houseSpot = await screenCell(page, 24, 96);
  await page.mouse.click(houseSpot.x, houseSpot.y);
  await expect(page.locator('#capacity-status')).toHaveText('Civil 2/4 · Mil 0/0');

  // Queue 2 workers to reach 4/4
  await page.locator('#btn-produce-worker').click();
  await expect(page.locator('#command-feedback')).toContainText('Operário adicionado à fila');
  await page.locator('#btn-produce-worker').click();
  await expect(page.locator('#command-feedback')).toContainText('Operário adicionado à fila');

  // 3rd attempt should fail with civilian capacity reached
  await page.locator('#btn-produce-worker').click();
  await expect(page.locator('#command-feedback')).toContainText('capacidade civil esgotada');
});

test('builder can repair damaged building via right-click in browser', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.wood = 500;
      sim.teams.blue.stone = 500;
      const b = sim.entities.createBuilding('blue', 'barricade', 24, 96, false);
      b.hp = 10;
      sim.entities.spawnUnit('blue', 'builder', 24, 95);
      sim.fog.update();
    }
  });

  // Select builder at (24, 95)
  const builderPos = await screenCell(page, 24, 95);
  await page.mouse.click(builderPos.x, builderPos.y);
  await expect(page.locator('#action-bar')).toContainText('Construir');

  // Right-click on damaged barricade at (24, 96)
  const barricadePos = await screenCell(page, 24, 96);
  await page.mouse.click(barricadePos.x, barricadePos.y, { button: 'right' });
  await expect(page.locator('#command-feedback')).toContainText('Reparo de Barricada iniciado');

  // Let the real repair command finish without depending on wall-clock FPS.
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(15_000));
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const b = sim?.entities.all().find((e: GameEntity) => e.kind === 'barricade' && e.team === 'blue');
      return b && b.hp > 15;
    });
  }, { timeout: 10_000 }).toBe(true);
});

test('builder can build watch tower and HUD displays tower 20x20 vision and counter description', async ({ page }) => {
  // Gameplay interactions are isolated from autonomous red AI; battle AI is covered by seeded tournaments.
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.coins = 1000;
      sim.teams.blue.wood = 1000;
      sim.teams.blue.stone = 1000;
      sim.entities.spawnUnit('blue', 'builder', 24, 95);
      sim.fog.update();
    }
  });

  // Select worker 1: verify #btn-build-tower does not exist
  const workerPos = await screenCell(page, 25, 99);
  await page.mouse.click(workerPos.x, workerPos.y);
  await expect(page.locator('#btn-build-tower')).not.toBeVisible();

  // Select builder at (24, 95)
  const builderPos = await screenCell(page, 24, 95);
  await page.mouse.click(builderPos.x, builderPos.y);
  await expect(page.locator('#action-bar')).toContainText('Construir');
  const buildTowerBtn = page.locator('#btn-build-tower');
  await expect(buildTowerBtn).toBeVisible();

  // Click build tower to enter placement mode
  await buildTowerBtn.click();
  await expect(page.locator('#command-feedback')).toContainText('posicionar a Torre de Vigilância (2×2)');

  // Place tower at (24, 96)
  const buildSpot = await screenCell(page, 24, 96);
  await page.mouse.click(buildSpot.x, buildSpot.y);
  await expect(page.locator('#command-feedback')).toContainText('Construção de Torre de Vigilância iniciada');

  // Select the placed tower
  const towerSpot = await screenCell(page, 24, 96);
  await page.mouse.click(towerSpot.x, towerSpot.y);
  await expect(page.locator('#selection-count')).toHaveText('Torre de Vigilância');

  // Complete construction
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    const tower = sim?.entities.all().find((e) => e.kind === 'tower' && e.team === 'blue');
    if (tower && tower.category === 'building') {
      tower.buildProgressTicks = tower.buildTotalTicks;
    }
  });

  // Wait for tick update to recognize completed building
  await expect.poll(async () => page.locator('#selection-count').getAttribute('data-tooltip-description'), { timeout: 10_000 }).toContain('20 casas e detecção');
});

test('house and barracks support defining, displaying, and removing rally points with auto-dispatch on unit spawn', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.blue.coins = 1000;
      sim.teams.blue.wood = 1000;
      sim.entities.createBuilding('blue', 'house', 24, 96);
      sim.fog.update();
    }
  });

  // Select the house at (24, 96)
  const housePos = await screenCell(page, 24, 96);
  await page.mouse.click(housePos.x, housePos.y);
  await expect(page.locator('#selection-count')).toHaveText('Casa');

  // Verify #btn-set-rally is visible
  const setRallyBtn = page.locator('#btn-set-rally');
  await expect(setRallyBtn).toBeVisible();

  // Right click cell (28, 96) to set rally point
  const rallyCell = await screenCell(page, 28, 96);
  await page.mouse.click(rallyCell.x, rallyCell.y, { button: 'right' });

  // Verify feedback and HUD update
  await expect(page.locator('#command-feedback')).toContainText('Ponto de reunião da Casa definido para (28, 96)');
  await expect(page.locator('#selection-count')).toHaveAttribute('data-tooltip-description', /Ponto de reunião: 28, 96/);
  await expect(page.locator('#btn-clear-rally')).toBeVisible();

  // Train a worker and verify it receives order to march to rally point and arrives at (28, 96)
  await page.locator('#btn-produce-worker').click();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const worker = sim?.entities.all().find((e) => e.category === 'unit' && e.kind === 'worker' && e.id === 'blue-worker-3');
      return worker ? { x: worker.x, y: worker.y } : null;
    });
  }, { timeout: 15_000 }).toEqual({ x: 28, y: 96 });

  // Remove rally point
  await page.locator('#btn-clear-rally').click();
  await expect(page.locator('#command-feedback')).toContainText('Ponto de reunião removido');
  await expect(page.locator('#selection-count')).not.toHaveAttribute('data-tooltip-description', /Ponto de reunião:/);
  await expect(page.locator('#btn-clear-rally')).not.toBeVisible();
});





import { expect, test } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

test('an enemy becomes visible at the displayed position and moves continuously', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const enemyId = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    const enemy = simulation.entities.spawnUnit('red', 'soldier', 105, 100);
    simulation.fog.update();
    (window as Window & { __enemySamples?: number[] }).__enemySamples = [];
    new MutationObserver(() => {
      const positions = document.querySelector('#game')?.getAttribute('data-visible-enemy-positions') ?? '';
      const match = positions.match(new RegExp(`${enemy.id}:([\\d.]+),`));
      if (match) (window as Window & { __enemySamples?: number[] }).__enemySamples!.push(Number(match[1]));
    }).observe(document.querySelector('#game')!, { attributes: true, attributeFilter: ['data-visible-enemy-positions'] });
    return enemy.id;
  });
  await expect(page.locator('#game')).not.toHaveAttribute('data-visible-enemy-ids', new RegExp(enemyId));
  await page.evaluate((id) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.issueCommand({ type: 'move', team: 'red', unitId: id, destination: [99, 100] });
  }, enemyId);
  await page.evaluate(() => (window as Window & { __simulation?: Simulation }).__simulation!.advance(7_000));
  await expect(page.locator('#game')).toHaveAttribute('data-visible-enemy-ids', new RegExp(enemyId));
  await expect.poll(async () => page.evaluate(() => Math.min(...((window as Window & { __enemySamples?: number[] }).__enemySamples ?? [105])))).toBeLessThan(102);
  const samples = await page.evaluate(() => (window as Window & { __enemySamples?: number[] }).__enemySamples ?? []);
  expect(samples[0]).toBeLessThanOrEqual(101);
  expect(samples.some((x) => x < 102 && x > 99)).toBe(true);
  for (let index = 1; index < samples.length; index += 1) expect(Math.abs(samples[index] - samples[index - 1])).toBeLessThan(0.8);
});

test('a marching soldier engages a newly seen enemy and resumes the route in the browser', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const ids = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 95, 100);
    // Hold the dummy defender in place so civilian economy tasks cannot
    // reposition it before attack-move acquires the freshly visible target.
    simulation.economy.cancel('red-worker-1');
    simulation.movement.cancel('red-worker-1');
    simulation.entities.moveUnit('red-worker-1', 105, 100);
    simulation.fog.update();
    return { soldier: soldier.id, enemy: 'red-worker-1' };
  });
  const order = await page.evaluate(({ soldier }) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    return simulation.issueCommand({ type: 'attack-move', team: 'blue', unitId: soldier, destination: [120, 100] });
  }, ids);
  expect(order).toEqual({ accepted: true });
  // In headless CI the browser may render slower than the combat clock.
  // Verify the transient engagement on the real simulation immediately
  // after precisely two seconds of deterministic ticks, as in unit tests.
  const acquired = await page.evaluate(({ soldier }) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.advance(2_000);
    return simulation.engagements.statusFor(soldier)?.targetId ?? null;
  }, ids);
  expect(acquired).toBe(ids.enemy);
  const defeated = await page.evaluate(({ enemy }) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.advance(6_000);
    return simulation.entities.get(enemy) === undefined;
  }, ids);
  expect(defeated).toBe(true);
  const arrived = await page.evaluate(({ soldier }) => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.advance(8_000);
    return simulation.entities.get(soldier)?.x ?? -1;
  }, ids);
  expect(arrived).toBe(120);
});

test('HUD overlays the full map and the troop palette identifies each team', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const kinds = ['worker', 'soldier', 'archer', 'shieldbearer', 'scout'] as const;
    kinds.forEach((kind, index) => {
      simulation.entities.spawnUnit('blue', kind, 28 + index, 96);
      simulation.entities.spawnUnit('red', kind, 28 + index, 103);
    });
    simulation.entities.spawnUnit('blue', 'worker', 34, 106);
    simulation.fog.update();
  });
  await expect(page.locator('#game')).toHaveAttribute('data-visible-enemy-ids', /red-soldier.*red-scout/);
  const map = await page.locator('#game canvas').boundingBox();
  const hud = await page.locator('#hud').boundingBox();
  expect(map && hud && map.x === hud.x && map.y === hud.y && map.width === hud.width && map.height === hud.height).toBe(true);
  await page.screenshot({ path: 'artifacts/playtest-palette-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 760, height: 800 });
  await expect.poll(async () => {
    const box = await page.locator('#game canvas').boundingBox();
    return box && { width: box.width, height: box.height };
  }).toEqual({ width: 760, height: 800 });
  const compactMap = await page.locator('#game canvas').boundingBox();
  const compactHud = await page.locator('#hud').boundingBox();
  expect(compactMap && compactHud && compactMap.x === compactHud.x && compactMap.y === compactHud.y && compactMap.width === compactHud.width && compactMap.height === compactHud.height, JSON.stringify({ compactMap, compactHud })).toBe(true);
  expect(compactMap && compactMap.x + compactMap.width <= 760).toBe(true);
  expect(compactHud && compactHud.x + compactHud.width <= 760).toBe(true);
  await page.screenshot({ path: 'artifacts/playtest-palette-compact.png', fullPage: true });
});

test('a player order coexists with an active AI developing from starting resources', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const canvas = page.locator('#game canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const root = page.locator('#game');
  const zoom = Number(await root.getAttribute('data-zoom'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root).toHaveAttribute('data-pointer-world', /,/);
  const pointerWorld = (await root.getAttribute('data-pointer-world'))!.split(',').map(Number);
  const backing = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  const click = async (x: number, y: number, button: 'left' | 'right') => page.mouse.click(
    box.x + box.width / 2 + ((x + 0.5) * 12 - pointerWorld[0]) * zoom * box.width / backing.width,
    box.y + box.height / 2 + ((y + 0.5) * 12 - pointerWorld[1]) * zoom * box.height / backing.height,
    { button },
  );
  await click(25, 99, 'left');
  await expect(root).toHaveAttribute('data-selected-ids', 'blue-worker-1');
  await click(30, 99, 'right');
  await expect(page.locator('#command-feedback')).toContainText('movimento');
  const outcome = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    simulation.advance(240_000);
    return {
      redMilitary: simulation.entities.all().filter((entity) => entity.team === 'red' && entity.category === 'unit' && entity.kind !== 'worker').length,
      redBarracks: simulation.entities.all().some((entity) => entity.team === 'red' && entity.kind === 'barracks'),
      blueWorkerMoved: simulation.entities.get('blue-worker-1')?.x !== 25,
    };
  });
  expect(outcome).toMatchObject({ redBarracks: true, blueWorkerMoved: true });
  expect(outcome.redMilitary).toBeGreaterThan(0);
});

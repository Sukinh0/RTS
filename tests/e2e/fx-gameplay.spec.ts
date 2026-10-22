import { expect, test, type Page } from '@playwright/test';

interface TestEntity {
  id: string;
  hp: number;
  team: 'blue' | 'red';
  x: number;
  y: number;
  width?: number;
  height?: number;
  cooldownUntilTick?: number;
}

interface TestSimulation {
  entities: {
    get(id: string): TestEntity | undefined;
    spawnUnit(team: 'blue' | 'red', kind: string, x: number, y: number): TestEntity;
    all(): TestEntity[];
    isFreeForUnit(x: number, y: number, movingUnitId: string): boolean;
  };
  issueCommand(command: unknown): { accepted: boolean; reason?: string };
  fog: { update(): void };
  clock: { ticks: number };
}

async function openTestMap(page: Page): Promise<void> {
  await page.goto('/?fxdebug=1&noai=1');
  await expect(page.locator('#game canvas')).toBeVisible();
  const panel = page.locator('[data-fx-debug="true"]');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(350);
  await panel.getByRole('button', { name: 'Limpar' }).click();
}

async function spawnPair(page: Page, blueKind: string, redKind: string, distance = 1) {
  return page.evaluate(({ blueKind, redKind, distance }) => {
    const host = window as unknown as { __simulation: TestSimulation };
    const simulation = host.__simulation;
    const base = simulation.entities.get('blue-base');
    if (!base) throw new Error('Blue base not found');
    let x = -1;
    let y = -1;
    for (let candidateY = base.y - 8; candidateY <= base.y + 8 && x < 0; candidateY += 1) {
      for (let candidateX = base.x + 4; candidateX <= base.x + 12; candidateX += 1) {
        if (simulation.entities.isFreeForUnit(candidateX, candidateY, '')
          && simulation.entities.isFreeForUnit(candidateX + distance, candidateY, '')) {
          x = candidateX;
          y = candidateY;
          break;
        }
      }
    }
    if (x < 0) throw new Error('No visible empty cells for FX combat fixture');
    const blue = simulation.entities.spawnUnit('blue', blueKind, x, y);
    const red = simulation.entities.spawnUnit('red', redKind, x + distance, y);
    blue.cooldownUntilTick = simulation.clock.ticks + 100_000;
    red.cooldownUntilTick = simulation.clock.ticks + 100_000;
    simulation.fog.update();
    return { blueId: blue.id, redId: red.id, x, y };
  }, { blueKind, redKind, distance });
}

async function waitEnemyVisible(page: Page, redId: string): Promise<void> {
  await expect.poll(async () => page.locator('#game').getAttribute('data-visible-enemy-ids'), {
    intervals: [10, 20, 50],
  }).toContain(redId);
}

async function orderAttack(page: Page, blueId: string, redId: string): Promise<void> {
  const result = await page.evaluate(({ blueId, redId }) => {
    const simulation = (window as unknown as { __simulation: TestSimulation }).__simulation;
    const unit = simulation.entities.get(blueId);
    if (unit) unit.cooldownUntilTick = simulation.clock.ticks;
    return simulation.issueCommand({ type: 'attack', team: 'blue', unitId: blueId, targetId: redId });
  }, { blueId, redId });
  expect(result.accepted, result.reason).toBe(true);
}

test('real combat events produce melee, arrow, reflection and death feedback; 30v30 stays bounded and fog-safe', async ({ page }) => {
  test.setTimeout(120_000);

  await openTestMap(page);
  const melee = await spawnPair(page, 'soldier', 'soldier');
  await waitEnemyVisible(page, melee.redId);
  const meleeBefore = await page.evaluate((redId) =>
    (window as unknown as { __simulation: TestSimulation }).__simulation.entities.get(redId)?.hp ?? 0, melee.redId);
  await orderAttack(page, melee.blueId, melee.redId);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-active-world-fx')),
    { intervals: [10, 20, 50] }).toBeGreaterThan(0);
  const meleeAfter = await page.evaluate((redId) =>
    (window as unknown as { __simulation: TestSimulation }).__simulation.entities.get(redId)?.hp ?? 0, melee.redId);
  expect(meleeAfter).toBeLessThan(meleeBefore);
  await page.screenshot({ path: 'artifacts/fx-gameplay-melee-1v1.png' });

  await openTestMap(page);
  const archer = await spawnPair(page, 'archer', 'soldier', 4);
  await waitEnemyVisible(page, archer.redId);
  await orderAttack(page, archer.blueId, archer.redId);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-active-projectiles')),
    { intervals: [5, 10, 20, 50] }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/fx-gameplay-archer.png' });

  await openTestMap(page);
  const shield = await spawnPair(page, 'soldier', 'shieldbearer');
  await waitEnemyVisible(page, shield.redId);
  const hpBefore = await page.evaluate((blueId) =>
    (window as unknown as { __simulation: TestSimulation }).__simulation.entities.get(blueId)?.hp ?? 0, shield.blueId);
  await orderAttack(page, shield.blueId, shield.redId);
  const hpAfter = await page.evaluate((blueId) =>
    (window as unknown as { __simulation: TestSimulation }).__simulation.entities.get(blueId)?.hp ?? 0, shield.blueId);
  expect(hpAfter).toBeLessThan(hpBefore);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-active-world-fx')),
    { intervals: [10, 20, 50] }).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/fx-gameplay-shield-reflection.png' });

  await openTestMap(page);
  const lethal = await spawnPair(page, 'archer', 'scout', 3);
  await waitEnemyVisible(page, lethal.redId);
  await orderAttack(page, lethal.blueId, lethal.redId);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-active-projectiles')),
    { intervals: [5, 10, 20, 50] }).toBeGreaterThan(0);
  const targetRemoved = await page.evaluate((redId) =>
    (window as unknown as { __simulation: TestSimulation }).__simulation.entities.get(redId) === undefined, lethal.redId);
  expect(targetRemoved).toBe(true);
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'artifacts/fx-gameplay-death.png' });

  await openTestMap(page);
  const army = await page.evaluate(() => {
    const simulation = (window as unknown as { __simulation: TestSimulation }).__simulation;
    const base = simulation.entities.get('blue-base');
    if (!base) throw new Error('Blue base not found');
    const blueIds: string[] = [];
    const redIds: string[] = [];
    for (let y = base.y - 16; y <= base.y + 16 && blueIds.length < 30; y += 1) {
      for (let x = base.x + 4; x <= base.x + 24 && blueIds.length < 30; x += 1) {
        if (!simulation.entities.isFreeForUnit(x, y, '') || !simulation.entities.isFreeForUnit(x + 1, y, '')) continue;
        const blue = simulation.entities.spawnUnit('blue', 'soldier', x, y);
        const red = simulation.entities.spawnUnit('red', 'soldier', x + 1, y);
        blue.cooldownUntilTick = simulation.clock.ticks + 100_000;
        red.cooldownUntilTick = simulation.clock.ticks + 100_000;
        blueIds.push(blue.id);
        redIds.push(red.id);
      }
    }
    if (blueIds.length !== 30) throw new Error(`Only found ${blueIds.length} free cells for 30v30 fixture`);
    simulation.fog.update();
    return { blueIds, redIds };
  });
  for (const id of army.redIds) await waitEnemyVisible(page, id);
  await page.evaluate(({ blueIds, redIds }) => {
    const simulation = (window as unknown as { __simulation: TestSimulation }).__simulation;
    blueIds.forEach((unitId, index) => {
      const unit = simulation.entities.get(unitId);
      if (unit) unit.cooldownUntilTick = simulation.clock.ticks;
      simulation.issueCommand({ type: 'attack', team: 'blue', unitId, targetId: redIds[index] });
    });
  }, army);
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-active-world-fx')),
    { intervals: [10, 20, 50] }).toBeGreaterThan(0);
  const activeFx = Number(await page.locator('#game').getAttribute('data-active-world-fx'));
  expect(activeFx).toBeLessThanOrEqual(96);
  await page.screenshot({ path: 'artifacts/fx-gameplay-30v30.png' });

  await openTestMap(page);
  await page.evaluate(() => {
    const simulation = (window as unknown as {
      __simulation: TestSimulation & { combat: { events: unknown[] } };
    }).__simulation;
    simulation.combat.events.push({
      type: 'attack', tick: 1, attackerId: 'red-hidden-test', attackerTeam: 'red', attackerKind: 'archer',
      attackerX: 150, attackerY: 150, targetId: 'blue-hidden-test', targetTeam: 'blue',
      targetCategory: 'unit', targetKind: 'soldier', targetX: 151, targetY: 150,
      damage: 8, targetHpAfter: 10, targetDied: false, reflectedDamage: 0, attackerHpAfter: 10, attackerDied: false,
    });
  });
  await page.waitForTimeout(150);
  expect(Number(await page.locator('#game').getAttribute('data-active-projectiles'))).toBe(0);
  expect(Number(await page.locator('#game').getAttribute('data-active-world-fx'))).toBe(0);
});

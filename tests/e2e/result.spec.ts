import { expect, test } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

test('destroying the enemy base shows victory and restart begins a fresh match', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const combatant = simulation.entities.spawnUnit('blue', 'soldier', 170, 100);
    const victim = simulation.entities.spawnUnit('red', 'soldier', 171, 100);
    victim.hp = combatant.damage;
    simulation.fog.update();
    simulation.issueCommand({ type: 'attack', team: 'blue', unitId: combatant.id, targetId: victim.id });
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 174, 100);
    const base = simulation.entities.get('red-base')!;
    base.hp = 5;
    simulation.fog.update();
    simulation.issueCommand({ type: 'attack', team: 'blue', unitId: soldier.id, targetId: base.id });
  });
  await expect(page.locator('#result-title')).toHaveText('Vitória!');
  await expect(page.locator('#result-duration')).toContainText('Duração');
  await expect(page.locator('#result-stats')).toContainText('Ouro coletado');
  await expect(page.locator('#result-stats')).toContainText('Madeira gasta');
  await expect(page.locator('#result-stats tbody tr').filter({ hasText: 'Tropas abatidas' }).locator('td').first()).toHaveText('1');
  await page.locator('#restart-game').click();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#game-result')).toBeHidden();
  const hasBothBases = await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    return Boolean(simulation.entities.get('blue-base') && simulation.entities.get('red-base'));
  });
  expect(hasBothBases).toBe(true);
});

test('destroying the blue base shows defeat', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const soldier = simulation.entities.spawnUnit('red', 'soldier', 25, 100);
    const base = simulation.entities.get('blue-base')!;
    base.hp = 5;
    simulation.fog.update();
    simulation.issueCommand({ type: 'attack', team: 'red', unitId: soldier.id, targetId: base.id });
  });
  await expect(page.locator('#result-title')).toHaveText('Derrota');
});

test('complete result report fits a compact screen and remains scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const soldier = simulation.entities.spawnUnit('blue', 'soldier', 174, 100);
    const base = simulation.entities.get('red-base')!;
    base.hp = soldier.damage;
    simulation.fog.update();
    simulation.issueCommand({ type: 'attack', team: 'blue', unitId: soldier.id, targetId: base.id });
  });
  await expect(page.locator('#result-stats tbody tr')).toHaveCount(11);
  const card = await page.locator('.result-card').boundingBox();
  expect(card).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(480);
  expect(card!.y + card!.height).toBeLessThanOrEqual(700);
  await page.locator('#restart-game').scrollIntoViewIfNeeded();
  await expect(page.locator('#restart-game')).toBeVisible();
});

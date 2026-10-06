import { expect, test } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

test('AI: Red team runs autonomously in the browser, making decisions and issuing commands', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Verify Red AI is attached and running
  const aiRunning = await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    return sim?.redAI !== undefined;
  });
  expect(aiRunning).toBe(true);

  // Give resources to Red to observe autonomous construction and training
  await page.evaluate(() => {
    const sim = (window as Window & { __simulation?: Simulation }).__simulation;
    if (sim) {
      sim.teams.red.coins = 1000;
      sim.teams.red.wood = 1000;
    }
  });

  // Verify AI makes autonomous strategic decisions over time
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim?.redAI?.currentIntent;
    });
  }, { timeout: 15_000 }).not.toBe('Idle');

  // Verify Red team starts construction of barracks
  await expect.poll(async () => {
    return page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const redBarracks = sim?.entities.all().find((e) => e.team === 'red' && e.kind === 'barracks');
      return redBarracks !== undefined;
    });
  }, { timeout: 20_000 }).toBe(true);
});

import { expect, test } from '@playwright/test';
import type { PerformanceMonitor } from '../../src/core/game/PerformanceMonitor';

declare global {
  interface Window {
    rtsPerformance: {
      setEnabled(enabled: boolean): void;
      reset(): void;
      snapshot(): ReturnType<PerformanceMonitor['snapshot']> & { units: number; entities: number; droppedSimulationMs: number };
    };
  }
}

test('diagnostics measures real frames and can be removed and re-enabled', async ({ page }) => {
  await page.goto('/?noai=1&perf=1');
  await page.waitForSelector('#game[data-ready="true"]');
  await expect.poll(() => page.evaluate(() => window.rtsPerformance.snapshot().metrics.frameInterval?.calls ?? 0)).toBeGreaterThan(10);
  const snapshot = await page.evaluate(() => window.rtsPerformance.snapshot());
  expect(snapshot.fps).toBeGreaterThan(0);
  expect(snapshot.metrics.rendererCPU.calls).toBeGreaterThan(0);
  expect(snapshot.units).toBe(4);
  await page.evaluate(() => window.rtsPerformance.setEnabled(false));
  const count = await page.evaluate(() => window.rtsPerformance.snapshot().metrics.frameInterval.calls);
  const ticks = Number(await page.locator('#game').getAttribute('data-ticks'));
  await expect.poll(async () => Number(await page.locator('#game').getAttribute('data-ticks'))).toBeGreaterThan(ticks + 3);
  expect(await page.evaluate(() => window.rtsPerformance.snapshot().metrics.frameInterval.calls)).toBe(count);
  await page.evaluate(() => {
    for (let i=0;i<5;i++) window.rtsPerformance.setEnabled(true);
  });
  await expect.poll(() => page.evaluate(() => window.rtsPerformance.snapshot().metrics.frameInterval?.calls ?? 0)).toBeGreaterThan(10);
  const after = await page.evaluate(() => window.rtsPerformance.snapshot());
  expect(Math.abs(after.metrics.sceneUpdate.calls - after.metrics.rendererCPU.calls)).toBeLessThanOrEqual(2);
});

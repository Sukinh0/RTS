import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('installed Tiny Swords sheets load and gameplay remains interactive', async ({ page }) => {
  test.skip(!existsSync('public/assets/tiny-swords/Units/Yellow Units/Pawn/Pawn_Idle.png'),
    'Install the separately licensed Tiny Swords pack to run this visual asset check');
  const assetResponses: number[] = [];
  const missing: string[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/assets/tiny-swords/')) return;
    assetResponses.push(response.status());
    if (response.status() >= 400) missing.push(response.url());
  });
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  expect(assetResponses.length).toBeGreaterThan(20);
  expect(missing).toEqual([]);
  await expect(page.locator('#team-status')).toContainText('2/60 unidades');
  await expect(page.locator('#game')).toHaveAttribute('data-visible-cells', /[1-9]\d+/);
});

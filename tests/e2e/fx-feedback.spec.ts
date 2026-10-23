import { expect, test } from '@playwright/test';

test('FX debug controls preview bounded gameplay feedback on the map', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?fxdebug=1&noai=1');
  const canvas = page.locator('#game canvas');
  const game = page.locator('#game');
  const panel = page.locator('[data-fx-debug="true"]');
  await expect(canvas).toBeVisible();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  await panel.getByRole('button', { name: 'Limpar' }).click();

  const previews = [
    { name: 'Impacto', file: 'artifacts/fx-hit.png', wait: 45 },
    { name: 'Morte', file: 'artifacts/fx-death.png', wait: 45 },
    { name: 'Destruição', file: 'artifacts/fx-structure-death.png', wait: 45 },
    { name: 'Flecha', file: 'artifacts/fx-arrow.png', wait: 90 },
    { name: 'Construção', file: 'artifacts/fx-construction.png', wait: 20 },
    { name: 'Madeira', file: 'artifacts/fx-wood.png', wait: 20 },
    { name: 'Ouro', file: 'artifacts/fx-gold.png', wait: 20 },
    { name: 'Pedra', file: 'artifacts/fx-stone.png', wait: 20 },
    { name: 'Ordem', file: 'artifacts/fx-order.png', wait: 20 },
  ];
  for (const preview of previews) {
    await panel.getByRole('button', { name: preview.name }).click();
    await page.waitForTimeout(preview.wait);
    if (preview.name === 'Impacto' || preview.name === 'Morte' || preview.name === 'Destruição') {
      await expect.poll(async () => Number(await game.getAttribute('data-active-world-fx')), { intervals: [5, 10, 20] }).toBeGreaterThan(0);
    }
    if (preview.name === 'Flecha') {
      await expect.poll(async () => Number(await game.getAttribute('data-active-projectiles')), { intervals: [5, 10, 20] }).toBeGreaterThan(0);
    }
    await page.screenshot({ path: preview.file });
    await panel.getByRole('button', { name: 'Limpar' }).click();
  }
});

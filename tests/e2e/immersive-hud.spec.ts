import { expect, test } from '@playwright/test';

test('battlefield fills desktop and compact viewports without hiding essential controls', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 760, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?noai=1');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
    const bounds = await page.locator('#game canvas').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    expect(bounds!.width).toBe(viewport.width);
    expect(bounds!.height).toBe(viewport.height);

    const native = await page.locator('#game canvas').evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(native).toEqual(viewport);
    await expect(page.locator('#minimap')).toBeVisible();
    await expect(page.locator('#team-status')).toBeVisible();
    await expect(page.locator('#command-feedback')).toBeVisible();
    await expect(page.locator('#btn-toggle-sandbox')).toBeVisible();
    await page.locator('#btn-toggle-sandbox').click();
    await expect(page.locator('#sandbox-section')).toBeVisible();
    await page.locator('#btn-toggle-sandbox').click();
    await expect(page.locator('#sandbox-section')).toBeHidden();
  }
});

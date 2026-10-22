import { expect, test } from '@playwright/test';

test('unit readability board captures teams, class pairs and mixed-army zooms', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?visualdebug=1');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(700);

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Unit visual comparison canvas is not visible');
  const sx = bounds.width / 1440;
  const sy = bounds.height / 810;
  const capture = async (path: string, x: number, y: number, width: number, height: number) => {
    await page.screenshot({
      path,
      clip: {
        x: bounds.x + x * sx,
        y: bounds.y + y * sy,
        width: width * sx,
        height: height * sy,
      },
    });
  };

  await canvas.screenshot({ path: 'artifacts/unit-readability-all-classes.png' });
  await capture('artifacts/unit-readability-worker-builder.png', 36, 382, 670, 174);
  await capture('artifacts/unit-readability-soldier-shieldbearer.png', 734, 382, 670, 174);
  await capture('artifacts/unit-readability-scout.png', 1220, 91, 184, 134);
  await capture('artifacts/unit-readability-army-distant.png', 36, 574, 456, 204);
  await capture('artifacts/unit-readability-army-standard.png', 492, 574, 456, 204);
  await capture('artifacts/unit-readability-army-close.png', 948, 574, 456, 204);
});

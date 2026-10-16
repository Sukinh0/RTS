import { expect, test, type Page } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

async function screenCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const root = page.locator('#game');
  const canvas = root.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-zoom', /\d/);
  await expect(root).toHaveAttribute('data-camera-x', /-?\d/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const zoom = Number(await root.getAttribute('data-zoom'));
  const scrollX = Number(await root.getAttribute('data-camera-x'));
  const scrollY = Number(await root.getAttribute('data-camera-y'));
  return {
    x: box.x + ((((x + 0.5) * 12 - scrollX - 480) * zoom) + 480) * box.width / 960,
    y: box.y + ((((y + 0.5) * 12 - scrollY - 300) * zoom) + 300) * box.height / 600,
  };
}

test.describe('V1.1.2 — E2E Construção de Barricadas em Linha', () => {
  test('clique simples constrói uma única barricada normalmente', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

    // Spawn a builder for blue and give resources
    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.teams.blue.wood = 500;
        sim.teams.blue.stone = 500;
        sim.entities.spawnUnit('blue', 'builder', 24, 95);
      }
    });

    // Select builder at (24, 95)
    const builderPos = await screenCell(page, 24, 95);
    await page.mouse.click(builderPos.x, builderPos.y);
    await expect(page.locator('#action-bar')).toContainText('Construtor · Construções');

    const buildBarricadeBtn = page.locator('#btn-build-barricade');
    await expect(buildBarricadeBtn).toBeVisible();
    await buildBarricadeBtn.click();
    await expect(page.locator('#command-feedback')).toContainText('posicionar a Barricada');

    // Click single spot at (24, 96)
    const targetPos = await screenCell(page, 24, 96);
    await page.mouse.click(targetPos.x, targetPos.y);
    await expect(page.locator('#command-feedback')).toContainText('Construção de Barricada iniciada');

    // Verify impassable and resources deducted
    const res = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim ? {
        wood: sim.teams.blue.wood,
        stone: sim.teams.blue.stone,
        passable: sim.map.isPassable(24, 96),
      } : null;
    });
    expect(res?.wood).toBe(490); // 10 wood deducted
    expect(res?.stone).toBe(495); // 5 stone deducted
    expect(res?.passable).toBe(false);
  });

  test('arrasto de mouse cria linha horizontal válida e inicia construção sequencial', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.teams.blue.wood = 500;
        sim.teams.blue.stone = 500;
        sim.entities.spawnUnit('blue', 'builder', 24, 94);
      }
    });

    // Select builder
    const builderPos = await screenCell(page, 24, 94);
    await page.mouse.click(builderPos.x, builderPos.y);
    await expect(page.locator('#btn-build-barricade')).toBeVisible();

    // Enter barricade mode
    await page.locator('#btn-build-barricade').click();

    // Drag from (24, 96) to (26, 96) - 3 cells horizontal
    const startPos = await screenCell(page, 24, 96);
    const endPos = await screenCell(page, 26, 96);

    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.mouse.move(endPos.x, endPos.y, { steps: 5 });

    // HUD feedback should show preview details
    await expect(page.locator('#command-feedback')).toContainText('Linha de 3 barricada(s) válida');
    await expect(page.locator('#command-feedback')).toContainText('30 madeira');
    await expect(page.locator('#command-feedback')).toContainText('15 pedra');

    // Release mouse to confirm
    await page.mouse.up();

    await expect(page.locator('#command-feedback')).toContainText('Construção de 3 barricadas iniciada!');

    // Check simulation state: 30 wood and 15 stone committed upfront
    const simState = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim ? {
        wood: sim.teams.blue.wood,
        stone: sim.teams.blue.stone,
        reservedCount: sim.construction.getReservedBarricadeCount('blue'),
      } : null;
    });
    expect(simState?.wood).toBe(470);
    expect(simState?.stone).toBe(485);
    // 3 cells reserved / in progress
    expect(simState?.reservedCount).toBeGreaterThanOrEqual(1);
  });

  test('arrasto sobre obstáculo exibe feedback inválido e rejeita confirmação', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.teams.blue.wood = 500;
        sim.teams.blue.stone = 500;
        sim.entities.spawnUnit('blue', 'builder', 24, 94);
        // Create an obstacle at (25, 96)
        sim.map.setTerrain(25, 96, 'mountain');
      }
    });

    const builderPos = await screenCell(page, 24, 94);
    await page.mouse.click(builderPos.x, builderPos.y);
    await page.locator('#btn-build-barricade').click();

    // Drag from (24, 96) to (26, 96) crossing mountain at (25, 96)
    const startPos = await screenCell(page, 24, 96);
    const endPos = await screenCell(page, 26, 96);

    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.mouse.move(endPos.x, endPos.y, { steps: 5 });

    // Should indicate invalid line in feedback
    await expect(page.locator('#command-feedback')).toContainText('inválida');

    // Release mouse
    await page.mouse.up();

    // Rejection message
    await expect(page.locator('#command-feedback')).toContainText('Ordem cancelada');

    // No resources should be deducted
    const resources = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim ? { wood: sim.teams.blue.wood, stone: sim.teams.blue.stone } : null;
    });
    expect(resources?.wood).toBe(500);
    expect(resources?.stone).toBe(500);
  });

  test('tecla ESC cancela o modo de prévia de barricada sem construir', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.teams.blue.wood = 500;
        sim.teams.blue.stone = 500;
        sim.entities.spawnUnit('blue', 'builder', 24, 94);
      }
    });

    const builderPos = await screenCell(page, 24, 94);
    await page.mouse.click(builderPos.x, builderPos.y);
    await page.locator('#btn-build-barricade').click();

    // Start dragging
    const startPos = await screenCell(page, 24, 96);
    const endPos = await screenCell(page, 26, 96);

    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.mouse.move(endPos.x, endPos.y, { steps: 5 });

    // Press Escape
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // Resources untouched
    const resources = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim ? { wood: sim.teams.blue.wood, stone: sim.teams.blue.stone } : null;
    });
    expect(resources?.wood).toBe(500);
    expect(resources?.stone).toBe(500);
  });
});

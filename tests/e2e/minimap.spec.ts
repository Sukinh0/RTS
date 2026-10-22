import { expect, test } from '@playwright/test';
import type { Simulation } from '../../src/core/game/Simulation';

test('minimap renders in HUD, reflects camera viewport, and clicking/dragging navigates camera', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  const minimap = page.locator('#minimap');
  await expect(minimap).toBeVisible();

  // Minimapa deve exibir atributos iniciais
  await expect.poll(async () => minimap.getAttribute('data-camera-center')).toBeTruthy();
  await expect.poll(async () => Number(await minimap.getAttribute('data-visible-allies'))).toBeGreaterThan(0);

  // Posição inicial da câmera perto da base azul (x ~ 20..35)
  const initialCamCenter = await minimap.getAttribute('data-camera-center');
  const initialCamX = await page.locator('#game').getAttribute('data-camera-x');

  // Clique no minimapa em direção ao centro-leste do mapa (ex: pixel 150, 100 no canvas de 200x200)
  // No mapa 200x200, pixel 150 equivale à célula 150
  const size = await minimap.boundingBox();
  if (!size) throw new Error('Minimap bounding box missing');
  await minimap.click({ position: { x: size.width * 0.75, y: size.height * 0.5 } });

  // A câmera deve ter se movido para a nova região
  await expect.poll(async () => page.locator('#game').getAttribute('data-camera-x')).not.toBe(initialCamX);
  await expect.poll(async () => minimap.getAttribute('data-camera-center')).not.toBe(initialCamCenter);

  const [afterClickX, afterClickY] = (await minimap.getAttribute('data-camera-center'))!.split(',').map(Number);
  expect(afterClickX).toBeGreaterThan(120);
  expect(afterClickY).toBeCloseTo(100, 0);

  // Arrastar pelo minimapa deve continuar movendo a câmera dinamicamente
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Minimap bounding box missing');

  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25, { steps: 5 });
  await page.mouse.up({ button: 'left' });

  // O centro da câmera deve agora refletir a região noroeste (próximo a 50, 50)
  await expect.poll(async () => {
    const center = await minimap.getAttribute('data-camera-center');
    const [cx] = (center ?? '').split(',').map(Number);
    return cx;
  }).toBeLessThan(80);
});

test('minimap reflects fog, hides enemies under fog/stealth, and displays visible enemies and tower vision', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  const minimap = page.locator('#minimap');
  await expect(minimap).toBeVisible();

  // Inicialmente sem inimigos visíveis no minimapa
  await expect.poll(async () => Number(await minimap.getAttribute('data-visible-enemies'))).toBe(0);

  // Spawna um inimigo no outro lado do mapa (sob fog) e um visível perto da base azul
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    // Inimigo sob fog (160, 100)
    simulation.entities.spawnUnit('red', 'soldier', 160, 100);
    // Inimigo perto da base azul visível (28, 98)
    simulation.entities.spawnUnit('red', 'soldier', 28, 98);
  });

  // O minimapa deve registrar exatamente 1 inimigo visível (o oculto sob o fog não aparece)
  await expect.poll(async () => Number(await minimap.getAttribute('data-visible-enemies'))).toBe(1);

  // Testa batedor: batedor em camuflagem fora da distância de detecção NÃO aparece
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    // Remove o soldado anterior para teste limpo
    for (const e of simulation.entities.all()) {
      if (e.team === 'red') simulation.entities.remove(e.id);
    }
    // Cria arqueiro azul em (50, 50) com visão 6
    simulation.entities.spawnUnit('blue', 'archer', 50, 50);
    // Spawna batedor inimigo em (56, 50) a distância 6 (> 5 stealthDetectionDistance)
    simulation.entities.spawnUnit('red', 'scout', 56, 50);
  });

  // Batedor invisível: 0 inimigos visíveis no minimapa
  await expect.poll(async () => Number(await minimap.getAttribute('data-visible-enemies'))).toBe(0);

  // Torre de vigilância construída: visão 20x20 revela o batedor
  await page.evaluate(() => {
    const simulation = (window as Window & { __simulation?: Simulation }).__simulation!;
    const tower = simulation.entities.createBuilding('blue', 'tower', 52, 48);
    tower.underConstruction = false;
  });

  // Com a torre ativa, o batedor perde camuflagem e aparece no minimapa
  await expect.poll(async () => Number(await minimap.getAttribute('data-visible-enemies'))).toBe(1);
});

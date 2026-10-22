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
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(root).toHaveAttribute('data-pointer-world', /,/);
  const pointerWorld = (await root.getAttribute('data-pointer-world'))!.split(',').map(Number);
  const backingSize = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  return {
    x: box.x + box.width / 2 + ((x + 0.5) * 12 - pointerWorld[0]) * zoom * box.width / backingSize.width,
    y: box.y + box.height / 2 + ((y + 0.5) * 12 - pointerWorld[1]) * zoom * box.height / backingSize.height,
  };
}

test.describe('V1.1.1 — Sistema de Formações Militares Persistentes', () => {
  test('exibe painel com 4 formações táticas ao selecionar tropas militares e permite alternar', async ({ page }) => {
    await page.goto('/?noai=1');
    await page.waitForSelector('#game[data-ready="true"]');

    // Spawna 1 escudeiro e 2 soldados para o time azul em (35, 98), (35, 99), (35, 100)
    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.entities.spawnUnit('blue', 'shieldbearer', 35, 98);
        sim.entities.spawnUnit('blue', 'soldier', 35, 99);
        sim.entities.spawnUnit('blue', 'archer', 35, 100);
        sim.fog.update();
      }
    });

    // Box-select as 3 unidades militares usando screenCell
    const start = await screenCell(page, 33, 96);
    const end = await screenCell(page, 37, 102);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    // Verifica que as unidades foram selecionadas
    await expect(page.locator('#selection-count')).toHaveText(/unidades|×\d+/);

    // Verifica se os 4 botões de formação estão visíveis no HUD
    const btnLine = page.locator('#btn-formation-line');
    const btnWedge = page.locator('#btn-formation-wedge');
    const btnBlock = page.locator('#btn-formation-block');
    const btnDouble = page.locator('#btn-formation-double-rank');

    await expect(btnLine).toBeVisible();
    await expect(btnWedge).toBeVisible();
    await expect(btnBlock).toBeVisible();
    await expect(btnDouble).toBeVisible();

    // Linha é a formação padrão ativa
    await expect(btnLine).toHaveClass(/active/);

    // Alterna para Cunha
    await btnWedge.click();
    await expect(btnWedge).toHaveClass(/active/);
    await expect(btnLine).not.toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Formação Cunha selecionada');

    // Alterna para Bloco
    await btnBlock.click();
    await expect(btnBlock).toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Formação Bloco selecionada');

    // Alterna para Duas Fileiras
    await btnDouble.click();
    await expect(btnDouble).toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Formação Duas Fileiras selecionada');

    // Botão Livre (ESC) está visível
    const btnNone = page.locator('#btn-formation-none');
    await expect(btnNone).toBeVisible();
    await expect(btnNone).not.toHaveClass(/active/);

    // Tecla ESC cancela a formação e ativa o modo Livre
    await page.keyboard.press('Escape');
    await expect(btnNone).toHaveClass(/active/);
    await expect(btnDouble).not.toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Formação desativada (Modo Livre)');

    // Clique em Linha reativa formação
    await btnLine.click();
    await expect(btnLine).toHaveClass(/active/);
    await expect(btnNone).not.toHaveClass(/active/);

    // Clique no botão Livre volta para modo Livre
    await btnNone.click();
    await expect(btnNone).toHaveClass(/active/);
    await expect(btnLine).not.toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Modo Livre selecionado');
  });

  test('suporta registro e recall de grupos de controle com Ctrl + 1..9 e 1..9', async ({ page }) => {
    await page.goto('/?noai=1');
    await page.waitForSelector('#game[data-ready="true"]');

    // Spawna 2 soldados
    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.entities.spawnUnit('blue', 'soldier', 35, 98);
        sim.entities.spawnUnit('blue', 'soldier', 35, 99);
        sim.fog.update();
      }
    });

    // Box-select as duas tropas
    const start = await screenCell(page, 33, 96);
    const end = await screenCell(page, 37, 101);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    await expect(page.locator('#selection-count')).toHaveText(/unidades|×\d+/);

    // Registra grupo 1 com Ctrl+1
    await page.keyboard.press('Control+Digit1');
    await expect(page.locator('#command-feedback')).toContainText('Grupo de controle 1 gravado');

    // Desseleciona clicando em célula vazia (15, 90)
    const emptyPos = await screenCell(page, 15, 90);
    await page.mouse.click(emptyPos.x, emptyPos.y);
    await expect(page.locator('#selection-count')).toHaveText('');

    // Pressiona 1 para selecionar o grupo 1
    await page.keyboard.press('Digit1');
    await expect(page.locator('#selection-count')).not.toHaveText('');
    await expect(page.locator('#command-feedback')).toContainText('Grupo 1 selecionado');
  });

  test('deslocamento em formação sincroniza velocidade e mantém coesão', async ({ page }) => {
    await page.goto('/?noai=1');
    await page.waitForSelector('#game[data-ready="true"]');

    // Spawna 1 escudeiro (lento: 2) e 1 batedor (rápido: 6)
    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.entities.spawnUnit('blue', 'shieldbearer', 35, 98);
        sim.entities.spawnUnit('blue', 'scout', 35, 99);
        sim.fog.update();
      }
    });

    // Box select as duas tropas
    const start = await screenCell(page, 33, 96);
    const end = await screenCell(page, 37, 101);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    await expect(page.locator('#btn-formation-line')).toBeVisible();

    // Ordem de marcha com botão direito em (45, 99)
    const targetPos = await screenCell(page, 45, 99);
    await page.mouse.click(targetPos.x, targetPos.y, { button: 'right' });
    await expect(page.locator('#command-feedback')).toContainText('ordem(ns) de movimento recebida(s)');

    // Verifica que a simulação criou uma formação militar ativa com velocidade do mais lento (2)
    const formationState = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      const groups = sim?.formations.getAllGroups() ?? [];
      return groups.length > 0 ? {
        count: groups.length,
        collectiveSpeed: groups[0].collectiveSpeed,
        state: groups[0].state,
        type: groups[0].type,
      } : null;
    });

    expect(formationState).not.toBeNull();
    // Velocidade coletiva limitada pelo escudeiro (2)
    expect(formationState!.collectiveSpeed).toBe(2);
    expect(formationState!.state).toBe('MARCHANDO');
  });

  test('tecla ESC cancela formação atual e permite movimentação e ataque livres', async ({ page }) => {
    await page.goto('/?noai=1');
    await page.waitForSelector('#game[data-ready="true"]');

    // Spawna 2 soldados azuis
    await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      if (sim) {
        sim.entities.spawnUnit('blue', 'soldier', 35, 98);
        sim.entities.spawnUnit('blue', 'soldier', 35, 99);
        sim.fog.update();
      }
    });

    // Box select os 2 soldados
    const start = await screenCell(page, 33, 96);
    const end = await screenCell(page, 37, 101);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up({ button: 'left' });

    await expect(page.locator('#selection-count')).toHaveText(/unidades|×\d+/);
    await expect(page.locator('#btn-formation-line')).toHaveClass(/active/);

    // Pressiona ESC para cancelar a formação
    await page.keyboard.press('Escape');
    await expect(page.locator('#btn-formation-none')).toHaveClass(/active/);
    await expect(page.locator('#btn-formation-line')).not.toHaveClass(/active/);
    await expect(page.locator('#command-feedback')).toContainText('Formação desativada (Modo Livre)');

    // Ordem de movimento com botão direito em (45, 98)
    const targetPos = await screenCell(page, 45, 98);
    await page.mouse.click(targetPos.x, targetPos.y, { button: 'right' });
    await expect(page.locator('#command-feedback')).toContainText('ordem(ns) de movimento recebida(s)');

    // Verifica que NENHUMA formação foi criada (movimento livre padrão com dispersão radial)
    const groupsCount = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim?.formations.getAllGroups().length ?? 0;
    });
    expect(groupsCount).toBe(0);

    // As unidades continuam selecionadas; testa Attack Move livre
    await page.keyboard.press('KeyA');
    await expect(page.locator('#command-feedback')).toContainText('Modo Attack Move ativado');
    const atkPos = await screenCell(page, 55, 98);
    await page.mouse.click(atkPos.x, atkPos.y, { button: 'left' });
    await expect(page.locator('#command-feedback')).toContainText('Attack Move enviada(s)');

    // Continua sem formação ativa
    const groupsCountAfterAtk = await page.evaluate(() => {
      const sim = (window as Window & { __simulation?: Simulation }).__simulation;
      return sim?.formations.getAllGroups().length ?? 0;
    });
    expect(groupsCountAfterAtk).toBe(0);
  });
});

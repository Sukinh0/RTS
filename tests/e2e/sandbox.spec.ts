import { expect, test } from '@playwright/test';

test.describe('Ambiente de Testes / Sandbox', () => {
  test('painel sandbox abre em ?sandbox=1 ou porta 5174 com recursos rápidos e spawns imediatos', async ({ page }) => {
    await page.goto('/?sandbox=1');
    await page.waitForSelector('#game[data-ready="true"]');

    const sandboxSection = page.locator('#sandbox-section');
    await expect(sandboxSection).toBeVisible();

    // Adicionar recursos
    const teamStatus = page.locator('#team-status');
    await page.locator('#sb-add-res').click();
    await expect(teamStatus).toContainText('moedas');
    await expect(teamStatus).toContainText('15000 pedra');

    // Spawn instantâneo de esquadrão
    await page.locator('#sb-spawn-squad').click();
    await expect(page.locator('#command-feedback')).toContainText('Esquadrão de 5 soldados azuis gerado');

    // Velocidade do jogo
    await page.locator('#sb-speed-2').click();
    await expect(page.locator('#sb-speed-2')).toHaveClass(/active/);

    // Revelar mapa sem fog
    await page.locator('#sb-reveal-map').check();
    await expect(page.locator('#command-feedback')).toContainText('Visão de mapa inteiro ATIVADA');

    // Pausar IA
    const toggleAiBtn = page.locator('#sb-toggle-ai');
    await toggleAiBtn.click();
    await expect(toggleAiBtn).toHaveText('Retomar IA');
  });

  test('botão de alternar sandbox no cabeçalho abre e fecha o painel no jogo normal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#game[data-ready="true"]');

    const sandboxSection = page.locator('#sandbox-section');
    await expect(sandboxSection).toBeHidden();

    const toggleBtn = page.locator('#btn-toggle-sandbox');
    await toggleBtn.click();
    await expect(sandboxSection).toBeVisible();
    await expect(toggleBtn).toHaveClass(/active/);

    await toggleBtn.click();
    await expect(sandboxSection).toBeHidden();
    await expect(toggleBtn).not.toHaveClass(/active/);
  });
});

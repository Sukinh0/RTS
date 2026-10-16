import { expect, test } from '@playwright/test';

test.describe('Fase 11 & 12 — Sons e Polimento Visual', () => {
  test('botão de controle de som alterna entre ON e OFF com persistência em localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#game[data-ready="true"]');

    const soundBtn = page.locator('#btn-sound-toggle');
    await expect(soundBtn).toBeVisible();
    await expect(soundBtn).toHaveText('🔊 Som: ON');
    await expect(soundBtn).not.toHaveClass(/muted/);

    // Desativar áudio
    await soundBtn.click();
    await expect(soundBtn).toHaveText('🔇 Som: OFF');
    await expect(soundBtn).toHaveClass(/muted/);

    // Validar persistência no localStorage
    const saved = await page.evaluate(() => localStorage.getItem('rts_sound_enabled'));
    expect(saved).toBe('false');

    // Recarregar página e verificar persistência
    await page.reload();
    await page.waitForSelector('#game[data-ready="true"]');
    await expect(soundBtn).toHaveText('🔇 Som: OFF');
    await expect(soundBtn).toHaveClass(/muted/);

    // Reativar áudio
    await soundBtn.click();
    await expect(soundBtn).toHaveText('🔊 Som: ON');
    await expect(soundBtn).not.toHaveClass(/muted/);

    const savedOn = await page.evaluate(() => localStorage.getItem('rts_sound_enabled'));
    expect(savedOn).toBe('true');
  });

  test('aviso visual de capacidade (.capacity-warning) é exibido no teto e removido ao expandir', async ({ page }) => {
    await page.goto('/?sandbox=1');
    await page.waitForSelector('#game[data-ready="true"]');

    const capStatus = page.locator('#capacity-status');
    await expect(capStatus).toBeVisible();

    // No início com 2 operários e 2 de capacidade da Base (2/2), deve ter warning de capacidade atingida
    await expect(capStatus).toContainText('Civil: 2/2');
    await expect(capStatus).toHaveClass(/capacity-warning/);

    // Expandir capacidade adicionando uma Casa concluída
    await page.evaluate(() => {
      const sim = (window as Window & {
        __simulation?: {
          entities: {
            add: (entity: {
              id: string;
              team: 'blue' | 'red';
              category: 'building';
              kind: 'house';
              x: number;
              y: number;
              width: number;
              height: number;
              hp: number;
              maxHp: number;
              vision: number;
              underConstruction: boolean;
              buildProgressTicks: number;
              buildTotalTicks: number;
            }) => void;
          };
        };
      }).__simulation;
      if (sim) {
        sim.entities.add({
          id: 'blue-house-test',
          team: 'blue',
          category: 'building',
          kind: 'house',
          x: 24,
          y: 95,
          width: 2,
          height: 2,
          hp: 250,
          maxHp: 250,
          vision: 7,
          underConstruction: false,
          buildProgressTicks: 80,
          buildTotalTicks: 80,
        });
      }
    });

    // Agora com a Casa concluída, capacidade civil expande para 2/4, warning deve sumir
    await expect(capStatus).toContainText('Civil: 2/4');
    await expect(capStatus).not.toHaveClass(/capacity-warning/);

    // Gerar 2 operários via sandbox para encher 4/4
    for (let i = 0; i < 2; i++) {
      await page.locator('#sb-spawn-worker').click();
    }

    // Agora atingiu 4/4 civil, warning deve voltar
    await expect(capStatus).toContainText('Civil: 4/4');
    await expect(capStatus).toHaveClass(/capacity-warning/);
  });
});

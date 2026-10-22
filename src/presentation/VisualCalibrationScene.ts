import Phaser from 'phaser';
import type { BuildingKind, UnitKind } from '../core/entities/EntityStore';
import {
  availableUnitKey, barricadeTextureKey, builderUnitSheetKey, BUILDING_VISUALS, buildingKey, EFFECT_VISUALS,
  preloadTinySwords, RESOURCE_VISUALS, UNIT_VISUALS, WORLD_VISUAL_METRICS, type UnitVisualState,
} from './VisualRegistry';
import { registerBarricadeTextures } from './BarricadeVisuals';

const UNIT_ORDER: Array<{ kind: UnitKind; label: string }> = [
  { kind: 'worker', label: 'Operário' },
  { kind: 'builder', label: 'Construtor' },
  { kind: 'soldier', label: 'Soldado' },
  { kind: 'archer', label: 'Arqueiro' },
  { kind: 'shieldbearer', label: 'Escudeiro' },
  { kind: 'scout', label: 'Batedor' },
];

const BUILDING_ORDER: Array<{ kind: BuildingKind; label: string }> = [
  { kind: 'base', label: 'Base' },
  { kind: 'house', label: 'Casa' },
  { kind: 'barracks', label: 'Quartel' },
  { kind: 'tower', label: 'Torre' },
  { kind: 'barricade', label: 'Barricada' },
];

/** Side-by-side, presentation-only comparison board; it never creates simulation entities. */
export class VisualCalibrationScene extends Phaser.Scene {
  constructor() {
    super('VisualCalibration');
  }

  preload(): void {
    preloadTinySwords(this);
  }

  create(): void {
    document.body.classList.add('visual-calibration-mode');
    const assetCalibration = new URLSearchParams(window.location.search).has('assets');
    document.body.classList.toggle('unit-visual-debug-mode', !assetCalibration);
    this.events.once('shutdown', () => {
      document.body.classList.remove('visual-calibration-mode', 'unit-visual-debug-mode');
    });
    this.cameras.main.setBackgroundColor('#47aaa7').setRoundPixels(true);
    registerBarricadeTextures(this);

    if (assetCalibration) {
      this.drawBoard();
      this.drawUnits();
      this.drawBuildings();
      this.drawEnvironment();
      this.drawEffectsAndOverlays();
      this.drawFortificationExamples();
    } else {
      this.drawUnitReadabilityBoard();
    }
  }

  private drawUnitReadabilityBoard(): void {
    const board = this.add.graphics();
    board.fillStyle(0x164f57, 1).fillRect(0, 0, 1440, 810);
    board.fillStyle(0xf4e4b9, 1).fillRoundedRect(18, 14, 1404, 782, 16);
    board.lineStyle(4, 0x402f2a, 1).strokeRoundedRect(18, 14, 1404, 782, 16);
    board.lineStyle(2, 0xc59a5b, 1).strokeRoundedRect(25, 21, 1390, 768, 12);

    this.add.text(720, 31, 'LEITURA VISUAL DAS UNIDADES', {
      fontFamily: 'Georgia, serif', fontSize: '25px', color: '#fff1ce', fontStyle: 'bold',
      stroke: '#183e48', strokeThickness: 5,
    }).setOrigin(0.5);
    this.add.text(720, 59, 'Ampliação para comparar silhuetas · proporções preservadas · sem seleção', {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#e3f1da', stroke: '#183e48', strokeThickness: 3,
    }).setOrigin(0.5);

    const classXs = [150, 378, 606, 834, 1062, 1290];
    const rows = [
      { top: 91, bottom: 225, baseline: 192, team: 'blue' as const, heading: 'EQUIPE AZUL  ·  assets Yellow' },
      { top: 232, bottom: 366, baseline: 333, team: 'red' as const, heading: 'EQUIPE VERMELHA  ·  assets Red' },
    ];
    for (const row of rows) {
      board.fillStyle(row.team === 'blue' ? 0xeaf0ce : 0xf3d9ca, 1).fillRoundedRect(36, row.top, 1368, row.bottom - row.top, 8);
      board.lineStyle(1, 0xc9a878, 0.85).strokeRoundedRect(36, row.top, 1368, row.bottom - row.top, 8);
      this.add.text(52, row.top + 8, row.heading, {
        fontFamily: 'Arial, sans-serif', fontSize: '13px', color: row.team === 'blue' ? '#365e51' : '#854b43', fontStyle: 'bold',
      });
      UNIT_ORDER.forEach(({ kind, label }, index) => {
        const state: UnitVisualState = kind === 'shieldbearer' ? 'guard' : kind === 'scout' ? 'move' : 'idle';
        this.drawUnitPortrait(kind, row.team, state, classXs[index], row.baseline, 2.1, true);
        this.add.text(classXs[index], row.bottom - 25, label, {
          fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#405846', fontStyle: 'bold',
          align: 'center',
        }).setOrigin(0.5, 0);
      });
    }

    this.drawGroupCard(board, 36, 382, 670, 174, 'OPERÁRIO × CONSTRUTOR', '5 operários + 5 construtores alternados, sem seleção');
    this.drawGroupCard(board, 734, 382, 670, 174, 'SOLDADO × ESCUDEIRO', '5 soldados + 5 escudeiros alternados, sem seleção');
    for (let i = 0; i < 10; i += 1) {
      const leftX = 90 + i * 62;
      const workerKind = i % 2 === 0 ? 'worker' : 'builder';
      this.drawUnitPortrait(workerKind, 'blue', 'idle', leftX, 520, 1.55);

      const rightX = 788 + i * 62;
      const militaryKind = i % 2 === 0 ? 'soldier' : 'shieldbearer';
      this.drawUnitPortrait(militaryKind, 'blue', militaryKind === 'shieldbearer' ? 'guard' : 'idle', rightX, 520, 1.55);
    }
    this.add.text(371, 530, 'Operário  ·  Construtor', { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#51624b' }).setOrigin(0.5, 0);
    this.add.text(1069, 530, 'Soldado  ·  Escudeiro', { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#51624b' }).setOrigin(0.5, 0);

    board.fillStyle(0xfff3d1, 1).fillRoundedRect(36, 574, 1368, 204, 8);
    board.lineStyle(1, 0xc9a878, 0.85).strokeRoundedRect(36, 574, 1368, 204, 8);
    this.add.text(52, 586, 'GRUPO MILITAR MISTO  ·  3 soldados + 3 arqueiros + 3 escudeiros + 2 batedores', {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#385c4b', fontStyle: 'bold',
    });

    const army: UnitKind[] = ['soldier', 'archer', 'shieldbearer', 'scout', 'soldier', 'archer', 'shieldbearer', 'scout', 'soldier', 'archer', 'shieldbearer'];
    const zooms = [
      { centerX: 264, scale: 0.9, label: 'ZOOM DISTANTE' },
      { centerX: 720, scale: 1.1, label: 'ZOOM PADRÃO' },
      { centerX: 1176, scale: 1.25, label: 'ZOOM PRÓXIMO' },
    ];
    board.lineStyle(1, 0xc9a878, 0.75).lineBetween(492, 626, 492, 766).lineBetween(948, 626, 948, 766);
    for (const zoom of zooms) {
      this.add.text(zoom.centerX, 612, zoom.label, {
        fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#51624b', fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      army.forEach((kind, index) => {
        const frontRank = index < 6;
        const rankIndex = frontRank ? index : index - 6;
        const rankCount = frontRank ? 6 : 5;
        const state: UnitVisualState = kind === 'shieldbearer' ? 'guard' : kind === 'scout' ? 'move' : 'idle';
        this.drawUnitPortrait(
          kind, 'blue', state,
          zoom.centerX - ((rankCount - 1) * 52) / 2 + rankIndex * 52,
          frontRank ? 688 : 752,
          zoom.scale,
        );
      });
    }
  }

  private drawGroupCard(board: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, title: string, subtitle: string): void {
    board.fillStyle(0xfff3d1, 1).fillRoundedRect(x, y, width, height, 8);
    board.lineStyle(1, 0xc9a878, 0.85).strokeRoundedRect(x, y, width, height, 8);
    this.add.text(x + 16, y + 10, title, {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#385c4b', fontStyle: 'bold',
    });
    this.add.text(x + 16, y + 31, subtitle, {
      fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#51624b',
    });
  }

  private drawUnitPortrait(
    kind: UnitKind,
    team: 'blue' | 'red',
    state: UnitVisualState,
    x: number,
    baseline: number,
    multiplier: number,
    showHealthBar = false,
  ): void {
    const metrics = UNIT_VISUALS[kind];
    const builderKey = kind === 'builder' ? builderUnitSheetKey(team, state) : null;
    const key = builderKey && this.textures.exists(builderKey)
      ? builderKey
      : availableUnitKey(this, team, kind, state);
    if (!key) return;
    this.add.image(x, baseline, key, 0)
      .setOrigin(0.5, metrics.originY)
      .setDisplaySize(metrics.frameDisplaySize * multiplier, metrics.frameDisplaySize * multiplier)
      .setDepth(2);

    if (showHealthBar) {
      const visibleHeight = metrics.visibleHeight * multiplier;
      const visibleWidth = Math.max(12, metrics.visibleWidth * multiplier);
      const barY = baseline - visibleHeight - WORLD_VISUAL_METRICS.unitHpBarGap;
      const bar = this.add.graphics().setDepth(3);
      bar.fillStyle(0x160f12, 0.9).fillRect(x - visibleWidth / 2, barY, visibleWidth, WORLD_VISUAL_METRICS.unitHpBarHeight);
      bar.fillStyle(0x71bd55, 1).fillRect(x - visibleWidth / 2, barY, visibleWidth, WORLD_VISUAL_METRICS.unitHpBarHeight);
    }
  }

  private drawBoard(): void {
    const board = this.add.graphics();
    board.fillStyle(0x164f57, 1).fillRect(0, 0, 960, 900);
    board.fillStyle(0xf4e4b9, 1).fillRoundedRect(18, 14, 924, 872, 16);
    board.lineStyle(4, 0x402f2a, 1).strokeRoundedRect(18, 14, 924, 872, 16);
    board.lineStyle(2, 0xc59a5b, 1).strokeRoundedRect(25, 21, 910, 858, 12);

    this.add.text(480, 35, 'COMPARATIVO DE ESCALA', {
      fontFamily: 'Georgia, serif', fontSize: '24px', color: '#fff1ce',
      fontStyle: 'bold', stroke: '#183e48', strokeThickness: 5,
    }).setOrigin(0.5);
    this.add.text(480, 62, 'Assets e fortificações lado a lado · ponto inferior alinhado · sem alterar footprints', {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#e3f1da',
      stroke: '#183e48', strokeThickness: 3,
    }).setOrigin(0.5);

    const rows = [
      { y: 86, height: 118, label: 'UNIDADES  ·  soldado = referência 1.0' },
      { y: 224, height: 118, label: 'CONSTRUÇÕES  ·  escala visual; footprints originais preservados' },
      { y: 371, height: 118, label: 'ÁRVORES, RECURSOS E RELEVO' },
      { y: 510, height: 72, label: 'EFEITOS, SELEÇÃO E BARRAS DE VIDA' },
    ];
    for (const row of rows) {
      board.fillStyle(0xfff3d1, 1).fillRoundedRect(34, row.y, 892, row.height, 8);
      board.lineStyle(1, 0xc9a878, 0.8).strokeRoundedRect(34, row.y, 892, row.height, 8);
      this.add.text(48, row.y + 7, row.label, {
        fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#385c4b',
        fontStyle: 'bold',
      });
    }
  }

  private drawUnits(): void {
    const baseline = 177;
    this.drawBaseline(baseline, 56, 904);
    UNIT_ORDER.forEach(({ kind, label }, index) => {
      const x = 126 + index * 142;
      const metrics = UNIT_VISUALS[kind];
      const builderKey = kind === 'builder' ? builderUnitSheetKey('blue', 'idle') : null;
      const key = builderKey && this.textures.exists(builderKey) ? builderKey : availableUnitKey(this, 'blue', kind, 'idle');
      if (key) {
        const sprite = this.add.image(x, baseline, key, 0)
          .setOrigin(0.5, metrics.originY)
          .setDisplaySize(metrics.frameDisplaySize, metrics.frameDisplaySize);
        sprite.setDepth(2);
      }
      this.addLabel(x, 183, label, `${metrics.visibleHeight.toFixed(1)} px`);
    });
  }

  private drawBuildings(): void {
    const baseline = 324;
    this.drawBaseline(baseline, 56, 904);
    BUILDING_ORDER.forEach(({ kind, label }, index) => {
      const x = 145 + index * 168;
      const metrics = BUILDING_VISUALS[kind];
      const key = buildingKey('blue', kind);
      if (this.textures.exists(key)) {
        this.add.image(x, baseline, key)
          .setOrigin(metrics.originX, metrics.originY)
          .setDisplaySize(metrics.width, metrics.height)
          .setDepth(2);
      }
      this.addLabel(x, 330, label, `${metrics.width} × ${metrics.height}`);
    });
  }

  private drawEnvironment(): void {
    const baseline = 449;
    this.drawBaseline(baseline, 48, 912);
    const columns = [70, 162, 254, 346, 438, 530, 622, 714, 806, 898];
    const items = [
      { label: 'Árvore pequena', key: 'tiny-tree2', metrics: RESOURCE_VISUALS.smallTree, frame: 0 },
      { label: 'Árvore A', key: 'tiny-tree1', metrics: RESOURCE_VISUALS.forestTreeA, frame: 0 },
      { label: 'Árvore B', key: 'tiny-tree3', metrics: RESOURCE_VISUALS.forestTreeB, frame: 0 },
      { label: 'Arbusto', key: 'tiny-bush', metrics: RESOURCE_VISUALS.bush, frame: 0 },
      { label: 'Jazida de ouro', key: 'tiny-gold6', metrics: RESOURCE_VISUALS.gold, frame: 0 },
      { label: 'Pedra coletável', key: 'tiny-stone', metrics: RESOURCE_VISUALS.stoneDeposit, frame: 0 },
      { label: 'Pedra decorativa', key: 'tiny-stone1', metrics: RESOURCE_VISUALS.decorationStone, frame: 0 },
      { label: 'Face da montanha', key: 'tiny-terrainHigh', metrics: { width: 12, height: 24, originX: 0.5, originY: 1 }, frame: 'calibration-cliff' },
      { label: 'Rocha d’água', key: 'tiny-waterRock', metrics: RESOURCE_VISUALS.waterRock, frame: 0 },
      { label: 'Espuma', key: 'tiny-waterFoam', metrics: RESOURCE_VISUALS.waterFoam, frame: 0 },
    ];
    const terrainHigh = this.textures.get('tiny-terrainHigh');
    if (terrainHigh?.key !== '__MISSING' && !terrainHigh.has('calibration-cliff')) {
      terrainHigh.add('calibration-cliff', 0, 384, 256, 64, 128);
    }
    items.forEach((item, index) => {
      const x = columns[index];
      if (this.textures.exists(item.key)) {
        this.add.image(x, baseline, item.key, item.frame)
          .setOrigin(item.metrics.originX, item.metrics.originY)
          .setDisplaySize(item.metrics.width, item.metrics.height)
          .setDepth(2);
      }
      this.addLabel(x, 455, item.label);
    });
  }

  private drawEffectsAndOverlays(): void {
    const baseline = 561;
    const columns = [112, 260, 408, 556, 704, 852];
    this.drawBaseline(baseline, 56, 904);
    const effectItems = [
      { label: 'Poeira', key: 'tiny-dust', frame: 0, size: EFFECT_VISUALS.dust.width },
      { label: 'Explosão', key: 'tiny-explosion', frame: 0, size: EFFECT_VISUALS.explosion.width },
      { label: 'Projétil', key: 'tiny-arrowYellow', frame: 0, size: EFFECT_VISUALS.projectile.width },
    ];
    effectItems.forEach((item, index) => {
      if (this.textures.exists(item.key)) {
        this.add.image(columns[index], baseline - 14, item.key, item.frame)
          .setDisplaySize(item.size, item.size)
          .setDepth(2);
      }
      this.add.text(columns[index], 569, item.label, {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#4c614e',
      }).setOrigin(0.5, 0);
    });

    const markers = this.add.graphics().setDepth(2);
    markers.lineStyle(1.5, 0x8c712d, 1).strokeEllipse(columns[3], baseline - 13, 19, 7);
    this.add.text(columns[3], 562, 'Seleção', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#4c614e' }).setOrigin(0.5, 0);

    markers.fillStyle(0x462d2a, 1).fillRect(columns[4] - 9, baseline - 14, 18, 3);
    markers.fillStyle(0x71bd55, 1).fillRect(columns[4] - 9, baseline - 14, 13, 3);
    this.add.text(columns[4], 562, 'HP unidade', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#4c614e' }).setOrigin(0.5, 0);

    markers.fillStyle(0x462d2a, 1).fillRect(columns[5] - 25, baseline - 14, 50, 4);
    markers.fillStyle(0x71bd55, 1).fillRect(columns[5] - 25, baseline - 14, 36, 4);
    this.add.text(columns[5], 562, 'HP construção', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#4c614e' }).setOrigin(0.5, 0);
  }

  private drawFortificationExamples(): void {
    const panel = this.add.graphics();
    panel.fillStyle(0xfff3d1, 1).fillRoundedRect(34, 600, 892, 270, 8);
    panel.lineStyle(1, 0xc9a878, 0.8).strokeRoundedRect(34, 600, 892, 270, 8);
    this.add.text(48, 608, 'FORTIFICAÇÕES  ·  conexão visual por vizinhos cardinais  ·  torre, linha, junções e tropas', {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#385c4b', fontStyle: 'bold',
    });
    const centers = [82, 196, 310, 424, 538, 652, 766, 880];
    const labels = ['Isolada', '5 horizontal', '10 horizontal', '5 vertical', 'Canto L', 'Junção T', 'Cruzamento', 'Linha partida'];
    centers.forEach((x, index) => this.add.text(x, 718, labels[index], {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#405846', align: 'center',
      wordWrap: { width: 118, useAdvancedWrap: true },
    }).setOrigin(0.5, 0));
    const foot = 710;
    const add = (x: number, mask: number, y = foot): Phaser.GameObjects.Image => this.add.image(x, y, barricadeTextureKey(mask))
      .setOrigin(0.5, BUILDING_VISUALS.barricade.originY)
      .setDisplaySize(BUILDING_VISUALS.barricade.width, BUILDING_VISUALS.barricade.height).setDepth(y);
    add(centers[0], 0);
    for (let i = 0; i < 5; i += 1) add(centers[1] - 24 + i * 12, (i > 0 ? 8 : 0) | (i < 4 ? 2 : 0));
    for (let i = 0; i < 10; i += 1) add(centers[2] - 54 + i * 12, (i > 0 ? 8 : 0) | (i < 9 ? 2 : 0));
    for (let i = 0; i < 5; i += 1) add(centers[3], (i > 0 ? 1 : 0) | (i < 4 ? 4 : 0), foot - 48 + i * 12);
    add(centers[4] - 12, 2); add(centers[4], 10); add(centers[4] + 12, 9); add(centers[4] + 12, 4, foot - 12);
    add(centers[5] - 6, 2); add(centers[5], 11); add(centers[5] + 6, 8); add(centers[5], 4, foot - 12);
    add(centers[6], 4, foot - 12); add(centers[6], 15); add(centers[6], 1, foot + 12);
    add(centers[6] - 12, 2); add(centers[6] + 12, 8);
    add(centers[7] - 12, 2); add(centers[7], 0); add(centers[7] + 12, 8);
    const tower = BUILDING_VISUALS.tower;
    if (this.textures.exists(buildingKey('blue', 'tower'))) {
      this.add.image(700, 850, buildingKey('blue', 'tower')).setOrigin(tower.originX, tower.originY)
        .setDisplaySize(tower.width, tower.height).setDepth(foot + 1);
    }
    for (let i = 0; i < 5; i += 1) add(736 + i * 12, (i > 0 ? 8 : 0) | (i < 4 ? 2 : 0), 850);
    const archerKey = availableUnitKey(this, 'blue', 'archer', 'idle');
    for (const [x, behind] of [[180, true], [460, false]] as const) {
      for (let i = 0; i < 5; i += 1) add(x - 24 + i * 12, (i > 0 ? 8 : 0) | (i < 4 ? 2 : 0), 850);
      if (archerKey) this.add.image(x, behind ? 848 : 853, archerKey, 0)
        .setOrigin(0.5, UNIT_VISUALS.archer.originY)
        .setDisplaySize(UNIT_VISUALS.archer.frameDisplaySize, UNIT_VISUALS.archer.frameDisplaySize)
        .setDepth(behind ? 845 : 855);
    }
    this.add.text(180, 859, 'Arqueiro atrás da linha', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#405846' }).setOrigin(0.5, 0);
    this.add.text(460, 859, 'Arqueiro à frente da linha', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#405846' }).setOrigin(0.5, 0);
    this.add.text(730, 859, 'Torre + barricadas', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#405846' }).setOrigin(0.5, 0);
  }

  private drawBaseline(y: number, x: number, width: number): void {
    this.add.graphics().lineStyle(1, 0x8d8065, 0.48).lineBetween(x, y, x + width, y);
  }

  private addLabel(x: number, y: number, title: string, subtitle?: string): void {
    this.add.text(x, y, subtitle ? `${title}\n${subtitle}` : title, {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#405846',
      align: 'center', lineSpacing: 1,
      wordWrap: { width: 86, useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
  }
}

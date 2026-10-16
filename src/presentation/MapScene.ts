import Phaser from 'phaser';
import { MAP_DEFINITION } from '../config/map';
import { BALANCE } from '../config/balance';
import { Simulation } from '../core/game/Simulation';
import { dispatchGroupMove, dispatchGroupAttackMove } from '../core/commands/dispatchGroupMove';
import { dispatchGroupAttack } from '../core/commands/dispatchGroupAttack';
import type { CommandResult } from '../core/commands/MoveCommand';
import type { BuildingEntity, GameEntity, UnitEntity, UnitKind } from '../core/entities/EntityStore';
import type { MovementEvent } from '../core/systems/MovementSystem';
import { TICKS_PER_SECOND } from '../config/runtime';
import { SelectionModel } from '../input/SelectionModel';
import type { Point, Team, Terrain } from '../map/MapGrid';
import { VisualFog } from './VisualFog';
import { Minimap } from './Minimap';
import { SoundSystem } from './SoundSystem';
import {
  assignFormationSlots,
  getMarchDirection,
  isMilitaryKind,
  type FormationType,
  type FormationUnitInfo,
} from '../core/formations/FormationGeometry';
import { computeLineCells } from '../core/construction/LineGeometry';
import { availableUnitKey, buildingKey, frameCount, preloadTinySwords, UNIT_VISUALS, type UnitVisualState } from './VisualRegistry';

const CELL_SIZE = 12;
const PAN_SPEED = 500;
const MIN_ZOOM = 0.38;
const MAX_ZOOM = 2.5;
const UNIT_COLORS: Record<UnitKind, number> = {
  worker: 0xe8bb77, soldier: 0xf27769, archer: 0xa4d96c,
  shieldbearer: 0xb69ce3, scout: 0x69d7d5, builder: 0xdd8833,
};
const COLORS: Record<Terrain, number> = {
  plain: 0x17252c,
  water: 0x286276,
  mountain: 0x68727a,
  forest: 0x346b51,
  mine: 0xd5a64e,
  stone: 0x828b94,
};
const LABELS: Record<string, string> = {
  base: 'Base', worker: 'Operário', builder: 'Construtor', soldier: 'Soldado', shieldbearer: 'Escudeiro',
  scout: 'Batedor', archer: 'Arqueiro', house: 'Casa', barracks: 'Quartel', barricade: 'Barricada',
  tower: 'Torre de Vigilância',
};
const REJECTION_REASONS: Record<string, string> = {
  cooldown: 'aguarde a próxima ação',
  'no-path': 'não há caminho livre',
  'invalid-destination': 'destino bloqueado ou ocupado',
  'already-there': 'a unidade já está no destino',
  'insufficient-coins': 'moedas insuficientes',
  'insufficient-wood': 'madeira insuficiente',
  'insufficient-stone': 'pedra insuficiente',
  'target-not-visible': 'alvo fora da visão',
  'target-not-found': 'alvo não existe mais',
  'out-of-range': 'alvo fora do alcance',
  'out-of-build-range': 'construção a mais de 80 casas da base',
  'cannot-attack': 'esta unidade não ataca',
  'unit-cap': 'limite de população atingido',
  'unit-cap-reached': 'limite global de 60 unidades atingido',
  'civilian-capacity-reached': 'capacidade civil esgotada (construa Casas)',
  'military-capacity-reached': 'capacidade militar esgotada (construa Quartéis)',
  'not-builder': 'somente construtores podem construir barricadas, torres ou reparar',
  'building-limit-reached': 'limite de construções atingido',
  'building-at-max-hp': 'construção já com vida máxima',
};
function rejection(reason: string | undefined): string {
  return reason ? `${REJECTION_REASONS[reason] ?? reason} (${reason})` : 'motivo desconhecido';
}

function formatMatchTime(ticks: number): string {
  const seconds = Math.floor(ticks / TICKS_PER_SECOND);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

interface MotionTrack {
  path: MovementEvent['path'];
  elapsedMs: number;
  durationMs: number;
}

interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: number;
  elapsedMs: number;
  totalMs: number;
  projectile?: Phaser.GameObjects.Image;
}

interface WorldEffect {
  kind: 'ring' | 'spark' | 'dust' | 'explosion';
  x: number;
  y: number;
  team: Team;
  color: number;
  elapsedMs: number;
  totalMs: number;
  sprite?: Phaser.GameObjects.Image;
}

/** Map rendering and camera input; logical terrain remains in MapGrid. */
export class MapScene extends Phaser.Scene {
  private readonly simulation = new Simulation(123, !new URLSearchParams(window.location.search).has('noai'));
  private readonly map = this.simulation.map;
  private readonly selection = new SelectionModel(this.simulation.entities, 'blue');
  private readonly visualFog = new VisualFog(this.map, this.simulation.entities, 'blue');
  private readonly minimap = new Minimap({ map: this.map, entities: this.simulation.entities, fog: this.visualFog, playerTeam: 'blue' });
  private dragStart: { x: number; y: number; worldX: number; worldY: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private dragged = false;
  private dragMode: 'pan' | 'select' | 'barricade' | null = null;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private terrainTexture?: Phaser.GameObjects.RenderTexture;
  private terrainTiles?: Phaser.GameObjects.TileSprite;
  private readonly entitySprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly spriteVisualCache = new Map<string, { key: string; frame: number; x: number; y: number; size: number }>();
  private readonly terrainDetails: Phaser.GameObjects.Image[] = [];
  private readonly attackVisualUntil = new Map<string, number>();
  private lastDetailBounds = '';
  private detailsDirty = true;
  private readonly lastEntityView = { x: NaN, y: NaN, width: NaN, height: NaN };
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private selectionBoxGraphics!: Phaser.GameObjects.Graphics;
  private entityGraphics!: Phaser.GameObjects.Graphics;
  private combatGraphics!: Phaser.GameObjects.Graphics;
  private worldGraphics!: Phaser.GameObjects.Graphics;
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private placementGhostGraphics!: Phaser.GameObjects.Graphics;
  private formationPreviewGraphics!: Phaser.GameObjects.Graphics;
  private placementMode: { kind: 'house' | 'barracks' | 'barricade' | 'tower'; width: number; height: number } | null = null;
  private barricadeDragStart: Point | null = null;
  private barricadeLineCells: Point[] = [];
  private barricadeLastEndCell: Point | null = null;
  private barricadeLineValidation: { valid: boolean; reason?: string } | null = null;
  private attackMoveMode = false;
  private rallyPlacementMode = false;
  private rallyBuildingId: string | null = null;
  private currentActionBarMode = 'none';
  private readonly displayPositions = new Map<string, { x: number; y: number }>();
  private readonly motionTracks = new Map<string, MotionTrack>();
  private readonly attackEffects: AttackEffect[] = [];
  private readonly worldEffects: WorldEffect[] = [];
  private readonly effectPool: Phaser.GameObjects.Image[] = [];
  private readonly projectilePool: Phaser.GameObjects.Image[] = [];
  private lastAmbientSecond = 0;
  private readonly soundSystem = new SoundSystem();
  private lastBlueWood = BALANCE.startingState.wood;
  private lastBlueCoins = BALANCE.startingState.coins;
  private lastBlueStone = BALANCE.startingState.stone ?? 0;
  private readonly lastVisibleEnemies = new Set<string>();
  private readonly underConstructionBuildingIds = new Set<string>();
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly debug = new URLSearchParams(window.location.search).has('debug');
  private resultShown = false;
  private lastVisibleCount = -1;
  private lastExploredCount = -1;
  private lastCamX = '';
  private lastCamY = '';
  private lastZoom = '';
  private lastPerformanceFrame = 0;

  constructor() {
    super('Map');
  }

  preload(): void {
    preloadTinySwords(this);
  }

  create(): void {
    if (new URLSearchParams(window.location.search).has('perf')) this.events.once('create', () => this.installDiagnostics());
    const worldWidth = this.map.width * CELL_SIZE;
    const worldHeight = this.map.height * CELL_SIZE;
    this.cameras.main.setBackgroundColor('#101a20');
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setZoom(1.25);
    this.cameras.main.centerOn((MAP_DEFINITION.teamStarts.blue.base[0] + 10) * CELL_SIZE, (MAP_DEFINITION.teamStarts.blue.base[1] + 2) * CELL_SIZE);
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit') this.displayPositions.set(entity.id, { x: entity.x, y: entity.y });
    }
    this.visualFog.update(this.displayPositions);
    const tiles = this.textures.get('tiny-terrain');
    if (tiles?.key !== '__MISSING') {
      tiles.add('grass', 0, 64, 64, 64, 64);
    }
    this.drawMap();
    this.fogGraphics = this.add.graphics();
    this.drawFog();
    this.entityGraphics = this.add.graphics();
    this.entityGraphics.setDepth(3);
    this.combatGraphics = this.add.graphics();
    this.combatGraphics.setDepth(4);
    this.worldGraphics = this.add.graphics();
    this.worldGraphics.setDepth(5);
    this.drawEntities();
    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(6);
    this.selectionBoxGraphics = this.add.graphics();
    this.selectionBoxGraphics.setDepth(7);
    this.placementGhostGraphics = this.add.graphics();
    this.placementGhostGraphics.setDepth(7);
    this.formationPreviewGraphics = this.add.graphics();
    this.formationPreviewGraphics.setDepth(7);
    this.refreshSelection();
    this.refreshTeamStatus();
    this.input.mouse?.disableContextMenu();
    (window as Window & { __simulation?: Simulation }).__simulation = this.simulation;

    const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
    if (minimapCanvas) {
      this.minimap.attach(minimapCanvas, (cellX, cellY) => {
        this.centerCameraOn(cellX, cellY);
      });
    }
    this.events.on('shutdown', () => {
      this.minimap.detach();
    });

    const soundBtn = document.querySelector<HTMLButtonElement>('#btn-sound-toggle');
    const updateSoundBtn = () => {
      if (!soundBtn) return;
      const on = this.soundSystem.isEnabled();
      soundBtn.textContent = on ? '🔊 Som: ON' : '🔇 Som: OFF';
      soundBtn.classList.toggle('muted', !on);
    };
    updateSoundBtn();
    soundBtn?.addEventListener('click', () => {
      this.soundSystem.unlock();
      this.soundSystem.toggle();
      updateSoundBtn();
    });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const name of ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT']) {
        this.keys[name] = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes]);
      }
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.soundSystem.unlock();
      if (this.simulation.result) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.dragStart = { x: pointer.x, y: pointer.y, worldX: world.x, worldY: world.y };
      this.lastPointer = { x: pointer.x, y: pointer.y };
      this.dragged = false;

      if (this.placementMode?.kind === 'barricade' && pointer.button === 0) {
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        this.barricadeDragStart = [gx, gy];
        this.barricadeLastEndCell = [gx, gy];
        this.barricadeLineCells = computeLineCells([gx, gy], [gx, gy], { width: this.map.width, height: this.map.height });
        const builder = this.selection.selectedEntities.find(
          (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
        );
        this.barricadeLineValidation = builder
          ? this.simulation.construction.validateBuildLine({
              type: 'build-line',
              team: 'blue',
              builderId: builder.id,
              buildingKind: 'barricade',
              cells: this.barricadeLineCells,
            }, this.simulation.clock.ticks)
          : { valid: false, reason: 'unknown-unit' };
        this.dragMode = 'barricade';
        return;
      }

      this.dragMode = pointer.button === 0 ? 'select' : 'pan';
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      if (this.placementMode) {
        if (this.placementMode.kind === 'barricade') {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const gx = Math.floor(world.x / CELL_SIZE);
          const gy = Math.floor(world.y / CELL_SIZE);
          const builder = this.selection.selectedEntities.find(
            (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
          );

          if (this.barricadeDragStart) {
            if (!this.barricadeLastEndCell || this.barricadeLastEndCell[0] !== gx || this.barricadeLastEndCell[1] !== gy) {
              this.barricadeLastEndCell = [gx, gy];
              this.barricadeLineCells = computeLineCells(this.barricadeDragStart, [gx, gy], { width: this.map.width, height: this.map.height });
              this.barricadeLineValidation = builder
                ? this.simulation.construction.validateBuildLine({
                    type: 'build-line',
                    team: 'blue',
                    builderId: builder.id,
                    buildingKind: 'barricade',
                    cells: this.barricadeLineCells,
                  }, this.simulation.clock.ticks)
                : { valid: false, reason: 'unknown-unit' };
            }
          } else {
            this.barricadeLineCells = [[gx, gy]];
            this.barricadeLineValidation = builder
              ? this.simulation.construction.validateBuildLine({
                  type: 'build-line',
                  team: 'blue',
                  builderId: builder.id,
                  buildingKind: 'barricade',
                  cells: this.barricadeLineCells,
                }, this.simulation.clock.ticks)
              : { valid: false, reason: 'unknown-unit' };
          }

          this.placementGhostGraphics.clear();
          const base = this.simulation.entities.get('blue-base');
          if (base && base.category === 'building') {
            const baseCenterPxX = (base.x + base.width / 2) * CELL_SIZE;
            const baseCenterPxY = (base.y + base.height / 2) * CELL_SIZE;
            this.placementGhostGraphics.lineStyle(1.5, 0x6da2b5, 0.35);
            this.placementGhostGraphics.strokeCircle(baseCenterPxX, baseCenterPxY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
          }

          const isValid = this.barricadeLineValidation?.valid ?? false;
          const color = isValid ? 0x44dd88 : 0xdd4444;

          this.placementGhostGraphics.fillStyle(color, 0.35);
          this.placementGhostGraphics.lineStyle(2, color, 1);
          for (const [cx, cy] of this.barricadeLineCells) {
            this.placementGhostGraphics.fillRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            this.placementGhostGraphics.strokeRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }

          const count = this.barricadeLineCells.length;
          const woodCost = count * BALANCE.buildings.barricade.wood;
          const stoneCost = count * (BALANCE.buildings.barricade.stone ?? 0);
          const fb = document.querySelector('#command-feedback');
          if (fb) {
            if (this.barricadeDragStart) {
              fb.textContent = isValid
                ? `Linha de ${count} barricada(s) válida. Custo: ${woodCost} madeira, ${stoneCost} pedra.`
                : `Linha de ${count} barricada(s) inválida: ${rejection(this.barricadeLineValidation?.reason)} (Custo: ${woodCost}m, ${stoneCost}p).`;
            } else {
              fb.textContent = `Construir Barricada (${woodCost}m, ${stoneCost}p). Clique e arraste para traçar linha.`;
            }
          }
          return;
        }

        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const { kind, width, height } = this.placementMode;
        const config = BALANCE.buildings[kind];
        const stock = this.simulation.teams.blue;
        let valid = this.simulation.entities.isAreaFreeForBuilding(gx, gy, width, height)
          && stock.coins >= config.coins && stock.wood >= config.wood && stock.stone >= ((config as { stone?: number }).stone ?? 0);
        const base = this.simulation.entities.get('blue-base');
        let outOfBuildRange = false;
        if (base && base.category === 'building') {
          const baseCenterX = base.x + (base.width - 1) / 2;
          const baseCenterY = base.y + (base.height - 1) / 2;
          const buildCenterX = gx + (width - 1) / 2;
          const buildCenterY = gy + (height - 1) / 2;
          if (Math.hypot(buildCenterX - baseCenterX, buildCenterY - baseCenterY)
            > BALANCE.construction.maxDistanceFromBase) {
            valid = false;
            outOfBuildRange = true;
          }
        }
        for (let y = gy; y < gy + height; y += 1) {
          for (let x = gx; x < gx + width; x += 1) {
            if (this.simulation.fog.stateAt('blue', x, y) === 'unknown') valid = false;
          }
        }
        this.placementGhostGraphics.clear();
        if (base && base.category === 'building') {
          const baseCenterPxX = (base.x + base.width / 2) * CELL_SIZE;
          const baseCenterPxY = (base.y + base.height / 2) * CELL_SIZE;
          this.placementGhostGraphics.lineStyle(1.5, 0x6da2b5, 0.35);
          this.placementGhostGraphics.strokeCircle(baseCenterPxX, baseCenterPxY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
        }
        const ghostCenterPxX = (gx + width / 2) * CELL_SIZE;
        const ghostCenterPxY = (gy + height / 2) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(1, valid ? 0x44dd88 : 0xdd4444, 0.35);
        if (this.placementMode.kind === 'tower') {
          const halfSpan = 9;
          this.placementGhostGraphics.strokeRect(
            (gx - halfSpan) * CELL_SIZE,
            (gy - halfSpan) * CELL_SIZE,
            20 * CELL_SIZE,
            20 * CELL_SIZE,
          );
        } else {
          this.placementGhostGraphics.strokeCircle(ghostCenterPxX, ghostCenterPxY, config.vision * CELL_SIZE);
        }
        this.placementGhostGraphics.fillStyle(valid ? 0x44dd88 : 0xdd4444, 0.35);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
        this.placementGhostGraphics.lineStyle(2, valid ? 0x44dd88 : 0xdd4444, 1);
        this.placementGhostGraphics.strokeRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
        if (outOfBuildRange) {
          const fb = document.querySelector('#command-feedback');
          if (fb && fb.textContent !== 'Posição além do limite de 80 casas da Base.') {
            fb.textContent = 'Posição além do limite de 80 casas da Base.';
          }
        }
      }
      if (this.attackMoveMode) {
        this.placementGhostGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const cx = (gx + 0.5) * CELL_SIZE;
        const cy = (gy + 0.5) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(2, 0xff4444, 0.85);
        this.placementGhostGraphics.strokeCircle(cx, cy, CELL_SIZE * 0.6);
        this.placementGhostGraphics.lineStyle(1.5, 0xff4444, 0.9);
        this.placementGhostGraphics.lineBetween(cx - CELL_SIZE * 0.8, cy, cx + CELL_SIZE * 0.8, cy);
        this.placementGhostGraphics.lineBetween(cx, cy - CELL_SIZE * 0.8, cx, cy + CELL_SIZE * 0.8);
        this.placementGhostGraphics.fillStyle(0xff4444, 0.2);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
      if (this.rallyPlacementMode) {
        this.placementGhostGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const cx = (gx + 0.5) * CELL_SIZE;
        const cy = (gy + 0.5) * CELL_SIZE;
        this.placementGhostGraphics.lineStyle(2, 0xfacc15, 0.9);
        this.placementGhostGraphics.strokeCircle(cx, cy, CELL_SIZE * 0.5);
        this.placementGhostGraphics.fillStyle(0xfacc15, 0.25);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        this.placementGhostGraphics.lineStyle(2, 0xffffff, 0.9);
        this.placementGhostGraphics.lineBetween(cx, cy + 4, cx, cy - 10);
        this.placementGhostGraphics.fillStyle(0xfacc15, 0.95);
        this.placementGhostGraphics.fillTriangle(cx, cy - 10, cx + 8, cy - 7, cx, cy - 4);
      }

      // Render tactical formation preview when military units are selected
      const militaryUnits = this.selection.selectedEntities.filter(
        (e): e is UnitEntity => e.category === 'unit' && e.team === 'blue' && isMilitaryKind(e.kind) && e.hp > 0,
      );
      if (militaryUnits.length >= 2 && this.selection.formation !== null && !this.placementMode && !this.rallyPlacementMode && !this.dragged) {
        this.formationPreviewGraphics.clear();
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        if (this.map.contains(gx, gy)) {
          let sumX = 0;
          let sumY = 0;
          for (const u of militaryUnits) {
            sumX += u.x;
            sumY += u.y;
          }
          const cx = Math.round(sumX / militaryUnits.length);
          const cy = Math.round(sumY / militaryUnits.length);
          const dir = getMarchDirection([cx, cy], [gx, gy]);
          const unitInfos: FormationUnitInfo[] = militaryUnits.map((u) => ({
            id: u.id,
            kind: u.kind,
            movement: u.movement,
            x: u.x,
            y: u.y,
          }));
          const slots = assignFormationSlots(unitInfos, this.selection.formation, [gx, gy], dir);
          for (const slot of slots) {
            const [sx, sy] = slot.destination;
            if (!this.map.contains(sx, sy)) continue;
            const px = sx * CELL_SIZE;
            const py = sy * CELL_SIZE;
            const isVanguard = slot.role === 'vanguard';
            const color = isVanguard ? 0x38bdf8 : 0x0284c7;
            this.formationPreviewGraphics.fillStyle(color, 0.28);
            this.formationPreviewGraphics.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            this.formationPreviewGraphics.lineStyle(1, color, 0.7);
            this.formationPreviewGraphics.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
        }
      } else {
        this.formationPreviewGraphics.clear();
      }

      if (!pointer.isDown || !this.dragStart || !this.lastPointer) return;
      if (Math.hypot(pointer.x - this.dragStart.x, pointer.y - this.dragStart.y) > 4) this.dragged = true;
      if (this.dragged && this.dragMode === 'pan') {
        this.cameras.main.scrollX -= (pointer.x - this.lastPointer.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - this.lastPointer.y) / this.cameras.main.zoom;
      } else if (this.dragged && this.dragMode === 'select' && !this.placementMode && !this.attackMoveMode && !this.rallyPlacementMode) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.drawSelectionBox(this.dragStart.worldX, this.dragStart.worldY, world.x, world.y);
      }
      this.lastPointer = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      if (this.rallyPlacementMode) {
        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const destination: Point = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
          if (this.rallyBuildingId) {
            const b = this.simulation.entities.get(this.rallyBuildingId);
            const bLabel = b && b.category === 'building' ? LABELS[b.kind] : 'Construção';
            const res = this.simulation.issueCommand({
              type: 'set-rally-point',
              team: 'blue',
              buildingId: this.rallyBuildingId,
              point: destination,
            });
            if (res.accepted) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) {
              feedback.textContent = res.accepted
                ? `Ponto de reunião da ${bLabel} definido para (${destination.join(', ')}).`
                : `Ponto de reunião indisponível: ${rejection(res.reason)}.`;
            }
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Definição de ponto de reunião cancelada.';
        }
        this.rallyPlacementMode = false;
        this.rallyBuildingId = null;
        this.placementGhostGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }
      if (this.attackMoveMode) {
        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const destination: [number, number] = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
          const results = dispatchGroupAttackMove(this.simulation, 'blue', this.selection.selectedIds, destination, this.selection.formation);
          const accepted = results.filter((item) => item.result.accepted).length;
          if (accepted > 0) {
            this.soundSystem.play('order');
            this.addWorldEffect('ring', (destination[0] + 0.5) * CELL_SIZE, (destination[1] + 0.5) * CELL_SIZE, 'blue', 0xff4d4f, 500);
          }
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = results.length === 0
              ? 'Selecione uma unidade azul para Attack Move.'
              : accepted > 0
                ? `${accepted} ordem(ns) de Attack Move enviada(s) para (${destination.join(', ')}).`
                : `Attack Move indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Modo Attack Move cancelado.';
        }
        this.attackMoveMode = false;
        this.placementGhostGraphics.clear();
        this.formationPreviewGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }
      if (this.placementMode) {
        if (this.placementMode.kind === 'barricade') {
          if (pointer.button === 0) {
            const builder = this.selection.selectedEntities.find(
              (e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder' && e.team === 'blue',
            );
            if (builder && this.barricadeLineCells.length > 0) {
              if (this.barricadeLineValidation?.valid) {
                const result = this.simulation.issueCommand({
                  type: 'build-line',
                  team: 'blue',
                  builderId: builder.id,
                  buildingKind: 'barricade',
                  cells: this.barricadeLineCells,
                });
                if (result.accepted) this.soundSystem.play('order');
                const feedback = document.querySelector('#command-feedback');
                if (feedback) {
                  feedback.textContent = result.accepted
                    ? (this.barricadeLineCells.length === 1
                        ? 'Construção de Barricada iniciada.'
                        : `Construção de ${this.barricadeLineCells.length} barricadas iniciada!`)
                    : `Construção indisponível: ${rejection(result.reason)}.`;
                }
              } else {
                const feedback = document.querySelector('#command-feedback');
                if (feedback) {
                  feedback.textContent = `Linha de barricadas inválida: ${rejection(this.barricadeLineValidation?.reason)}. Ordem cancelada.`;
                }
              }
            }
          } else if (pointer.button === 2) {
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = 'Modo de construção de barricada cancelado.';
          }
          this.placementMode = null;
          this.barricadeDragStart = null;
          this.barricadeLineCells = [];
          this.barricadeLastEndCell = null;
          this.barricadeLineValidation = null;
          this.placementGhostGraphics.clear();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          this.refreshSelection();
          this.refreshTeamStatus();
          return;
        }

        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const gx = Math.floor(world.x / CELL_SIZE);
          const gy = Math.floor(world.y / CELL_SIZE);
          const builder = this.selection.selectedEntities.find(
            (e): e is UnitEntity => e.category === 'unit' && (e.kind === 'builder' || e.kind === 'worker') && e.team === 'blue',
          );
          if (builder) {
            const result = this.simulation.issueCommand({
              type: 'build',
              team: 'blue',
              builderId: builder.id,
              buildingKind: this.placementMode.kind,
              position: [gx, gy],
            });
            if (result.accepted) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = result.accepted
              ? `Construção de ${LABELS[this.placementMode.kind]} iniciada em (${gx}, ${gy}).`
              : `Construção indisponível: ${rejection(result.reason)}.`;
          }
        } else if (pointer.button === 2) {
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = 'Modo de construção cancelado.';
        }
        this.placementMode = null;
        this.placementGhostGraphics.clear();
        this.dragStart = null;
        this.lastPointer = null;
        this.dragMode = null;
        this.selectionBoxGraphics.clear();
        this.refreshSelection();
        this.refreshTeamStatus();
        return;
      }

      if (this.dragMode === 'select' && this.dragStart) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const shift = pointer.event.shiftKey;
        if (this.dragged) {
          this.selection.selectRect(
            Math.floor(this.dragStart.worldX / CELL_SIZE), Math.floor(this.dragStart.worldY / CELL_SIZE),
            Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE), shift,
          );
        } else {
          this.selection.selectAt(Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE), shift);
          if (this.debug) this.inspect(pointer);
        }
        this.soundSystem.play('click');
        this.refreshSelection();
      } else if (this.dragMode === 'pan' && !this.dragged && pointer.button === 2) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const destination: [number, number] = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
        const clickedEntity = this.simulation.entities.atCell(destination[0], destination[1]);
        const isEnemyVisible = clickedEntity && clickedEntity.team !== 'blue' && this.visualFog.isEntityVisible(clickedEntity);
        if (isEnemyVisible && clickedEntity) {
          const results = dispatchGroupAttack(this.simulation, 'blue', this.selection.selectedIds, clickedEntity.id);
          const accepted = results.filter((item) => item.result.accepted).length;
          if (accepted > 0) this.soundSystem.play('order');
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = results.length === 0
            ? 'Selecione uma unidade azul para atacar.'
            : accepted > 0 ? `${accepted} ordem(ns) de ataque contra ${LABELS[clickedEntity.kind]} enviada(s).`
              : `Ataque indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
          this.refreshSelection();
          this.refreshTeamStatus();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          return;
        }

        const selectedUnits = this.selection.selectedIds
          .map((id) => this.simulation.entities.get(id))
          .filter((e): e is UnitEntity => e?.category === 'unit' && e.team === 'blue');
        const builders = selectedUnits.filter((u) => u.kind === 'builder');
        if (clickedEntity && clickedEntity.team === 'blue' && clickedEntity.category === 'building' && builders.length > 0) {
          if (clickedEntity.hp < clickedEntity.maxHp && !clickedEntity.underConstruction) {
            let acceptedCount = 0;
            let lastFailure: CommandResult = { accepted: true };
            for (const b of builders) {
              const res = this.simulation.issueCommand({
                type: 'repair', team: 'blue', builderId: b.id, buildingId: clickedEntity.id,
              });
              if (res.accepted) {
                acceptedCount += 1;
              } else {
                lastFailure = res;
              }
            }
            if (acceptedCount > 0) this.soundSystem.play('order');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = acceptedCount > 0
              ? `${acceptedCount > 1 ? `${acceptedCount} construtores iniciando reparo` : 'Reparo'} de ${LABELS[clickedEntity.kind]} iniciado.`
              : `Reparo indisponível: ${lastFailure.accepted ? '' : rejection(lastFailure.reason)}.`;
            this.refreshSelection();
            this.refreshTeamStatus();
            this.dragStart = null;
            this.lastPointer = null;
            this.dragMode = null;
            this.selectionBoxGraphics.clear();
            return;
          }
        }

        const selectedBuilding = this.selection.selectedEntities.find(
          (e): e is BuildingEntity => e.category === 'building' && e.team === 'blue' && (e.kind === 'house' || e.kind === 'barracks'),
        );
        if (selectedBuilding && selectedUnits.length === 0) {
          const res = this.simulation.issueCommand({
            type: 'set-rally-point',
            team: 'blue',
            buildingId: selectedBuilding.id,
            point: destination,
          });
          if (res.accepted) this.soundSystem.play('order');
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = res.accepted
              ? `Ponto de reunião da ${LABELS[selectedBuilding.kind]} definido para (${destination.join(', ')}).`
              : `Ponto de reunião indisponível: ${rejection(res.reason)}.`;
          }
          this.refreshSelection();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          return;
        }

        const terrain = this.visualFog.cellAt(destination[0], destination[1])?.terrain;
        const known = this.visualFog.stateAt(destination[0], destination[1]) !== 'unknown';
        const hasWorker = selectedUnits.some((u) => u.kind === 'worker');
        const workType = hasWorker && known && terrain === 'mine' ? 'mine' : hasWorker && known && (terrain === 'forest' || terrain === 'stone') ? 'gather' : null;
        const results = workType
          ? this.selection.selectedIds.map((unitId) => ({ unitId, result: this.simulation.issueCommand({
            type: workType, team: 'blue', unitId, target: destination,
          }) }))
          : dispatchGroupMove(this.simulation, 'blue', this.selection.selectedIds, destination, false, this.selection.formation);
        const accepted = results.filter((item) => item.result.accepted).length;
        if (accepted > 0) {
          this.soundSystem.play('order');
          this.addWorldEffect('ring', (destination[0] + 0.5) * CELL_SIZE, (destination[1] + 0.5) * CELL_SIZE, 'blue', workType ? 0xfacc15 : 0x55ff55, 400);
        }
        const feedback = document.querySelector('#command-feedback');
        const workLabel = workType === 'mine' ? 'mina' : workType === 'gather' ? (terrain === 'stone' ? 'coleta de pedra' : 'coleta') : 'movimento';
        if (feedback) feedback.textContent = results.length === 0
          ? 'Selecione uma unidade azul para mover.'
          : accepted > 0 ? `${accepted} ordem(ns) de ${workLabel} recebida(s) para (${destination.join(', ')}).`
            : `Ordem indisponível: ${results[0].result.accepted ? '' : rejection(results[0].result.reason)}.`;
        this.refreshSelection();
      }
      this.dragStart = null;
      this.lastPointer = null;
      this.dragMode = null;
      this.selectionBoxGraphics.clear();
      this.formationPreviewGraphics.clear();
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.simulation.result) return;
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, MAX_ZOOM));
    });

    this.input.keyboard?.on('keydown-A', () => {
      if (this.simulation.result) return;
      const blueUnits = this.selection.selectedEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.team === 'blue');
      if (blueUnits.length > 0) {
        this.toggleAttackMoveMode();
      }
    });

    const onEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.handleEscape();
      }
    };
    window.addEventListener('keydown', onEscapeKey);
    this.events.on('shutdown', () => {
      window.removeEventListener('keydown', onEscapeKey);
    });

    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (this.simulation.result) return;
      const key = event.key;
      if (key >= '1' && key <= '9') {
        const digit = parseInt(key, 10);
        if (event.ctrlKey) {
          const recorded = this.selection.recordControlGroup(digit);
          const feedback = document.querySelector('#command-feedback');
          if (feedback) {
            feedback.textContent = recorded
              ? `Grupo de controle ${digit} gravado (${this.selection.getControlGroup(digit).length} tropas).`
              : `Grupo de controle ${digit} limpo.`;
          }
          if (recorded) this.soundSystem.play('click');
        } else {
          const selected = this.selection.selectControlGroup(digit, event.shiftKey);
          if (selected) {
            this.soundSystem.play('click');
            const feedback = document.querySelector('#command-feedback');
            if (feedback) {
              feedback.textContent = `Grupo ${digit} selecionado (${this.selection.selectedIds.length} tropas).`;
            }
            this.refreshSelection();
          }
        }
      }
    });

    document.querySelector('#game')?.setAttribute('data-ready', 'true');
    document.querySelector('#inspect')?.toggleAttribute('hidden', !this.debug);
    document.querySelector('#ai-debug')?.toggleAttribute('hidden', !this.debug);
    this.setupSandboxControls();
  }

  private setupSandboxControls(): void {
    const isSandboxQuery = new URLSearchParams(window.location.search).has('sandbox')
      || new URLSearchParams(window.location.search).has('test')
      || window.location.port === '5174';

    const panel = document.querySelector<HTMLElement>('#sandbox-section');
    const toggleBtn = document.querySelector<HTMLButtonElement>('#btn-toggle-sandbox');
    const feedback = document.querySelector<HTMLElement>('#command-feedback');

    const setMsg = (text: string) => {
      if (feedback) feedback.textContent = text;
    };

    const togglePanel = (show?: boolean) => {
      if (!panel || !toggleBtn) return;
      const willShow = show ?? panel.hasAttribute('hidden');
      if (willShow) {
        panel.removeAttribute('hidden');
        toggleBtn.classList.add('active');
      } else {
        panel.setAttribute('hidden', '');
        toggleBtn.classList.remove('active');
      }
    };

    toggleBtn?.addEventListener('click', () => togglePanel());

    if (isSandboxQuery) {
      togglePanel(true);
      this.simulation.addResources('blue', 10000, 10000, 10000);
      this.refreshTeamStatus();
      setMsg('Ambiente de Testes / Sandbox carregado! Recursos extras liberados.');
    }

    // 1. Recursos
    document.querySelector('#sb-add-res')?.addEventListener('click', () => {
      this.simulation.addResources('blue', 5000, 5000, 5000);
      this.refreshTeamStatus();
      setMsg('Sandbox: +5.000 moedas, madeira e pedra adicionados!');
    });

    document.querySelector('#sb-inf-res')?.addEventListener('click', () => {
      this.simulation.teams.blue.coins = 99999;
      this.simulation.teams.blue.wood = 99999;
      this.simulation.teams.blue.stone = 99999;
      this.refreshTeamStatus();
      setMsg('Sandbox: Recursos definidos para 99.999!');
    });

    // 2. Produção e Obra Instantânea
    const fastProd = document.querySelector<HTMLInputElement>('#sb-fast-prod');
    fastProd?.addEventListener('change', () => {
      this.simulation.production.instantProduction = !!fastProd.checked;
      setMsg(`Sandbox: Treino instantâneo ${fastProd.checked ? 'ATIVADO' : 'desativado'}.`);
    });

    const fastBuild = document.querySelector<HTMLInputElement>('#sb-fast-build');
    fastBuild?.addEventListener('change', () => {
      this.simulation.construction.instantBuild = !!fastBuild.checked;
      setMsg(`Sandbox: Obra instantânea ${fastBuild.checked ? 'ATIVADA' : 'desativada'}.`);
    });

    // 3. Velocidade
    const speedButtons = [
      { id: '#sb-speed-1', speed: 1 },
      { id: '#sb-speed-2', speed: 2 },
      { id: '#sb-speed-4', speed: 4 },
    ];
    for (const { id, speed } of speedButtons) {
      document.querySelector(id)?.addEventListener('click', (e) => {
        this.simulation.gameSpeed = speed;
        document.querySelectorAll('.btn-speed').forEach((btn) => btn.classList.remove('active'));
        (e.currentTarget as HTMLElement)?.classList.add('active');
        setMsg(`Sandbox: Velocidade ajustada para ${speed}x.`);
      });
    }

    // 4. Spawns Instantâneos (Azul)
    const unitSpawns: Array<{ id: string; kind: import('../core/entities/EntityStore').UnitKind }> = [
      { id: '#sb-spawn-soldier', kind: 'soldier' },
      { id: '#sb-spawn-archer', kind: 'archer' },
      { id: '#sb-spawn-shield', kind: 'shieldbearer' },
      { id: '#sb-spawn-scout', kind: 'scout' },
      { id: '#sb-spawn-builder', kind: 'builder' },
      { id: '#sb-spawn-worker', kind: 'worker' },
    ];
    for (const { id, kind } of unitSpawns) {
      document.querySelector(id)?.addEventListener('click', () => {
        const u = this.simulation.instantSpawn('blue', kind);
        if (u) {
          this.displayPositions.set(u.id, { x: u.x, y: u.y });
          this.drawEntities();
          this.refreshTeamStatus();
          setMsg(`Sandbox: ${LABELS[kind]} azul gerado em (${u.x}, ${u.y})!`);
        }
      });
    }

    document.querySelector('#sb-spawn-squad')?.addEventListener('click', () => {
      for (let i = 0; i < 5; i++) {
        const u = this.simulation.instantSpawn('blue', 'soldier');
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      this.refreshTeamStatus();
      setMsg('Sandbox: Esquadrão de 5 soldados azuis gerado na base!');
    });

    document.querySelector('#sb-spawn-mixed-army')?.addEventListener('click', () => {
      const kinds: import('../core/entities/EntityStore').UnitKind[] = [
        'shieldbearer', 'shieldbearer',
        'soldier', 'soldier', 'soldier', 'soldier',
        'archer', 'archer',
        'scout', 'scout',
      ];
      for (const kind of kinds) {
        const u = this.simulation.instantSpawn('blue', kind);
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      this.refreshTeamStatus();
      setMsg('Sandbox: Exército misto de 10 tropas (2 escudeiros, 4 soldados, 2 arqueiros, 2 batedores) gerado!');
    });

    // 5. Inimigos & IA
    document.querySelector('#sb-spawn-enemy-squad')?.addEventListener('click', () => {
      for (let i = 0; i < 3; i++) {
        const u = this.simulation.instantSpawn('red', 'soldier', 90, 98 + i);
        if (u) this.displayPositions.set(u.id, { x: u.x, y: u.y });
      }
      this.drawEntities();
      setMsg('Sandbox: 3 soldados inimigos vermelhos gerados no centro do mapa!');
    });

    const aiToggleBtn = document.querySelector<HTMLButtonElement>('#sb-toggle-ai');
    aiToggleBtn?.addEventListener('click', () => {
      this.simulation.aiPaused = !this.simulation.aiPaused;
      if (aiToggleBtn) {
        aiToggleBtn.textContent = this.simulation.aiPaused ? 'Retomar IA' : 'Pausar IA';
      }
      setMsg(`Sandbox: IA Vermelha ${this.simulation.aiPaused ? 'PAUSADA' : 'RETOMADA'}.`);
    });

    // 6. Revelar Mapa
    const revealCheck = document.querySelector<HTMLInputElement>('#sb-reveal-map');
    revealCheck?.addEventListener('change', () => {
      this.visualFog.revealAll = !!revealCheck.checked;
      this.drawFog();
      this.drawEntities();
      this.minimap.render(this.cameras.main.worldView, CELL_SIZE, this.displayPositions, true);
      setMsg(`Sandbox: Visão de mapa inteiro ${revealCheck.checked ? 'ATIVADA' : 'desativada'}.`);
    });
  }

  private toggleAttackMoveMode(): void {
    this.placementMode = null;
    this.rallyPlacementMode = false;
    this.rallyBuildingId = null;
    this.attackMoveMode = !this.attackMoveMode;
    this.placementGhostGraphics.clear();
    const fb = document.querySelector('#command-feedback');
    if (fb) {
      fb.textContent = this.attackMoveMode
        ? 'Modo Attack Move ativado: clique com botão esquerdo no mapa para definir o destino. Botão direito cancela.'
        : 'Modo Attack Move cancelado.';
    }
    this.refreshSelection();
  }

  private toggleRallyPlacementMode(buildingId: string): void {
    if (this.rallyPlacementMode && this.rallyBuildingId === buildingId) {
      this.rallyPlacementMode = false;
      this.rallyBuildingId = null;
      this.placementGhostGraphics.clear();
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Definição de ponto de reunião cancelada.';
    } else {
      this.rallyPlacementMode = true;
      this.rallyBuildingId = buildingId;
      this.attackMoveMode = false;
      this.placementMode = null;
      const building = this.simulation.entities.get(buildingId);
      const bLabel = building && building.category === 'building' ? LABELS[building.kind] : 'Construção';
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = `Clique no mapa para definir o Ponto de Reunião da ${bLabel}. Botão direito cancela.`;
    }
    this.refreshSelection();
  }

  private drawDashedLine(
    graphics: Phaser.GameObjects.Graphics,
    x1: number, y1: number, x2: number, y2: number,
    dashLength = 6, gapLength = 4,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const dirX = dx / distance;
    const dirY = dy / distance;
    let current = 0;
    while (current < distance) {
      const startX = x1 + dirX * current;
      const startY = y1 + dirY * current;
      const endDist = Math.min(current + dashLength, distance);
      const endX = x1 + dirX * endDist;
      const endY = y1 + dirY * endDist;
      graphics.lineBetween(startX, startY, endX, endY);
      current += dashLength + gapLength;
    }
  }

  update(_time: number, delta: number): void {
    if (this.simulation.diagnostics.enabled) {
      const now = performance.now();
      if (this.lastPerformanceFrame) this.simulation.diagnostics.record('frameInterval', now - this.lastPerformanceFrame);
      this.lastPerformanceFrame = now;
    }
    const ticks = this.simulation.advance(delta, 5);
    if (ticks > 0) {
      const timer = document.querySelector('#match-timer');
      if (timer) timer.textContent = formatMatchTime(this.simulation.clock.ticks);
    }
    if (this.simulation.result && !this.resultShown) this.showResult();
    const movementEvents = this.simulation.movement.drainEvents();
    const movementFailures = this.simulation.movement.drainFailures().filter((event) => this.simulation.entities.get(event.unitId)?.team === 'blue');
    if (movementFailures.length > 0) {
      const feedback = document.querySelector('#command-feedback');
      const failure = movementFailures[0];
      if (feedback) feedback.textContent = `Marcha interrompida: ${failure.unitId} · ${rejection(failure.reason)}.`;
    }
    for (const event of movementEvents) {
      const unit = this.simulation.entities.get(event.unitId);
      if (unit?.category !== 'unit') continue;
      this.motionTracks.set(event.unitId, {
        path: event.path, elapsedMs: 0,
        durationMs: unit.movementCooldownSeconds * 1000,
      });
      const start = event.path[0];
      if (start) this.addWorldEffect('dust', (start[0] + 0.5) * CELL_SIZE,
        (start[1] + 0.5) * CELL_SIZE, unit.team, 0xa6bdc4, 300);
    }
    this.updateMotion(delta);

    const combatEvents = this.simulation.combat.drainEvents();
    for (const event of combatEvents) {
      this.attackVisualUntil.set(event.attackerId, this.time.now + 420);
      const target = this.simulation.entities.get(event.targetId);
      const attacker = this.simulation.entities.get(event.attackerId);
      if (event.targetId === 'blue-base') {
        this.soundSystem.play('baseUnderAttack');
      } else if (target?.category === 'building') {
        this.soundSystem.play('buildingAttack');
      } else if (attacker?.category === 'unit' && attacker.kind === 'archer') {
        this.soundSystem.play('rangedAttack');
      } else {
        this.soundSystem.play('meleeAttack');
      }

      const arrowKey = event.attackerTeam === 'blue' ? 'tiny-arrowYellow' : 'tiny-arrowRed';
      const projectile = attacker?.category === 'unit' && attacker.kind === 'archer' && this.textures.exists(arrowKey)
        ? this.acquireProjectile(arrowKey) : undefined;
      this.attackEffects.push({
        fromX: (event.attackerX + 0.5) * CELL_SIZE,
        fromY: (event.attackerY + 0.5) * CELL_SIZE,
        toX: (event.targetX + 0.5) * CELL_SIZE,
        toY: (event.targetY + 0.5) * CELL_SIZE,
        color: event.attackerTeam === 'blue' ? 0x9bdbff : 0xffada9,
        elapsedMs: 0,
        totalMs: 180,
        projectile,
      });
      if (event.reflectedDamage > 0) {
        this.attackEffects.push({
          fromX: (event.targetX + 0.5) * CELL_SIZE,
          fromY: (event.targetY + 0.5) * CELL_SIZE,
          toX: (event.attackerX + 0.5) * CELL_SIZE,
          toY: (event.attackerY + 0.5) * CELL_SIZE,
          color: 0xeccf74,
          elapsedMs: 0,
          totalMs: 220,
        });
      }
    }
    this.updateAttackEffects(delta);

    for (const unitId of this.displayPositions.keys()) {
      if (!this.simulation.entities.get(unitId)) {
        const last = this.displayPositions.get(unitId);
        if (last) this.addWorldEffect('explosion', (last.x + 0.5) * CELL_SIZE,
          (last.y + 0.5) * CELL_SIZE, unitId.startsWith('red-') ? 'red' : 'blue', 0xffffff, 260);
        this.displayPositions.delete(unitId);
        this.soundSystem.play('unitDeath');
      }
    }
    for (const unitId of this.motionTracks.keys()) {
      if (!this.simulation.entities.get(unitId)) this.motionTracks.delete(unitId);
    }
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit' && !this.displayPositions.has(entity.id)) {
        this.displayPositions.set(entity.id, { x: entity.x, y: entity.y });
        this.addWorldEffect('ring', (entity.x + 0.5) * CELL_SIZE,
          (entity.y + 0.5) * CELL_SIZE, entity.team, UNIT_COLORS[entity.kind], 450);
        if (entity.team === 'blue') {
          this.soundSystem.play('unitProduced');
        }
      }
      if (entity.category === 'building') {
        if (entity.underConstruction) {
          this.underConstructionBuildingIds.add(entity.id);
        } else if (this.underConstructionBuildingIds.has(entity.id)) {
          this.underConstructionBuildingIds.delete(entity.id);
          if (entity.team === 'blue') {
            this.soundSystem.play('buildingComplete');
          }
        }
      }
    }

    const dirtyMapCells = this.map.drainDirtyCells();
    const visionChanged = this.visualFog.update(this.displayPositions, dirtyMapCells.length > 0);
    const dirtyCells = this.visualFog.drainDirtyTerrain();
    if (dirtyCells.length > 0) {
      this.detailsDirty = true;
      for (const [x, y] of dirtyCells) {
        const terrain = this.visualFog.cellAt(x, y)?.terrain;
        if (terrain) this.renderTerrainCell(x, y, terrain);
      }
      this.flushTerrain();
    }
    if (visionChanged) this.drawFog();
    this.addAmbientEffects();

    const blueStock = this.simulation.teams.blue;
    if (blueStock.wood > this.lastBlueWood || blueStock.coins > this.lastBlueCoins || blueStock.stone > this.lastBlueStone) {
      this.soundSystem.play('resourceDeposited');
      const base = this.simulation.entities.get('blue-base');
      if (base?.category === 'building') {
        const fxColor = blueStock.stone > this.lastBlueStone ? 0xb5bcc4 : blueStock.coins > this.lastBlueCoins ? 0xefce87 : 0xa4d96c;
        this.addWorldEffect('ring',
          (base.x + base.width / 2) * CELL_SIZE, (base.y + base.height / 2) * CELL_SIZE,
          'blue', fxColor, 550);
      }
    }
    this.lastBlueWood = blueStock.wood;
    this.lastBlueCoins = blueStock.coins;
    this.lastBlueStone = blueStock.stone;

    const visibleEnemies = this.visualFog.visibleEntities().filter((e) => e.team === 'red');
    let newEnemySpotted = false;
    for (const enemy of visibleEnemies) {
      if (!this.lastVisibleEnemies.has(enemy.id)) {
        this.lastVisibleEnemies.add(enemy.id);
        newEnemySpotted = true;
      }
    }
    for (const id of Array.from(this.lastVisibleEnemies)) {
      if (!visibleEnemies.some((e) => e.id === id)) {
        this.lastVisibleEnemies.delete(id);
      }
    }
    if (newEnemySpotted) {
      this.soundSystem.play('enemySpotted');
    }
    this.updateWorldEffects(delta);
    const motionActive = this.motionTracks.size > 0;
    const view = this.cameras.main.worldView;
    const cameraChanged = view.x !== this.lastEntityView.x || view.y !== this.lastEntityView.y || view.width !== this.lastEntityView.width || view.height !== this.lastEntityView.height;
    if (ticks > 0 || motionActive || movementEvents.length > 0 || dirtyCells.length > 0 || combatEvents.length > 0 || cameraChanged) {
      this.drawEntities();
      this.drawSelectionVisuals();
    }
    if (ticks > 0 || combatEvents.length > 0) {
      this.refreshSelectionDOM();
      this.refreshTeamStatus();
    }
    this.minimap.render(this.cameras.main.worldView, CELL_SIZE, this.displayPositions, visionChanged);
    if (this.simulation.result) return;
    const camera = this.cameras.main;
    const movement = PAN_SPEED * delta / 1000 / camera.zoom;
    if (this.keys.A?.isDown || this.keys.LEFT?.isDown) camera.scrollX -= movement;
    if (this.keys.D?.isDown || this.keys.RIGHT?.isDown) camera.scrollX += movement;
    if (this.keys.W?.isDown || this.keys.UP?.isDown) camera.scrollY -= movement;
    if (this.keys.S?.isDown || this.keys.DOWN?.isDown) camera.scrollY += movement;

    const root = document.querySelector('#game');
    if (ticks > 0) {
      root?.setAttribute('data-ticks', String(this.simulation.clock.ticks));
      if (this.debug) {
        const redAI = this.simulation.redAI;
        if (redAI) {
          const dbg = redAI.getDebugState();
          root?.setAttribute('data-ai-red-decision', dbg.decision);
          root?.setAttribute('data-ai-red-priority', String(dbg.priority));
          root?.setAttribute('data-ai-red-goal', dbg.goal);
          root?.setAttribute('data-ai-red-action', dbg.chosenAction);
          root?.setAttribute('data-ai-red-desired', `${dbg.desiredResources.coins},${dbg.desiredResources.wood},${dbg.desiredResources.stone}`);

          const aiDebugEl = document.querySelector('#ai-debug');
          if (aiDebugEl) {
            aiDebugEl.textContent = `IA Vermelha: ${dbg.decision} (P:${dbg.priority}) · ${dbg.goal} · Desejado: C:${dbg.desiredResources.coins} M:${dbg.desiredResources.wood} P:${dbg.desiredResources.stone} · Ação: ${dbg.chosenAction}`;
          }
        }
      }
    }

    const curZoom = camera.zoom.toFixed(2);
    const curCamX = camera.scrollX.toFixed(1);
    const curCamY = camera.scrollY.toFixed(1);
    if (curCamX !== this.lastCamX || curCamY !== this.lastCamY || curZoom !== this.lastZoom) {
      this.lastCamX = curCamX;
      this.lastCamY = curCamY;
      this.lastZoom = curZoom;
      root?.setAttribute('data-zoom', curZoom);
      root?.setAttribute('data-camera-x', curCamX);
      root?.setAttribute('data-camera-y', curCamY);
      const zoomLabel = document.querySelector('#zoom-value');
      if (zoomLabel) zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
    }
  }

  private installDiagnostics(): void {
    const api = {
      setEnabled: (enabled: boolean) => {
        this.simulation.setDiagnostics(enabled);
        this.lastPerformanceFrame = 0;
        if (!enabled) return;
        const monitor = this.simulation.diagnostics;
        const scene = this as unknown as Record<string, unknown>;
        monitor.watch(this.sys as unknown as Record<string, unknown>, 'sceneUpdate', 'sceneUpdate');
        for (const name of ['drawEntities', 'drawFog', 'drawSelectionVisuals', 'refreshSelectionDOM', 'refreshTeamStatus']) {
          monitor.watch(scene, name, name);
        }
        monitor.watch(this.visualFog, 'update', 'visualFog');
        monitor.watch(this.minimap, 'render', 'minimap');
        let renderStart = 0;
        const before = () => { renderStart = performance.now(); };
        const after = () => { monitor.record('rendererCPU', performance.now() - renderStart); };
        this.game.events.on('prerender', before);
        this.game.events.on('postrender', after);
        monitor.onDisable(() => {
          this.game.events.off('prerender', before);
          this.game.events.off('postrender', after);
        });
      },
      reset: () => this.simulation.diagnostics.reset(),
      snapshot: () => ({ ...this.simulation.diagnostics.snapshot(),
        entities: this.simulation.entities.all().length,
        units: this.simulation.entities.all().filter(e => e.category === 'unit').length,
        formations: this.simulation.formations.getAllGroups().length,
        droppedSimulationMs: this.simulation.clock.droppedMs }),
    };
    const host = window as unknown as { rtsPerformance?: typeof api };
    host.rtsPerformance = api;
    api.setEnabled(true);
    this.events.once('shutdown', () => {
      api.setEnabled(false);
      if (host.rtsPerformance === api) delete host.rtsPerformance;
    });
  }

  private showResult(): void {
    const result = this.simulation.result;
    if (!result) return;
    this.resultShown = true;
    this.placementMode = null;
    this.placementGhostGraphics.clear();
    const victory = result.winner === 'blue';
    if (victory) {
      this.soundSystem.play('victory');
    } else {
      this.soundSystem.play('defeat');
    }
    const title = document.querySelector('#result-title');
    const summary = document.querySelector('#result-summary');
    const duration = document.querySelector('#result-duration');
    const stats = document.querySelector('#result-stats tbody');
    const panel = document.querySelector('#game-result');
    if (title) title.textContent = victory ? 'Vitória!' : 'Derrota';
    if (summary) summary.textContent = victory ? 'Você destruiu a base inimiga.' : 'Sua base foi destruída.';
    if (duration) duration.textContent = `Duração: ${Math.floor(result.elapsedTicks / TICKS_PER_SECOND / 60)}m ${String(Math.floor(result.elapsedTicks / TICKS_PER_SECOND) % 60).padStart(2, '0')}s`;
    if (stats) {
      stats.replaceChildren();
      const entries = [
        ['Tropas produzidas', result.stats.blue.troopsProduced, result.stats.red.troopsProduced],
        ['Tropas abatidas', result.stats.blue.troopsKilled, result.stats.red.troopsKilled],
        ['Operários produzidos', result.stats.blue.workersProduced, result.stats.red.workersProduced],
        ['Operários abatidos', result.stats.blue.workersKilled, result.stats.red.workersKilled],
        ['Ouro coletado', Math.floor(result.stats.blue.coinsCollected), Math.floor(result.stats.red.coinsCollected)],
        ['Ouro gasto', Math.floor(result.stats.blue.coinsSpent), Math.floor(result.stats.red.coinsSpent)],
        ['Madeira coletada', Math.floor(result.stats.blue.woodCollected), Math.floor(result.stats.red.woodCollected)],
        ['Madeira gasta', Math.floor(result.stats.blue.woodSpent), Math.floor(result.stats.red.woodSpent)],
        ['Unidades restantes', result.blueUnits, result.redUnits],
        ['Ouro restante', Math.floor(result.blueCoins), Math.floor(result.redCoins)],
        ['Madeira restante', Math.floor(result.blueWood), Math.floor(result.redWood)],
      ];
      for (const [label, blue, red] of entries) {
        const row = document.createElement('tr');
        const heading = document.createElement('th');
        heading.scope = 'row';
        heading.textContent = String(label);
        const blueCell = document.createElement('td');
        blueCell.textContent = String(blue);
        const redCell = document.createElement('td');
        redCell.textContent = String(red);
        row.append(heading, blueCell, redCell);
        stats.append(row);
      }
    }
    panel?.removeAttribute('hidden');
    document.querySelector('#restart-game')?.addEventListener('click', () => window.location.reload(), { once: true });
    (document.querySelector('#restart-game') as HTMLButtonElement | null)?.focus();
  }

  private drawMap(): void {
    const width = this.map.width * CELL_SIZE, height = this.map.height * CELL_SIZE;
    if (this.textures.exists('tiny-terrain')) {
      this.terrainTiles = this.add.tileSprite(0, 0, width, height, 'tiny-terrain', 'grass').setOrigin(0);
      this.terrainTiles.setTileScale(CELL_SIZE / 64);
      if (this.terrainTexture) {
        this.terrainTexture.draw(this.terrainTiles);
        this.terrainTiles.setVisible(false);
      }
    }
    const renderer = this.game.renderer;
    const supported = !(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)
      || renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) >= Math.max(width, height);
    if (supported) this.terrainTexture = this.add.renderTexture(0, 0, width, height).setOrigin(0);
    this.mapGraphics = this.add.graphics();
    if (this.terrainTexture) this.mapGraphics.setVisible(false);
    if (!this.terrainTiles) this.mapGraphics.fillStyle(0x09141a).fillRect(0, 0, width, height);
    const dirty = this.visualFog.drainDirtyTerrain();
    for (const [x, y] of dirty) {
      const terrain = this.visualFog.cellAt(x, y)?.terrain;
      if (terrain) this.renderTerrainCell(x, y, terrain);
    }

    this.flushTerrain();
  }

  private flushTerrain(): void {
    if (!this.terrainTexture) return;
    this.terrainTexture.draw([this.mapGraphics]);
    this.mapGraphics.clear();
  }

  private renderTerrainCell(x: number, y: number, terrain: Terrain): void {
    if (!this.terrainTiles || terrain === 'water' || terrain === 'mountain') {
      this.mapGraphics.fillStyle(COLORS[terrain]).fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  private drawEntities(): void {
    const graphics = this.entityGraphics;
    graphics.clear();
    this.drawTerrainDetails();
    for (const sprite of this.entitySprites.values()) sprite.setVisible(false);
    Object.assign(this.lastEntityView, this.cameras.main.worldView);
    for (const entity of this.visualFog.visibleEntities()) {
      const position = entity.category === 'unit' ? this.displayPositions.get(entity.id) ?? entity : entity;
      if (!this.intersectsViewport(position.x, position.y, entity.category === 'building' ? entity.width : 1, entity.category === 'building' ? entity.height : 1)) continue;
      const color = entity.team === 'blue' ? 0x9bdbff : 0xffada9;
      if (entity.category === 'unit') {
        const position = this.displayPositions.get(entity.id) ?? entity;
        const sprite = this.updateUnitSprite(entity, position.x, position.y);
        if (sprite) {
          graphics.lineStyle(1, entity.team === 'blue' ? 0x3a9f67 : 0xa84b4c, 0.9);
          graphics.strokeEllipse((position.x + 0.5) * CELL_SIZE, (position.y + 0.88) * CELL_SIZE, 10, 4);
        }
        if (!sprite) {
          graphics.fillStyle(color).fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          graphics.fillStyle(UNIT_COLORS[entity.kind]).fillRect(position.x * CELL_SIZE + 3, position.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
        }
        if (!sprite && entity.kind === 'builder') {
          graphics.fillStyle(0xffe600, 1).fillRect(position.x * CELL_SIZE + 3, position.y * CELL_SIZE + 1, CELL_SIZE - 6, 2.5);
          graphics.fillStyle(0xffffff, 0.9).fillRect(position.x * CELL_SIZE + 5, position.y * CELL_SIZE + 4, 2, 3);
        }
        const hpPct = Math.max(0, Math.min(1, entity.hp / entity.maxHp));
        const barW = CELL_SIZE - 2;
        graphics.fillStyle(0x160f12, 0.9).fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE - 3, barW, 2);
        graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
          .fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE - 3, Math.max(1, barW * hpPct), 2);
      } else {
        const sprite = this.updateBuildingSprite(entity);
        if (sprite && !entity.underConstruction) {
          graphics.lineStyle(1, entity.team === 'blue' ? 0x3a9f67 : 0xa84b4c, 0.8);
          graphics.strokeRect(entity.x * CELL_SIZE, entity.y * CELL_SIZE,
            entity.width * CELL_SIZE, entity.height * CELL_SIZE);
        }
        if (entity.underConstruction) {
          graphics.lineStyle(2, 0xeccf74, 0.85).strokeRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          graphics.fillStyle(color, 0.35).fillRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          const pct = Math.min(1, entity.buildProgressTicks / Math.max(1, entity.buildTotalTicks));
          graphics.fillStyle(0x38505a, 0.95).fillRect(
            entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3,
            entity.width * CELL_SIZE - 6, 3,
          );
          graphics.fillStyle(0xeccf74, 1).fillRect(
            entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3,
            (entity.width * CELL_SIZE - 6) * pct, 3,
          );
        } else {
          if (!sprite) graphics.lineStyle(2, color, 1).strokeRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          if (!sprite && entity.kind === 'barricade') {
            graphics.fillStyle(0x7a634e, 0.9).fillRect(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
            );
            graphics.lineStyle(1.5, 0x3d2c1e, 1);
            graphics.lineBetween(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              (entity.x + 1) * CELL_SIZE - 2, (entity.y + 1) * CELL_SIZE - 2,
            );
            graphics.lineBetween(
              (entity.x + 1) * CELL_SIZE - 2, entity.y * CELL_SIZE + 2,
              entity.x * CELL_SIZE + 2, (entity.y + 1) * CELL_SIZE - 2,
            );
            graphics.fillStyle(0x231810, 1).fillRect(entity.x * CELL_SIZE + 3, entity.y * CELL_SIZE + 3, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect((entity.x + 1) * CELL_SIZE - 5, entity.y * CELL_SIZE + 3, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect(entity.x * CELL_SIZE + 3, (entity.y + 1) * CELL_SIZE - 5, 2, 2);
            graphics.fillStyle(0x231810, 1).fillRect((entity.x + 1) * CELL_SIZE - 5, (entity.y + 1) * CELL_SIZE - 5, 2, 2);
          } else if (!sprite && entity.kind === 'tower') {
            graphics.fillStyle(0x4a5568, 0.95).fillRect(
              entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
              entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
            );
            graphics.lineStyle(1.5, 0x2d3748, 1).strokeRect(
              entity.x * CELL_SIZE + 4, entity.y * CELL_SIZE + 4,
              entity.width * CELL_SIZE - 8, entity.height * CELL_SIZE - 8,
            );
            graphics.fillStyle(0x38bdf8, 1).fillCircle(
              (entity.x + entity.width / 2) * CELL_SIZE,
              (entity.y + entity.height / 2) * CELL_SIZE, 3.5,
            );
            graphics.fillStyle(0xfffbeb, 0.9).fillCircle(
              (entity.x + entity.width / 2) * CELL_SIZE,
              (entity.y + entity.height / 2) * CELL_SIZE, 1.5,
            );
          } else if (!sprite) {
            graphics.fillStyle(color).fillRect(
              (entity.x + entity.width / 2) * CELL_SIZE - 3,
              (entity.y + entity.height / 2) * CELL_SIZE - 3, 6, 6,
            );
          }
          if (entity.hp < entity.maxHp) {
            const hpPct = Math.max(0, entity.hp / entity.maxHp);
            const barW = entity.width * CELL_SIZE - 4;
            graphics.fillStyle(0x3a0000, 0.9).fillRect(entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE - 3, barW, 3);
            graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
              .fillRect(entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE - 3, Math.max(1, barW * hpPct), 3);
          }
          if (this.simulation.construction.isBeingRepaired(entity.id)) {
            graphics.lineStyle(2, 0x52c41a, 0.95).strokeRect(
              entity.x * CELL_SIZE + 1, entity.y * CELL_SIZE + 1,
              entity.width * CELL_SIZE - 2, entity.height * CELL_SIZE - 2,
            );
            graphics.fillStyle(0x52c41a, 1).fillCircle(entity.x * CELL_SIZE + entity.width * CELL_SIZE - 1, entity.y * CELL_SIZE - 1.5, 3);
            graphics.fillStyle(0xffffff, 1).fillCircle(entity.x * CELL_SIZE + entity.width * CELL_SIZE - 1, entity.y * CELL_SIZE - 1.5, 1.2);
          }
        }
      }
    }
    for (const building of this.visualFog.knownBuildings()) {
      if (this.visualFog.stateAt(building.x, building.y) === 'visible') continue;
      if (!this.intersectsViewport(building.x, building.y, building.width, building.height)) continue;
      const color = building.team === 'blue' ? 0x9bdbff : 0xffada9;
      graphics.lineStyle(1, color, 0.4).strokeRect(
        building.x * CELL_SIZE + 2, building.y * CELL_SIZE + 2,
        building.width * CELL_SIZE - 4, building.height * CELL_SIZE - 4,
      );
    }
    const root = document.querySelector('#game');
    const visibleEnemies = this.visualFog.visibleEntities().filter((entity) => entity.team === 'red');
    root?.setAttribute('data-visible-enemy-ids', visibleEnemies.map((entity) => entity.id).join(','));
    root?.setAttribute('data-visible-enemy-positions', visibleEnemies.filter((entity) => entity.category === 'unit').map((entity) => {
      const position = this.displayPositions.get(entity.id) ?? entity;
      return `${entity.id}:${position.x.toFixed(2)},${position.y.toFixed(2)}`;
    }).join(';'));
    for (const [id, sprite] of this.entitySprites) {
      if (!this.simulation.entities.get(id)) {
        sprite.destroy();
        this.entitySprites.delete(id);
        this.spriteVisualCache.delete(id);
        this.attackVisualUntil.delete(id);
      }
    }
  }

  private updateUnitSprite(unit: UnitEntity, x: number, y: number): Phaser.GameObjects.Image | null {
    let state: UnitVisualState = unit.kind === 'shieldbearer' ? 'guard' : 'idle';
    const motion = this.motionTracks.get(unit.id);
    if (motion) state = unit.carriedWood > 0 ? 'carryWood' : unit.carriedStone > 0 ? 'carryStone' : 'move';
    else if (unit.kind === 'worker') {
      const task = this.simulation.economy.taskFor(unit.id);
      if (task?.kind === 'mine' && task.phase === 'working') state = 'mine';
      else if (task?.kind === 'gather' && task.phase === 'gathering') state = task.resourceKind === 'stone' ? 'gatherStone' : 'gatherWood';
    } else if (unit.kind === 'builder') {
      const task = this.simulation.construction.taskFor(unit.id);
      if (task?.phase === 'building' || task?.phase === 'repairing') state = 'build';
    }
    if ((this.attackVisualUntil.get(unit.id) ?? 0) > this.time.now) state = 'attack';
    const key = availableUnitKey(this, unit.team, unit.kind, state);
    if (!key) return null;
    let sprite = this.entitySprites.get(unit.id);
    if (!sprite) {
      sprite = this.add.image(0, 0, key).setDepth(2);
      this.entitySprites.set(unit.id, sprite);
    } else if (sprite.texture.key !== key) sprite.setTexture(key);
    const frame = Math.floor(this.time.now / (state === 'attack' ? 85 : 130)) % frameCount(unit.kind, state);
    const size = UNIT_VISUALS[unit.kind].size;
    const px = (x + 0.5) * CELL_SIZE;
    const py = (y + 0.5) * CELL_SIZE;
    const cached = this.spriteVisualCache.get(unit.id);
    if (!cached || cached.key !== key || cached.frame !== frame) sprite.setFrame(frame);
    if (!cached || cached.size !== size) sprite.setDisplaySize(size, size);
    if (!cached || cached.x !== px || cached.y !== py) sprite.setPosition(px, py);
    if (motion && motion.path.length > 1) {
      sprite.setFlipX(motion.path[motion.path.length - 1][0] < motion.path[0][0]);
    }
    sprite.setVisible(true).setAlpha(1);
    this.spriteVisualCache.set(unit.id, { key, frame, x: px, y: py, size });
    return sprite;
  }

  private updateBuildingSprite(building: BuildingEntity): Phaser.GameObjects.Image | null {
    const key = buildingKey(building.team, building.kind);
    if (!this.textures.exists(key)) return null;
    let sprite = this.entitySprites.get(building.id);
    if (!sprite) {
      sprite = this.add.image(0, 0, key).setDepth(2).setOrigin(0.5, 1);
      this.entitySprites.set(building.id, sprite);
    } else if (sprite.texture.key !== key) sprite.setTexture(key);
    const width = building.kind === 'barricade' ? CELL_SIZE : building.width * CELL_SIZE + 4;
    const height = building.kind === 'barricade' ? CELL_SIZE : width * sprite.texture.source[0].height / sprite.texture.source[0].width;
    const px = (building.x + building.width / 2) * CELL_SIZE;
    const py = (building.y + building.height) * CELL_SIZE;
    const cached = this.spriteVisualCache.get(building.id);
    if (!cached || cached.size !== width) sprite.setDisplaySize(width, height);
    if (!cached || cached.x !== px || cached.y !== py) sprite.setPosition(px, py);
    this.spriteVisualCache.set(building.id, { key, frame: 0, x: px, y: py, size: width });
    sprite.setVisible(true).setAlpha(building.underConstruction ? 0.52 : 1);
    return sprite;
  }

  private drawTerrainDetails(): void {
    const view = this.cameras.main.worldView;
    const minX = Math.max(0, Math.floor(view.x / CELL_SIZE) - 2);
    const minY = Math.max(0, Math.floor(view.y / CELL_SIZE) - 2);
    const maxX = Math.min(this.map.width - 1, Math.ceil(view.right / CELL_SIZE) + 2);
    const maxY = Math.min(this.map.height - 1, Math.ceil(view.bottom / CELL_SIZE) + 2);
    const bounds = `${minX},${minY},${maxX},${maxY}`;
    if (!this.detailsDirty && bounds === this.lastDetailBounds) return;
    this.detailsDirty = false;
    this.lastDetailBounds = bounds;
    let used = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const terrain = this.visualFog.rawTerrain(x, y);
        if (!terrain) continue;
        const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        let key = '';
        let frame = 0;
        let width = 0;
        let height = 0;
        if (terrain === 'forest') {
          key = hash % 3 === 0 ? (hash % 2 ? 'tiny-tree1' : 'tiny-tree2') : 'tiny-bush';
          width = key === 'tiny-bush' ? 13 : 21;
          height = key === 'tiny-bush' ? 13 : 27;
          frame = key === 'tiny-bush' ? hash % 8 : 0;
        } else if (terrain === 'mine') { key = 'tiny-gold'; width = 14; height = 14; }
        else if (terrain === 'stone') { key = 'tiny-stone'; width = 12; height = 12; }
        else if (terrain === 'mountain' && hash % 4 === 0) { key = 'tiny-stone'; width = 13; height = 13; }
        else if (terrain === 'water' && hash % 79 === 0) { key = 'tiny-waterRock'; width = 12; height = 12; frame = hash % 16; }
        else if (terrain === 'plain' && hash % 29 === 0) { key = 'tiny-bush'; width = 10; height = 10; frame = hash % 8; }
        else continue;
        if (!this.textures.exists(key)) continue;
        let sprite = this.terrainDetails[used];
        if (!sprite) {
          sprite = this.add.image(0, 0, key).setDepth(1).setOrigin(0.5, 1);
          this.terrainDetails.push(sprite);
        }
        if (sprite.texture.key !== key) sprite.setTexture(key);
        if (sprite.frame.name !== String(frame)) sprite.setFrame(frame);
        sprite.setDisplaySize(width, height);
        sprite.setPosition((x + 0.5) * CELL_SIZE, (y + 1) * CELL_SIZE);
        sprite.setVisible(true);
        used += 1;
      }
    }
    for (let i = used; i < this.terrainDetails.length; i += 1) this.terrainDetails[i].setVisible(false);
  }

  private intersectsViewport(x: number, y: number, width: number, height: number): boolean {
    const view = this.cameras.main.worldView;
    // One-cell margin preserves health bars, outlines and fractional interpolation.
    return (x + width + 1) * CELL_SIZE >= view.x && (x - 1) * CELL_SIZE <= view.right
      && (y + height + 1) * CELL_SIZE >= view.y && (y - 1) * CELL_SIZE <= view.bottom;
  }

  private updateAttackEffects(delta: number): void {
    this.combatGraphics.clear();
    for (let i = this.attackEffects.length - 1; i >= 0; i -= 1) {
      const fx = this.attackEffects[i];
      fx.elapsedMs += delta;
      if (fx.elapsedMs >= fx.totalMs) {
        if (fx.projectile) {
          fx.projectile.setVisible(false);
          this.projectilePool.push(fx.projectile);
        }
        this.attackEffects.splice(i, 1);
        continue;
      }
      if (this.visualFog.stateAt(Math.floor(fx.fromX / CELL_SIZE), Math.floor(fx.fromY / CELL_SIZE)) !== 'visible'
        || this.visualFog.stateAt(Math.floor(fx.toX / CELL_SIZE), Math.floor(fx.toY / CELL_SIZE)) !== 'visible') {
        fx.projectile?.setVisible(false);
        continue;
      }
      const alpha = 1 - (fx.elapsedMs / fx.totalMs);
      if (fx.projectile) {
        const progress = fx.elapsedMs / fx.totalMs;
        fx.projectile.setPosition(Phaser.Math.Linear(fx.fromX, fx.toX, progress), Phaser.Math.Linear(fx.fromY, fx.toY, progress));
        fx.projectile.setRotation(Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX));
        fx.projectile.setVisible(true);
      } else {
        this.combatGraphics.lineStyle(2, fx.color, alpha);
        this.combatGraphics.lineBetween(fx.fromX, fx.fromY, fx.toX, fx.toY);
      }
      this.combatGraphics.fillStyle(0xffffff, alpha);
      this.combatGraphics.fillCircle(fx.toX, fx.toY, 2.5);
      this.combatGraphics.lineStyle(1.5, fx.color, alpha * 0.8);
      this.combatGraphics.strokeCircle(fx.toX, fx.toY, 2 + (1 - alpha) * 8);
    }
  }

  private addWorldEffect(kind: WorldEffect['kind'], x: number, y: number,
    team: Team, color: number, totalMs: number): void {
    if (this.worldEffects.length >= 100) {
      const removed = this.worldEffects.shift();
      if (removed?.sprite) this.releaseEffect(removed.sprite);
    }
    const key = kind === 'dust' ? 'tiny-dust' : kind === 'explosion' ? 'tiny-explosion' : '';
    const sprite = key && this.textures.exists(key) ? this.acquireEffect(key) : undefined;
    if (sprite) sprite.setPosition(x, y).setDisplaySize(kind === 'dust' ? 15 : 20, kind === 'dust' ? 15 : 20);
    this.worldEffects.push({ kind, x, y, team, color, elapsedMs: 0, totalMs, sprite });
  }

  private acquireEffect(key: string): Phaser.GameObjects.Image {
    const sprite = this.effectPool.pop() ?? this.add.image(0, 0, key).setDepth(5);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    return sprite.setVisible(true);
  }

  private releaseEffect(sprite: Phaser.GameObjects.Image): void {
    sprite.setVisible(false);
    this.effectPool.push(sprite);
  }

  private acquireProjectile(key: string): Phaser.GameObjects.Image {
    const sprite = this.projectilePool.pop() ?? this.add.image(0, 0, key).setDepth(5);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    return sprite.setDisplaySize(10, 10).setVisible(true);
  }

  private addAmbientEffects(): void {
    const second = Math.floor(this.simulation.clock.ticks / TICKS_PER_SECOND);
    if (second <= this.lastAmbientSecond) return;
    this.lastAmbientSecond = second;
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit' && entity.kind === 'worker') {
        const task = this.simulation.economy.taskFor(entity.id);
        if (task?.phase === 'working' || task?.phase === 'gathering') {
          const position = this.displayPositions.get(entity.id) ?? entity;
          const offset = ((second + entity.id.length) % 3 - 1) * 3;
          this.addWorldEffect('spark', (position.x + 0.5) * CELL_SIZE + offset,
            (position.y + 0.5) * CELL_SIZE - 3, entity.team,
            task.kind === 'mine' ? 0xefce87 : 0xa4d96c, 450);
        }
      } else if (entity.category === 'building' && entity.underConstruction) {
        this.addWorldEffect('spark', (entity.x + entity.width - 0.3) * CELL_SIZE,
          (entity.y + 0.3) * CELL_SIZE, entity.team, 0xefce87, 450);
      } else if (entity.category === 'building' && this.simulation.construction.isBeingRepaired(entity.id)) {
        this.addWorldEffect('spark', (entity.x + entity.width / 2) * CELL_SIZE,
          (entity.y + entity.height / 2) * CELL_SIZE, entity.team, 0x52c41a, 400);
      }
    }
  }

  private updateWorldEffects(delta: number): void {
    this.worldGraphics.clear();
    for (let index = this.worldEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.worldEffects[index];
      effect.elapsedMs += delta;
      if (effect.elapsedMs >= effect.totalMs) {
        if (effect.sprite) this.releaseEffect(effect.sprite);
        this.worldEffects.splice(index, 1);
        continue;
      }
      if (effect.team === 'red' && this.visualFog.stateAt(Math.floor(effect.x / CELL_SIZE),
        Math.floor(effect.y / CELL_SIZE)) !== 'visible') {
        effect.sprite?.setVisible(false);
        continue;
      }
      const progress = effect.elapsedMs / effect.totalMs;
      const alpha = 1 - progress;
      if (effect.sprite) {
        effect.sprite.setFrame(Math.min(7, Math.floor(progress * 8)));
        effect.sprite.setAlpha(alpha).setVisible(true);
      } else if (effect.kind === 'ring') {
        this.worldGraphics.lineStyle(1.5, effect.color, alpha);
        this.worldGraphics.strokeCircle(effect.x, effect.y, 2 + progress * 10);
      } else if (effect.kind === 'spark') {
        this.worldGraphics.lineStyle(1.5, effect.color, alpha);
        this.worldGraphics.lineBetween(effect.x - 2, effect.y, effect.x + 2, effect.y);
        this.worldGraphics.lineBetween(effect.x, effect.y - 2, effect.x, effect.y + 2);
      } else {
        this.worldGraphics.fillStyle(effect.color, alpha * 0.45);
        this.worldGraphics.fillCircle(effect.x, effect.y, 1 + progress * 3);
      }
    }
  }

  private updateMotion(delta: number): void {
    for (const [unitId, track] of this.motionTracks) {
      track.elapsedMs += delta;
      const segments = track.path.length - 1;
      const progress = Math.min(segments, track.elapsedMs / track.durationMs * segments);
      const segment = Math.min(segments - 1, Math.floor(progress));
      const fraction = Math.min(1, progress - segment);
      const from = track.path[segment];
      const to = track.path[segment + 1];
      this.displayPositions.set(unitId, {
        x: Phaser.Math.Linear(from[0], to[0], fraction),
        y: Phaser.Math.Linear(from[1], to[1], fraction),
      });
      if (progress >= segments) this.motionTracks.delete(unitId);
    }
  }

  private drawFog(): void {
    const graphics = this.fogGraphics;
    graphics.clear();
    let visibleCount = 0;
    let exploredCount = 0;
    for (let y = 0; y < this.map.height; y += 1) {
      let runState = this.visualFog.rawState(0, y);
      let runStart = 0;
      for (let x = 0; x <= this.map.width; x += 1) {
        const state = x < this.map.width ? this.visualFog.rawState(x, y) : -1;
        if (state === 2) visibleCount += 1;
        if (state === 1) exploredCount += 1;
        if (state === runState) continue;
        if (runState === 0) {
          graphics.fillStyle(0x09141a, 1)
            .fillRect(runStart * CELL_SIZE, y * CELL_SIZE, (x - runStart) * CELL_SIZE, CELL_SIZE);
        }
        runStart = x;
        runState = state;
      }
    }
    if (visibleCount !== this.lastVisibleCount || exploredCount !== this.lastExploredCount) {
      this.lastVisibleCount = visibleCount;
      this.lastExploredCount = exploredCount;
      const root = document.querySelector('#game');
      root?.setAttribute('data-visible-cells', String(visibleCount));
      root?.setAttribute('data-explored-cells', String(exploredCount));
      const fogStatus = document.querySelector('#fog-status');
      if (fogStatus) fogStatus.textContent = `Visíveis: ${visibleCount} · exploradas: ${exploredCount}`;
    }
  }

  private drawSelectionBox(x1: number, y1: number, x2: number, y2: number): void {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    this.selectionBoxGraphics.clear();
    this.selectionBoxGraphics.fillStyle(0xeccf74, 0.12).fillRect(x, y, width, height);
    this.selectionBoxGraphics.lineStyle(1, 0xeccf74, 1).strokeRect(x, y, width, height);
  }

  private drawSelectionVisuals(): void {
    this.selectionGraphics.clear();
    const selected = this.selection.selectedEntities;
    for (const entity of selected) {
      const width = entity.category === 'unit' ? 1 : entity.width;
      const height = entity.category === 'unit' ? 1 : entity.height;
      const position = entity.category === 'unit' ? this.displayPositions.get(entity.id) ?? entity : entity;
      this.selectionGraphics.lineStyle(2, 0xffdf70, 1).strokeRect(
        position.x * CELL_SIZE - 2, position.y * CELL_SIZE - 2,
        width * CELL_SIZE + 4, height * CELL_SIZE + 4,
      );
      if (entity.category === 'building') {
        const centerX = (entity.x + entity.width / 2) * CELL_SIZE;
        const centerY = (entity.y + entity.height / 2) * CELL_SIZE;
        if (entity.kind === 'tower') {
          const halfSpan = 9;
          const minX = entity.x - halfSpan;
          const minY = entity.y - halfSpan;
          this.selectionGraphics.lineStyle(1.5, 0x38bdf8, 0.6);
          this.selectionGraphics.strokeRect(
            minX * CELL_SIZE, minY * CELL_SIZE,
            20 * CELL_SIZE, 20 * CELL_SIZE,
          );
          this.selectionGraphics.fillStyle(0x38bdf8, 0.05);
          this.selectionGraphics.fillRect(
            minX * CELL_SIZE, minY * CELL_SIZE,
            20 * CELL_SIZE, 20 * CELL_SIZE,
          );
        } else {
          const radius = BALANCE.buildings[entity.kind].vision;
          this.selectionGraphics.lineStyle(1.5, 0x9bdbff, 0.35);
          this.selectionGraphics.strokeCircle(centerX, centerY, radius * CELL_SIZE);
        }
        if (entity.kind === 'base') {
          this.selectionGraphics.lineStyle(1.5, 0x6da2b5, 0.3);
          this.selectionGraphics.strokeCircle(centerX, centerY, BALANCE.construction.maxDistanceFromBase * CELL_SIZE);
        }
        if (entity.rallyPoint) {
          const [rx, ry] = entity.rallyPoint;
          const targetPxX = (rx + 0.5) * CELL_SIZE;
          const targetPxY = (ry + 0.5) * CELL_SIZE;
          this.selectionGraphics.lineStyle(1.5, 0xfacc15, 0.85);
          this.drawDashedLine(this.selectionGraphics, centerX, centerY, targetPxX, targetPxY, 6, 4);

          this.selectionGraphics.fillStyle(0xfacc15, 0.9);
          this.selectionGraphics.fillCircle(targetPxX, targetPxY, 4);
          this.selectionGraphics.lineStyle(2, 0xeab308, 1);
          this.selectionGraphics.strokeCircle(targetPxX, targetPxY, 7);

          this.selectionGraphics.lineStyle(2, 0xffffff, 0.95);
          this.selectionGraphics.lineBetween(targetPxX, targetPxY, targetPxX, targetPxY - 14);
          this.selectionGraphics.fillStyle(0xfacc15, 0.95);
          this.selectionGraphics.fillTriangle(
            targetPxX, targetPxY - 14,
            targetPxX + 10, targetPxY - 10,
            targetPxX, targetPxY - 6,
          );
        }
      } else if (entity.category === 'unit') {
        const radius = entity.vision;
        const centerX = (position.x + 0.5) * CELL_SIZE;
        const centerY = (position.y + 0.5) * CELL_SIZE;
        this.selectionGraphics.lineStyle(1.5, 0x9bdbff, 0.35);
        this.selectionGraphics.strokeCircle(centerX, centerY, radius * CELL_SIZE);
      }
    }
    const root = document.querySelector('#game');
    root?.setAttribute('data-selected-ids', this.selection.selectedIds.join(','));
    const first = selected[0];
    const visual = first?.category === 'unit' ? this.displayPositions.get(first.id) ?? first : null;
    if (visual) root?.setAttribute('data-selected-visual-x', visual.x.toFixed(2));
    else root?.removeAttribute('data-selected-visual-x');
  }

  private refreshSelectionDOM(): void {
    const selected = this.selection.selectedEntities;
    const root = document.querySelector('#game');
    root?.setAttribute('data-selected-ids', this.selection.selectedIds.join(','));
    const first = selected[0];
    const count = document.querySelector('#selection-count');
    const details = document.querySelector('#selection-details');
    if (count) count.textContent = selected.length === 0 ? 'Nenhuma seleção' : `${selected.length} selecionado${selected.length === 1 ? '' : 's'}`;
    if (details) details.textContent = selected.length === 0
      ? 'Clique em uma unidade ou base azul.'
      : selected.map((entity: GameEntity) => {
        const cooldown = entity.category === 'unit'
          ? this.simulation.movement.cooldownRemainingTicks(entity, this.simulation.clock.ticks) : 0;
        const task = entity.category === 'unit' ? this.simulation.economy.taskFor(entity.id) : null;
        const buildTask = entity.category === 'unit' ? this.simulation.construction.taskFor(entity.id) : null;
        const combatTarget = entity.category === 'unit' ? this.simulation.combat.manualTargetFor(entity.id) : null;
        const queue = entity.category === 'building' ? this.simulation.production.queueFor(entity.id) : [];
        return `${LABELS[entity.kind]} · HP ${Math.round(entity.hp)}/${entity.maxHp} · (${entity.x}, ${entity.y})`
          + (entity.category === 'unit' && entity.damage > 0 ? ` · Dano ${entity.damage} · Alc ${entity.range}` : '')
          + (combatTarget ? ` · Alvo (${combatTarget})` : '')
          + (entity.category === 'building' && entity.underConstruction ? ' · em construção' : '')
          + (entity.kind === 'tower' && !entity.underConstruction ? ' · visão 20×20 células (detecta batedores)' : '')
          + (entity.category === 'building' && entity.rallyPoint ? ` · Rally (${entity.rallyPoint.join(', ')})` : '')
          + (cooldown > 0 ? ` · cooldown ${Math.ceil(cooldown / TICKS_PER_SECOND)}s` : '')
          + (entity.category === 'unit' && entity.moveTarget ? ` · destino (${entity.moveTarget.join(', ')})` : '')
          + (entity.category === 'unit' && (entity.carriedWood > 0 || entity.carriedStone > 0)
            ? ` · carga ${Math.floor(entity.carriedStone > 0 ? entity.carriedStone : entity.carriedWood)}/${entity.carriedStone > 0 ? BALANCE.economy.stone.workerCapacity : BALANCE.economy.wood.workerCapacity} ${entity.carriedStone > 0 ? 'pedra' : 'madeira'}`
            : '')
          + (task ? ` · ${task.kind === 'mine' ? 'mina' : 'coleta'}: ${task.phase}` : '')
          + (buildTask ? ` · construindo: ${buildTask.phase}` : '')
          + (queue.length > 0 ? ` · fila (${queue.length})` : '');
      }).join('  |  ');

    const status = document.querySelector('#selection-status');
    if (status) {
      status.replaceChildren();
      if (first) {
        const add = (label: string, value: string) => {
          const dt = document.createElement('dt');
          const dd = document.createElement('dd');
          dt.textContent = label;
          dd.textContent = value;
          status.append(dt, dd);
        };
        add('Unidade', `${LABELS[first.kind]} · ${first.id}`);
        add('Vida', `${Math.round(first.hp)}/${first.maxHp}`);
        if (first.category === 'unit') {
          const engagement = this.simulation.engagements.statusFor(first.id);
          const task = this.simulation.economy.taskFor(first.id);
          const buildTask = this.simulation.construction.taskFor(first.id);
          const target = this.simulation.combat.manualTargetFor(first.id);
          const movementCooldown = this.simulation.movement.cooldownRemainingTicks(first, this.simulation.clock.ticks);
          add('Ordem', engagement ? 'Engajar e retomar marcha' : target ? 'Atacar' : buildTask ? 'Construir' : task ? task.kind === 'mine' ? 'Minerar' : 'Coletar' : first.moveTarget ? 'Mover' : 'Aguardar');
          if (target) add('Alvo', target);
          if (first.moveTarget || engagement) add('Destino', (engagement?.destination ?? first.moveTarget)!.join(', '));
          if (movementCooldown > 0) add('Espera', `${Math.ceil(movementCooldown / TICKS_PER_SECOND)}s até próxima ação`);
          const group = this.simulation.formations.getFormationForUnit(first.id);
          if (group) {
            const slot = group.slots.get(first.id);
            const roleLabels: Record<string, string> = {
              vanguard: 'Vanguarda (Linha de frente)',
              frontline: 'Frente secundária',
              flank: 'Flanco',
              rear: 'Retaguarda',
            };
            const fmtLabels: Record<string, string> = {
              line: 'Linha',
              wedge: 'Cunha',
              block: 'Bloco',
              'double-rank': 'Duas Fileiras',
            };
            add('Formação', `${fmtLabels[group.type]} (${group.state}) · ${roleLabels[slot?.role ?? ''] ?? 'Combatente'}`);
            add('Velocidade', `${group.collectiveSpeed} casas/s (coletiva)`);
          }
          if (task) {
            if (task.kind === 'gather') {
              const isStone = task.resourceKind === 'stone';
              const carried = isStone ? Math.floor(first.carriedStone) : Math.floor(first.carriedWood);
              const capacity = isStone ? BALANCE.economy.stone.workerCapacity : BALANCE.economy.wood.workerCapacity;
              const resourceName = isStone ? 'pedra' : 'madeira';
              add('Trabalho', `${task.phase} · carga ${carried}/${capacity} ${resourceName}`);
            } else {
              add('Trabalho', task.phase);
            }
          }
          if (buildTask) add('Construção', buildTask.phase);
        } else {
          if (first.kind === 'tower') {
            add('Visão', '20×20 células (detecta batedores)');
          } else {
            add('Visão', `${BALANCE.buildings[first.kind].vision} casas`);
          }
          if (first.kind === 'base') {
            add('Área de construção', `${BALANCE.construction.maxDistanceFromBase} casas`);
          }
          if (first.underConstruction) add('Construção', `${Math.round(first.buildProgressTicks / Math.max(1, first.buildTotalTicks) * 100)}%`);
          const queue = this.simulation.production.queueFor(first.id);
          if (queue.length > 0) add('Fila', queue.map((item, index) => `${LABELS[item.unitKind]}${index === 0 ? ` ${Math.ceil((item.totalTicks - item.progressTicks) / TICKS_PER_SECOND)}s` : ''}`).join(', '));
          if (first.kind === 'house' || first.kind === 'barracks') {
            add('Rally Point', first.rallyPoint ? `(${first.rallyPoint.join(', ')})` : 'Nenhum');
          }
        }
      }
    }

    const actionBar = document.querySelector('#action-bar');
    if (actionBar) {
      let targetMode = 'none';
      const blueBuildings = selected.filter((ent): ent is BuildingEntity => ent.category === 'building' && ent.team === 'blue');
      const blueBuilders = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.kind === 'builder' && ent.team === 'blue');
      const blueWorkers = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.kind === 'worker' && ent.team === 'blue');
      const blueUnits = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.team === 'blue');

      if (blueBuildings.length > 0) {
        const building = blueBuildings[0];
        const rallyKey = building.rallyPoint ? `${building.rallyPoint[0]},${building.rallyPoint[1]}` : 'none';
        const rallyModeKey = this.rallyPlacementMode && this.rallyBuildingId === building.id ? 'active' : 'idle';
        targetMode = `${building.kind}:${building.id}:${building.underConstruction ? 'building' : 'ready'}:${rallyKey}:${rallyModeKey}`;
      } else if (blueUnits.some((u) => isMilitaryKind(u.kind))) {
        const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
        targetMode = `units:${blueUnits.length}:${militaryCount}:${this.attackMoveMode ? 'on' : 'off'}:${this.selection.formation ?? 'none'}`;
      } else if (blueBuilders.length > 0) {
        targetMode = `builder:${blueBuilders[0].id}:${this.attackMoveMode ? 'on' : 'off'}`;
      } else if (blueWorkers.length > 0) {
        targetMode = `worker:${blueWorkers[0].id}:${this.attackMoveMode ? 'on' : 'off'}`;
      } else if (blueUnits.length > 0) {
        const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
        targetMode = `units:${blueUnits.length}:${militaryCount}:${this.attackMoveMode ? 'on' : 'off'}:${this.selection.formation ?? 'none'}`;
      }

      if (this.currentActionBarMode !== targetMode) {
        this.currentActionBarMode = targetMode;
        if (targetMode === 'none') {
          actionBar.setAttribute('hidden', '');
          actionBar.innerHTML = '';
        } else if (targetMode.startsWith('builder:') || targetMode.startsWith('worker:')) {
          const isBuilder = targetMode.startsWith('builder:');
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <div class="action-bar-header">${isBuilder ? 'Construtor' : 'Operário'} · Construções</div>
            <button id="btn-build-house" type="button">Construir Casa (150m, 100w)</button>
            <button id="btn-build-barracks" type="button">Construir Quartel (200m, 120w)</button>
            ${isBuilder ? '<button id="btn-build-barricade" type="button">Construir Barricada (10w, 5p)</button>' : ''}
            ${isBuilder ? '<button id="btn-build-tower" type="button">Construir Torre (200m, 150w, 100p)</button>' : ''}
            <button id="btn-attack-move" type="button" class="btn-attack-move ${this.attackMoveMode ? 'active' : ''}">Attack Move (A)</button>
          `;
          document.querySelector('#btn-attack-move')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.toggleAttackMoveMode();
          });
          document.querySelector('#btn-build-house')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.placementMode = { kind: 'house', width: 2, height: 2 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar a Casa (2×2). Botão direito cancela.';
          });
          document.querySelector('#btn-build-barracks')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.placementMode = { kind: 'barracks', width: 3, height: 3 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar o Quartel (3×3). Botão direito cancela.';
          });
          if (isBuilder) {
            document.querySelector('#btn-build-barricade')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.placementMode = { kind: 'barricade', width: 1, height: 1 };
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Clique no mapa para posicionar a Barricada (1×1). Botão direito cancela.';
            });
            document.querySelector('#btn-build-tower')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.placementMode = { kind: 'tower', width: 2, height: 2 };
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Clique no mapa para posicionar a Torre de Vigilância (2×2). Botão direito cancela.';
            });
          }
        } else if (targetMode.startsWith('units:')) {
          const militaryCount = blueUnits.filter((u) => isMilitaryKind(u.kind)).length;
          const currentFmt = this.selection.formation;
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <div class="action-bar-header">${blueUnits.length > 1 ? `${blueUnits.length} Tropas Selecionadas` : LABELS[blueUnits[0].kind]} · Comandos</div>
            <button id="btn-attack-move" type="button" class="btn-attack-move ${this.attackMoveMode ? 'active' : ''}">Attack Move (A)</button>
            ${militaryCount >= 2 ? `
              <div class="action-bar-header" style="margin-top: 6px;">Formação Tática</div>
              <div class="formation-buttons">
                <button id="btn-formation-none" type="button" class="btn-formation btn-formation-none ${currentFmt === null ? 'active' : ''}">Livre (ESC)</button>
                <button id="btn-formation-line" type="button" class="btn-formation ${currentFmt === 'line' ? 'active' : ''}">Linha</button>
                <button id="btn-formation-wedge" type="button" class="btn-formation ${currentFmt === 'wedge' ? 'active' : ''}">Cunha</button>
                <button id="btn-formation-block" type="button" class="btn-formation ${currentFmt === 'block' ? 'active' : ''}">Bloco</button>
                <button id="btn-formation-double-rank" type="button" class="btn-formation ${currentFmt === 'double-rank' ? 'active' : ''}">2 Fileiras</button>
              </div>
            ` : ''}
          `;
          document.querySelector('#btn-attack-move')?.addEventListener('click', () => {
            this.soundSystem.play('click');
            this.toggleAttackMoveMode();
          });
          if (militaryCount >= 2) {
            document.querySelector('#btn-formation-none')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.selection.setFormation(null);
              for (const id of this.selection.selectedIds) {
                this.simulation.formations.removeUnit(id);
              }
              this.formationPreviewGraphics.clear();
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = 'Modo Livre selecionado (sem formação). Movimentação e ataque livres.';
              this.refreshSelection();
            });
            const bindFormation = (id: string, fmt: FormationType, label: string) => {
              document.querySelector(id)?.addEventListener('click', () => {
                this.soundSystem.play('click');
                this.selection.setFormation(fmt);
                const fb = document.querySelector('#command-feedback');
                if (fb) fb.textContent = `Formação ${label} selecionada. Clique com o botão direito para movimentar.`;
                this.refreshSelection();
              });
            };
            bindFormation('#btn-formation-line', 'line', 'Linha');
            bindFormation('#btn-formation-wedge', 'wedge', 'Cunha');
            bindFormation('#btn-formation-block', 'block', 'Bloco');
            bindFormation('#btn-formation-double-rank', 'double-rank', 'Duas Fileiras');
          }
        } else if (targetMode.startsWith('base:')) {
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <div class="action-bar-header">Base Principal · QG</div>
            <div class="base-info">Centro de comando da colônia. Construa <strong>Casas</strong> com seus operários para treinar novos operários, e <strong>Quartéis</strong> para tropas militares.</div>
          `;
        } else if (targetMode.startsWith('house:')) {
          const house = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (house.underConstruction) {
            actionBar.innerHTML = '<span id="build-progress-label" class="queue-info"></span>';
          } else {
            actionBar.innerHTML = `
              <div class="action-bar-header">Casa · Treinamento</div>
              <button id="btn-produce-worker" type="button">Treinar Operário (150m, 6s)</button>
              <button id="btn-produce-builder" type="button">Treinar Construtor (150m, 6s)</button>
              <div style="display: flex; gap: 6px; width: 100%; margin-top: 4px;">
                <button id="btn-set-rally" type="button" class="btn-set-rally ${this.rallyPlacementMode && this.rallyBuildingId === house.id ? 'active' : ''}">Definir Rally Point</button>
                ${house.rallyPoint ? '<button id="btn-clear-rally" type="button" class="btn-clear-rally">Remover Rally</button>' : ''}
              </div>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            document.querySelector('#btn-produce-worker')?.addEventListener('click', () => {
              const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id, unitKind: 'worker' });
              if (res.accepted) this.soundSystem.play('order');
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Operário adicionado à fila de produção.' : `Produção indisponível: ${rejection(res.reason)}.`;
              this.refreshSelection();
              this.refreshTeamStatus();
            });
            document.querySelector('#btn-produce-builder')?.addEventListener('click', () => {
              const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id, unitKind: 'builder' });
              if (res.accepted) this.soundSystem.play('order');
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Construtor adicionado à fila de produção.' : `Produção indisponível: ${rejection(res.reason)}.`;
              this.refreshSelection();
              this.refreshTeamStatus();
            });
            document.querySelector('#btn-set-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.toggleRallyPlacementMode(house.id);
            });
            document.querySelector('#btn-clear-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              const res = this.simulation.issueCommand({ type: 'set-rally-point', team: 'blue', buildingId: house.id, point: null });
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Ponto de reunião removido.' : 'Erro ao remover ponto de reunião.';
              this.refreshSelection();
            });
          }
        } else if (targetMode.startsWith('barracks:')) {
          const barracks = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (barracks.underConstruction) {
            actionBar.innerHTML = '<span id="build-progress-label" class="queue-info"></span>';
          } else {
            actionBar.innerHTML = `
              <div class="action-bar-header">Quartel · Treinamento Militar</div>
              <button id="btn-produce-soldier" type="button">Soldado (100m, 5s)</button>
              <button id="btn-produce-archer" type="button">Arqueiro (180m, 7s)</button>
              <button id="btn-produce-shieldbearer" type="button">Escudeiro (150m, 7s)</button>
              <button id="btn-produce-scout" type="button">Batedor (200m, 6s)</button>
              <div style="display: flex; gap: 6px; width: 100%; margin-top: 4px;">
                <button id="btn-set-rally" type="button" class="btn-set-rally ${this.rallyPlacementMode && this.rallyBuildingId === barracks.id ? 'active' : ''}">Definir Rally Point</button>
                ${barracks.rallyPoint ? '<button id="btn-clear-rally" type="button" class="btn-clear-rally">Remover Rally</button>' : ''}
              </div>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            const bindProduce = (id: string, kind: UnitKind) => {
              document.querySelector(id)?.addEventListener('click', () => {
                const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: kind });
                if (res.accepted) this.soundSystem.play('order');
                const fb = document.querySelector('#command-feedback');
                if (fb) fb.textContent = res.accepted ? `${LABELS[kind]} adicionado à fila de produção.` : `Produção indisponível: ${rejection(res.reason)}.`;
                this.refreshSelection();
                this.refreshTeamStatus();
              });
            };
            bindProduce('#btn-produce-soldier', 'soldier');
            bindProduce('#btn-produce-archer', 'archer');
            bindProduce('#btn-produce-shieldbearer', 'shieldbearer');
            bindProduce('#btn-produce-scout', 'scout');
            document.querySelector('#btn-set-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              this.toggleRallyPlacementMode(barracks.id);
            });
            document.querySelector('#btn-clear-rally')?.addEventListener('click', () => {
              this.soundSystem.play('click');
              const res = this.simulation.issueCommand({ type: 'set-rally-point', team: 'blue', buildingId: barracks.id, point: null });
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Ponto de reunião removido.' : 'Erro ao remover ponto de reunião.';
              this.refreshSelection();
            });
          }
        } else if (targetMode.startsWith('tower:')) {
          const tower = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'tower' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (tower.underConstruction) {
            actionBar.innerHTML = '<span id="build-progress-label" class="queue-info"></span>';
          } else {
            actionBar.innerHTML = `
              <div class="action-bar-header">Torre de Vigilância</div>
              <div class="base-info">Estrutura de observação avançada. Revela continuamente uma área de <strong>20×20 células</strong> em tempo real e <strong>detecta batedores inimigos</strong> que entrarem no seu campo de visão. Não ataca.</div>
            `;
          }
        }
      }

      if (targetMode.endsWith(':building')) {
        const building = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
        if (building) {
          const rem = Math.ceil((building.buildTotalTicks - building.buildProgressTicks) / TICKS_PER_SECOND);
          const label = document.querySelector('#build-progress-label');
          if (label) label.textContent = `${LABELS[building.kind]} em construção... (${rem}s restantes)`;
        }
      } else if (targetMode.endsWith(':ready') && !targetMode.startsWith('base:')) {
        const building = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
        if (building) {
          const queue = this.simulation.production.queueFor(building.id);
          const queueStr = queue.length > 0
            ? `Fila: ${queue.map((item, i) => `${LABELS[item.unitKind]} (${i === 0 ? Math.ceil((item.totalTicks - item.progressTicks) / TICKS_PER_SECOND) + 's' : 'na fila'})`).join(', ')}`
            : '';
          const label = document.querySelector('#queue-info-label');
          if (label) label.textContent = queueStr;
        }
      }
    }
  }

  private refreshSelection(): void {
    this.drawSelectionVisuals();
    this.refreshSelectionDOM();
  }

  private refreshTeamStatus(): void {
    const team = this.simulation.teams.blue;
    const units = this.simulation.entities.all().filter((entity) => entity.team === 'blue' && entity.category === 'unit').length;
    const teamStatus = document.querySelector('#team-status');
    if (teamStatus) teamStatus.textContent = `Azul · ${Math.floor(team.coins)} moedas · ${Math.floor(team.wood)} madeira · ${Math.floor(team.stone)} pedra · ${units}/${BALANCE.map.unitCapPerTeam} unidades`;
    const cap = this.simulation.production.getCapacity('blue');
    const capStatus = document.querySelector('#capacity-status');
    if (capStatus) {
      capStatus.textContent = `Civil: ${cap.civilianUnits}/${cap.civilianCapacity} · Militar: ${cap.militaryUnits}/${cap.militaryCapacity} · Total: ${cap.totalUnits}/${cap.maxTotalUnits}`;
      const isCivilianCapped = cap.civilianCapacity > 0 && cap.civilianUnits >= cap.civilianCapacity;
      const isMilitaryCapped = cap.militaryCapacity > 0 && cap.militaryUnits >= cap.militaryCapacity;
      const isTotalCapped = cap.totalUnits >= cap.maxTotalUnits;
      const isCapped = isCivilianCapped || isMilitaryCapped || isTotalCapped;
      capStatus.classList.toggle('capacity-warning', isCapped);
    }
  }

  private inspect(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x / CELL_SIZE);
    const y = Math.floor(world.y / CELL_SIZE);
    const cell = this.map.cellAt(x, y);
    if (!cell) return;
    const panel = document.querySelector('#inspect');
    const occupant = this.simulation.entities.atCell(x, y);
    const fogState = this.simulation.fog.stateAt('blue', x, y);
    if (panel) panel.textContent = `Célula ${x}, ${y} · ${cell.terrain} · fog ${fogState} · ${cell.blocked || occupant ? 'ocupada/bloqueada' : 'livre'}${occupant ? ` · ${occupant.id}` : ''}`;
    document.querySelector('#game')?.setAttribute('data-cell', `${x},${y}`);
  }

  private lastEscapeTime = 0;

  handleEscape(): void {
    if (this.simulation.result) return;
    const now = performance.now();
    if (now - this.lastEscapeTime < 150) return;
    this.lastEscapeTime = now;

    let cancelled = false;
    if (this.placementMode) {
      this.placementMode = null;
      this.barricadeDragStart = null;
      this.barricadeLineCells = [];
      this.barricadeLastEndCell = null;
      this.barricadeLineValidation = null;
      this.placementGhostGraphics.clear();
      cancelled = true;
    }
    if (this.attackMoveMode) {
      this.attackMoveMode = false;
      this.placementGhostGraphics.clear();
      this.formationPreviewGraphics.clear();
      cancelled = true;
    }
    if (this.rallyPlacementMode) {
      this.rallyPlacementMode = false;
      this.rallyBuildingId = null;
      this.placementGhostGraphics.clear();
      cancelled = true;
    }

    // If tactical formation is active, cancel it (switch to Free Mode)
    // and detach selected units from formation constraints so they can move/attack freely
    if (this.selection.formation !== null) {
      this.selection.setFormation(null);
      for (const id of this.selection.selectedIds) {
        this.simulation.formations.removeUnit(id);
      }
      this.formationPreviewGraphics.clear();
      this.soundSystem.play('click');
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Formação desativada (Modo Livre). Movimentação e ataque livres.';
      this.refreshSelection();
      return;
    }

    if (cancelled) {
      this.soundSystem.play('click');
      const fb = document.querySelector('#command-feedback');
      if (fb) fb.textContent = 'Comando cancelado.';
      this.refreshSelection();
      return;
    }

    // If already in Free Mode and units are selected, clear selection
    if (this.selection.selectedIds.length > 0) {
      this.selection.clear();
      this.soundSystem.play('click');
      this.refreshSelection();
    }
  }

  centerCameraOn(cellX: number, cellY: number): void {
    const clampedX = Math.max(0, Math.min(this.map.width - 1, cellX));
    const clampedY = Math.max(0, Math.min(this.map.height - 1, cellY));
    this.cameras.main.centerOn((clampedX + 0.5) * CELL_SIZE, (clampedY + 0.5) * CELL_SIZE);
  }
}

import Phaser from 'phaser';
import { MAP_DEFINITION } from '../config/map';
import { BALANCE } from '../config/balance';
import { Simulation } from '../core/game/Simulation';
import { dispatchGroupMove } from '../core/commands/dispatchGroupMove';
import { dispatchGroupAttack } from '../core/commands/dispatchGroupAttack';
import type { BuildingEntity, GameEntity, UnitEntity, UnitKind } from '../core/entities/EntityStore';
import type { MovementEvent } from '../core/systems/MovementSystem';
import { TICKS_PER_SECOND } from '../config/runtime';
import { SelectionModel } from '../input/SelectionModel';
import type { Terrain } from '../map/MapGrid';

const CELL_SIZE = 12;
const PAN_SPEED = 500;
const MIN_ZOOM = 0.38;
const MAX_ZOOM = 2.5;
const MOTION_MS_PER_CELL = 90;
const COLORS: Record<Terrain, number> = {
  plain: 0x17252c,
  water: 0x286276,
  mountain: 0x68727a,
  forest: 0x346b51,
  mine: 0xd5a64e,
};
const LABELS: Record<string, string> = {
  base: 'Base', worker: 'Operário', soldier: 'Soldado', shieldbearer: 'Escudeiro',
  scout: 'Batedor', archer: 'Arqueiro', house: 'Casa', barracks: 'Quartel',
};

interface MotionTrack {
  path: MovementEvent['path'];
  elapsedMs: number;
}

interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: number;
  elapsedMs: number;
  totalMs: number;
}

/** Map rendering and camera input; logical terrain remains in MapGrid. */
export class MapScene extends Phaser.Scene {
  private readonly simulation = new Simulation(123, !new URLSearchParams(window.location.search).has('noai'));
  private readonly map = this.simulation.map;
  private readonly selection = new SelectionModel(this.simulation.entities, 'blue');
  private dragStart: { x: number; y: number; worldX: number; worldY: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private dragged = false;
  private dragMode: 'pan' | 'select' | null = null;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private selectionBoxGraphics!: Phaser.GameObjects.Graphics;
  private entityGraphics!: Phaser.GameObjects.Graphics;
  private combatGraphics!: Phaser.GameObjects.Graphics;
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private placementGhostGraphics!: Phaser.GameObjects.Graphics;
  private placementMode: { kind: 'house' | 'barracks'; width: number; height: number } | null = null;
  private currentActionBarMode = 'none';
  private readonly displayPositions = new Map<string, { x: number; y: number }>();
  private readonly motionTracks = new Map<string, MotionTrack>();
  private readonly attackEffects: AttackEffect[] = [];
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly debug = new URLSearchParams(window.location.search).has('debug');
  private resultShown = false;

  constructor() {
    super('Map');
  }

  create(): void {
    const worldWidth = this.map.width * CELL_SIZE;
    const worldHeight = this.map.height * CELL_SIZE;
    this.cameras.main.setBackgroundColor('#101a20');
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setZoom(1.25);
    this.cameras.main.centerOn((MAP_DEFINITION.teamStarts.blue.base[0] + 10) * CELL_SIZE, (MAP_DEFINITION.teamStarts.blue.base[1] + 2) * CELL_SIZE);
    this.drawMap();
    this.fogGraphics = this.add.graphics();
    this.drawFog();
    this.entityGraphics = this.add.graphics();
    this.combatGraphics = this.add.graphics();
    for (const entity of this.simulation.entities.all()) {
      if (entity.category === 'unit') this.displayPositions.set(entity.id, { x: entity.x, y: entity.y });
    }
    this.drawEntities();
    this.selectionGraphics = this.add.graphics();
    this.selectionBoxGraphics = this.add.graphics();
    this.placementGhostGraphics = this.add.graphics();
    this.refreshSelection();
    this.refreshTeamStatus();
    this.input.mouse?.disableContextMenu();
    (window as Window & { __simulation?: Simulation }).__simulation = this.simulation;

    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const name of ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT']) {
        this.keys[name] = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes]);
      }
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.dragStart = { x: pointer.x, y: pointer.y, worldX: world.x, worldY: world.y };
      this.lastPointer = { x: pointer.x, y: pointer.y };
      this.dragged = false;
      this.dragMode = pointer.button === 0 ? 'select' : 'pan';
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      if (this.placementMode) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gx = Math.floor(world.x / CELL_SIZE);
        const gy = Math.floor(world.y / CELL_SIZE);
        const { kind, width, height } = this.placementMode;
        const config = BALANCE.buildings[kind];
        const stock = this.simulation.teams.blue;
        let valid = this.simulation.entities.isAreaFreeForBuilding(gx, gy, width, height)
          && stock.coins >= config.coins && stock.wood >= config.wood;
        for (let y = gy; y < gy + height; y += 1) {
          for (let x = gx; x < gx + width; x += 1) {
            if (this.simulation.fog.stateAt('blue', x, y) === 'unknown') valid = false;
          }
        }
        this.placementGhostGraphics.clear();
        this.placementGhostGraphics.fillStyle(valid ? 0x44dd88 : 0xdd4444, 0.35);
        this.placementGhostGraphics.fillRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
        this.placementGhostGraphics.lineStyle(2, valid ? 0x44dd88 : 0xdd4444, 1);
        this.placementGhostGraphics.strokeRect(gx * CELL_SIZE, gy * CELL_SIZE, width * CELL_SIZE, height * CELL_SIZE);
      }
      if (!pointer.isDown || !this.dragStart || !this.lastPointer) return;
      if (Math.hypot(pointer.x - this.dragStart.x, pointer.y - this.dragStart.y) > 4) this.dragged = true;
      if (this.dragged && this.dragMode === 'pan') {
        this.cameras.main.scrollX -= (pointer.x - this.lastPointer.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - this.lastPointer.y) / this.cameras.main.zoom;
      } else if (this.dragged && this.dragMode === 'select' && !this.placementMode) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.drawSelectionBox(this.dragStart.worldX, this.dragStart.worldY, world.x, world.y);
      }
      this.lastPointer = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.simulation.result) return;
      if (this.placementMode) {
        if (pointer.button === 0 && !this.dragged) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const gx = Math.floor(world.x / CELL_SIZE);
          const gy = Math.floor(world.y / CELL_SIZE);
          const worker = this.selection.selectedEntities.find(
            (e): e is UnitEntity => e.category === 'unit' && e.kind === 'worker' && e.team === 'blue',
          );
          if (worker) {
            const result = this.simulation.issueCommand({
              type: 'build',
              team: 'blue',
              builderId: worker.id,
              buildingKind: this.placementMode.kind,
              position: [gx, gy],
            });
            const feedback = document.querySelector('#command-feedback');
            if (feedback) feedback.textContent = result.accepted
              ? `Construção de ${LABELS[this.placementMode.kind]} iniciada em (${gx}, ${gy}).`
              : `Construção indisponível: ${result.reason}.`;
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
        this.refreshSelection();
      } else if (this.dragMode === 'pan' && !this.dragged && pointer.button === 2) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const destination: [number, number] = [Math.floor(world.x / CELL_SIZE), Math.floor(world.y / CELL_SIZE)];
        const clickedEntity = this.simulation.entities.atCell(destination[0], destination[1]);
        const isEnemyVisible = clickedEntity && clickedEntity.team !== 'blue' && this.simulation.fog.isEntityVisible('blue', clickedEntity);
        if (isEnemyVisible && clickedEntity) {
          const results = dispatchGroupAttack(this.simulation, 'blue', this.selection.selectedIds, clickedEntity.id);
          const accepted = results.filter((item) => item.result.accepted).length;
          const feedback = document.querySelector('#command-feedback');
          if (feedback) feedback.textContent = results.length === 0
            ? 'Selecione uma unidade militar azul para atacar.'
            : accepted > 0 ? `${accepted} ordem(ns) de ataque contra ${LABELS[clickedEntity.kind]} enviada(s).`
              : `Ataque indisponível: ${results[0].result.accepted ? '' : results[0].result.reason}.`;
          this.refreshSelection();
          this.refreshTeamStatus();
          this.dragStart = null;
          this.lastPointer = null;
          this.dragMode = null;
          this.selectionBoxGraphics.clear();
          return;
        }

        const terrain = this.map.cellAt(destination[0], destination[1])?.terrain;
        const known = this.simulation.fog.stateAt('blue', destination[0], destination[1]) !== 'unknown';
        const workType = known && terrain === 'mine' ? 'mine' : known && terrain === 'forest' ? 'gather' : null;
        const results = workType
          ? this.selection.selectedIds.map((unitId) => ({ unitId, result: this.simulation.issueCommand({
            type: workType, team: 'blue', unitId, target: destination,
          }) }))
          : dispatchGroupMove(this.simulation, 'blue', this.selection.selectedIds, destination);
        const accepted = results.filter((item) => item.result.accepted).length;
        const feedback = document.querySelector('#command-feedback');
        if (feedback) feedback.textContent = results.length === 0
          ? 'Selecione uma unidade azul para mover.'
          : accepted > 0 ? `${accepted} ordem(ns) de ${workType === 'mine' ? 'mina' : workType === 'gather' ? 'coleta' : 'movimento'} recebida(s) para (${destination.join(', ')}).`
            : `Ordem indisponível: ${results[0].result.accepted ? '' : results[0].result.reason}.`;
        this.refreshSelection();
      }
      this.dragStart = null;
      this.lastPointer = null;
      this.dragMode = null;
      this.selectionBoxGraphics.clear();
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.simulation.result) return;
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, MAX_ZOOM));
    });

    document.querySelector('#game')?.setAttribute('data-ready', 'true');
    document.querySelector('#inspect')?.toggleAttribute('hidden', !this.debug);
  }

  update(_time: number, delta: number): void {
    const ticks = this.simulation.advance(delta);
    if (this.simulation.result && !this.resultShown) this.showResult();
    const movementEvents = this.simulation.movement.drainEvents();
    for (const event of movementEvents) this.motionTracks.set(event.unitId, { path: event.path, elapsedMs: 0 });
    this.updateMotion(delta);

    const combatEvents = this.simulation.combat.drainEvents();
    for (const event of combatEvents) {
      this.attackEffects.push({
        fromX: (event.attackerX + 0.5) * CELL_SIZE,
        fromY: (event.attackerY + 0.5) * CELL_SIZE,
        toX: (event.targetX + 0.5) * CELL_SIZE,
        toY: (event.targetY + 0.5) * CELL_SIZE,
        color: event.attackerTeam === 'blue' ? 0x9bdbff : 0xffada9,
        elapsedMs: 0,
        totalMs: 180,
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
      if (!this.simulation.entities.get(unitId)) this.displayPositions.delete(unitId);
    }
    for (const unitId of this.motionTracks.keys()) {
      if (!this.simulation.entities.get(unitId)) this.motionTracks.delete(unitId);
    }

    const dirtyCells = this.map.drainDirtyCells();
    if (dirtyCells.length > 0) {
      for (const [x, y] of dirtyCells) {
        const cell = this.map.cellAt(x, y)!;
        this.mapGraphics.fillStyle(COLORS[cell.terrain]).fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        if (cell.structureTeam) {
          this.mapGraphics.fillStyle(cell.structureTeam === 'blue' ? 0x5aaadb : 0xe07072)
            .fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
        this.mapGraphics.lineStyle(1, 0x38505a, 0.55);
        this.mapGraphics.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    if (movementEvents.length > 0 || dirtyCells.length > 0) this.drawFog();
    if (ticks > 0 || this.motionTracks.size > 0 || movementEvents.length > 0 || dirtyCells.length > 0 || combatEvents.length > 0) {
      this.drawEntities();
      this.refreshSelection();
      this.refreshTeamStatus();
    }
    if (this.simulation.result) return;
    const camera = this.cameras.main;
    const movement = PAN_SPEED * delta / 1000 / camera.zoom;
    if (this.keys.A?.isDown || this.keys.LEFT?.isDown) camera.scrollX -= movement;
    if (this.keys.D?.isDown || this.keys.RIGHT?.isDown) camera.scrollX += movement;
    if (this.keys.W?.isDown || this.keys.UP?.isDown) camera.scrollY -= movement;
    if (this.keys.S?.isDown || this.keys.DOWN?.isDown) camera.scrollY += movement;

    const root = document.querySelector('#game');
    root?.setAttribute('data-ticks', String(this.simulation.clock.ticks));
    root?.setAttribute('data-zoom', camera.zoom.toFixed(2));
    root?.setAttribute('data-camera-x', camera.scrollX.toFixed(1));
    root?.setAttribute('data-camera-y', camera.scrollY.toFixed(1));
    const zoomLabel = document.querySelector('#zoom-value');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  }

  private showResult(): void {
    const result = this.simulation.result;
    if (!result) return;
    this.resultShown = true;
    this.placementMode = null;
    this.placementGhostGraphics.clear();
    const victory = result.winner === 'blue';
    const title = document.querySelector('#result-title');
    const summary = document.querySelector('#result-summary');
    const stats = document.querySelector('#result-stats');
    const panel = document.querySelector('#game-result');
    if (title) title.textContent = victory ? 'Vitória!' : 'Derrota';
    if (summary) summary.textContent = victory ? 'Você destruiu a base inimiga.' : 'Sua base foi destruída.';
    if (stats) {
      stats.innerHTML = '';
      const entries = [
        ['Duração', `${Math.floor(result.elapsedTicks / TICKS_PER_SECOND / 60)}m ${String(Math.floor(result.elapsedTicks / TICKS_PER_SECOND) % 60).padStart(2, '0')}s`],
        ['Unidades azuis restantes', String(result.blueUnits)],
        ['Unidades vermelhas restantes', String(result.redUnits)],
        ['Recursos azuis', `${result.blueCoins} moedas · ${result.blueWood} madeira`],
        ['Recursos vermelhos', `${result.redCoins} moedas · ${result.redWood} madeira`],
      ];
      for (const [label, value] of entries) {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        stats.append(dt, dd);
      }
    }
    panel?.removeAttribute('hidden');
    document.querySelector('#restart-game')?.addEventListener('click', () => window.location.reload(), { once: true });
    (document.querySelector('#restart-game') as HTMLButtonElement | null)?.focus();
  }

  private drawMap(): void {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(COLORS.plain).fillRect(0, 0, this.map.width * CELL_SIZE, this.map.height * CELL_SIZE);
    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const cell = this.map.cellAt(x, y)!;
        if (cell.terrain !== 'plain') {
          this.mapGraphics.fillStyle(COLORS[cell.terrain]).fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
        if (cell.structureTeam) {
          this.mapGraphics.fillStyle(cell.structureTeam === 'blue' ? 0x5aaadb : 0xe07072)
            .fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    this.mapGraphics.lineStyle(1, 0x38505a, 0.55);
    for (let x = 0; x <= this.map.width; x += 1) {
      this.mapGraphics.lineBetween(x * CELL_SIZE, 0, x * CELL_SIZE, this.map.height * CELL_SIZE);
    }
    for (let y = 0; y <= this.map.height; y += 1) {
      this.mapGraphics.lineBetween(0, y * CELL_SIZE, this.map.width * CELL_SIZE, y * CELL_SIZE);
    }
    this.mapGraphics.lineStyle(3, 0x8ba7ad, 1).strokeRect(0, 0, this.map.width * CELL_SIZE, this.map.height * CELL_SIZE);
  }

  private drawEntities(): void {
    const graphics = this.entityGraphics;
    graphics.clear();
    for (const entity of this.simulation.fog.visibleEntities('blue')) {
      const color = entity.team === 'blue' ? 0x9bdbff : 0xffada9;
      if (entity.category === 'unit') {
        const position = this.displayPositions.get(entity.id) ?? entity;
        graphics.fillStyle(0x10232b).fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        graphics.fillStyle(color).fillRect(position.x * CELL_SIZE + 3, position.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
        if (entity.hp < entity.maxHp) {
          const hpPct = Math.max(0, entity.hp / entity.maxHp);
          const barW = CELL_SIZE - 2;
          graphics.fillStyle(0x3a0000, 0.9).fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE - 3, barW, 2);
          graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
            .fillRect(position.x * CELL_SIZE + 1, position.y * CELL_SIZE - 3, Math.max(1, barW * hpPct), 2);
        }
      } else {
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
          graphics.lineStyle(2, color, 1).strokeRect(
            entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE + 2,
            entity.width * CELL_SIZE - 4, entity.height * CELL_SIZE - 4,
          );
          graphics.fillStyle(color).fillRect(
            (entity.x + entity.width / 2) * CELL_SIZE - 3,
            (entity.y + entity.height / 2) * CELL_SIZE - 3, 6, 6,
          );
          if (entity.hp < entity.maxHp) {
            const hpPct = Math.max(0, entity.hp / entity.maxHp);
            const barW = entity.width * CELL_SIZE - 4;
            graphics.fillStyle(0x3a0000, 0.9).fillRect(entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE - 3, barW, 3);
            graphics.fillStyle(entity.team === 'blue' ? 0x55ff55 : 0xff5555, 0.95)
              .fillRect(entity.x * CELL_SIZE + 2, entity.y * CELL_SIZE - 3, Math.max(1, barW * hpPct), 3);
          }
        }
      }
    }
  }

  private updateAttackEffects(delta: number): void {
    this.combatGraphics.clear();
    for (let i = this.attackEffects.length - 1; i >= 0; i -= 1) {
      const fx = this.attackEffects[i];
      fx.elapsedMs += delta;
      if (fx.elapsedMs >= fx.totalMs) {
        this.attackEffects.splice(i, 1);
        continue;
      }
      const alpha = 1 - (fx.elapsedMs / fx.totalMs);
      this.combatGraphics.lineStyle(2, fx.color, alpha);
      this.combatGraphics.lineBetween(fx.fromX, fx.fromY, fx.toX, fx.toY);
      this.combatGraphics.fillStyle(0xffffff, alpha);
      this.combatGraphics.fillCircle(fx.toX, fx.toY, 2.5);
    }
  }

  private updateMotion(delta: number): void {
    for (const [unitId, track] of this.motionTracks) {
      track.elapsedMs += delta;
      const segments = track.path.length - 1;
      const progress = Math.min(segments, track.elapsedMs / MOTION_MS_PER_CELL);
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
      let runState = this.simulation.fog.stateAt('blue', 0, y);
      let runStart = 0;
      for (let x = 0; x <= this.map.width; x += 1) {
        const state = x < this.map.width ? this.simulation.fog.stateAt('blue', x, y) : null;
        if (state === 'visible') visibleCount += 1;
        if (state === 'explored') exploredCount += 1;
        if (state === runState) continue;
        if (runState === 'unknown') {
          graphics.fillStyle(0x09141a, 1)
            .fillRect(runStart * CELL_SIZE, y * CELL_SIZE, (x - runStart) * CELL_SIZE, CELL_SIZE);
        }
        runStart = x;
        runState = state;
      }
    }
    graphics.lineStyle(1, 0x35515b, 0.18);
    for (let x = 0; x <= this.map.width; x += 1) {
      graphics.lineBetween(x * CELL_SIZE, 0, x * CELL_SIZE, this.map.height * CELL_SIZE);
    }
    for (let y = 0; y <= this.map.height; y += 1) {
      graphics.lineBetween(0, y * CELL_SIZE, this.map.width * CELL_SIZE, y * CELL_SIZE);
    }
    const root = document.querySelector('#game');
    root?.setAttribute('data-visible-cells', String(visibleCount));
    root?.setAttribute('data-explored-cells', String(exploredCount));
    const fogStatus = document.querySelector('#fog-status');
    if (fogStatus) fogStatus.textContent = `Visíveis: ${visibleCount} · exploradas: ${exploredCount}`;
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

  private refreshSelection(): void {
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
    }
    const root = document.querySelector('#game');
    root?.setAttribute('data-selected-ids', this.selection.selectedIds.join(','));
    const first = selected[0];
    const visual = first?.category === 'unit' ? this.displayPositions.get(first.id) ?? first : null;
    if (visual) root?.setAttribute('data-selected-visual-x', visual.x.toFixed(2));
    else root?.removeAttribute('data-selected-visual-x');
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
        return `${LABELS[entity.kind]} · HP ${entity.hp}/${entity.maxHp} · (${entity.x}, ${entity.y})`
          + (entity.category === 'unit' && entity.damage > 0 ? ` · Dano ${entity.damage} · Alc ${entity.range}` : '')
          + (combatTarget ? ` · Alvo (${combatTarget})` : '')
          + (entity.category === 'building' && entity.underConstruction ? ' · em construção' : '')
          + (cooldown > 0 ? ` · cooldown ${Math.ceil(cooldown / TICKS_PER_SECOND)}s` : '')
          + (entity.category === 'unit' && entity.moveTarget ? ` · destino (${entity.moveTarget.join(', ')})` : '')
          + (entity.category === 'unit' && entity.carriedWood > 0 ? ` · carga ${entity.carriedWood}/${BALANCE.economy.wood.workerCapacity}` : '')
          + (task ? ` · ${task.kind === 'mine' ? 'mina' : 'coleta'}: ${task.phase}` : '')
          + (buildTask ? ` · construindo: ${buildTask.phase}` : '')
          + (queue.length > 0 ? ` · fila (${queue.length})` : '');
      }).join('  |  ');

    const actionBar = document.querySelector('#action-bar');
    if (actionBar) {
      let targetMode = 'none';
      const blueBuildings = selected.filter((ent): ent is BuildingEntity => ent.category === 'building' && ent.team === 'blue');
      const blueWorkers = selected.filter((ent): ent is UnitEntity => ent.category === 'unit' && ent.kind === 'worker' && ent.team === 'blue');

      if (blueBuildings.length > 0) {
        const building = blueBuildings[0];
        targetMode = `${building.kind}:${building.id}:${building.underConstruction ? 'building' : 'ready'}`;
      } else if (blueWorkers.length > 0) {
        targetMode = `worker:${blueWorkers[0].id}`;
      }

      if (this.currentActionBarMode !== targetMode) {
        this.currentActionBarMode = targetMode;
        if (targetMode === 'none') {
          actionBar.setAttribute('hidden', '');
          actionBar.innerHTML = '';
        } else if (targetMode.startsWith('worker:')) {
          actionBar.removeAttribute('hidden');
          actionBar.innerHTML = `
            <div class="action-bar-header">Operário · Construções</div>
            <button id="btn-build-house" type="button">Construir Casa (150m, 100w)</button>
            <button id="btn-build-barracks" type="button">Construir Quartel (200m, 120w)</button>
          `;
          document.querySelector('#btn-build-house')?.addEventListener('click', () => {
            this.placementMode = { kind: 'house', width: 2, height: 2 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar a Casa (2×2). Botão direito cancela.';
          });
          document.querySelector('#btn-build-barracks')?.addEventListener('click', () => {
            this.placementMode = { kind: 'barracks', width: 3, height: 3 };
            const fb = document.querySelector('#command-feedback');
            if (fb) fb.textContent = 'Clique no mapa para posicionar o Quartel (3×3). Botão direito cancela.';
          });
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
              <div class="action-bar-header">Casa · Treinamento de Operários</div>
              <button id="btn-produce-worker" type="button">Treinar Operário (150m, 6s)</button>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            document.querySelector('#btn-produce-worker')?.addEventListener('click', () => {
              const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: house.id, unitKind: 'worker' });
              const fb = document.querySelector('#command-feedback');
              if (fb) fb.textContent = res.accepted ? 'Operário adicionado à fila de produção.' : `Produção indisponível: ${res.reason}.`;
              this.refreshSelection();
              this.refreshTeamStatus();
            });
          }
        } else if (targetMode.startsWith('barracks:')) {
          const barracks = (selected.find((e): e is BuildingEntity => e.category === 'building' && e.team === 'blue') ?? selected[0]) as BuildingEntity;
          actionBar.removeAttribute('hidden');
          if (barracks.underConstruction) {
            actionBar.innerHTML = '<span id="build-progress-label" class="queue-info"></span>';
          } else {
            actionBar.innerHTML = `
              <button id="btn-produce-soldier" type="button">Soldado (100m, 5s)</button>
              <button id="btn-produce-archer" type="button">Arqueiro (180m, 7s)</button>
              <button id="btn-produce-shieldbearer" type="button">Escudeiro (150m, 7s)</button>
              <button id="btn-produce-scout" type="button">Batedor (200m, 6s)</button>
              <div id="queue-info-label" class="queue-info"></div>
            `;
            const bindProduce = (id: string, kind: UnitKind) => {
              document.querySelector(id)?.addEventListener('click', () => {
                const res = this.simulation.issueCommand({ type: 'produce', team: 'blue', buildingId: barracks.id, unitKind: kind });
                const fb = document.querySelector('#command-feedback');
                if (fb) fb.textContent = res.accepted ? `${LABELS[kind]} adicionado à fila de produção.` : `Produção indisponível: ${res.reason}.`;
                this.refreshSelection();
                this.refreshTeamStatus();
              });
            };
            bindProduce('#btn-produce-soldier', 'soldier');
            bindProduce('#btn-produce-archer', 'archer');
            bindProduce('#btn-produce-shieldbearer', 'shieldbearer');
            bindProduce('#btn-produce-scout', 'scout');
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

  private refreshTeamStatus(): void {
    const team = this.simulation.teams.blue;
    const units = this.simulation.entities.all().filter((entity) => entity.team === 'blue' && entity.category === 'unit').length;
    const teamStatus = document.querySelector('#team-status');
    if (teamStatus) teamStatus.textContent = `Azul · ${team.coins} moedas · ${team.wood} madeira · ${units}/${BALANCE.map.unitCapPerTeam} unidades`;
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
}

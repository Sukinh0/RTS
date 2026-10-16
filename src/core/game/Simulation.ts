import { FixedStepClock } from './FixedStepClock';
import { PerformanceMonitor } from './PerformanceMonitor';
import { SeededRng } from './SeededRng';
import { MAP_DEFINITION } from '../../config/map';
import { MapGrid } from '../../map/MapGrid';
import { EntityStore, type UnitEntity, type UnitKind } from '../entities/EntityStore';
import { BALANCE } from '../../config/balance';
import type { CommandResult, GameCommand, AttackMoveCommand, MoveCommand } from '../commands/MoveCommand';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import { MovementSystem } from '../systems/MovementSystem';
import { FogOfWar } from '../systems/FogOfWar';
import { EconomySystem, type TeamStock } from '../systems/EconomySystem';
import { ConstructionSystem } from '../systems/ConstructionSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { MarchEngagementSystem, findBlockingEnemyStructure } from '../systems/MarchEngagementSystem';
import { FormationController } from '../formations/FormationController';
import { AIController } from '../ai/AIController';
import type { Team } from '../../map/MapGrid';
import { MatchStats, type MatchStatsSnapshot } from './MatchStats';

export interface GameResult {
  winner: Team;
  loser: Team;
  elapsedTicks: number;
  blueUnits: number;
  redUnits: number;
  blueCoins: number;
  redCoins: number;
  blueWood: number;
  redWood: number;
  blueStone: number;
  redStone: number;
  stats: MatchStatsSnapshot;
}

/** Headless simulation entry point. Gameplay systems will attach here by phase. */
export class Simulation {
  readonly diagnostics = new PerformanceMonitor();
  readonly clock = new FixedStepClock();
  readonly rng: SeededRng;
  readonly map = new MapGrid(MAP_DEFINITION);
  readonly entities = new EntityStore(this.map);
  readonly movement = new MovementSystem(this.entities);
  readonly formations: FormationController;
  readonly fog = new FogOfWar(this.map, this.entities);
  readonly teams: TeamStock = {
    blue: {
      coins: Math.round(BALANCE.startingState.coins),
      wood: Math.round(BALANCE.startingState.wood),
      stone: Math.round(BALANCE.startingState.stone ?? 0),
    },
    red: {
      coins: Math.round(BALANCE.startingState.coins),
      wood: Math.round(BALANCE.startingState.wood),
      stone: Math.round(BALANCE.startingState.stone ?? 0),
    },
  };
  readonly economy = new EconomySystem(this.entities, this.movement, this.fog, this.teams);
  readonly construction = new ConstructionSystem(this.entities, this.movement, this.fog, this.teams);
  readonly production = new ProductionSystem(this.entities, this.teams, this.fog);
  readonly combat: CombatSystem;
  readonly engagements = new MarchEngagementSystem(this);
  readonly aiControllers = new Map<Team, AIController>();
  readonly stats = new MatchStats();
  result: GameResult | null = null;

  constructor(seed: number, enableRedAI = false) {
    this.map.diagnostics = this.diagnostics;
    this.rng = new SeededRng(seed);
    this.formations = new FormationController(this);
    this.movement.setSpeedLimitProvider((unit) => this.formations.getEffectiveSpeed(unit));
    this.combat = new CombatSystem(this.entities, this.fog, (entity) => {
      if (entity.category === 'unit') {
        for (const ai of this.aiControllers.values()) {
          if (this.fog.isEntityVisible(ai.team, entity)) ai.memory.lastSeenEnemies.delete(entity.id);
        }
        this.stats.killed(entity.team, entity.kind);
        this.formations.handleUnitDeath(entity.id);
      }
      this.movement.cancel(entity.id);
      this.economy.cancel(entity.id);
      this.construction.cancel(entity.id);
      this.production.cancel(entity.id);
      this.engagements.cancel(entity.id);
      if (entity.category === 'building' && entity.kind === 'base' && !this.result) {
        const winner: Team = entity.team === 'blue' ? 'red' : 'blue';
        const units = this.entities.all().filter((item) => item.category === 'unit');
        this.result = {
          winner, loser: entity.team, elapsedTicks: this.clock.ticks,
          blueUnits: units.filter((item) => item.team === 'blue').length,
          redUnits: units.filter((item) => item.team === 'red').length,
          blueCoins: Math.round(this.teams.blue.coins),
          redCoins: Math.round(this.teams.red.coins),
          blueWood: Math.round(this.teams.blue.wood),
          redWood: Math.round(this.teams.red.wood),
          blueStone: Math.round(this.teams.blue.stone),
          redStone: Math.round(this.teams.red.stone),
          stats: this.stats.snapshot(),
        };
      }
    }, () => this.result !== null);
    this.production.setOnUnitSpawned((unit, _building, rally) => {
      dispatchGroupMove(this, unit.team, [unit.id], rally);
    });
    this.production.setOnUnitProduced((unit) => this.stats.produced(unit.team, unit.kind));
    this.fog.update();
    if (enableRedAI) {
      this.enableAI('red');
    }
  }

  get redAI(): AIController | undefined {
    return this.aiControllers.get('red');
  }

  get blueAI(): AIController | undefined {
    return this.aiControllers.get('blue');
  }

  enableAI(team: Team = 'red'): AIController {
    const controller = new AIController(this, team);
    this.aiControllers.set(team, controller);
    if (this.diagnostics.enabled) this.diagnostics.watch(controller, 'update', 'ai');
    return controller;
  }

  setDiagnostics(enabled: boolean): void {
    this.diagnostics.disable();
    if (!enabled) return;
    const monitor = this.diagnostics;
    monitor.enable();
    monitor.watch(this, 'advance', 'simulation');
    for (const key of ['movement', 'fog', 'economy', 'construction', 'production', 'engagements', 'formations', 'combat'] as const) {
      monitor.watch(this[key], 'update', key);
    }
    for (const controller of this.aiControllers.values()) monitor.watch(controller, 'update', 'ai');
    monitor.watch(this.entities, 'isFreeForUnit', 'collisionChecks', true);
    monitor.watch(this.entities, 'moveUnit', 'collisions');
    monitor.watch(this.entities, 'nearby', 'spatialQueries');
    monitor.watch(this.map, 'hasStaticConnection', 'connectivity');
    monitor.watch(this.movement, 'issue', 'moveCommands');
  }

  gameSpeed = 1;
  aiPaused = false;

  addResources(team: Team, coins: number, wood: number, stone: number): void {
    this.teams[team].coins += coins;
    this.teams[team].wood += wood;
    this.teams[team].stone += stone;
  }

  instantSpawn(team: Team, kind: UnitKind, atX?: number, atY?: number): UnitEntity | null {
    const base = this.entities.get(team === 'blue' ? 'blue-base' : 'red-base');
    const startX = atX ?? (base?.x ? base.x + 3 : (team === 'blue' ? 30 : 170));
    const startY = atY ?? (base?.y ? base.y + 3 : 100);

    for (let r = 0; r <= 15; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = startX + dx;
          const y = startY + dy;
          if (this.map.contains(x, y) && this.entities.isFreeForUnit(x, y, '')) {
            const unit = this.entities.spawnUnit(team, kind, x, y);
            this.fog.update();
            return unit;
          }
        }
      }
    }
    return null;
  }

  advance(deltaMs: number, maxSteps = Infinity): number {
    if (this.result) return 0;
    const effective = deltaMs * this.gameSpeed;
    return this.clock.advance(effective, () => {
      this.tick();
      return this.result === null;
    }, maxSteps);
  }

  issueCommand(command: GameCommand): CommandResult {
    if (this.result) return { accepted: false, reason: 'game-over' };
    if (command.type === 'attack-move' || (command.type === 'move' && command.attackMove)) {
      return this.issueAttackMove(command);
    }
    if (command.type === 'move') {
      const formation = this.formations.getFormationForUnit(command.unitId);
      if (formation) {
        const slot = formation.slots.get(command.unitId);
        const matchesDest = slot && slot.destination[0] === command.destination[0] && slot.destination[1] === command.destination[1];
        const matchesCurrent = slot && slot.currentTarget[0] === command.destination[0] && slot.currentTarget[1] === command.destination[1];
        if (!matchesDest && !matchesCurrent) {
          this.formations.removeUnit(command.unitId);
        }
      }
      const result = this.movement.issue(command, this.clock.ticks);
      if (result.accepted) {
        const entity = this.entities.get(command.unitId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.unitId);
        this.combat.cancel(command.unitId);
        this.economy.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    if (command.type === 'mine' || command.type === 'gather') {
      this.formations.removeUnit(command.unitId);
      const result = this.economy.issue(command, this.clock.ticks);
      if (result.accepted) {
        const entity = this.entities.get(command.unitId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.unitId);
        this.combat.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    if (command.type === 'build') {
      const before = { ...this.teams[command.team] };
      const result = this.construction.issue(command, this.clock.ticks);
      if (result.accepted) {
        this.stats.spent(command.team, before.coins - this.teams[command.team].coins,
          before.wood - this.teams[command.team].wood,
          before.stone - this.teams[command.team].stone);
        const entity = this.entities.get(command.builderId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.builderId);
        this.combat.cancel(command.builderId);
        this.economy.cancel(command.builderId);
      }
      return result;
    }
    if (command.type === 'build-line') {
      const before = { ...this.teams[command.team] };
      const result = this.construction.issueBuildLine(command, this.clock.ticks);
      if (result.accepted) {
        this.stats.spent(command.team, before.coins - this.teams[command.team].coins,
          before.wood - this.teams[command.team].wood,
          before.stone - this.teams[command.team].stone);
        const entity = this.entities.get(command.builderId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.builderId);
        this.combat.cancel(command.builderId);
        this.economy.cancel(command.builderId);
      }
      return result;
    }
    if (command.type === 'repair') {
      const result = this.construction.issueRepair(command, this.clock.ticks);
      if (result.accepted) {
        const entity = this.entities.get(command.builderId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.builderId);
        this.combat.cancel(command.builderId);
        this.economy.cancel(command.builderId);
      }
      return result;
    }
    if (command.type === 'produce') {
      const before = { ...this.teams[command.team] };
      const result = this.production.issue(command);
      if (result.accepted) this.stats.spent(command.team, before.coins - this.teams[command.team].coins,
        before.wood - this.teams[command.team].wood,
        before.stone - this.teams[command.team].stone);
      return result;
    }
    if (command.type === 'attack') {
      this.formations.removeUnit(command.unitId);
      const result = this.combat.issue(command, this.clock.ticks);
      if (result.accepted) {
        const entity = this.entities.get(command.unitId);
        if (entity && entity.category === 'unit') {
          entity.attackMoveTarget = null;
        }
        this.engagements.cancel(command.unitId);
        this.movement.cancel(command.unitId);
        this.economy.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    if (command.type === 'set-rally-point') {
      return this.production.setRallyPoint(command);
    }
    return { accepted: false, reason: 'invalid-destination' };
  }

  private issueAttackMove(command: AttackMoveCommand | (MoveCommand & { attackMove?: boolean })): CommandResult {
    const unit = this.entities.get(command.unitId);
    if (!unit || unit.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (unit.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (this.clock.ticks < unit.cooldownUntilTick && !unit.moveTarget) return { accepted: false, reason: 'cooldown' };
    const [x, y] = command.destination;
    const formation = this.formations.getFormationForUnit(command.unitId);
    if (formation) {
      const slot = formation.slots.get(command.unitId);
      const matchesDest = slot && slot.destination[0] === x && slot.destination[1] === y;
      const matchesCurrent = slot && slot.currentTarget[0] === x && slot.currentTarget[1] === y;
      if (!matchesDest && !matchesCurrent) {
        this.formations.removeUnit(command.unitId);
      }
    }
    if (!this.map.contains(x, y) || !this.entities.isFreeForUnit(x, y, unit.id)) {
      return { accepted: false, reason: 'invalid-destination' };
    }
    if (unit.x === x && unit.y === y) return { accepted: false, reason: 'already-there' };

    const moveRes = this.movement.issue({
      type: 'move',
      team: command.team,
      unitId: command.unitId,
      destination: [x, y],
      attackMove: true,
    }, this.clock.ticks);

    if (moveRes.accepted) {
      unit.attackMoveTarget = [x, y];
      this.engagements.cancel(command.unitId);
      this.combat.cancel(command.unitId);
      this.economy.cancel(command.unitId);
      this.construction.cancel(command.unitId);
      return { accepted: true };
    }

    if (moveRes.reason === 'no-path' && unit.damage > 0) {
      const blocking = findBlockingEnemyStructure(this, unit, [x, y]);
      if (blocking) {
        unit.attackMoveTarget = [x, y];
        this.engagements.cancel(command.unitId);
        this.combat.cancel(command.unitId);
        this.economy.cancel(command.unitId);
        this.construction.cancel(command.unitId);
        this.engagements.setTarget(unit.id, [x, y], blocking.id);
        return { accepted: true };
      }
    }

    return moveRes;
  }

  private tick(): void {
    if (this.movement.update(this.clock.ticks) > 0) this.fog.update();
    const beforeEconomy = { blue: { ...this.teams.blue }, red: { ...this.teams.red } };
    this.economy.update(this.clock.ticks);
    for (const team of ['blue', 'red'] as const) {
      this.stats.collected(team, this.teams[team].coins - beforeEconomy[team].coins,
        this.teams[team].wood - beforeEconomy[team].wood,
        this.teams[team].stone - beforeEconomy[team].stone);
    }
    const beforeConstruction = { blue: { ...this.teams.blue }, red: { ...this.teams.red } };
    this.construction.update(this.clock.ticks);
    for (const team of ['blue', 'red'] as const) {
      const woodSpent = Math.round(beforeConstruction[team].wood - this.teams[team].wood);
      const stoneSpent = Math.round(beforeConstruction[team].stone - this.teams[team].stone);
      const coinsSpent = Math.round(beforeConstruction[team].coins - this.teams[team].coins);
      if (coinsSpent > 0 || woodSpent > 0 || stoneSpent > 0) {
        this.stats.spent(team, coinsSpent, woodSpent, stoneSpent);
      }
    }
    this.production.update();
    this.engagements.update(this.clock.ticks);
    this.formations.update(this.clock.ticks);
    this.combat.update(this.clock.ticks);
    if (this.result) return;
    if (!this.aiPaused) {
      for (const ai of this.aiControllers.values()) {
        ai.update(this.clock.ticks);
      }
    }
    for (const team of ['blue', 'red'] as const) {
      this.teams[team].coins = Math.round(this.teams[team].coins);
      this.teams[team].wood = Math.round(this.teams[team].wood);
      this.teams[team].stone = Math.round(this.teams[team].stone);
    }
  }
}

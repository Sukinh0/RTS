import { FixedStepClock } from './FixedStepClock';
import { SeededRng } from './SeededRng';
import { MAP_DEFINITION } from '../../config/map';
import { MapGrid } from '../../map/MapGrid';
import { EntityStore } from '../entities/EntityStore';
import { BALANCE } from '../../config/balance';
import type { CommandResult, GameCommand } from '../commands/MoveCommand';
import { MovementSystem } from '../systems/MovementSystem';
import { FogOfWar } from '../systems/FogOfWar';
import { EconomySystem, type TeamStock } from '../systems/EconomySystem';
import { ConstructionSystem } from '../systems/ConstructionSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { AIController } from '../ai/AIController';
import type { Team } from '../../map/MapGrid';

/** Headless simulation entry point. Gameplay systems will attach here by phase. */
export class Simulation {
  readonly clock = new FixedStepClock();
  readonly rng: SeededRng;
  readonly map = new MapGrid(MAP_DEFINITION);
  readonly entities = new EntityStore(this.map);
  readonly movement = new MovementSystem(this.entities);
  readonly fog = new FogOfWar(this.map, this.entities);
  readonly teams: TeamStock = {
    blue: { coins: BALANCE.startingState.coins, wood: BALANCE.startingState.wood },
    red: { coins: BALANCE.startingState.coins, wood: BALANCE.startingState.wood },
  };
  readonly economy = new EconomySystem(this.entities, this.movement, this.fog, this.teams);
  readonly construction = new ConstructionSystem(this.entities, this.movement, this.fog, this.teams);
  readonly production = new ProductionSystem(this.entities, this.teams, this.fog);
  readonly combat: CombatSystem;
  readonly aiControllers = new Map<Team, AIController>();
  result: { winner: Team; loser: Team; elapsedTicks: number; blueUnits: number; redUnits: number; blueCoins: number; redCoins: number; blueWood: number; redWood: number } | null = null;

  constructor(seed: number, enableRedAI = false) {
    this.rng = new SeededRng(seed);
    this.combat = new CombatSystem(this.entities, this.fog, (entity) => {
      this.movement.cancel(entity.id);
      this.economy.cancel(entity.id);
      this.construction.cancel(entity.id);
      this.production.cancel(entity.id);
      if (entity.category === 'building' && entity.kind === 'base' && !this.result) {
        const winner: Team = entity.team === 'blue' ? 'red' : 'blue';
        const units = this.entities.all().filter((item) => item.category === 'unit');
        this.result = {
          winner, loser: entity.team, elapsedTicks: this.clock.ticks,
          blueUnits: units.filter((item) => item.team === 'blue').length,
          redUnits: units.filter((item) => item.team === 'red').length,
          blueCoins: this.teams.blue.coins, redCoins: this.teams.red.coins,
          blueWood: this.teams.blue.wood, redWood: this.teams.red.wood,
        };
      }
    }, () => this.result !== null);
    this.fog.update();
    if (enableRedAI) {
      this.enableAI('red');
    }
  }

  get redAI(): AIController | undefined {
    return this.aiControllers.get('red');
  }

  enableAI(team: Team = 'red'): AIController {
    const controller = new AIController(this, team);
    this.aiControllers.set(team, controller);
    return controller;
  }

  advance(deltaMs: number): number {
    if (this.result) return 0;
    return this.clock.advance(deltaMs, () => {
      this.tick();
      return this.result === null;
    });
  }

  issueCommand(command: GameCommand): CommandResult {
    if (this.result) return { accepted: false, reason: 'game-over' };
    if (command.type === 'move') {
      const result = this.movement.issue(command, this.clock.ticks);
      if (result.accepted) {
        this.combat.cancel(command.unitId);
        this.economy.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    if (command.type === 'mine' || command.type === 'gather') {
      const result = this.economy.issue(command, this.clock.ticks);
      if (result.accepted) {
        this.combat.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    if (command.type === 'build') {
      const result = this.construction.issue(command, this.clock.ticks);
      if (result.accepted) {
        this.combat.cancel(command.builderId);
        this.economy.cancel(command.builderId);
      }
      return result;
    }
    if (command.type === 'produce') {
      return this.production.issue(command);
    }
    if (command.type === 'attack') {
      const result = this.combat.issue(command, this.clock.ticks);
      if (result.accepted) {
        this.movement.cancel(command.unitId);
        this.economy.cancel(command.unitId);
        this.construction.cancel(command.unitId);
      }
      return result;
    }
    return { accepted: false, reason: 'invalid-destination' };
  }

  private tick(): void {
    if (this.movement.update(this.clock.ticks) > 0) this.fog.update();
    this.economy.update(this.clock.ticks);
    this.construction.update(this.clock.ticks);
    this.production.update();
    this.combat.update(this.clock.ticks);
    if (this.result) return;
    for (const ai of this.aiControllers.values()) {
      ai.update(this.clock.ticks);
    }
  }
}

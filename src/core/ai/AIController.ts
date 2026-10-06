import { BALANCE } from '../../config/balance';
import type { Point, Team } from '../../map/MapGrid';
import { dispatchGroupAttack } from '../commands/dispatchGroupAttack';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import type { BuildingEntity, UnitEntity, UnitKind } from '../entities/EntityStore';
import type { Simulation } from '../game/Simulation';
import { AIMemory } from './AIMemory';

export type AIIntent =
  | 'Defend'
  | 'BuildBarracks'
  | 'BuildHouse'
  | 'ProduceMilitary'
  | 'ProduceWorker'
  | 'AttackBase'
  | 'AttackArmy'
  | 'GatherWood'
  | 'Mine'
  | 'Scout'
  | 'Idle';

export class AIController {
  readonly memory: AIMemory;
  private lastDecisionTick = -999;
  private readonly openingForward: number;
  private readonly openingVertical: number;
  currentIntent: AIIntent = 'Idle';

  constructor(
    readonly simulation: Simulation,
    readonly team: Team,
    readonly decisionIntervalTicks = 30,
  ) {
    this.memory = new AIMemory(team);
    this.openingForward = 24 + Math.floor(simulation.rng.next() * 5) - 2;
    this.openingVertical = -12 + Math.floor(simulation.rng.next() * 5) - 2;
  }

  update(currentTick: number): void {
    // Continuous memory updates
    this.memory.update(this.simulation.fog, this.simulation.entities, this.simulation.map, currentTick);

    // Periodic strategic decision cycle
    if (currentTick - this.lastDecisionTick < this.decisionIntervalTicks) {
      return;
    }
    this.lastDecisionTick = currentTick;

    this.evaluateAndExecute(currentTick);
  }

  private evaluateAndExecute(currentTick: number): void {
    const ownEntities = this.simulation.entities.all().filter((e) => e.team === this.team);
    const ownBase = ownEntities.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'base');
    if (!ownBase || ownBase.hp <= 0) return;

    const ownWorkers = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind === 'worker');
    const ownHouses = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house');
    const ownBarracks = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barracks');
    const ownMilitary = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind !== 'worker');

    const stock = this.simulation.teams[this.team];
    const visibleEnemies = this.simulation.fog.visibleEntities(this.team).filter((e) => e.team !== this.team);

    // 1. Defend: Are there visible enemies near own base?
    const threatToHome = visibleEnemies.filter((e) => {
      const dist = Math.hypot(e.x - ownBase.x, e.y - ownBase.y);
      return dist <= 30;
    });

    if (threatToHome.length > 0 && ownMilitary.length > 0) {
      this.currentIntent = 'Defend';
      const target = threatToHome[0];
      const militaryIds = ownMilitary.map((u) => u.id);
      dispatchGroupAttack(this.simulation, this.team, militaryIds, target.id);
      return;
    }

    // 2. Attack: Do we have an army ready to assault?
    const armyThreshold = this.memory.enemyBaseLocation ? 4 : 5;
    if (ownMilitary.length >= armyThreshold) {
      if (this.memory.enemyBaseLocation) {
        this.currentIntent = 'AttackBase';
        const enemyBase = this.simulation.entities.get(this.team === 'red' ? 'blue-base' : 'red-base');
        const militaryIds = ownMilitary.map((u) => u.id);
        if (enemyBase && this.simulation.fog.isEntityVisible(this.team, enemyBase)) {
          dispatchGroupAttack(this.simulation, this.team, militaryIds, enemyBase.id);
        } else {
          dispatchGroupMove(this.simulation, this.team, militaryIds, this.memory.enemyBaseLocation);
        }
        return;
      } else if (visibleEnemies.length > 0) {
        this.currentIntent = 'AttackArmy';
        const militaryIds = ownMilitary.map((u) => u.id);
        dispatchGroupAttack(this.simulation, this.team, militaryIds, visibleEnemies[0].id);
        return;
      } else {
        // March towards estimated enemy side to find them
        this.currentIntent = 'AttackBase';
        const targetSide: Point = this.team === 'red' ? [24, 100] : [175, 100];
        const militaryIds = ownMilitary.map((u) => u.id);
        dispatchGroupMove(this.simulation, this.team, militaryIds, targetSide);
        return;
      }
    }

    // 3. Construction: Build Barracks if not yet built or building
    const readyOrBuildingBarracks = ownBarracks.length > 0;
    const barracksConfig = BALANCE.buildings.barracks;
    if (!readyOrBuildingBarracks && stock.coins >= barracksConfig.coins && stock.wood >= barracksConfig.wood) {
      const freeWorker = this.findFreeWorker(ownWorkers, currentTick);
      if (freeWorker) {
        const spot = this.findPlacementSpot(ownBase, barracksConfig.width, barracksConfig.height);
        if (spot) {
          const res = this.simulation.issueCommand({
            type: 'build',
            team: this.team,
            builderId: freeWorker.id,
            buildingKind: 'barracks',
            position: spot,
          });
          if (res.accepted) {
            this.currentIntent = 'BuildBarracks';
            return;
          }
        }
      }
    }

    // 4. Construction: Build House if needed and resources available
    const readyOrBuildingHouses = ownHouses.length > 0;
    const houseConfig = BALANCE.buildings.house;
    if (readyOrBuildingBarracks && !readyOrBuildingHouses && stock.coins >= houseConfig.coins && stock.wood >= houseConfig.wood) {
      const freeWorker = this.findFreeWorker(ownWorkers, currentTick);
      if (freeWorker) {
        const spot = this.findPlacementSpot(ownBase, houseConfig.width, houseConfig.height);
        if (spot) {
          const res = this.simulation.issueCommand({
            type: 'build',
            team: this.team,
            builderId: freeWorker.id,
            buildingKind: 'house',
            position: spot,
          });
          if (res.accepted) {
            this.currentIntent = 'BuildHouse';
            return;
          }
        }
      }
    }

    // 5. Military Production: If barracks is ready, train military
    const readyBarracks = ownBarracks.filter((b) => !b.underConstruction);
    for (const barracks of readyBarracks) {
      const queue = this.simulation.production.queueFor(barracks.id);
      if (queue.length < 2) {
        const unitToTrain = this.selectMilitaryUnitToTrain(ownMilitary, stock.coins);
        if (unitToTrain) {
          const res = this.simulation.issueCommand({
            type: 'produce',
            team: this.team,
            buildingId: barracks.id,
            unitKind: unitToTrain,
          });
          if (res.accepted) {
            this.currentIntent = 'ProduceMilitary';
            return;
          }
        }
      }
    }

    // 6. Worker Production: If workers < 5, train worker at ready House (Base does not produce)
    if (ownWorkers.length < 5 && stock.coins >= BALANCE.units.worker.coins) {
      const readyHouses = ownHouses.filter((h) => !h.underConstruction);
      for (const building of readyHouses) {
        const queue = this.simulation.production.queueFor(building.id);
        if (queue.length === 0) {
          const res = this.simulation.issueCommand({
            type: 'produce',
            team: this.team,
            buildingId: building.id,
            unitKind: 'worker',
          });
          if (res.accepted) {
            this.currentIntent = 'ProduceWorker';
            return;
          }
        }
      }
    }

    // 7. Scouting: If enemy base unknown, assign scout or idle unit to explore
    if (!this.memory.enemyBaseLocation) {
      const scoutUnit = ownMilitary.find((u) => u.kind === 'scout' && !u.moveTarget && currentTick >= u.cooldownUntilTick);
      if (scoutUnit) {
        const exploreTarget = this.findExplorationTarget();
        if (exploreTarget) {
          this.simulation.issueCommand({
            type: 'move',
            team: this.team,
            unitId: scoutUnit.id,
            destination: exploreTarget,
          });
          this.currentIntent = 'Scout';
        }
      }
    }

    // 8. Economy: Put idle workers to work (Wood or Mine)
    this.assignIdleWorkers(ownWorkers, stock.wood);
  }

  private findFreeWorker(workers: UnitEntity[], currentTick: number): UnitEntity | null {
    for (const worker of workers) {
      const hasEconomyTask = this.simulation.economy.taskFor(worker.id) !== null;
      const hasBuildTask = this.simulation.construction.taskFor(worker.id) !== null;
      const isMoving = worker.moveTarget !== null;
      const isReady = currentTick >= worker.cooldownUntilTick;
      if (!hasEconomyTask && !hasBuildTask && !isMoving && isReady) {
        return worker;
      }
    }
    // If all are working on economy, pick one doing wood/mine to reassign to building
    for (const worker of workers) {
      const hasBuildTask = this.simulation.construction.taskFor(worker.id) !== null;
      const isReady = currentTick >= worker.cooldownUntilTick;
      if (!hasBuildTask && isReady) {
        return worker;
      }
    }
    return null;
  }

  private assignIdleWorkers(workers: UnitEntity[], currentWood: number): void {
    const hasIncomeWorker = workers.some((worker) => !worker.moveTarget
      && this.simulation.economy.taskFor(worker.id)?.kind === 'mine');
    let scoutingWorkerAssigned = false;
    for (const worker of workers) {
      const hasEconomyTask = this.simulation.economy.taskFor(worker.id) !== null;
      const hasBuildTask = this.simulation.construction.taskFor(worker.id) !== null;
      const isMoving = worker.moveTarget !== null;
      if (hasEconomyTask || hasBuildTask || isMoving) continue;

      // Prioritize wood if wood is low, else mine
      if (currentWood < 150 && this.memory.discoveredForests.length > 0
        && (hasIncomeWorker || workers.some((candidate) => candidate.id !== worker.id
          && !candidate.moveTarget && this.simulation.economy.taskFor(candidate.id) === null))) {
        const nearestForest = this.findClosestPoint(worker, this.memory.discoveredForests);
        if (nearestForest) {
          const res = this.simulation.issueCommand({
            type: 'gather',
            team: this.team,
            unitId: worker.id,
            target: nearestForest,
          });
          if (res.accepted) {
            this.currentIntent = 'GatherWood';
            continue;
          }
        }
      }

      if (this.memory.discoveredMines.length > 0) {
        const nearestMine = this.findClosestPoint(worker, this.memory.discoveredMines);
        if (nearestMine) {
          const res = this.simulation.issueCommand({
            type: 'mine',
            team: this.team,
            unitId: worker.id,
            target: nearestMine,
          });
          if (res.accepted) {
            this.currentIntent = 'Mine';
            continue;
          }
        }
      }

      // One worker explores nearby unknown territory; the other remains free to earn coins.
      if (!hasIncomeWorker && workers.some((candidate) => candidate.id !== worker.id
        && this.simulation.economy.taskFor(candidate.id)?.kind === 'gather')) continue;
      if (scoutingWorkerAssigned || workers.some((candidate) => candidate.id !== worker.id && candidate.moveTarget)) continue;
      const exploreTarget = this.findWorkerExplorationTarget();
      if (!exploreTarget) continue;
      const res = this.simulation.issueCommand({
        type: 'move',
        team: this.team,
        unitId: worker.id,
        destination: exploreTarget,
      });
      if (res.accepted) {
        scoutingWorkerAssigned = true;
        this.currentIntent = 'Scout';
      }
    }
  }

  private findWorkerExplorationTarget(): Point | null {
    const base = this.simulation.entities.get(`${this.team}-base`);
    if (!base || base.category !== 'building') return null;
    const direction = this.team === 'red' ? -1 : 1;
    const offsets: Point[] = [[this.openingForward, this.openingVertical], [24, 12], [36, -24], [36, 24], [48, 0]];
    for (const [forward, vertical] of offsets) {
      const originX = this.team === 'red' ? base.x + base.width - 1 : base.x;
      const target: Point = [originX + direction * forward, base.y + vertical];
      if (this.simulation.map.isPassable(target[0], target[1])
        && this.simulation.fog.stateAt(this.team, target[0], target[1]) === 'unknown') return target;
    }
    return null;
  }

  private selectMilitaryUnitToTrain(ownMilitary: UnitEntity[], coins: number): UnitKind | null {
    const hasScout = ownMilitary.some((u) => u.kind === 'scout');
    if (!hasScout && coins >= BALANCE.units.scout.coins) {
      return 'scout';
    }

    const soldiers = ownMilitary.filter((u) => u.kind === 'soldier').length;
    const archers = ownMilitary.filter((u) => u.kind === 'archer').length;
    const shieldbearers = ownMilitary.filter((u) => u.kind === 'shieldbearer').length;

    // Composition balance: 2 soldiers, 1 archer, 1 shieldbearer
    if (archers < soldiers / 2 && coins >= BALANCE.units.archer.coins) {
      return 'archer';
    }
    if (shieldbearers < soldiers / 2 && coins >= BALANCE.units.shieldbearer.coins) {
      return 'shieldbearer';
    }
    if (coins >= BALANCE.units.soldier.coins) {
      return 'soldier';
    }
    return null;
  }

  private findPlacementSpot(base: BuildingEntity, width: number, height: number): Point | null {
    // Search in expanding rings near base
    for (let r = 2; r <= 14; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = this.team === 'blue' ? base.x + base.width - width - dx : base.x + dx;
          const y = base.y + dy;

          if (!this.simulation.map.contains(x, y) || !this.simulation.map.contains(x + width - 1, y + height - 1)) {
            continue;
          }

          // Must be fully explored by this team
          let explored = true;
          for (let cy = y; cy < y + height; cy += 1) {
            for (let cx = x; cx < x + width; cx += 1) {
              if (this.simulation.fog.stateAt(this.team, cx, cy) === 'unknown') {
                explored = false;
                break;
              }
            }
            if (!explored) break;
          }
          if (!explored) continue;

          if (this.simulation.entities.isAreaFreeForBuilding(x, y, width, height)) {
            return [x, y];
          }
        }
      }
    }
    return null;
  }

  private findExplorationTarget(): Point | null {
    // Probe towards opponent's side of the map in strategic corridors
    const enemyBaseApprox: Point = this.team === 'red' ? [24, 100] : [175, 100];
    const candidateSectors: Point[] = this.team === 'red'
      ? [[120, 100], [90, 80], [90, 120], [60, 100], [30, 100], enemyBaseApprox]
      : [[79, 100], [109, 80], [109, 120], [139, 100], [169, 100], enemyBaseApprox];

    for (const target of candidateSectors) {
      if (this.simulation.fog.stateAt(this.team, target[0], target[1]) === 'unknown') {
        return target;
      }
    }
    return enemyBaseApprox;
  }

  private findClosestPoint(from: { x: number; y: number }, points: Point[]): Point | null {
    if (points.length === 0) return null;
    let closest = points[0];
    let minDist = (from.x - closest[0]) ** 2 + (from.y - closest[1]) ** 2;
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      const d = (from.x - p[0]) ** 2 + (from.y - p[1]) ** 2;
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    }
    return closest;
  }
}

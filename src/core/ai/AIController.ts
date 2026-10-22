import { BALANCE } from '../../config/balance';
import type { Point, Team } from '../../map/MapGrid';
import { dispatchGroupAttack } from '../commands/dispatchGroupAttack';
import { dispatchGroupAttackMove, dispatchGroupMove } from '../commands/dispatchGroupMove';
import type { BuildingEntity, GameEntity, UnitEntity, UnitKind } from '../entities/EntityStore';
import type { Simulation } from '../game/Simulation';
import { AIMemory } from './AIMemory';

export type AIIntent =
  | 'Defend'
  | 'Repair'
  | 'BuildTower'
  | 'BuildBarricade'
  | 'BuildBarracks'
  | 'BuildHouse'
  | 'ProduceMilitary'
  | 'ProduceWorker'
  | 'ProduceBuilder'
  | 'AttackBase'
  | 'AttackArmy'
  | 'GatherWood'
  | 'GatherStone'
  | 'Mine'
  | 'Scout'
  | 'Rally'
  | 'Idle';

export interface AIDebugState {
  team: Team;
  decision: string;
  priority: number;
  goal: string;
  desiredResources: {
    coins: number;
    wood: number;
    stone: number;
  };
  chosenAction: string;
}

export class AIController {
  readonly memory: AIMemory;
  private lastDecisionTick = -999;
  private readonly openingForward: number;
  private readonly openingVertical: number;
  private readonly raidFlank: Point;
  private raidFlankReached = false;
  private guardUnitId: string | null = null;
  private readonly raidUnitIds = new Set<string>();
  private readonly retreatingUnitIds = new Set<string>();
  currentIntent: AIIntent = 'Idle';
  currentDecision = 'Idle';
  currentPriority = 0;
  currentGoal = 'None';
  desiredResources = { coins: 0, wood: 0, stone: 0 };
  chosenAction = 'None';
  private _desiredStone?: number;

  get desiredStone(): number {
    return this._desiredStone ?? this.calculateDynamicDesiredStone();
  }

  set desiredStone(val: number) {
    this._desiredStone = val;
  }

  constructor(
    readonly simulation: Simulation,
    readonly team: Team,
    readonly decisionIntervalTicks = 30,
  ) {
    this.memory = new AIMemory(team);
    this.openingForward = 24 + Math.floor(simulation.rng.next() * 5) - 2;
    this.openingVertical = -12 + Math.floor(simulation.rng.next() * 5) - 2;
    // Separate mirrored AI armies into different passable side corridors, varying
    // the preferred side by match seed instead of using enemy information through fog.
    const blueTakesNorth = (simulation.seed & 1) === 0;
    const takesNorth = team === 'blue' ? blueTakesNorth : !blueTakesNorth;
    this.raidFlank = [team === 'blue' ? 137 : 62, takesNorth ? 63 : 137];
  }

  getDebugState(): AIDebugState {
    return {
      team: this.team,
      decision: this.currentDecision,
      priority: this.currentPriority,
      goal: this.currentGoal,
      desiredResources: { ...this.desiredResources },
      chosenAction: this.chosenAction,
    };
  }

  update(currentTick: number): void {
    // Continuous memory updates strictly adhering to FogOfWar visibility
    this.memory.update(this.simulation.fog, this.simulation.entities, this.simulation.map, currentTick);

    // Periodic strategic decision cycle
    if (currentTick - this.lastDecisionTick < this.decisionIntervalTicks) {
      return;
    }
    this.lastDecisionTick = currentTick;

    this.evaluateAndExecute(currentTick);
  }

  private setDecision(
    intent: AIIntent,
    priority: number,
    goal: string,
    action: string,
  ): void {
    this.currentIntent = intent;
    this.currentDecision = intent;
    this.currentPriority = priority;
    this.currentGoal = goal;
    this.chosenAction = action;
  }

  private calculateDynamicDesiredStone(): number {
    const stats = this.simulation.stats.snapshot()[this.team];
    const ownEntities = this.simulation.entities.all().filter((e) => e.team === this.team);
    const ownAttackers = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind !== 'worker' && e.kind !== 'builder' && e.damage > 0);
    const hasOpeningTroop = ownAttackers.length > 0 || stats.troopsProduced > 0;

    if (!hasOpeningTroop) return 0;

    const hasDamagedStoneBuilding = ownEntities.some((e) =>
      e.category === 'building' && e.hp < e.maxHp && (e.kind === 'base' || e.kind === 'tower' || e.kind === 'barracks' || e.kind === 'barricade')
    );
    if (hasDamagedStoneBuilding) return 30;

    const ownTowers = ownEntities.filter((e) => e.category === 'building' && e.kind === 'tower');
    if (ownAttackers.length >= 2 && ownTowers.length < 2) return 100;

    const ownBarricades = ownEntities.filter((e) => e.category === 'building' && e.kind === 'barricade');
    if (ownBarricades.length < 2) return 15;

    if (stats.troopsProduced >= 3) return 100;
    return 20;
  }

  private evaluateAndExecute(currentTick: number): void {
    this.setDecision('Idle', 10, 'Maintain Base Operations', 'Standing by');
    const ownEntities = this.simulation.entities.all().filter((e) => e.team === this.team);
    const ownBase = ownEntities.find((e): e is BuildingEntity => e.category === 'building' && e.kind === 'base');
    if (!ownBase || ownBase.hp <= 0) return;

    const ownWorkers = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind === 'worker');
    const ownBuilders = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind === 'builder');
    const ownHouses = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'house');
    const ownBarracks = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barracks');
    const ownBarricades = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'barricade');
    const ownTowers = ownEntities.filter((e): e is BuildingEntity => e.category === 'building' && e.kind === 'tower');
    const ownMilitary = ownEntities.filter((e): e is UnitEntity => e.category === 'unit' && e.kind !== 'worker' && e.kind !== 'builder');
    const ownAttackers = ownMilitary.filter((unit) => unit.damage > 0);
    const hasOpeningTroop = ownMilitary.length > 0 || ownBarracks.some((barracks) =>
      this.simulation.production.queueFor(barracks.id).length > 0);

    const stock = this.simulation.teams[this.team];
    const capacity = this.simulation.production.getCapacity(this.team);
    const visibleEnemies = this.simulation.fog.visibleEntities(this.team).filter((e) => e.team !== this.team);

    // Calculate desired resources for debug observability and decision weighting
    const barracksConfig = BALANCE.buildings.barracks;
    const houseConfig = BALANCE.buildings.house;
    const wantsMoreMilitary = ownMilitary.length < 25;
    const hasUnderConstructionBarracks = ownBarracks.some((b) => b.underConstruction);
    const needsBarracks = ownBarracks.length === 0 || (
      hasOpeningTroop &&
      !hasUnderConstructionBarracks &&
      capacity.militaryUnits + capacity.militaryQueued >= capacity.militaryCapacity &&
      capacity.totalUnits + capacity.totalQueued < capacity.maxTotalUnits &&
      wantsMoreMilitary
    );

    const workerTarget = ownAttackers.length >= 6 ? 6 : ownAttackers.length >= 3 ? 5 : 3;
    const queuedWorkers = ownHouses.reduce((total, house) => total
      + this.simulation.production.queueFor(house.id).filter((item) => item.unitKind === 'worker').length, 0);
    const needsWorkers = ownWorkers.length + queuedWorkers < workerTarget;
    const needsHouseForWorkers = needsWorkers && (capacity.civilianUnits + capacity.civilianQueued >= capacity.civilianCapacity);
    const readyOrBuildingBarracks = ownBarracks.length > 0;
    const readyOrBuildingHouses = ownHouses.length > 0;
    const wantsHouse = hasOpeningTroop && readyOrBuildingBarracks && (!readyOrBuildingHouses || needsHouseForWorkers);

    this.desiredResources = {
      coins: needsBarracks ? barracksConfig.coins : wantsHouse ? houseConfig.coins : BALANCE.units.soldier.coins,
      wood: needsBarracks ? barracksConfig.wood : wantsHouse ? houseConfig.wood : 50,
      stone: this.desiredStone,
    };

    // 1. Worker Economy Assignment across Gold, Wood, and Stone
    this.assignIdleWorkers(ownWorkers, stock.wood, stock.stone);

    // 2. Exploration / Scouting
    if (!this.memory.enemyBaseLocation) {
      const scoutUnit = ownMilitary.find((u) => u.kind === 'scout' && !u.moveTarget && currentTick >= u.cooldownUntilTick);
      const exploreTarget = scoutUnit ? this.findExplorationTarget() : null;
      if (scoutUnit && exploreTarget && this.simulation.issueCommand({
        type: 'move', team: this.team, unitId: scoutUnit.id, destination: exploreTarget,
      }).accepted) {
        this.setDecision('Scout', 50, 'Scout Fog to Locate Enemy Base', `Scout ${scoutUnit.id} moving to (${exploreTarget[0]}, ${exploreTarget[1]})`);
      }
    }

    // 3. Military Tactics & Combat Management
    const militaryIntent = this.manageMilitary(ownBase, ownAttackers, visibleEnemies);

    // 4. Repairs: Builder repairs damaged structures if affordable, or maintains ongoing repair
    if (ownBuilders.length > 0) {
      const activeRepair = ownBuilders.find((b) => {
        const task = this.simulation.construction.taskFor(b.id);
        return task?.phase === 'repairing' || (task?.phase === 'travel' && this.simulation.entities.get(task.buildingId)?.category === 'building' && (this.simulation.entities.get(task.buildingId) as BuildingEntity).hp < (this.simulation.entities.get(task.buildingId) as BuildingEntity).maxHp);
      });
      if (activeRepair) {
        const task = this.simulation.construction.taskFor(activeRepair.id)!;
        this.setDecision(
          militaryIntent ?? 'Repair',
          80,
          `Repairing Structure (${task.buildingId})`,
          `Builder ${activeRepair.id} repairing ${task.buildingId}`,
        );
        return;
      }

      const freeBuilder = this.findFreeBuilder(ownBuilders, currentTick);
      if (freeBuilder) {
        const buildingToRepair = this.findBuildingToRepair(ownEntities, stock.wood, stock.stone);
        if (buildingToRepair) {
          const res = this.simulation.issueCommand({
            type: 'repair',
            team: this.team,
            builderId: freeBuilder.id,
            buildingId: buildingToRepair.id,
          });
          if (res.accepted) {
            this.setDecision(
              militaryIntent ?? 'Repair',
              80,
              `Repair Damaged ${buildingToRepair.kind} (${buildingToRepair.id})`,
              `Builder ${freeBuilder.id} repairing ${buildingToRepair.id}`,
            );
            return;
          }
        }
      }
    }

    // 5. Construction: Build Barracks to expand military capacity
    if (needsBarracks && stock.coins >= barracksConfig.coins && stock.wood >= barracksConfig.wood) {
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
            this.setDecision(
              militaryIntent ?? 'BuildBarracks',
              75,
              'Expand Military Capacity',
              `Worker ${freeWorker.id} constructing barracks at (${spot[0]}, ${spot[1]})`,
            );
            return;
          }
        }
      }
    }

    // 6. Construction: Build House to expand civilian capacity
    const hasUnderConstructionHouse = ownHouses.some((h) => h.underConstruction);
    if (wantsHouse
      && !hasUnderConstructionHouse
      && stock.coins >= houseConfig.coins && stock.wood >= houseConfig.wood) {
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
            this.setDecision(
              militaryIntent ?? 'BuildHouse',
              72,
              'Expand Civilian Capacity',
              `Worker ${freeWorker.id} constructing house at (${spot[0]}, ${spot[1]})`,
            );
            return;
          }
        }
      }
    }

    // 7. Construction: Build Barricade for perimeter fortification
    const barricadeConfig = BALANCE.buildings.barricade;
    const wantsBarricade = hasOpeningTroop && ownAttackers.length >= 1 && ownBarricades.length < 2 && !ownBarricades.some((b) => b.underConstruction);
    if (wantsBarricade && stock.wood >= barricadeConfig.wood && stock.stone >= barricadeConfig.stone) {
      const freeBuilder = this.findFreeBuilder(ownBuilders, currentTick);
      if (freeBuilder) {
        const spot = this.findBarricadePlacementSpot(ownBase);
        if (spot) {
          const res = this.simulation.issueCommand({
            type: 'build',
            team: this.team,
            builderId: freeBuilder.id,
            buildingKind: 'barrack' in BALANCE.buildings ? 'barricade' : 'barricade',
            position: spot,
          });
          if (res.accepted) {
            this.setDecision(
              militaryIntent ?? 'BuildBarricade',
              55,
              'Fortify Base Perimeter with Barricade',
              `Builder ${freeBuilder.id} constructing barricade at (${spot[0]}, ${spot[1]})`,
            );
            return;
          }
        }
      }
    }

    // 8. Construction: Build Watch Tower for strategic territory vision & defense
    const towerConfig = BALANCE.buildings.tower;
    if (hasOpeningTroop && ownAttackers.length >= 2 && ownTowers.length < 2 && !ownTowers.some((t) => t.underConstruction)
      && stock.coins >= towerConfig.coins && stock.wood >= towerConfig.wood && stock.stone >= towerConfig.stone) {
      const freeBuilder = this.findFreeBuilder(ownBuilders, currentTick);
      if (freeBuilder) {
        const spot = this.findPlacementSpot(ownBase, towerConfig.width, towerConfig.height);
        if (spot) {
          const res = this.simulation.issueCommand({
            type: 'build',
            team: this.team,
            builderId: freeBuilder.id,
            buildingKind: 'tower',
            position: spot,
          });
          if (res.accepted) {
            this.setDecision(
              militaryIntent ?? 'BuildTower',
              62,
              'Construct Watch Tower for Territorial Vision',
              `Builder ${freeBuilder.id} constructing tower at (${spot[0]}, ${spot[1]})`,
            );
            return;
          }
        }
      }
    }

    // 9. Civilian Unit Production (Workers and Builders)
    if (needsWorkers && stock.coins >= BALANCE.units.worker.coins
      && capacity.civilianUnits + capacity.civilianQueued < capacity.civilianCapacity) {
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
            this.setDecision(
              militaryIntent ?? 'ProduceWorker',
              68,
              'Expand Worker Economy',
              `Produce worker at house ${building.id}`,
            );
            return;
          }
        }
      }
    } else if (ownBuilders.length === 0 && ownAttackers.length >= 2 && stock.coins >= BALANCE.units.builder.coins
      && capacity.civilianUnits + capacity.civilianQueued < capacity.civilianCapacity) {
      const readyHouses = ownHouses.filter((h) => !h.underConstruction);
      for (const building of readyHouses) {
        const queue = this.simulation.production.queueFor(building.id);
        if (queue.length === 0) {
          const res = this.simulation.issueCommand({
            type: 'produce',
            team: this.team,
            buildingId: building.id,
            unitKind: 'builder',
          });
          if (res.accepted) {
            this.setDecision(
              militaryIntent ?? 'ProduceWorker',
              60,
              'Produce Builder for Fortifications & Repairs',
              `Produce builder at house ${building.id}`,
            );
            return;
          }
        }
      }
    }

    const wantsBuilder = ownBuilders.length === 0 && ownAttackers.length >= 2;
    const stats = this.simulation.stats.snapshot()[this.team];
    const wantsTower = stats.troopsProduced >= 3 && ownTowers.length === 0
      && stock.stone >= 50 && stock.wood >= 100;
    const towerReserve = wantsTower ? towerConfig.coins : 0;
    const reserve = (hasOpeningTroop && (!readyOrBuildingHouses || needsWorkers || wantsBuilder) ? BALANCE.units.worker.coins : 0) + towerReserve;
    const readyBarracks = ownBarracks.filter((b) => !b.underConstruction);
    if (capacity.militaryUnits + capacity.militaryQueued < capacity.militaryCapacity) {
      for (const barracks of readyBarracks) {
        const queue = this.simulation.production.queueFor(barracks.id);
        if (queue.length < 2) {
          const unitToTrain = this.selectMilitaryUnitToTrain(ownMilitary, stock.coins - reserve);
          if (unitToTrain) {
            const res = this.simulation.issueCommand({
              type: 'produce',
              team: this.team,
              buildingId: barracks.id,
              unitKind: unitToTrain,
            });
            if (res.accepted) {
              this.setDecision(
                militaryIntent ?? 'ProduceMilitary',
                65,
                `Train ${unitToTrain} for Army Composition`,
                `Produce ${unitToTrain} at barracks ${barracks.id}`,
              );
              return;
            }
          }
        }
      }
    }

    if (militaryIntent) {
      this.currentIntent = militaryIntent;
    }
  }

  private manageMilitary(base: BuildingEntity, attackers: UnitEntity[], visibleEnemies: GameEntity[]): AIIntent | null {
    const byId = new Map(attackers.map((unit) => [unit.id, unit]));
    for (const id of this.raidUnitIds) if (!byId.has(id)) this.raidUnitIds.delete(id);
    for (const id of this.retreatingUnitIds) if (!byId.has(id)) this.retreatingUnitIds.delete(id);
    if (!this.guardUnitId || !byId.has(this.guardUnitId)) {
      const candidates = attackers.filter((unit) => !this.raidUnitIds.has(unit.id));
      const pool = candidates.length ? candidates : attackers;
      const guard = [...pool].sort((a, b) =>
        Number(b.kind === 'soldier') - Number(a.kind === 'soldier')
        || Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y)
        || a.id.localeCompare(b.id))[0];
      this.guardUnitId = guard?.id ?? null;
      if (guard) {
        this.raidUnitIds.delete(guard.id);
        this.retreatingUnitIds.delete(guard.id);
      }
    }
    if (!this.guardUnitId) return null;

    const rallyPoint = this.findHomeRallyPoint(base);
    const threat = visibleEnemies.find((enemy) =>
      Math.hypot(enemy.x - base.x, enemy.y - base.y) <= 30);
    const guard = byId.get(this.guardUnitId)!;
    if (threat) {
      const defenders = attackers.filter((unit) => unit.id === guard.id
        || (!this.raidUnitIds.has(unit.id) && !this.retreatingUnitIds.has(unit.id)
          && Math.hypot(unit.x - base.x, unit.y - base.y) <= 30));
      dispatchGroupAttack(this.simulation, this.team, defenders.map((unit) => unit.id), threat.id);
      this.setDecision(
        'Defend',
        95,
        'Defend Base against Hostile Invaders',
        `Defenders engaging hostile threat ${threat.id}`,
      );
    } else if (rallyPoint && Math.hypot(guard.x - base.x, guard.y - base.y) > 12) {
      dispatchGroupMove(this.simulation, this.team, [guard.id], rallyPoint);
    }

    // Do not abort a breakthrough when the last raider can already see the enemy base.
    // Otherwise two-unit waves retreat before pressuring buildings, perpetuating draws.
    // Away from the enemy base, a lone survivor still regroups as before.
    if (this.raidUnitIds.size === 1) {
      const [lastRaiderId] = this.raidUnitIds;
      const survivor = byId.get(lastRaiderId);
      const enemyBase = this.simulation.entities.get(this.team === 'red' ? 'blue-base' : 'red-base');
      const canFinishAssault = survivor && enemyBase?.category === 'building'
        && enemyBase.hp > 0
        && this.simulation.fog.isEntityVisible(this.team, enemyBase)
        && Math.hypot(survivor.x - enemyBase.x, survivor.y - enemyBase.y) <= 30;
      if (!canFinishAssault) {
        this.retreatingUnitIds.add(lastRaiderId);
        this.raidUnitIds.clear();
      }
    }
    for (const id of this.retreatingUnitIds) {
      const unit = byId.get(id)!;
      if (Math.hypot(unit.x - base.x, unit.y - base.y) <= 12) {
        this.retreatingUnitIds.delete(id);
      } else if (rallyPoint) {
        dispatchGroupMove(this.simulation, this.team, [id], rallyPoint);
      }
    }

    const reserves = attackers.filter((unit) => unit.id !== guard.id
      && !this.raidUnitIds.has(unit.id) && !this.retreatingUnitIds.has(unit.id));
    // Field units far from base (> 30 cells) are automatically part of the active raid force
    for (const unit of reserves) {
      if (Math.hypot(unit.x - base.x, unit.y - base.y) > 30) {
        this.raidUnitIds.add(unit.id);
      }
    }
    // Launch the first offensive wave with two field fighters plus one home guard.
    // With starting resources, waiting for a third reserve kept both AIs idle for 900s.
    // Additional reinforcements form their own wave instead of travelling alone.
    if (!threat && reserves.length >= 2) {
      for (const unit of reserves) this.raidUnitIds.add(unit.id);
    }
    const raidIds = attackers.filter((unit) => this.raidUnitIds.has(unit.id)).map((unit) => unit.id);
    if (raidIds.length === 0) {
      this.raidFlankReached = false;
      if (threat) {
        this.setDecision('Defend', 95, 'Defend Base against Hostile Invaders', `Defenders engaging threat ${threat.id}`);
        return 'Defend';
      }
      if (reserves.length > 0) {
        this.setDecision('Rally', 40, 'Assemble Military Strike Force', `${reserves.length} reserves holding at home base`);
        return 'Rally';
      }
      return null;
    }

    if (this.memory.enemyBaseLocation) {
      const enemyBase = this.simulation.entities.get(this.team === 'red' ? 'blue-base' : 'red-base');
      if (enemyBase && this.simulation.fog.isEntityVisible(this.team, enemyBase)) {
        dispatchGroupAttack(this.simulation, this.team, raidIds, enemyBase.id);
        this.setDecision(
          threat ? 'Defend' : 'AttackBase',
          threat ? 95 : 85,
          'Assault Enemy Base',
          `Raid force (${raidIds.length} units) attacking enemy base ${enemyBase.id}`,
        );
        return threat ? 'Defend' : 'AttackBase';
      }

      const enemyTower = visibleEnemies.find((enemy) => enemy.category === 'building' && enemy.kind === 'tower');
      if (enemyTower) {
        dispatchGroupAttack(this.simulation, this.team, raidIds, enemyTower.id);
        this.setDecision(
          threat ? 'Defend' : 'AttackArmy',
          75,
          'Destroy Enemy Watch Tower',
          `Raid force (${raidIds.length} units) attacking enemy tower ${enemyTower.id}`,
        );
        return threat ? 'Defend' : 'AttackArmy';
      }

      const enemyBarricade = visibleEnemies.find((enemy) => enemy.category === 'building' && enemy.kind === 'barricade');
      if (enemyBarricade) {
        dispatchGroupAttack(this.simulation, this.team, raidIds, enemyBarricade.id);
        this.setDecision(
          threat ? 'Defend' : 'AttackArmy',
          70,
          'Destroy Enemy Barricade',
          `Raid force (${raidIds.length} units) attacking enemy barricade ${enemyBarricade.id}`,
        );
        return threat ? 'Defend' : 'AttackArmy';
      }

      const destination = this.marchRaid(raidIds, this.memory.enemyBaseLocation);
      this.setDecision(
        threat ? 'Defend' : 'AttackBase',
        80,
        'Advance Towards Enemy Base',
        `Raid force (${raidIds.length} units) marching to (${destination[0]}, ${destination[1]})`,
      );
      return threat ? 'Defend' : 'AttackBase';
    }

    const enemyTower = visibleEnemies.find((enemy) => enemy.category === 'building' && enemy.kind === 'tower');
    if (enemyTower) {
      dispatchGroupAttack(this.simulation, this.team, raidIds, enemyTower.id);
      this.setDecision(
        threat ? 'Defend' : 'AttackArmy',
        75,
        'Destroy Enemy Watch Tower',
        `Raid force (${raidIds.length} units) attacking enemy tower ${enemyTower.id}`,
      );
      return threat ? 'Defend' : 'AttackArmy';
    }

    const enemyBarricade = visibleEnemies.find((enemy) => enemy.category === 'building' && enemy.kind === 'barricade');
    if (enemyBarricade) {
      dispatchGroupAttack(this.simulation, this.team, raidIds, enemyBarricade.id);
      this.setDecision(
        threat ? 'Defend' : 'AttackArmy',
        70,
        'Destroy Enemy Barricade',
        `Raid force (${raidIds.length} units) attacking enemy barricade ${enemyBarricade.id}`,
      );
      return threat ? 'Defend' : 'AttackArmy';
    }

    const fieldEnemy = visibleEnemies.find((enemy) =>
      Math.hypot(enemy.x - base.x, enemy.y - base.y) > 30);
    if (fieldEnemy) {
      dispatchGroupAttack(this.simulation, this.team, raidIds, fieldEnemy.id);
      this.setDecision(
        threat ? 'Defend' : 'AttackArmy',
        72,
        'Engage Hostile Forces in Field',
        `Raid force (${raidIds.length} units) attacking enemy entity ${fieldEnemy.id}`,
      );
      return threat ? 'Defend' : 'AttackArmy';
    }

    const defaultMarch: Point = this.team === 'red' ? [24, 100] : [175, 100];
    const destination = this.marchRaid(raidIds, defaultMarch);
    this.setDecision(
      threat ? 'Defend' : 'AttackBase',
      80,
      'Advance Towards Enemy Territory',
      `Raid force (${raidIds.length} units) marching to (${destination[0]}, ${destination[1]})`,
    );
    return threat ? 'Defend' : 'AttackBase';
  }

  private marchRaid(raidIds: string[], destination: Point): Point {
    // One staging waypoint per wave; after crossing the side corridor the troops
    // continue to the original objective instead of looping back to the flank.
    if (!this.raidFlankReached) {
      this.raidFlankReached = raidIds.some((id) => {
        const unit = this.simulation.entities.get(id);
        return unit?.category === 'unit'
          && Math.max(Math.abs(unit.x - this.raidFlank[0]), Math.abs(unit.y - this.raidFlank[1])) <= 7;
      });
    }
    const leadUnit = this.simulation.entities.get(raidIds[0]);
    const canStage = !this.memory.enemyBaseLocation && !this.raidFlankReached
      && leadUnit?.category === 'unit'
      && this.simulation.map.hasStaticConnection([leadUnit.x, leadUnit.y], this.raidFlank);
    const effectiveDestination: Point = canStage ? this.raidFlank : destination;
    const ready = raidIds.filter((id) => {
      const unit = this.simulation.entities.get(id);
      return unit?.category === 'unit' && !unit.moveTarget && !this.simulation.engagements.statusFor(id);
    });
    if (ready.length > 0) dispatchGroupAttackMove(this.simulation, this.team, ready, effectiveDestination);
    return effectiveDestination;
  }

  private findHomeRallyPoint(base: BuildingEntity): Point | null {
    const frontX = this.team === 'red' ? base.x - 5 : base.x + base.width + 4;
    const centerY = base.y + Math.floor(base.height / 2);
    for (let radius = 0; radius <= 5; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = frontX + dx;
          const y = centerY + dy;
          if (this.simulation.map.contains(x, y) && this.simulation.entities.isFreeForUnit(x, y, '')) {
            return [x, y];
          }
        }
      }
    }
    return null;
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

  private findFreeBuilder(builders: UnitEntity[], currentTick: number): UnitEntity | null {
    for (const builder of builders) {
      const hasBuildTask = this.simulation.construction.taskFor(builder.id) !== null;
      const isMoving = builder.moveTarget !== null;
      const isReady = currentTick >= builder.cooldownUntilTick;
      if (!hasBuildTask && !isMoving && isReady) {
        return builder;
      }
    }
    return null;
  }

  private assignIdleWorkers(workers: UnitEntity[], currentWood: number, currentStone: number): void {
    const hasIncomeWorker = workers.some((worker) =>
      this.simulation.economy.taskFor(worker.id)?.kind === 'mine');
    let stoneAssigned = workers.some((worker) => {
      const task = this.simulation.economy.taskFor(worker.id);
      return task?.kind === 'gather' && (task as { resourceKind?: string }).resourceKind === 'stone';
    });
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
            this.setDecision('GatherWood', 64, 'Harvest Wood for Construction', `Worker ${worker.id} gathering wood`);
            continue;
          }
        }
      }

      // Ensure miners are assigned to mine (1 miner for <=3 workers, 2 for >=4 workers)
      const currentMiners = workers.filter((w) =>
        this.simulation.economy.taskFor(w.id)?.kind === 'mine').length;
      const targetMiners = workers.length >= 4 ? 2 : 1;
      if (currentMiners < targetMiners && this.memory.discoveredMines.length > 0) {
        const nearestMine = this.findClosestPoint(worker, this.memory.discoveredMines);
        if (nearestMine) {
          const res = this.simulation.issueCommand({
            type: 'mine',
            team: this.team,
            unitId: worker.id,
            target: nearestMine,
          });
          if (res.accepted) {
            this.setDecision('Mine', 70, 'Mine Gold for Economy', `Worker ${worker.id} mining gold`);
            continue;
          }
        }
      }

      // Gather stone if needed, once base economy has at least one mining worker
      const activeMiners = workers.filter((w) =>
        this.simulation.economy.taskFor(w.id)?.kind === 'mine').length;
      if (currentStone < this.desiredStone && !stoneAssigned && activeMiners >= 1
        && this.memory.discoveredStones.length > 0) {
        const nearestStone = this.findClosestPoint(worker, this.memory.discoveredStones);
        if (nearestStone) {
          const res = this.simulation.issueCommand({
            type: 'gather',
            team: this.team,
            unitId: worker.id,
            target: nearestStone,
          });
          if (res.accepted) {
            stoneAssigned = true;
            this.setDecision('GatherStone', 62, 'Harvest Stone for Fortifications & Repairs', `Worker ${worker.id} gathering stone`);
            continue;
          }
        }
      }

      // One worker explores unknown territory until essential resources are found
      const needsResourceExploration = this.memory.discoveredMines.length === 0
        || (this.memory.discoveredForests.length === 0 && currentWood < 150)
        || (this.memory.discoveredStones.length === 0 && this.desiredStone > 0);
      if (needsResourceExploration) {
        if (scoutingWorkerAssigned || workers.some((candidate) => candidate.id !== worker.id && candidate.moveTarget)) continue;
        const exploreTarget = this.findWorkerExplorationTarget();
        if (exploreTarget) {
          const res = this.simulation.issueCommand({
            type: 'move',
            team: this.team,
            unitId: worker.id,
            destination: exploreTarget,
          });
          if (res.accepted) {
            scoutingWorkerAssigned = true;
            this.setDecision('Scout', 45, 'Explore Territory to Discover Resources', `Worker ${worker.id} scouting for resources`);
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
            this.setDecision('Mine', 70, 'Mine Gold for Economy', `Worker ${worker.id} mining gold`);
            continue;
          }
        }
      }
    }

    // Dynamic economy rebalancing: When wood reserves are healthy (>= 100),
    // reallocate workers from wood to stone, mining, or scouting so resources don't stall.
    if (currentWood >= 100) {
      const woodWorkers = workers.filter((w) => {
        const task = this.simulation.economy.taskFor(w.id);
        const hasBuild = this.simulation.construction.taskFor(w.id) !== null;
        return !hasBuild && task?.kind === 'gather' && (task as { resourceKind?: string }).resourceKind !== 'stone';
      });

      if (!stoneAssigned && currentStone < this.desiredStone && this.memory.discoveredStones.length > 0 && woodWorkers.length > 0) {
        const workerToReassign = woodWorkers[0];
        const nearestStone = this.findClosestPoint(workerToReassign, this.memory.discoveredStones);
        if (nearestStone) {
          const res = this.simulation.issueCommand({
            type: 'gather',
            team: this.team,
            unitId: workerToReassign.id,
            target: nearestStone,
          });
          if (res.accepted) {
            this.setDecision('GatherStone', 63, 'Reassign Worker to Stone Harvest', `Worker ${workerToReassign.id} switched to stone`);
          }
        }
      } else if (this.memory.discoveredStones.length === 0 && this.desiredStone > 0 && !scoutingWorkerAssigned && woodWorkers.length > 0) {
        const workerToScout = woodWorkers[0];
        const exploreTarget = this.findWorkerExplorationTarget();
        if (exploreTarget) {
          const res = this.simulation.issueCommand({
            type: 'move',
            team: this.team,
            unitId: workerToScout.id,
            destination: exploreTarget,
          });
          if (res.accepted) {
            this.setDecision('Scout', 48, 'Explore Territory to Discover Stone Deposits', `Worker ${workerToScout.id} scouting for stone`);
          }
        }
      } else if (currentWood >= 180 && woodWorkers.length > 1 && this.memory.discoveredMines.length > 0) {
        const activeMiners = workers.filter((w) => this.simulation.economy.taskFor(w.id)?.kind === 'mine').length;
        if (activeMiners < 2) {
          const workerToMine = woodWorkers[0];
          const nearestMine = this.findClosestPoint(workerToMine, this.memory.discoveredMines);
          if (nearestMine) {
            const res = this.simulation.issueCommand({
              type: 'mine',
              team: this.team,
              unitId: workerToMine.id,
              target: nearestMine,
            });
            if (res.accepted) {
              this.setDecision('Mine', 69, 'Rebalance Wood Worker to Gold Mining', `Worker ${workerToMine.id} switched to gold mine`);
            }
          }
        }
      }
    }
  }

  private findWorkerExplorationTarget(): Point | null {
    const base = this.simulation.entities.get(`${this.team}-base`);
    if (!base || base.category !== 'building') return null;
    const direction = this.team === 'red' ? -1 : 1;
    const offsets: Point[] = [
      [this.openingForward, this.openingVertical],
      [24, 12],
      [24, -30],
      [24, 25],
      [36, -24],
      [40, -40],
      [36, 24],
      [40, 40],
      [48, 0],
    ];
    for (const [forward, vertical] of offsets) {
      const originX = this.team === 'red' ? base.x + base.width - 1 : base.x;
      const target: Point = [originX + direction * forward, base.y + vertical];
      if (this.simulation.map.isPassable(target[0], target[1])
        && this.simulation.fog.stateAt(this.team, target[0], target[1]) === 'unknown') return target;
    }
    return null;
  }

  private selectMilitaryUnitToTrain(ownMilitary: UnitEntity[], coins: number): UnitKind | null {
    const soldiers = ownMilitary.filter((u) => u.kind === 'soldier').length;
    const archers = ownMilitary.filter((u) => u.kind === 'archer').length;
    // Fill the home guard and first fighting wave before buying a scout or support.
    if (soldiers < 2 && coins >= BALANCE.units.soldier.coins) {
      return 'soldier';
    }
    if (archers === 0 && coins >= BALANCE.units.archer.coins) return 'archer';
    if (soldiers < 3 && coins >= BALANCE.units.soldier.coins) return 'soldier';
    const hasScout = ownMilitary.some((u) => u.kind === 'scout');
    if (!hasScout && coins >= BALANCE.units.scout.coins) {
      return 'scout';
    }

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

  private findBarricadePlacementSpot(base: BuildingEntity): Point | null {
    const direction = this.team === 'red' ? -1 : 1;
    const originX = this.team === 'red' ? base.x : base.x + base.width - 1;
    const baseCenterY = base.y + Math.floor(base.height / 2);

    const offsets: Array<[number, number]> = [
      [7, -3], [7, 0], [7, 3],
      [9, -2], [9, 2],
      [6, -4], [6, 4],
      [8, -1], [8, 1],
      [10, 0],
    ];

    for (const [fwd, dy] of offsets) {
      const x = originX + direction * fwd;
      const y = baseCenterY + dy;
      if (!this.simulation.map.contains(x, y)) continue;
      if (!this.simulation.map.isPassable(x, y)) continue;
      if (this.simulation.fog.stateAt(this.team, x, y) === 'unknown') continue;
      if (this.simulation.entities.isAreaFreeForBuilding(x, y, 1, 1)) {
        return [x, y];
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

  private findBuildingToRepair(
    ownEntities: GameEntity[],
    wood: number,
    stone: number,
  ): BuildingEntity | null {
    const damaged = ownEntities.filter((e): e is BuildingEntity =>
      e.category === 'building' && !e.underConstruction && e.hp < e.maxHp
    );
    if (damaged.length === 0) return null;

    // Filter by affordable buildings and avoid being obsessive over tiny scratch damage
    const affordable = damaged.filter((b) => {
      const config = BALANCE.buildings[b.kind];
      const costConfig = (config as { repairCostPerSecond?: { wood?: number; stone?: number } }).repairCostPerSecond;
      const woodCost = costConfig?.wood ?? 0;
      const stoneCost = costConfig?.stone ?? 0;
      if (woodCost > 0 && wood < woodCost) return false;
      if (stoneCost > 0 && stone < stoneCost) return false;
      if (b.kind !== 'base' && b.hp > b.maxHp * 0.85) return false;
      return true;
    });

    if (affordable.length === 0) return null;

    const priorityRank = (b: BuildingEntity): number => {
      switch (b.kind) {
        case 'base': return 1;
        case 'tower': return 2;
        case 'barracks': return 3;
        case 'house': return 4;
        case 'barricade': return 5;
        default: return 6;
      }
    };

    affordable.sort((a, b) => {
      const rA = priorityRank(a);
      const rB = priorityRank(b);
      if (rA !== rB) return rA - rB;
      return (a.hp / a.maxHp) - (b.hp / b.maxHp);
    });

    return affordable[0];
  }
}

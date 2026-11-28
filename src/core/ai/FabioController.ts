/**
 * Scripted opponent that plays the way Fabio described in his questionnaire
 * (see docs/FABIO.md). It is a persona for testing and training, not a learner.
 * It uses the same commands as a player and sees what the player's screen shows.
 */
import { BALANCE } from '../../config/balance';
import type { Point, Team } from '../../map/MapGrid';
import { dispatchGroupAttack } from '../commands/dispatchGroupAttack';
import { dispatchGroupAttackMove, dispatchGroupMove } from '../commands/dispatchGroupMove';
import type { BuildingEntity, BuildingKind, GameEntity, UnitEntity, UnitKind } from '../entities/EntityStore';
import { SeededRng } from '../game/SeededRng';
import type { Simulation } from '../game/Simulation';
import type { AIDebugState, TeamController } from './AIController';
import { AIMemory } from './AIMemory';

/** The parts of his answers that vary from match to match. */
export interface FabioHabits {
  /** Soldiers trained before the first builder: he described both 0 and 1. */
  soldiersBeforeBuilder: number;
  /** Fighters needed to leave home; one stays in the middle of the map. */
  attackArmy: number;
  /** Without being attacked first, he stops waiting after this many seconds. */
  patienceSeconds: number;
  /** Shieldbearers he likes to keep: "1 or 2". */
  shieldbearers: number;
}

export function habitsFor(seed: number, team: Team): FabioHabits {
  const rng = new SeededRng(((seed | 0) ^ (team === 'blue' ? 0x0fab10 : 0x10bafa)) >>> 0);
  const pick = (options: number) => Math.floor(rng.next() * options);
  rng.next();
  return {
    soldiersBeforeBuilder: pick(2),
    attackArmy: 6 + pick(2),
    patienceSeconds: 480 + pick(121),
    shieldbearers: 1 + pick(2),
  };
}

type Resource = 'mine' | 'wood' | 'stone';
type Goal =
  | { type: 'unit'; kind: 'worker' | 'builder' }
  | { type: 'building'; kind: Extract<BuildingKind, 'house' | 'barracks' | 'tower'> };

const HOME_RADIUS = 30;
const WORKER_DANGER = 8;
const TOWERS = 2;
const SCREEN_SIZE = 3;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const isFighter = (entity: GameEntity): entity is UnitEntity => entity.category === 'unit' && entity.damage > 0
  && entity.kind !== 'worker';

export class FabioController implements TeamController {
  readonly memory: AIMemory;
  readonly habits: FabioHabits;
  private lastDecisionTick = -999;
  private decision = 'Abertura';
  private wasAttacked = false;
  private defendedOnce = false;
  private readonly raid = new Set<string>();
  private holderId: string | null = null;
  private retreating = false;
  private scoutStep = 0;

  constructor(readonly simulation: Simulation, readonly team: Team, readonly decisionIntervalTicks = 30) {
    this.memory = new AIMemory(team);
    this.habits = habitsFor(simulation.seed, team);
  }

  getDebugState(): AIDebugState {
    return {
      team: this.team, decision: this.decision, priority: 0, goal: this.decision,
      desiredResources: { coins: 0, wood: 0, stone: 0 }, chosenAction: this.decision,
    };
  }

  update(currentTick: number): void {
    this.memory.update(this.simulation.fog, this.simulation.entities, this.simulation.map, currentTick);
    if (currentTick - this.lastDecisionTick < this.decisionIntervalTicks) return;
    this.lastDecisionTick = currentTick;
    this.decide(currentTick);
  }

  private get direction(): 1 | -1 {
    return this.team === 'blue' ? 1 : -1;
  }

  private decide(tick: number): void {
    const base = this.simulation.entities.get(`${this.team}-base`);
    if (!base || base.category !== 'building') return;
    const own = this.simulation.entities.all().filter((e) => e.team === this.team && e.hp > 0);
    const units = own.filter((e): e is UnitEntity => e.category === 'unit');
    const buildings = own.filter((e): e is BuildingEntity => e.category === 'building');
    const enemies = this.simulation.fog.visibleEntities(this.team).filter((e) => e.team !== this.team);
    const enemyFighters = enemies.filter(isFighter);
    const workers = units.filter((u) => u.kind === 'worker');
    const army = units.filter((u) => u.kind !== 'worker' && u.kind !== 'builder');
    const fighters = army.filter((u) => u.kind !== 'scout');

    const threats = enemyFighters.filter((enemy) => distance(enemy, base) <= HOME_RADIUS
      || workers.some((worker) => distance(enemy, worker) <= WORKER_DANGER));
    if (threats.length > 0) this.wasAttacked = true;
    else if (this.wasAttacked) this.defendedOnce = true;

    this.protectWorkers(base, workers, enemyFighters);
    this.assignWorkers(workers.filter((w) => !enemyFighters.some((e) => distance(e, w) <= WORKER_DANGER)), buildings);
    this.runBuilder(tick, base, units.filter((u) => u.kind === 'builder'), buildings, enemyFighters);
    this.spend(tick, base, units, buildings, fighters.length, threats.length > 0);
    this.runScout(army.find((u) => u.kind === 'scout'), threats.length > 0);
    this.command(tick, base, fighters, enemies, enemyFighters, threats);
  }

  // ---- Economy ---------------------------------------------------------

  /** "Recuo os operários" when enemy fighters get close to them. */
  private protectWorkers(base: BuildingEntity, workers: UnitEntity[], enemyFighters: UnitEntity[]): void {
    const shelter: Point = [this.direction === 1 ? base.x - 3 : base.x + base.width + 2, base.y + 1];
    const fleeing = workers.filter((worker) => enemyFighters.some((e) => distance(e, worker) <= WORKER_DANGER)
      && distance(worker, base) > 6
      // A miner on its way to the mine still has to drop everything and run.
      && (!worker.moveTarget || this.simulation.economy.taskFor(worker.id) !== null)).map((w) => w.id);
    if (fleeing.length > 0) dispatchGroupMove(this.simulation, this.team, fleeing, shelter);
  }

  private taskOf(worker: UnitEntity): Resource | null {
    const task = this.simulation.economy.taskFor(worker.id);
    if (task?.kind === 'mine') return 'mine';
    if (task?.kind !== 'gather') return null;
    return task.resourceKind === 'stone' ? 'stone' : 'wood';
  }

  /**
   * Even split at first; after the barracks and the second house only one hand
   * gathers: wood until about 300, then stone for towers and barricades.
   */
  private assignWorkers(workers: UnitEntity[], buildings: BuildingEntity[]): void {
    const free = workers.filter((w) => !this.simulation.construction.taskFor(w.id));
    if (free.length === 0) return;
    const stock = this.simulation.teams[this.team];
    const established = buildings.some((b) => b.kind === 'barracks')
      && buildings.filter((b) => b.kind === 'house').length >= 2;
    let wood = 0;
    let stone = 0;
    if (!established) wood = Math.floor(free.length / 2) || (stock.wood < 100 ? 1 : 0);
    else if (stock.wood < 150) wood = 1;
    else if (stock.stone < 160) {
      // Keeps the wood hand until there is plenty in the bank.
      const woodBusy = free.some((w) => this.taskOf(w) === 'wood');
      if (stock.wood < 300 && woodBusy) wood = 1;
      else stone = 1;
    } else if (stock.wood < 300) wood = 1;
    // With both piles full, every hand mines gold.
    if (stone > 0 && this.memory.discoveredStones.length === 0) {
      stone = 0;
      wood = stock.wood < 400 ? 1 : 0;
    }
    if (free.length === 1) {
      wood = stock.wood < 100 && stock.coins >= 150 ? 1 : 0;
      stone = 0;
    }
    const wanted: Record<Resource, number> = { wood, stone, mine: free.length - wood - stone };
    const have: Record<Resource, number> = { wood: 0, stone: 0, mine: 0 };
    const spare: UnitEntity[] = [];
    for (const worker of free) {
      const role = this.taskOf(worker);
      if (role && have[role] < wanted[role]) have[role] += 1;
      else if (role || !worker.moveTarget) spare.push(worker);
    }
    // The first idle hand goes to wood, the next to gold, as he opens.
    for (const role of ['wood', 'mine', 'stone'] as const) {
      while (have[role] < wanted[role] && spare.length > 0) {
        this.work(spare.shift()!, role);
        have[role] += 1;
      }
    }
  }

  private work(worker: UnitEntity, role: Resource): void {
    const sites = role === 'mine' ? this.memory.discoveredMines
      : role === 'wood' ? this.memory.discoveredForests : this.memory.discoveredStones;
    const nearest = [...sites].sort((a, b) => Math.hypot(a[0] - worker.x, a[1] - worker.y)
      - Math.hypot(b[0] - worker.x, b[1] - worker.y));
    // A full or unreachable site is skipped for the next closest one.
    for (const target of nearest.slice(0, 40)) {
      if (this.simulation.issueCommand({
        type: role === 'mine' ? 'mine' : 'gather', team: this.team, unitId: worker.id, target,
      }).accepted) return;
    }
    if (nearest.length === 0 && !worker.moveTarget) this.exploreWith(worker);
  }

  private exploreWith(worker: UnitEntity): void {
    const base = this.simulation.entities.get(`${this.team}-base`);
    if (!base || base.category !== 'building') return;
    // Measured from the mirrored edge of the base so both colours explore alike.
    const originX = this.team === 'red' ? base.x + base.width - 1 : base.x;
    for (const [forward, vertical] of [[24, -12], [24, 12], [24, -30], [24, 25], [36, -24], [40, -40], [36, 24], [40, 40], [48, 0], [48, -20], [48, 20], [60, 0], [30, 0]]) {
      const destination: Point = [originX + this.direction * forward, base.y + this.direction * vertical];
      if (!this.simulation.map.isPassable(...destination)
        || this.simulation.fog.stateAt(this.team, ...destination) !== 'unknown') continue;
      if (this.simulation.issueCommand({ type: 'move', team: this.team, unitId: worker.id, destination }).accepted) return;
    }
  }

  // ---- Spending --------------------------------------------------------

  private trained(): number {
    return this.simulation.stats.snapshot()[this.team].troopsProduced
      + this.simulation.production.getCapacity(this.team).militaryQueued;
  }

  private queued(buildings: BuildingEntity[], kind: UnitKind): number {
    return buildings.reduce((sum, building) => sum
      + this.simulation.production.queueFor(building.id).filter((item) => item.unitKind === kind).length, 0);
  }

  /** The next thing that is not a fighter, following his opening and then his habits. */
  private nextGoal(tick: number, units: UnitEntity[], buildings: BuildingEntity[], army: number): Goal | null {
    const count = (kind: BuildingKind) => buildings.filter((b) => b.kind === kind).length;
    const workers = units.filter((u) => u.kind === 'worker').length + this.queued(buildings, 'worker');
    const builders = units.filter((u) => u.kind === 'builder').length + this.queued(buildings, 'builder');
    const trained = this.trained();
    const capacity = this.simulation.production.getCapacity(this.team);
    const civilians = (kind: 'worker' | 'builder'): Goal =>
      capacity.civilianUnits + capacity.civilianQueued >= capacity.civilianCapacity
        ? { type: 'building', kind: 'house' } : { type: 'unit', kind };

    // Opening: house, worker, barracks, builder, two soldiers, second house.
    if (count('house') === 0) return { type: 'building', kind: 'house' };
    if (workers < 3) return civilians('worker');
    if (count('barracks') === 0) return { type: 'building', kind: 'barracks' };
    if (trained < this.habits.soldiersBeforeBuilder) return null;
    if (builders === 0) return civilians('builder');
    if (trained < 2) return null;
    if (count('house') < 2) return { type: 'building', kind: 'house' };
    if (trained < 3) return null;

    // Later: 6 workers mid game and 8 at the end; towers before the second barracks.
    const target = trained >= 12 || tick >= 600 * 30 ? 8 : 6;
    if (workers < Math.min(target, 4)) return civilians('worker');
    if (count('tower') === 0 && (this.defendedOnce || army >= 5)) return { type: 'building', kind: 'tower' };
    if (workers < target) return civilians('worker');
    if (count('house') < 3) return { type: 'building', kind: 'house' };
    const militaryFull = capacity.militaryUnits + capacity.militaryQueued >= capacity.militaryCapacity;
    const stoneForTower = this.simulation.teams[this.team].stone >= (BALANCE.buildings.tower as { stone?: number }).stone!;
    // A second tower short of stone must not hold back a bigger army.
    if (count('tower') > 0 && count('tower') < TOWERS && (stoneForTower || !militaryFull)) {
      return { type: 'building', kind: 'tower' };
    }
    if (militaryFull && count('barracks') < 3) return { type: 'building', kind: 'barracks' };
    return null;
  }

  private price(goal: Goal): { coins: number; wood: number; stone: number } {
    if (goal.type === 'unit') return { coins: BALANCE.units[goal.kind].coins, wood: 0, stone: 0 };
    const config = BALANCE.buildings[goal.kind];
    return { coins: config.coins, wood: config.wood, stone: (config as { stone?: number }).stone ?? 0 };
  }

  /** With more than 4 fighters he saves for construction; with fewer, troops come first. */
  private spend(
    tick: number, base: BuildingEntity, units: UnitEntity[], buildings: BuildingEntity[],
    army: number, underAttack: boolean,
  ): void {
    // Under attack everything goes into troops, unless there is no barracks to make them.
    const goal = underAttack && buildings.some((b) => b.kind === 'barracks')
      ? null : this.nextGoal(tick, units, buildings, army);
    const openingStep = this.trained() < 3;
    const constructionFirst = goal !== null && (openingStep || army > 4);
    if (goal && constructionFirst) this.buy(tick, goal, base, units, buildings);
    const materialsReady = goal !== null && this.simulation.teams[this.team].wood >= this.price(goal).wood
      && this.simulation.teams[this.team].stone >= this.price(goal).stone;
    // Gold is only held back when it is the sole thing still missing (or in the opening).
    const reserve = goal && constructionFirst && (openingStep || materialsReady) ? this.price(goal).coins : 0;
    this.trainTroops(units, buildings, this.simulation.teams[this.team].coins - reserve, underAttack);
    if (goal && !constructionFirst) this.buy(tick, goal, base, units, buildings);
  }

  private buy(tick: number, goal: Goal, base: BuildingEntity, units: UnitEntity[], buildings: BuildingEntity[]): void {
    const price = this.price(goal);
    const stock = this.simulation.teams[this.team];
    if (stock.coins < price.coins || stock.wood < price.wood || stock.stone < price.stone) return;
    if (goal.type === 'unit') {
      const house = [base, ...buildings.filter((b) => b.kind === 'house')].find((b) => !b.underConstruction
        && this.simulation.production.queueFor(b.id).length === 0
        && this.simulation.issueCommand({ type: 'produce', team: this.team, buildingId: b.id, unitKind: goal.kind }).accepted);
      if (house) this.decision = `Criando ${goal.kind}`;
      return;
    }
    if (buildings.some((b) => b.kind === goal.kind && b.underConstruction)) return;
    const builders = units.filter((u) => goal.kind === 'tower' ? u.kind === 'builder' : u.kind === 'worker');
    const free = builders.filter((u) => !this.simulation.construction.taskFor(u.id) && tick >= u.cooldownUntilTick);
    if (free.length === 0) return;
    const spot = goal.kind === 'tower' ? this.towerSpot(base, buildings) : this.spotNear(base.x, base.y, goal.kind, 14);
    if (spot && this.simulation.issueCommand({
      type: 'build', team: this.team, builderId: free[0].id, buildingKind: goal.kind, position: spot,
    }).accepted) this.decision = `Construindo ${goal.kind}`;
  }

  private trainTroops(units: UnitEntity[], buildings: BuildingEntity[], coins: number, underAttack: boolean): void {
    const barracks = buildings.find((b) => b.kind === 'barracks' && !b.underConstruction
      && this.simulation.production.queueFor(b.id).length === 0);
    if (!barracks) return;
    const trained = this.trained();
    // His builder comes before (or right after) the first soldier.
    if (trained >= this.habits.soldiersBeforeBuilder && trained > 0
      && !units.some((u) => u.kind === 'builder') && this.queued(buildings, 'builder') === 0 && !underAttack
      && coins < BALANCE.units.builder.coins + BALANCE.units.soldier.coins) return;
    let kind = this.nextTroop(units, buildings, trained);
    if (underAttack && coins < BALANCE.units[kind].coins) kind = 'soldier';
    if (coins < BALANCE.units[kind].coins) return;
    this.simulation.issueCommand({ type: 'produce', team: this.team, buildingId: barracks.id, unitKind: kind });
  }

  private nextTroop(units: UnitEntity[], buildings: BuildingEntity[], trained: number): UnitKind {
    const opening: UnitKind[] = this.wasAttacked
      ? ['soldier', 'soldier', 'shieldbearer', 'soldier', 'soldier', 'archer']
      : ['soldier', 'soldier', 'scout', 'shieldbearer', 'soldier', 'soldier'];
    if (trained < opening.length) return opening[trained];
    const alive = (kind: UnitKind) => units.filter((u) => u.kind === kind).length + this.queued(buildings, kind);
    if (alive('shieldbearer') < this.habits.shieldbearers) return 'shieldbearer';
    if (alive('scout') === 0 && alive('soldier') >= 3) return 'scout';
    return alive('archer') * 2 < alive('soldier') ? 'archer' : 'soldier';
  }

  // ---- Construction and repair -----------------------------------------

  private spotNear(x: number, y: number, kind: BuildingKind, radius: number): Point | null {
    const { width, height } = BALANCE.buildings[kind];
    for (let r = 0; r <= radius; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.canPlace(x + dx, y + dy, width, height)) return [x + dx, y + dy];
        }
      }
    }
    return null;
  }

  private canPlace(x: number, y: number, width: number, height: number): boolean {
    for (let cy = y; cy < y + height; cy += 1) {
      for (let cx = x; cx < x + width; cx += 1) {
        if (!this.simulation.map.contains(cx, cy) || !this.simulation.map.isPassable(cx, cy)
          || this.simulation.fog.stateAt(this.team, cx, cy) === 'unknown') return false;
      }
    }
    return this.simulation.entities.isAreaFreeForBuilding(x, y, width, height);
  }

  /** Towers go towards the enemy for vision: one centred, the second to one side. */
  private towerSpot(base: BuildingEntity, buildings: BuildingEntity[]): Point | null {
    const first = !buildings.some((b) => b.kind === 'tower');
    for (const ahead of [26, 22, 18, 14]) {
      const spot = this.spotNear(base.x + this.direction * ahead, base.y + (first ? 0 : -10), 'tower', 6);
      if (spot) return spot;
    }
    return null;
  }

  /** Repairs any damage at once; otherwise screens the towers and the front of the base. */
  private runBuilder(
    tick: number, base: BuildingEntity, builders: UnitEntity[], buildings: BuildingEntity[], enemyFighters: UnitEntity[],
  ): void {
    const builder = builders.find((b) => !this.simulation.construction.taskFor(b.id)
      && !b.moveTarget && tick >= b.cooldownUntilTick);
    if (!builder) return;
    const stock = this.simulation.teams[this.team];
    const damaged = buildings.filter((b) => !b.underConstruction && b.hp < b.maxHp
      && !enemyFighters.some((e) => distance(e, b) <= 5))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    for (const building of damaged) {
      if (this.simulation.issueCommand({
        type: 'repair', team: this.team, builderId: builder.id, buildingId: building.id,
      }).accepted) {
        this.decision = 'Reparando';
        return;
      }
    }
    const towers = buildings.filter((b) => b.kind === 'tower' && !b.underConstruction);
    const config = BALANCE.buildings.barricade;
    const tower = BALANCE.buildings.tower;
    // Barricades come after a tower and never eat the stone of the next one.
    const stoneKept = buildings.filter((b) => b.kind === 'tower').length < TOWERS ? (tower.stone ?? 0) : 0;
    if (towers.length === 0 || stock.wood < config.wood + 50 || stock.stone < config.stone + stoneKept) return;
    const fronts: Array<[number, number]> = [
      ...towers.map((t): [number, number] => [this.direction === 1 ? t.x + t.width + 2 : t.x - 3, t.y]),
      [this.direction === 1 ? base.x + base.width + 6 : base.x - 7, base.y + 1],
    ];
    for (const [x, y] of fronts) {
      const near = buildings.filter((b) => b.kind === 'barricade' && Math.abs(b.x - x) <= 2 && Math.abs(b.y - y) <= 5);
      if (near.length >= SCREEN_SIZE) continue;
      for (const dy of [0, 2, -2, 4, -4]) {
        if (this.canPlace(x, y + dy, 1, 1) && this.simulation.issueCommand({
          type: 'build', team: this.team, builderId: builder.id, buildingKind: 'barricade', position: [x, y + dy],
        }).accepted) {
          this.decision = 'Erguendo barricada';
          return;
        }
      }
    }
  }

  // ---- Army ------------------------------------------------------------

  /** Scouts along the map edges, then keeps watch near the enemy side. */
  private runScout(scout: UnitEntity | undefined, underAttack: boolean): void {
    if (!scout || scout.moveTarget || underAttack) return;
    const far = this.direction === 1 ? 1 : -1;
    const x = (step: number) => 100 + far * step;
    const route: Point[] = [[x(-40), 60], [x(0), 55], [x(45), 60], [x(65), 85], [x(45), 140], [x(0), 145], [x(-40), 140]];
    for (let i = 0; i < route.length; i += 1) {
      const destination = route[this.scoutStep % route.length];
      this.scoutStep += 1;
      if (this.simulation.issueCommand({ type: 'move', team: this.team, unitId: scout.id, destination }).accepted) return;
    }
  }

  private march(ids: string[], destination: Point): void {
    const idle = ids.filter((id) => {
      const unit = this.simulation.entities.get(id);
      return unit?.category === 'unit' && !unit.moveTarget && !this.simulation.engagements.statusFor(id)
        && Math.hypot(unit.x - destination[0], unit.y - destination[1]) > 6;
    });
    // Shieldbearers lead and archers stay behind.
    if (idle.length > 0) dispatchGroupAttackMove(this.simulation, this.team, idle, destination, idle.length > 1 ? 'block' : null);
  }

  private command(
    tick: number, base: BuildingEntity, fighters: UnitEntity[], enemies: GameEntity[],
    enemyFighters: UnitEntity[], threats: UnitEntity[],
  ): void {
    const alive = new Set(fighters.map((u) => u.id));
    for (const id of this.raid) if (!alive.has(id)) this.raid.delete(id);
    if (this.holderId && !alive.has(this.holderId)) this.holderId = null;
    const home: Point = [this.direction === 1 ? base.x + base.width + 3 : base.x - 4, base.y + 2];

    if (threats.length > 0) {
      const target = [...threats].sort((a, b) => distance(a, base) - distance(b, base))[0];
      // Troops far away only come back when the home guard is outnumbered.
      const near = fighters.filter((u) => distance(u, target) <= HOME_RADIUS + 10);
      const defenders = near.length >= threats.length ? near : fighters;
      for (const unit of defenders) this.raid.delete(unit.id);
      if (defenders.length > 0) dispatchGroupAttack(this.simulation, this.team, defenders.map((u) => u.id), target.id);
      this.decision = 'Defendendo';
      return;
    }

    const raiders = fighters.filter((u) => this.raid.has(u.id));
    if (raiders.length > 0) {
      const contact = enemyFighters.filter((e) => raiders.some((u) => distance(u, e) <= 10));
      // "When I see I would lose every troop, I fall back and rebuild."
      if ((contact.length >= raiders.length + 2) || (raiders.length <= 2 && contact.length >= raiders.length)) {
        this.raid.clear();
        this.retreating = true;
        dispatchGroupMove(this.simulation, this.team, raiders.map((u) => u.id), home);
        this.decision = 'Recuando';
        return;
      }
    }
    if (this.retreating && fighters.length >= this.habits.attackArmy) this.retreating = false;

    // A full army smaller than usual (a scout takes a slot) is still an army.
    const capacity = this.simulation.production.getCapacity(this.team);
    const needed = capacity.militaryUnits >= capacity.militaryCapacity && capacity.militaryCapacity > 0
      ? Math.min(this.habits.attackArmy, Math.max(5, capacity.militaryCapacity - 1)) : this.habits.attackArmy;
    const reserves = fighters.filter((u) => !this.raid.has(u.id) && u.id !== this.holderId);
    const ready = !this.retreating && (this.defendedOnce || tick >= this.habits.patienceSeconds * 30
      || fighters.length >= this.habits.attackArmy + 2);
    if (this.raid.size === 0) {
      if (ready && fighters.length >= needed) {
        this.holderId ??= (fighters.find((u) => u.kind === 'soldier') ?? fighters[0]).id;
        for (const unit of fighters) if (unit.id !== this.holderId) this.raid.add(unit.id);
      }
    } else {
      // A healthy economy sends fresh waves; a thin one tops up the attack.
      const rich = this.simulation.teams[this.team].coins >= 300 || capacity.militaryCapacity >= 12;
      if (reserves.length >= (rich ? 4 : 1)) for (const unit of reserves) this.raid.add(unit.id);
    }

    // The final push: the enemy can no longer defend, so everyone goes.
    const enemyBase = enemies.find((e) => e.category === 'building' && e.kind === 'base');
    const finalPush = this.raid.size > 0 && enemyBase !== undefined && fighters.length >= 8
      && enemyFighters.filter((e) => distance(e, enemyBase) <= HOME_RADIUS).length <= 1;
    if (finalPush) {
      this.holderId = null;
      for (const unit of fighters) this.raid.add(unit.id);
    }

    if (this.holderId) this.march([this.holderId], [100, 100]);
    const waiting = fighters.filter((u) => !this.raid.has(u.id) && u.id !== this.holderId);
    const strayed = waiting.filter((u) => distance(u, base) > 14 && !u.moveTarget).map((u) => u.id);
    if (strayed.length > 0) dispatchGroupMove(this.simulation, this.team, strayed, home);
    if (this.raid.size === 0) return;
    this.attack([...this.raid], fighters.filter((u) => this.raid.has(u.id)), enemies, enemyFighters);
  }

  /** Targets in his order: fighters in the way, workers, troops and barracks, then the base. */
  private attack(ids: string[], raiders: UnitEntity[], enemies: GameEntity[], enemyFighters: UnitEntity[]): void {
    const nearest = (list: GameEntity[], reach: number) => list
      .map((e) => ({ e, d: Math.min(...raiders.map((u) => distance(u, e))) }))
      .filter((item) => item.d <= reach).sort((a, b) => a.d - b.d)[0]?.e;
    const kind = (...kinds: string[]) => enemies.filter((e) => kinds.includes(e.kind));
    const target = nearest(enemyFighters, 8)
      ?? nearest(kind('worker', 'builder'), 25)
      ?? nearest(enemyFighters, 18)
      ?? nearest(kind('barracks', 'tower'), 25)
      ?? nearest(kind('base'), 40);
    this.decision = 'Atacando';
    if (target) {
      dispatchGroupAttack(this.simulation, this.team, ids, target.id);
      return;
    }
    // Straight through the middle of the map towards the enemy base.
    this.march(ids, this.memory.enemyBaseLocation ?? (this.team === 'blue' ? [175, 100] : [24, 100]));
  }
}

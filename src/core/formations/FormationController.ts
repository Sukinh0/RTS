import type { Point, Team } from '../../map/MapGrid';
import { findPath } from '../../map/findPath';
import type { UnitEntity } from '../entities/EntityStore';
import type { Simulation } from '../game/Simulation';
import {
  assignFormationSlots,
  getMarchDirection,
  transformOffsetToWorld,
  isMilitaryKind,
  type FormationType,
  type FormationUnitInfo,
  type MilitaryRole,
  type SlotOffset,
  type MarchDirection,
} from './FormationGeometry';

export type FormationState = 'MARCHANDO' | 'EM_COMBATE' | 'REAGRUPANDO' | 'PARADO';

export interface FormationSlot {
  unitId: string;
  role: MilitaryRole;
  slotIndex: number;
  offset: SlotOffset;
  destination: Point;
  currentTarget: Point;
  isStuck: boolean;
  stuckTicks: number;
  lastPosition: Point;
  lastReissueTick?: number;
}

export interface FormationGroup {
  id: string;
  team: Team;
  type: FormationType;
  state: FormationState;
  targetDestination: Point;
  attackMove: boolean;
  slots: Map<string, FormationSlot>;
  collectiveSpeed: number;
  createdTick: number;
  spinePath: Point[];
  spineIndex: number;
  currentDirection: MarchDirection;
}

export class FormationController {
  private readonly groups = new Map<string, FormationGroup>();
  private readonly unitToGroup = new Map<string, string>();
  private nextGroupId = 1;
  private readonly waypointVersions = new WeakMap<FormationGroup, { spine: number; navigation: number }>();

  constructor(private readonly simulation: Simulation) {}

  getAllGroups(): readonly FormationGroup[] {
    return Array.from(this.groups.values());
  }

  getGroup(groupId: string): FormationGroup | undefined {
    return this.groups.get(groupId);
  }

  getFormationForUnit(unitId: string): FormationGroup | undefined {
    const groupId = this.unitToGroup.get(unitId);
    return groupId ? this.groups.get(groupId) : undefined;
  }

  /**
   * Creates or replaces a military formation for the given unit IDs.
   */
  createFormation(
    team: Team,
    unitIds: readonly string[],
    type: FormationType,
    destination: Point,
    attackMove = false,
  ): FormationGroup | null {
    // 1. Filter military units only
    const militaryEntities: UnitEntity[] = [];
    for (const id of unitIds) {
      const entity = this.simulation.entities.get(id);
      if (entity && entity.category === 'unit' && entity.team === team && isMilitaryKind(entity.kind) && entity.hp > 0) {
        // Remove from existing formation if any
        this.removeUnit(id);
        militaryEntities.push(entity);
      }
    }

    if (militaryEntities.length < 2) {
      return null;
    }

    // 2. Compute group center to determine marching direction and spine trajectory
    let sumX = 0;
    let sumY = 0;
    for (const ent of militaryEntities) {
      sumX += ent.x;
      sumY += ent.y;
    }
    const centerX = Math.round(sumX / militaryEntities.length);
    const centerY = Math.round(sumY / militaryEntities.length);

    const spine = findPath(
      this.simulation.map,
      [centerX, centerY],
      destination,
      (x, y) => this.simulation.map.isPassable(x, y) && this.isCellFreeOfBuildings(x, y),
    );
    const spinePath: Point[] = spine && spine.length >= 2 ? spine : [[centerX, centerY], destination];
    const formationLookahead = Math.max(6, Math.ceil(Math.sqrt(militaryEntities.length)) * 2);
    const initialLookahead = Math.min(formationLookahead, spinePath.length - 1);
    const dir = getMarchDirection([centerX, centerY], destination);
    const initialDir = spinePath.length >= 2
      ? getMarchDirection(spinePath[0], spinePath[initialLookahead])
      : dir;

    // 3. Prepare info for slot assignment
    const unitInfos: FormationUnitInfo[] = militaryEntities.map((ent) => ({
      id: ent.id,
      kind: ent.kind,
      movement: ent.movement,
      x: ent.x,
      y: ent.y,
    }));

    const rawAssignments = assignFormationSlots(unitInfos, type, destination, dir);

    // 4. Resolve blocked slots and assign initial marching waypoints
    const reservedCells = new Set<string>();
    const reservedWaypoints = new Set<string>();
    const slots = new Map<string, FormationSlot>();

    for (const assign of rawAssignments) {
      const validDest = this.findValidDestinationCell(assign.destination, reservedCells);
      reservedCells.add(`${validDest[0]},${validDest[1]}`);
      const ent = this.simulation.entities.get(assign.unitId) as UnitEntity;

      let currentTarget = validDest;
      if (initialLookahead < spinePath.length - 1) {
        const [dx, dy] = transformOffsetToWorld(assign.offset.u, assign.offset.v, initialDir);
        const spineTarget = spinePath[initialLookahead];
        currentTarget = this.findValidWaypointCell([spineTarget[0] + dx, spineTarget[1] + dy], assign.unitId, reservedWaypoints);
        reservedWaypoints.add(`${currentTarget[0]},${currentTarget[1]}`);
      }

      slots.set(assign.unitId, {
        unitId: assign.unitId,
        role: assign.role,
        slotIndex: assign.slotIndex,
        offset: assign.offset,
        destination: validDest,
        currentTarget,
        isStuck: false,
        stuckTicks: 0,
        lastPosition: [ent.x, ent.y],
      });
    }

    const groupId = `formation-${team}-${this.nextGroupId++}`;
    const group: FormationGroup = {
      id: groupId,
      team,
      type,
      state: 'MARCHANDO',
      targetDestination: destination,
      attackMove,
      slots,
      collectiveSpeed: this.computeCollectiveSpeed(slots),
      createdTick: this.simulation.clock.ticks,
      spinePath,
      spineIndex: 0,
      currentDirection: initialDir,
    };

    this.groups.set(groupId, group);
    for (const unitId of slots.keys()) {
      this.unitToGroup.set(unitId, groupId);
    }

    return group;
  }

  /**
   * Dissolves a formation group.
   */
  dissolveFormation(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    for (const unitId of group.slots.keys()) {
      this.unitToGroup.delete(unitId);
    }
    this.groups.delete(groupId);
  }

  /**
   * Removes a single unit from its formation (e.g. on manual order, detachment or death).
   * Does NOT destroy the formation for other units unless fewer than 2 remain.
   */
  removeUnit(unitId: string): void {
    const groupId = this.unitToGroup.get(unitId);
    if (!groupId) return;

    this.unitToGroup.delete(unitId);
    const group = this.groups.get(groupId);
    if (!group) return;

    group.slots.delete(unitId);

    if (group.slots.size < 2) {
      this.dissolveFormation(groupId);
    } else {
      group.collectiveSpeed = this.computeCollectiveSpeed(group.slots);
    }
  }

  /**
   * Handles unit death, reorganizing remaining slots if the formation is still marching.
   */
  handleUnitDeath(unitId: string): void {
    const groupId = this.unitToGroup.get(unitId);
    if (!groupId) return;

    const group = this.groups.get(groupId);
    if (!group) return;

    this.removeUnit(unitId);

    // If still alive with >= 2 units, re-balance slots
    if (this.groups.has(groupId) && group.state === 'MARCHANDO') {
      this.rebalanceSlots(group);
    }
  }

  /**
   * Returns the speed allowance for a unit:
   * - Units in the front/regular march are capped to collectiveSpeed.
   * - Units that are lagging behind (rejoining/regrouping) can move faster up to their native speed.
   */
  getEffectiveSpeed(unit: UnitEntity): number {
    const group = this.getFormationForUnit(unit.id);
    if (!group) return unit.movement;

    const slot = group.slots.get(unit.id);
    if (!slot) return unit.movement;

    // If stuck or fighting, use native speed
    if (slot.isStuck || group.state === 'EM_COMBATE') {
      return unit.movement;
    }

    // When actively marching in formation, advance at collective speed
    return Math.min(unit.movement, group.collectiveSpeed);
  }

  /**
   * Updates all active formations:
   * - Detects combat states
   * - Checks for stuck units so they don't halt the whole army
   * - Updates regrouping and arrival states
   */
  update(currentTick: number): void {
    for (const [groupId, group] of this.groups) {
      let anyInCombat = false;
      let anyRegrouping = false;
      let allArrived = true;

      // Filter out any dead or deleted units
      for (const unitId of Array.from(group.slots.keys())) {
        const entity = this.simulation.entities.get(unitId);
        if (!entity || entity.hp <= 0) {
          this.handleUnitDeath(unitId);
        }
      }

      if (!this.groups.has(groupId)) continue;

      // 1. Advance spine progression based on units' centroid
      let sumX = 0;
      let sumY = 0;
      let activeCount = 0;
      for (const slot of group.slots.values()) {
        if (slot.isStuck) continue;
        const ent = this.simulation.entities.get(slot.unitId);
        if (ent && ent.category === 'unit' && ent.hp > 0) {
          sumX += ent.x;
          sumY += ent.y;
          activeCount++;
        }
      }

      if (activeCount > 0 && group.spinePath && group.spinePath.length >= 2) {
        const centroidX = Math.round(sumX / activeCount);
        const centroidY = Math.round(sumY / activeCount);
        let bestIdx = group.spineIndex;
        let bestDist = Infinity;
        const maxSearch = Math.min(group.spinePath.length - 1, group.spineIndex + 6);
        for (let i = group.spineIndex; i <= maxSearch; i++) {
          const p = group.spinePath[i];
          const dist = Math.hypot(p[0] - centroidX, p[1] - centroidY);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx > group.spineIndex) {
          group.spineIndex = bestIdx;
        }

        const previousWaypoint = this.waypointVersions.get(group);
        if (previousWaypoint?.spine !== group.spineIndex || previousWaypoint.navigation !== this.simulation.map.navigationRevision) {
          this.waypointVersions.set(group, { spine: group.spineIndex, navigation: this.simulation.map.navigationRevision });
          const lookaheadDist = Math.max(6, Math.ceil(Math.sqrt(group.slots.size)) * 2);
          const reservedWaypoints = new Set<string>();
          for (const slot of group.slots.values()) {
            const ent = this.simulation.entities.get(slot.unitId);
            const unitX = ent ? ent.x : slot.lastPosition[0];
            const unitY = ent ? ent.y : slot.lastPosition[1];

            // Find closest spine point to this individual unit
            let unitSpineIdx = group.spineIndex;
            let minDist = Infinity;
            const searchMin = Math.max(0, group.spineIndex - 4);
            const searchMax = Math.min(group.spinePath.length - 1, group.spineIndex + 6);
            for (let i = searchMin; i <= searchMax; i++) {
              const sp = group.spinePath[i];
              const d = Math.hypot(sp[0] - unitX, sp[1] - unitY);
              if (d < minDist) {
                minDist = d;
                unitSpineIdx = i;
              }
            }

            const unitLookahead = Math.min(group.spinePath.length - 1, unitSpineIdx + lookaheadDist);
            if (unitLookahead >= group.spinePath.length - 1) {
              slot.currentTarget = slot.destination;
            } else {
              const currentSpine = group.spinePath[unitSpineIdx];
              const targetSpine = group.spinePath[unitLookahead];
              const localDir = getMarchDirection(currentSpine, targetSpine);
              group.currentDirection = localDir;
              const [dx, dy] = transformOffsetToWorld(slot.offset.u, slot.offset.v, localDir);
              const desired: Point = [targetSpine[0] + dx, targetSpine[1] + dy];
              const valid = this.findValidWaypointCell(desired, slot.unitId, reservedWaypoints);
              reservedWaypoints.add(`${valid[0]},${valid[1]}`);
              slot.currentTarget = valid;
            }
          }
        }
      }

      let waypointUpdatesBudget = 2;
      for (const slot of group.slots.values()) {
        const unit = this.simulation.entities.get(slot.unitId);
        if (!unit || unit.category !== 'unit') continue;

        // Stuck detection: track if unit hasn't changed position while having a moveTarget
        if (unit.moveTarget) {
          if (unit.x === slot.lastPosition[0] && unit.y === slot.lastPosition[1]) {
            slot.stuckTicks += 1;
            if (slot.stuckTicks > 20) {
              slot.isStuck = true;
            }
          } else {
            slot.stuckTicks = 0;
            slot.isStuck = false;
            slot.lastPosition = [unit.x, unit.y];
          }
        } else {
          const distToDest = Math.max(Math.abs(unit.x - slot.destination[0]), Math.abs(unit.y - slot.destination[1]));
          if (distToDest <= 1) {
            slot.stuckTicks = 0;
            slot.isStuck = false;
          }
        }

        // Combat status check
        const inEngagement = this.simulation.engagements.isEngaged(unit.id);
        const manualTarget = this.simulation.combat.manualTargetFor(unit.id) !== null;
        if (inEngagement || manualTarget) {
          anyInCombat = true;
        }

        // Regrouping & marching waypoint advancement
        const distToDest = Math.max(Math.abs(unit.x - slot.destination[0]), Math.abs(unit.y - slot.destination[1]));
        const isArrivedAtFinal = distToDest <= 1 || (distToDest <= 2 && this.simulation.entities.atCell(slot.destination[0], slot.destination[1]) !== null);

        if (!inEngagement && !manualTarget) {
          if (!unit.moveTarget && !isArrivedAtFinal) {
            const timeSinceReissue = currentTick - (slot.lastReissueTick ?? 0);
            if (timeSinceReissue >= 6 && currentTick >= unit.cooldownUntilTick) {
              slot.lastReissueTick = currentTick;
              anyRegrouping = true;
              // Re-issue movement towards assigned marching slot
              const res = this.simulation.movement.issue(
                {
                  type: 'move',
                  team: group.team,
                  unitId: unit.id,
                  destination: slot.currentTarget,
                  attackMove: group.attackMove,
                },
                currentTick,
              );
              if (!res.accepted && res.reason === 'invalid-destination') {
                const alt = this.simulation.movement.findNearestFreeNeighbor(slot.currentTarget[0], slot.currentTarget[1], unit.id);
                if (alt) {
                  slot.currentTarget = alt;
                  this.simulation.movement.issue(
                    {
                      type: 'move',
                      team: group.team,
                      unitId: unit.id,
                      destination: alt,
                      attackMove: group.attackMove,
                    },
                    currentTick,
                  );
                }
              }
            }
          } else if (unit.moveTarget) {
            // Keep marching in formation along spine waypoints, updating when approaching current waypoint
            const distToTarget = Math.max(Math.abs(unit.x - unit.moveTarget[0]), Math.abs(unit.y - unit.moveTarget[1]));
            const distToCurrent = Math.hypot(unit.moveTarget[0] - slot.currentTarget[0], unit.moveTarget[1] - slot.currentTarget[1]);
            if (distToTarget <= 3 && distToCurrent >= 2 && waypointUpdatesBudget > 0) {
              waypointUpdatesBudget--;
              unit.moveTarget = slot.currentTarget;
              if (group.attackMove) {
                unit.attackMoveTarget = slot.currentTarget;
              }
            }
          }
        }

        // Arrival check with spatial tolerance at final destination
        if (!isArrivedAtFinal && !slot.isStuck) {
          allArrived = false;
        }
      }

      // Recompute collective speed excluding permanently stuck units
      group.collectiveSpeed = this.computeCollectiveSpeed(group.slots);

      // Transition state
      if (anyInCombat) {
        group.state = 'EM_COMBATE';
      } else if (anyRegrouping) {
        group.state = 'REAGRUPANDO';
      } else if (allArrived) {
        group.state = 'PARADO';
      } else {
        group.state = 'MARCHANDO';
      }
    }
  }

  private computeCollectiveSpeed(slots: Map<string, FormationSlot>): number {
    let minSpeed = Infinity;
    for (const slot of slots.values()) {
      if (slot.isStuck) continue; // Stuck units do not slow down the active marching core
      const entity = this.simulation.entities.get(slot.unitId);
      if (entity && entity.category === 'unit' && entity.hp > 0) {
        if (entity.movement < minSpeed) {
          minSpeed = entity.movement;
        }
      }
    }
    return minSpeed === Infinity ? 3 : minSpeed;
  }

  private rebalanceSlots(group: FormationGroup): void {
    this.waypointVersions.delete(group);
    const activeUnits: FormationUnitInfo[] = [];
    for (const slot of group.slots.values()) {
      const ent = this.simulation.entities.get(slot.unitId);
      if (ent && ent.category === 'unit' && ent.hp > 0) {
        activeUnits.push({
          id: ent.id,
          kind: ent.kind,
          movement: ent.movement,
          x: ent.x,
          y: ent.y,
        });
      }
    }

    if (activeUnits.length < 2) {
      this.dissolveFormation(group.id);
      return;
    }

    let sumX = 0;
    let sumY = 0;
    for (const ent of activeUnits) {
      sumX += ent.x;
      sumY += ent.y;
    }
    const center: Point = [Math.round(sumX / activeUnits.length), Math.round(sumY / activeUnits.length)];
    const dir = getMarchDirection(center, group.targetDestination);

    const raw = assignFormationSlots(activeUnits, group.type, group.targetDestination, dir);
    const reserved = new Set<string>();

    const spine = group.spinePath;
    const lookaheadDist = Math.max(6, Math.ceil(Math.sqrt(activeUnits.length)) * 2);
    const lookahead = Math.min(spine.length - 1, group.spineIndex + lookaheadDist);
    const localDir = lookahead < spine.length - 1
      ? getMarchDirection(spine[group.spineIndex], spine[lookahead])
      : dir;
    const reservedWaypoints = new Set<string>();

    for (const assign of raw) {
      const valid = this.findValidDestinationCell(assign.destination, reserved);
      reserved.add(`${valid[0]},${valid[1]}`);
      const existing = group.slots.get(assign.unitId);
      if (existing) {
        existing.destination = valid;
        existing.offset = assign.offset;
        existing.role = assign.role;
        existing.slotIndex = assign.slotIndex;
        if (lookahead < spine.length - 1) {
          const [dx, dy] = transformOffsetToWorld(assign.offset.u, assign.offset.v, localDir);
          const spineTarget = spine[lookahead];
          const validWaypoint = this.findValidWaypointCell([spineTarget[0] + dx, spineTarget[1] + dy], assign.unitId, reservedWaypoints);
          reservedWaypoints.add(`${validWaypoint[0]},${validWaypoint[1]}`);
          existing.currentTarget = validWaypoint;
        } else {
          existing.currentTarget = valid;
        }
      }
    }
  }

  findNearestPassableCell(point: Point): Point {
    const [x, y] = point;
    if (
      this.simulation.map.contains(x, y) &&
      this.simulation.map.isPassable(x, y) &&
      this.isCellFreeOfBuildings(x, y)
    ) {
      return point;
    }

    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (
            this.simulation.map.contains(nx, ny) &&
            this.simulation.map.isPassable(nx, ny) &&
            this.isCellFreeOfBuildings(nx, ny)
          ) {
            return [nx, ny];
          }
        }
      }
    }

    return point;
  }

  private findValidDestinationCell(desired: Point, reserved: Set<string>): Point {
    const [targetX, targetY] = desired;
    const key = `${targetX},${targetY}`;
    if (
      !reserved.has(key) &&
      this.simulation.map.contains(targetX, targetY) &&
      this.simulation.map.isPassable(targetX, targetY) &&
      this.isCellFreeOfBuildings(targetX, targetY)
    ) {
      return desired;
    }

    // Search nearest free neighbor in concentric rings
    for (let r = 1; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          const ringKey = `${x},${y}`;
          if (
            !reserved.has(ringKey) &&
            this.simulation.map.contains(x, y) &&
            this.simulation.map.isPassable(x, y) &&
            this.isCellFreeOfBuildings(x, y)
          ) {
            return [x, y];
          }
        }
      }
    }

    return desired;
  }

  private findValidWaypointCell(desired: Point, unitId: string, reserved: Set<string>): Point {
    const [targetX, targetY] = desired;
    const key = `${targetX},${targetY}`;
    if (
      !reserved.has(key) &&
      this.simulation.map.contains(targetX, targetY) &&
      this.simulation.map.isPassable(targetX, targetY) &&
      this.isCellFreeOfBuildings(targetX, targetY) &&
      this.simulation.entities.isFreeForUnit(targetX, targetY, unitId)
    ) {
      return desired;
    }

    // Search nearest free neighbor in concentric rings
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          const ringKey = `${x},${y}`;
          if (
            !reserved.has(ringKey) &&
            this.simulation.map.contains(x, y) &&
            this.simulation.map.isPassable(x, y) &&
            this.isCellFreeOfBuildings(x, y) &&
            this.simulation.entities.isFreeForUnit(x, y, unitId)
          ) {
            return [x, y];
          }
        }
      }
    }

    // Secondary fallback: cell is passable and unreserved, even if a friendly unit is currently walking through it
    if (
      !reserved.has(key) &&
      this.simulation.map.contains(targetX, targetY) &&
      this.simulation.map.isPassable(targetX, targetY) &&
      this.isCellFreeOfBuildings(targetX, targetY)
    ) {
      return desired;
    }

    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = targetX + dx;
          const y = targetY + dy;
          const ringKey = `${x},${y}`;
          if (
            !reserved.has(ringKey) &&
            this.simulation.map.contains(x, y) &&
            this.simulation.map.isPassable(x, y) &&
            this.isCellFreeOfBuildings(x, y)
          ) {
            return [x, y];
          }
        }
      }
    }

    return desired;
  }

  private isCellFreeOfBuildings(x: number, y: number): boolean {
    const entity = this.simulation.entities.atCell(x, y);
    return !entity || entity.category !== 'building';
  }
}

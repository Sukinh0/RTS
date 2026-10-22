import { BALANCE } from '../../config/balance';
import { TICKS_PER_SECOND } from '../../config/runtime';
import type { AttackCommand, CommandResult } from '../commands/MoveCommand';
import { EntityStore, type BuildingKind, type GameEntity, type UnitEntity, type UnitKind } from '../entities/EntityStore';
import { FogOfWar } from './FogOfWar';
import type { Team } from '../../map/MapGrid';

export interface CombatEvent {
  type: 'attack';
  tick: number;
  attackerId: string;
  attackerTeam: Team;
  attackerKind: UnitKind;
  attackerX: number;
  attackerY: number;
  targetId: string;
  targetTeam: Team;
  targetCategory: GameEntity['category'];
  targetKind: UnitKind | BuildingKind;
  targetX: number;
  targetY: number;
  damage: number;
  targetHpAfter: number;
  targetDied: boolean;
  reflectedDamage: number;
  attackerHpAfter: number;
  attackerDied: boolean;
}

/** Handles manual attack orders, auto-targeting, deterministic damage, range, and reflection. */
export class CombatSystem {
  private readonly events: CombatEvent[] = [];
  private readonly manualTargets = new Map<string, string>();

  constructor(
    private readonly entities: EntityStore,
    private readonly fog: FogOfWar,
    private readonly onEntityDeath?: (entity: GameEntity) => void,
    private readonly isGameOver?: () => boolean,
  ) {}

  manualTargetFor(unitId: string): string | null {
    return this.manualTargets.get(unitId) ?? null;
  }

  setManualTarget(unitId: string, targetId: string): void {
    this.manualTargets.set(unitId, targetId);
  }

  cancel(unitId: string): void {
    this.manualTargets.delete(unitId);
  }

  issue(command: AttackCommand, currentTick: number): CommandResult {
    const attacker = this.entities.get(command.unitId);
    if (!attacker || attacker.category !== 'unit') return { accepted: false, reason: 'unknown-unit' };
    if (attacker.team !== command.team) return { accepted: false, reason: 'wrong-owner' };
    if (attacker.damage <= 0) return { accepted: false, reason: 'cannot-attack' };
    if (currentTick < attacker.cooldownUntilTick) return { accepted: false, reason: 'cooldown' };

    const target = this.entities.get(command.targetId);
    if (!target) return { accepted: false, reason: 'target-not-found' };
    if (target.team === command.team) return { accepted: false, reason: 'target-friendly' };
    if (!this.fog.isEntityVisible(command.team, target)) return { accepted: false, reason: 'target-not-visible' };

    const dist = this.distance(attacker, target);
    if (dist > attacker.range) return { accepted: false, reason: 'out-of-range' };

    this.manualTargets.set(attacker.id, target.id);
    this.executeAttack(attacker, target, currentTick);
    return { accepted: true };
  }

  update(currentTick: number): number {
    if (this.isGameOver?.()) return 0;
    const planned: Array<{ attacker: UnitEntity; target: GameEntity }> = [];
    const attackers = this.entities.all()
      .filter((e): e is UnitEntity => e.category === 'unit' && e.damage > 0 && e.hp > 0)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const attacker of attackers) {
      if (currentTick < attacker.cooldownUntilTick) continue;
      if (attacker.moveTarget !== null) continue;

      const manualTargetId = this.manualTargets.get(attacker.id);
      if (manualTargetId) {
        const manualTarget = this.entities.get(manualTargetId);
        if (
          manualTarget &&
          manualTarget.team !== attacker.team &&
          manualTarget.hp > 0 &&
          this.fog.isEntityVisible(attacker.team, manualTarget) &&
          this.distance(attacker, manualTarget) <= attacker.range
        ) {
          planned.push({ attacker, target: manualTarget });
          continue;
        } else {
          this.manualTargets.delete(attacker.id);
        }
      }

      const candidates = this.entities.nearby(attacker.x, attacker.y, attacker.range).filter((target) => {
        if (target.team === attacker.team || target.hp <= 0) return false;
        if (!this.fog.isEntityVisible(attacker.team, target)) return false;
        return this.distance(attacker, target) <= attacker.range;
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const distA = this.distance(attacker, a);
          const distB = this.distance(attacker, b);
          if (Math.abs(distA - distB) > 1e-6) return distA - distB;
          if (a.hp !== b.hp) return a.hp - b.hp;
          return a.id.localeCompare(b.id);
        });
        const bestTarget = candidates[0];
        planned.push({ attacker, target: bestTarget });
      }
    }

    for (const { attacker, target } of planned) this.executeAttack(attacker, target, currentTick, true);
    for (const entity of this.entities.all()) {
      if (entity.hp <= 0) this.killEntity(entity);
    }
    return planned.length;
  }

  distance(attacker: UnitEntity, target: GameEntity): number {
    if (target.category === 'unit') {
      return Math.hypot(attacker.x - target.x, attacker.y - target.y);
    }
    const closestX = Math.max(target.x, Math.min(attacker.x, target.x + target.width - 1));
    const closestY = Math.max(target.y, Math.min(attacker.y, target.y + target.height - 1));
    return Math.hypot(attacker.x - closestX, attacker.y - closestY);
  }

  drainEvents(): CombatEvent[] {
    return this.events.splice(0);
  }

  private executeAttack(attacker: UnitEntity, target: GameEntity, currentTick: number, deferDeath = false): void {
    const damage = attacker.damage;
    target.hp = Math.max(0, target.hp - damage);
    attacker.cooldownUntilTick = currentTick + Math.round(attacker.cooldownSeconds * TICKS_PER_SECOND);

    let reflectedDamage = 0;
    if (target.category === 'unit' && target.kind === 'shieldbearer') {
      const isAdjacent = Math.max(Math.abs(attacker.x - target.x), Math.abs(attacker.y - target.y))
        <= BALANCE.units.shieldbearer.reflectionMaxDistance;
      if (isAdjacent) {
        reflectedDamage = Math.floor(damage * (BALANCE.units.shieldbearer.reflectionPercent / 100));
        attacker.hp = Math.max(0, attacker.hp - reflectedDamage);
      }
    }

    const center = this.targetCenter(target);
    this.events.push({
      type: 'attack',
      tick: currentTick,
      attackerId: attacker.id,
      attackerTeam: attacker.team,
      attackerKind: attacker.kind,
      attackerX: attacker.x,
      attackerY: attacker.y,
      targetId: target.id,
      targetTeam: target.team,
      targetCategory: target.category,
      targetKind: target.kind,
      targetX: center.x,
      targetY: center.y,
      damage,
      targetHpAfter: target.hp,
      targetDied: target.hp <= 0,
      reflectedDamage,
      attackerHpAfter: attacker.hp,
      attackerDied: attacker.hp <= 0,
    });

    if (!deferDeath) {
      if (target.hp <= 0) this.killEntity(target);
      if (attacker.hp <= 0) this.killEntity(attacker);
    }
  }

  private killEntity(entity: GameEntity): void {
    this.entities.remove(entity.id);
    this.manualTargets.delete(entity.id);
    for (const [k, v] of this.manualTargets.entries()) {
      if (v === entity.id) this.manualTargets.delete(k);
    }
    this.onEntityDeath?.(entity);
    this.fog.update();
  }

  private targetCenter(target: GameEntity): { x: number; y: number } {
    if (target.category === 'unit') {
      return { x: target.x, y: target.y };
    }
    return {
      x: target.x + (target.width - 1) / 2,
      y: target.y + (target.height - 1) / 2,
    };
  }
}

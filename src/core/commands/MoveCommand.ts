import type { Point, Team } from '../../map/MapGrid';
import type { BuildingKind, UnitKind } from '../entities/EntityStore';

export interface MoveCommand {
  type: 'move';
  team: Team;
  unitId: string;
  destination: Point;
}

export interface WorkCommand {
  type: 'mine' | 'gather';
  team: Team;
  unitId: string;
  target: Point;
}

export interface BuildCommand {
  type: 'build';
  team: Team;
  builderId: string;
  buildingKind: Extract<BuildingKind, 'house' | 'barracks'>;
  position: Point;
}

export interface ProduceCommand {
  type: 'produce';
  team: Team;
  buildingId: string;
  unitKind: UnitKind;
}

export interface AttackCommand {
  type: 'attack';
  team: Team;
  unitId: string;
  targetId: string;
}

export type GameCommand = MoveCommand | WorkCommand | BuildCommand | ProduceCommand | AttackCommand;

export type CommandFailureReason =
  | 'game-over'
  | 'unknown-unit'
  | 'wrong-owner'
  | 'cooldown'
  | 'invalid-destination'
  | 'no-path'
  | 'already-there'
  | 'not-worker'
  | 'wrong-terrain'
  | 'mine-full'
  | 'unknown-building'
  | 'under-construction'
  | 'invalid-unit-kind'
  | 'unit-cap-reached'
  | 'insufficient-coins'
  | 'insufficient-wood'
  | 'invalid-position'
  | 'blocked'
  | 'unexplored'
  | 'cannot-attack'
  | 'target-not-found'
  | 'target-friendly'
  | 'target-not-visible'
  | 'out-of-range';

export type CommandResult =
  | { accepted: true }
  | { accepted: false; reason: CommandFailureReason };

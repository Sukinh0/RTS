import type { Point, Team } from '../../map/MapGrid';
import type { BuildingKind, UnitKind } from '../entities/EntityStore';

export interface MoveCommand {
  type: 'move';
  team: Team;
  unitId: string;
  destination: Point;
  attackMove?: boolean;
}

export interface AttackMoveCommand {
  type: 'attack-move';
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
  buildingKind: Extract<BuildingKind, 'house' | 'barracks' | 'barricade' | 'tower'>;
  position: Point;
}

export interface BuildLineCommand {
  type: 'build-line';
  team: Team;
  builderId: string;
  buildingKind: 'barricade';
  cells: Point[];
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

export interface RepairCommand {
  type: 'repair';
  team: Team;
  builderId: string;
  buildingId: string;
}

export interface SetRallyPointCommand {
  type: 'set-rally-point';
  team: Team;
  buildingId: string;
  point: Point | null;
}

export type GameCommand =
  | MoveCommand
  | AttackMoveCommand
  | WorkCommand
  | BuildCommand
  | BuildLineCommand
  | ProduceCommand
  | AttackCommand
  | RepairCommand
  | SetRallyPointCommand;

export type CommandFailureReason =
  | 'game-over'
  | 'unknown-unit'
  | 'wrong-owner'
  | 'unsupported-building'
  | 'cooldown'
  | 'invalid-destination'
  | 'no-path'
  | 'already-there'
  | 'not-worker'
  | 'not-builder'
  | 'wrong-terrain'
  | 'mine-full'
  | 'unknown-building'
  | 'under-construction'
  | 'invalid-unit-kind'
  | 'unit-cap-reached'
  | 'civilian-capacity-reached'
  | 'military-capacity-reached'
  | 'insufficient-coins'
  | 'insufficient-wood'
  | 'insufficient-stone'
  | 'building-limit-reached'
  | 'building-at-max-hp'
  | 'invalid-position'
  | 'out-of-build-range'
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

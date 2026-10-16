import type { FormationType } from '../core/formations/FormationGeometry';
import { EntityStore, type GameEntity } from '../core/entities/EntityStore';
import type { Team } from '../map/MapGrid';

/** Player selection state. Enemy entities cannot enter the selection set. */
export class SelectionModel {
  private readonly ids = new Set<string>();
  private readonly controlGroups = new Map<number, string[]>();
  private currentFormation: FormationType | null = 'line';

  constructor(private readonly entities: EntityStore, readonly team: Team) {}

  get selectedIds(): readonly string[] {
    return [...this.ids];
  }

  get selectedEntities(): readonly GameEntity[] {
    return this.selectedIds.flatMap((id) => {
      const entity = this.entities.get(id);
      return entity ? [entity] : [];
    });
  }

  get formation(): FormationType | null {
    return this.currentFormation;
  }

  setFormation(formation: FormationType | null): void {
    this.currentFormation = formation;
  }

  clear(): void {
    this.ids.clear();
  }

  selectAt(x: number, y: number, additive = false): void {
    const entity = this.entities.atCell(x, y);
    if (!additive) this.clear();
    if (!entity || entity.team !== this.team) return;
    if (additive && this.ids.has(entity.id)) this.ids.delete(entity.id);
    else this.ids.add(entity.id);
  }

  selectRect(minX: number, minY: number, maxX: number, maxY: number, additive = false): void {
    if (!additive) this.clear();
    const left = Math.min(minX, maxX);
    const right = Math.max(minX, maxX);
    const top = Math.min(minY, maxY);
    const bottom = Math.max(minY, maxY);
    for (const unit of this.entities.unitsInRect(left, top, right, bottom)) {
      if (unit.team === this.team) this.ids.add(unit.id);
    }
  }

  selectEntity(id: string): void {
    const entity = this.entities.get(id);
    this.clear();
    if (entity && entity.team === this.team) {
      this.ids.add(entity.id);
    }
  }

  /**
   * Binds the current selection of team units to control group 1..9 (Ctrl + 1..9).
   */
  recordControlGroup(groupNumber: number): boolean {
    if (groupNumber < 1 || groupNumber > 9) return false;
    const validIds = this.selectedIds.filter((id) => {
      const ent = this.entities.get(id);
      return ent && ent.team === this.team && ent.hp > 0;
    });

    if (validIds.length === 0) {
      this.controlGroups.delete(groupNumber);
      return false;
    }

    this.controlGroups.set(groupNumber, [...validIds]);
    return true;
  }

  /**
   * Selects units previously registered in control group 1..9.
   * Automatically cleans up destroyed units.
   */
  selectControlGroup(groupNumber: number, additive = false): boolean {
    if (groupNumber < 1 || groupNumber > 9) return false;
    const group = this.controlGroups.get(groupNumber);
    if (!group) return false;

    // Filter surviving units
    const surviving = group.filter((id) => {
      const ent = this.entities.get(id);
      return ent && ent.team === this.team && ent.hp > 0;
    });

    if (surviving.length === 0) {
      this.controlGroups.delete(groupNumber);
      return false;
    }

    // Update stored group to prune dead units
    this.controlGroups.set(groupNumber, surviving);

    if (!additive) {
      this.clear();
    }

    for (const id of surviving) {
      this.ids.add(id);
    }

    return true;
  }

  getControlGroup(groupNumber: number): readonly string[] {
    return this.controlGroups.get(groupNumber) ?? [];
  }
}

import { EntityStore, type GameEntity } from '../core/entities/EntityStore';
import type { Team } from '../map/MapGrid';

/** Player selection state. Enemy entities cannot enter the selection set. */
export class SelectionModel {
  private readonly ids = new Set<string>();

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
}

import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { FixedStepClock } from './FixedStepClock';
import { FIXED_STEP_MS } from '../../config/runtime';
import { findPath, terrainHeuristic } from '../../map/findPath';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';
import { BALANCE } from '../../config/balance';

describe('performance invariants', () => {
  it('keeps cell occupancy exact through repeated moves, spawns and removal', () => {
    const { entities } = new Simulation(1);
    for (let i = 0; i < 100; i++) {
      const unit = entities.spawnUnit('blue', 'soldier', 30, 30);
      const old = entities.all();
      expect(entities.moveUnit(unit.id, 31, 30)).toBe(true);
      expect(entities.atCell(30, 30)).toBeUndefined();
      expect(entities.atCell(31, 30)).toBe(unit);
      expect(entities.isFreeForUnit(31, 30, '')).toBe(false);
      entities.remove(unit.id);
      expect(entities.atCell(31, 30)).toBeUndefined();
      expect(entities.all()).not.toBe(old);
      expect(old).toContain(unit); // membership snapshots remain stable
    }
  });

  it('includes adjacent cells and the far edge of building footprints once', () => {
    const { entities } = new Simulation(1);
    const building = entities.createBuilding('red', 'house', 40, 40);
    const unit = entities.spawnUnit('red', 'archer', 39, 40);
    const found = entities.nearby(39, 41, 2);
    expect(found.filter(e => e.id === building.id)).toHaveLength(1);
    expect(found).toContain(unit);
    expect(entities.atCell(40 + building.width - 1, 40 + building.height - 1)).toBe(building);
    entities.remove(building.id);
    expect(entities.nearby(39, 41, 2)).not.toContain(building);
  });

  it('invalidates connectivity after terrain and structure changes', () => {
    const { map, entities } = new Simulation(1);
    for (let y = 0; y < map.height; y++) map.setTerrain(50, y, 'mountain');
    expect(map.hasStaticConnection([45, 50], [55, 50])).toBe(false);
    map.setTerrain(50, 50, 'plain');
    expect(map.hasStaticConnection([45, 50], [55, 50])).toBe(true);
    const wall = entities.createBuilding('red', 'barricade', 50, 50);
    expect(map.hasStaticConnection([45, 50], [55, 50])).toBe(false);
    entities.remove(wall.id);
    expect(map.hasStaticConnection([45, 50], [55, 50])).toBe(true);
  });

  it('reuses A* scratch safely across failures, obstacle changes and nested calls', () => {
    const { map } = new Simulation(1);
    const expected = findPath(map, [30, 30], [40, 40]);
    let nested = false;
    expect(findPath(map, [30, 30], [40, 40], (x, y) => {
      if (!nested) { nested = true; expect(findPath(map, [40, 40], [30, 30])).not.toBeNull(); }
      return map.isPassable(x, y);
    })).toEqual(expected);
    expect(findPath(map, [30, 30], [40, 40], () => false)).toBeNull();
    map.setTerrain(35, 35, 'water');
    expect(findPath(map, [30, 30], [40, 40])).not.toContainEqual([35, 35]);
    map.setTerrain(35, 35, 'plain');
    expect(findPath(map, [30, 30], [40, 40])).toEqual(expected);
  });

  it('validates cached routes against new units, terrain and diagonal corners', () => {
    const sim = new Simulation(1);
    const unit = sim.entities.spawnUnit('blue', 'soldier', 30, 30);
    expect(sim.movement.issue({ type: 'move', team: 'blue', unitId: unit.id, destination: [50, 50] }, 0).accepted).toBe(true);
    sim.movement.update(1);
    sim.movement.drainEvents();
    const blockX = unit.x + 1, blockY = unit.y + 1;
    sim.entities.spawnUnit('blue', 'worker', blockX, blockY);
    sim.map.setTerrain(unit.x + 1, unit.y, 'water');
    sim.movement.update(unit.cooldownUntilTick);
    const events = sim.movement.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).not.toContainEqual([blockX, blockY]);
    for (let i = 1; i < events[0].path.length; i++) {
      const [x, y] = events[0].path[i], [px, py] = events[0].path[i - 1];
      expect(sim.map.isPassable(x, y)).toBe(true);
      if (x !== px && y !== py) {
        expect(sim.map.isPassable(x, py)).toBe(true);
        expect(sim.map.isPassable(px, y)).toBe(true);
      }
    }
  });

  it('waits briefly behind an ally, then replans around a persistent blockage', () => {
    const sim = new Simulation(1);
    const marcher = sim.entities.spawnUnit('blue','soldier',30,30);
    const oldCap = BALANCE.map.unitCapPerTeam;
    BALANCE.map.unitCapPerTeam = 130;
    try {
      for(let i=0;i<122;i++) sim.entities.spawnUnit('red','soldier',140+i%10,30+Math.floor(i/10));
    } finally {
      BALANCE.map.unitCapPerTeam = oldCap;
    }
    expect(sim.movement.issue({type:'move',team:'blue',unitId:marcher.id,destination:[45,30]},0).accepted).toBe(true);
    sim.movement.update(1);
    sim.movement.drainEvents();
    const blocker = sim.entities.spawnUnit('blue','worker',marcher.x+1,marcher.y);
    const initialX=marcher.x, initialY=marcher.y;
    const ready=marcher.cooldownUntilTick;
    for(let tick=ready;tick<ready+8;tick+=2) {
      sim.movement.update(tick);
      expect([marcher.x,marcher.y]).toEqual([initialX,initialY]);
    }
    sim.movement.update(ready+8);
    expect([marcher.x,marcher.y]).not.toEqual([blocker.x,blocker.y]);
    expect([marcher.x,marcher.y]).not.toEqual([initialX,initialY]);
  });

  it('shared terrain guides preserve optimal path cost and invalidate after edits', () => {
    const sim = new Simulation(1);
    const cost = (path: ReturnType<typeof findPath>) => path?.slice(1).reduce((sum, point, i) => sum + (point[0] !== path[i][0] && point[1] !== path[i][1] ? 14 : 10), 0);
    for (let i=0;i<8;i++) {
      const start = [30+i, 30+i] as const;
      const goal = [110+i, 60+i] as const;
      const plain = findPath(sim.map,start,goal);
      const guided = findPath(sim.map,start,goal,undefined,terrainHeuristic(sim.map,goal));
      expect(cost(guided)).toBe(cost(plain));
    }
    const goal=[110,60] as const;
    for(let y=0;y<sim.map.height;y++) if(y!==100) sim.map.setTerrain(80,y,'mountain');
    expect(cost(findPath(sim.map,[30,30],goal,undefined,terrainHeuristic(sim.map,goal))))
      .toBe(cost(findPath(sim.map,[30,30],goal)));
  });


  it('bounds realtime catch-up without a persistent backlog, preserving headless time', () => {
    const clock = new FixedStepClock();
    expect(clock.advance(60_000, () => {}, 5)).toBe(5);
    expect(clock.droppedMs).toBeGreaterThan(59_000);
    expect(clock.advance(FIXED_STEP_MS, () => {}, 5)).toBe(1);
    expect(new FixedStepClock().advance(1000, () => {})).toBe(30);
    for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 120]) {
      const c = new FixedStepClock();
      for (let i = 0; i < Math.round(1000 / frameMs); i++) c.advance(frameMs, () => {}, 5);
      expect(c.ticks).toBe(30);
    }
  });

  it('restores original methods on diagnostic disable and bounds samples', () => {
    const sim = new Simulation(1);
    const original = sim.entities.isFreeForUnit;
    sim.setDiagnostics(true);
    for (let i = 0; i < 1000; i++) sim.entities.isFreeForUnit(30, 30, '');
    sim.advance(FIXED_STEP_MS);
    expect(sim.diagnostics.snapshot().metrics.collisionChecks.calls).toBeGreaterThanOrEqual(1000);
    sim.setDiagnostics(false);
    expect(sim.entities.isFreeForUnit).toBe(original);
    const count = sim.diagnostics.snapshot().metrics.collisionChecks.calls;
    sim.entities.isFreeForUnit(30, 30, '');
    expect(sim.diagnostics.snapshot().metrics.collisionChecks.calls).toBe(count);
  });

  it('keeps formation slots stable and reacts to changed terrain', () => {
    const sim = new Simulation(1);
    const units = [sim.entities.spawnUnit('blue', 'soldier', 30, 30), sim.entities.spawnUnit('blue', 'archer', 31, 30)];
    dispatchGroupMove(sim, 'blue', units.map(u => u.id), [60, 30], false, 'line');
    const group = sim.formations.getAllGroups()[0];
    sim.formations.update(1);
    const slot = group.slots.get(units[0].id)!;
    const target = slot.currentTarget;
    sim.formations.update(2);
    expect(slot.currentTarget).toBe(target);
    sim.map.setTerrain(target[0], target[1], 'water');
    sim.formations.update(3);
    expect(slot.currentTarget).not.toEqual(target);
  });
});

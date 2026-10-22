import { Simulation } from '../core/game/Simulation';
import type { UnitEntity } from '../core/entities/EntityStore';
import type { Team } from '../map/MapGrid';

interface ArmySnapshot {
  team: Team;
  totalUnits: number;
  combatants: number;
  combatantPositions: Array<{ kind: string; x: number; y: number; destination: [number, number] | null }>;
  intent: string;
  action: string;
  crossedMidfield: number;
}

function snapshot(simulation: Simulation, team: Team): ArmySnapshot {
  const all = simulation.entities.all().filter((entity) => entity.team === team && entity.category === 'unit') as UnitEntity[];
  const combatants = all.filter((unit) => unit.damage > 0 && unit.kind !== 'worker');
  const ai = simulation.aiControllers.get(team);
  return {
    team,
    totalUnits: all.length,
    combatants: combatants.length,
    combatantPositions: combatants.map((unit) => ({
      kind: unit.kind, x: unit.x, y: unit.y,
      destination: unit.moveTarget ? [unit.moveTarget[0], unit.moveTarget[1]] : null,
    })),
    intent: ai?.currentIntent ?? 'None',
    action: ai?.chosenAction ?? 'None',
    crossedMidfield: combatants.filter((unit) => team === 'blue' ? unit.x > 100 : unit.x < 100).length,
  };
}

/** Diagnostics use normal starting resources and both real AI controllers (no instant spawns). */
export function diagnoseAI(seed = 123, maxSeconds = 900, interval = 120): string[] {
  const simulation = new Simulation(seed);
  simulation.enableAI('blue');
  simulation.enableAI('red');
  const lines: string[] = [];
  const movementFailures: Record<string, number> = {};
  let attacks = 0;
  let firstCombat: number | null = null;
  let furthestBlue = 0;
  let furthestRed = 199;

  for (let second = 1; second <= maxSeconds && !simulation.result; second++) {
    simulation.advance(1000);
    simulation.movement.drainEvents();
    for (const failure of simulation.movement.drainFailures()) {
      const key = failure.reason;
      movementFailures[key] = (movementFailures[key] ?? 0) + 1;
    }
    simulation.map.drainDirtyCells();
    const combatEvents = simulation.combat.drainEvents();
    attacks += combatEvents.length;
    if (firstCombat === null && combatEvents.length > 0) firstCombat = second;
    for (const team of ['blue', 'red'] as const) {
      const troops = simulation.entities.all().filter((entity): entity is UnitEntity =>
        entity.team === team && entity.category === 'unit' && entity.damage > 0 && entity.kind !== 'worker');
      for (const troop of troops) {
        if (team === 'blue') furthestBlue = Math.max(furthestBlue, troop.x);
        else furthestRed = Math.min(furthestRed, troop.x);
      }
    }
    if (second % interval === 0 || second === maxSeconds || simulation.result) {
      lines.push(JSON.stringify({
        second, blue: snapshot(simulation, 'blue'), red: snapshot(simulation, 'red'),
        attacks, firstCombat, movementFailures,
        furthestBlue, furthestRed,
      }));
    }
  }
  return lines;
}

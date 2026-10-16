import type { Team } from '../../map/MapGrid';
import type { UnitKind } from '../entities/EntityStore';

export interface TeamMatchStats {
  troopsProduced: number;
  workersProduced: number;
  troopsKilled: number;
  workersKilled: number;
  coinsCollected: number;
  coinsSpent: number;
  woodCollected: number;
  woodSpent: number;
  stoneCollected: number;
  stoneSpent: number;
}

export type MatchStatsSnapshot = Record<Team, TeamMatchStats>;

function emptyStats(): TeamMatchStats {
  return {
    troopsProduced: 0, workersProduced: 0, troopsKilled: 0, workersKilled: 0,
    coinsCollected: 0, coinsSpent: 0, woodCollected: 0, woodSpent: 0,
    stoneCollected: 0, stoneSpent: 0,
  };
}

/** Counts completed production, combat losses and actual stock transactions. */
export class MatchStats {
  private readonly teams: MatchStatsSnapshot = { blue: emptyStats(), red: emptyStats() };

  produced(team: Team, kind: UnitKind): void {
    if (kind === 'worker' || kind === 'builder') this.teams[team].workersProduced += 1;
    else this.teams[team].troopsProduced += 1;
  }

  killed(victimTeam: Team, kind: UnitKind): void {
    const opponent = victimTeam === 'blue' ? 'red' : 'blue';
    if (kind === 'worker' || kind === 'builder') this.teams[opponent].workersKilled += 1;
    else this.teams[opponent].troopsKilled += 1;
  }

  collected(team: Team, coins: number, wood: number, stone = 0): void {
    this.teams[team].coinsCollected += Math.round(coins);
    this.teams[team].woodCollected += Math.round(wood);
    this.teams[team].stoneCollected += Math.round(stone);
  }

  spent(team: Team, coins: number, wood: number, stone = 0): void {
    this.teams[team].coinsSpent += Math.round(coins);
    this.teams[team].woodSpent += Math.round(wood);
    this.teams[team].stoneSpent += Math.round(stone);
  }

  snapshot(): MatchStatsSnapshot {
    return { blue: { ...this.teams.blue }, red: { ...this.teams.red } };
  }
}

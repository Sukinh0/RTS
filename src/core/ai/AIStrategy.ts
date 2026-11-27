/**
 * Tunable decisions of the AI. They only choose among actions that follow the
 * same rules as the player: no extra resources, vision or cooldown shortcuts.
 */
export interface AIStrategy {
  /** Send the stone gatherer back to other work once this much stone is idle (0 = never). */
  stoneSurplus: number;
  /** Same for wood: gatherers leave the forest once this much wood is idle (0 = never). */
  woodSurplus: number;
  /** Workers sent to gold when the economy has room (a mine accepts four). */
  minerTarget: number;
  /** Defend workers and outposts too, focus the most dangerous intruder and recall the raid if outnumbered. */
  smartDefense: boolean;
  /** Hold new waves while enemy fighters are seen within this many cells of the base (0 = off). */
  earlyWarningDistance: number;
  /** Fighting reserves needed to launch a wave, or to reinforce one already in the field. */
  waveSize: number;
  reinforcementSize: number;
  /** Cells from the base, towards the enemy, for an early-warning watch tower (0 = home towers only). */
  forwardTowerDistance: number;
  /** Barricades screening the forward tower (0 = none). */
  forwardBarricades: number;
  /** Fighting units ordered before extra civilians (0 = chosen by the seed, 2 to 4). */
  openingArmy: number;
  /** Assault route: as the seed says, always straight through the centre, or always by a flank. */
  route: 'seed' | 'direct' | 'flank';
  /** Worker goal with fewer than 3, 3 to 5, and 6 or more fighters. */
  workersEarly: number;
  workersMid: number;
  workersLate: number;
  homeBarricades: number;
  maxTowers: number;
  /** Troops produced before saving for the forward tower (0 = after the opening army). */
  forwardPostAfterTroops: number;
  /** Archers and shieldbearers wanted per soldier. */
  archerShare: number;
  shieldShare: number;
  trainScout: boolean;
  /** With smart defense, extra intruders tolerated beyond the home defenders before recalling the raid. */
  recallMargin: number;
}

/** The behaviour before strategies existed. Kept as the fixed opponent for duels and training. */
export const LEGACY_STRATEGY: Readonly<AIStrategy> = Object.freeze({
  stoneSurplus: 0,
  woodSurplus: 0,
  minerTarget: 2,
  smartDefense: false,
  earlyWarningDistance: 0,
  waveSize: 2,
  reinforcementSize: 2,
  forwardTowerDistance: 0,
  forwardBarricades: 0,
  openingArmy: 0,
  route: 'seed',
  workersEarly: 4,
  workersMid: 6,
  workersLate: 7,
  homeBarricades: 2,
  maxTowers: 2,
  forwardPostAfterTroops: 0,
  archerShare: 0.5,
  shieldShare: 0.5,
  trainScout: true,
  recallMargin: 0,
});

/** Strategy used in the game. Values were chosen with duels against LEGACY_STRATEGY. */
export const DEFAULT_STRATEGY: Readonly<AIStrategy> = Object.freeze({
  ...LEGACY_STRATEGY,
  stoneSurplus: 100,
  woodSurplus: 200,
  minerTarget: 3,
  smartDefense: true,
  earlyWarningDistance: 60,
  forwardTowerDistance: 35,
  forwardBarricades: 4,
});

import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';
import { BALANCE } from '../../config/balance';
import { isUnitEntity } from '../entities/EntityStore';

function advanceSeconds(simulation: Simulation, seconds: number): void {
  for (let i = 0; i < seconds; i += 1) {
    simulation.advance(1000);
  }
}

describe('Fase 8 — Rally Point / Ponto de Reunião', () => {
  it('definir: permite definir rally point em Casa e Quartel, rejeitando alvos inválidos', () => {
    const sim = new Simulation(42);
    const house = sim.entities.createBuilding('blue', 'house', 30, 100);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);
    const redHouse = sim.entities.createBuilding('red', 'house', 170, 100);
    const tower = sim.entities.createBuilding('blue', 'tower', 40, 100);

    // Definir em Casa aliada
    const resHouse = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: [45, 105],
    });
    expect(resHouse).toEqual({ accepted: true });
    expect(house.rallyPoint).toEqual([45, 105]);
    expect(sim.production.getRallyPoint(house.id)).toEqual([45, 105]);

    // Definir em Quartel aliado
    const resBarracks = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: [50, 110],
    });
    expect(resBarracks).toEqual({ accepted: true });
    expect(barracks.rallyPoint).toEqual([50, 110]);
    expect(sim.production.getRallyPoint(barracks.id)).toEqual([50, 110]);

    // Rejeitar equipe errada
    const resWrongOwner = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: redHouse.id,
      point: [45, 105],
    });
    expect(resWrongOwner).toEqual({ accepted: false, reason: 'wrong-owner' });

    // Rejeitar estrutura sem produção de unidades (Torre)
    const resTower = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: tower.id,
      point: [45, 105],
    });
    expect(resTower).toEqual({ accepted: false, reason: 'unsupported-building' });

    // Rejeitar coordenadas fora do mapa
    const resOutOfBounds = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: [-5, 300],
    });
    expect(resOutOfBounds).toEqual({ accepted: false, reason: 'invalid-destination' });
  });

  it('alterar: permite alterar o rally point de uma construção para um novo destino', () => {
    const sim = new Simulation(42);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: [40, 100],
    });
    expect(sim.production.getRallyPoint(barracks.id)).toEqual([40, 100]);

    // Altera para nova coordenada
    const resChange = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: [55, 95],
    });
    expect(resChange).toEqual({ accepted: true });
    expect(barracks.rallyPoint).toEqual([55, 95]);
    expect(sim.production.getRallyPoint(barracks.id)).toEqual([55, 95]);
  });

  it('remover: permite remover o rally point de uma construção', () => {
    const sim = new Simulation(42);
    const house = sim.entities.createBuilding('blue', 'house', 30, 100);

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: [40, 100],
    });
    expect(house.rallyPoint).toEqual([40, 100]);

    // Remover passando point: null
    const resClear = sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: null,
    });
    expect(resClear).toEqual({ accepted: true });
    expect(house.rallyPoint).toBeNull();
    expect(sim.production.getRallyPoint(house.id)).toBeNull();
  });

  it('unidade produzida recebe ordem: unidade recém-treinada em Casa recebe ordem de movimento até o rally point', () => {
    const sim = new Simulation(42);
    const house = sim.entities.createBuilding('blue', 'house', 30, 100);
    const rallyDest: [number, number] = [38, 102];

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: rallyDest,
    });

    sim.teams.blue.coins = 500;
    sim.teams.blue.wood = 500;

    const prodRes = sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });
    expect(prodRes).toEqual({ accepted: true });

    // Avança tempo de produção do operário (6 segundos)
    advanceSeconds(sim, BALANCE.units.worker.productionSeconds);

    // Operário foi gerado
    const worker = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'worker' && e.id === 'blue-worker-3');
    expect(worker).toBeDefined();
    if (!worker || !isUnitEntity(worker)) throw new Error('Worker entity missing');

    // Automaticamente recebeu ordem de movimento em direção ao rally point
    expect(worker.moveTarget).toEqual(rallyDest);
  });

  it('unidade produzida recebe ordem: tropa militar recém-treinada em Quartel recebe ordem de movimento ao rally point', () => {
    const sim = new Simulation(42);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);
    const rallyDest: [number, number] = [48, 100];

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: rallyDest,
    });

    sim.teams.blue.coins = 500;
    sim.teams.blue.wood = 500;

    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    });

    // Avança tempo de produção do soldado (5 segundos)
    advanceSeconds(sim, BALANCE.units.soldier.productionSeconds);

    const soldier = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
    expect(soldier).toBeDefined();
    if (!soldier || !isUnitEntity(soldier)) throw new Error('Soldier entity missing');
    expect(soldier.moveTarget).toEqual(rallyDest);
  });

  it('se rally point não existir: unidade recém-treinada permanece parada na célula de spawn', () => {
    const sim = new Simulation(42);
    const house = sim.entities.createBuilding('blue', 'house', 30, 100);

    // Sem rally point
    expect(house.rallyPoint).toBeNull();

    sim.teams.blue.coins = 500;
    sim.teams.blue.wood = 500;

    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });

    advanceSeconds(sim, BALANCE.units.worker.productionSeconds);

    const worker = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'worker' && e.id === 'blue-worker-3');
    expect(worker).toBeDefined();
    if (!worker || !isUnitEntity(worker)) throw new Error('Worker entity missing');
    expect(worker.moveTarget).toBeNull();
  });

  it('pathfinding: unidade despachada para o rally point desvia de obstáculos no mapa', () => {
    const sim = new Simulation(42);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);
    const rallyDest: [number, number] = [45, 100];

    // Coloca uma barricada entre o quartel e o rally point (ex: em 40, 100)
    sim.entities.createBuilding('blue', 'barricade', 40, 100);

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: rallyDest,
    });

    sim.teams.blue.coins = 500;
    sim.teams.blue.wood = 500;

    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    });

    advanceSeconds(sim, BALANCE.units.soldier.productionSeconds);

    const soldier = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
    expect(soldier).toBeDefined();
    if (!soldier || !isUnitEntity(soldier)) throw new Error('Soldier entity missing');
    expect(soldier.moveTarget).toEqual(rallyDest);

    // Avança o movimento do soldado; ele deve contornar a barricada e chegar ao rally point
    advanceSeconds(sim, 20);
    expect(soldier.x).toBe(rallyDest[0]);
    expect(soldier.y).toBe(rallyDest[1]);
  });

  it('destino inacessível: não trava a simulação e mantém a unidade em segurança sem erro', () => {
    const sim = new Simulation(42);
    const house = sim.entities.createBuilding('blue', 'house', 30, 100);

    // No mapa, em (76, 10) há água bloqueante
    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: house.id,
      point: [76, 10],
    });

    sim.teams.blue.coins = 500;
    sim.teams.blue.wood = 500;

    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: house.id,
      unitKind: 'worker',
    });

    // Simulação não lança exceção e avança sem erro
    expect(() => advanceSeconds(sim, BALANCE.units.worker.productionSeconds + 5)).not.toThrow();

    const worker = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'worker' && e.id === 'blue-worker-3');
    expect(worker).toBeDefined();
  });

  it('construção destruída: remover a construção cancela e limpa o rally point associado', () => {
    const sim = new Simulation(42);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: [50, 100],
    });
    expect(sim.production.getRallyPoint(barracks.id)).toEqual([50, 100]);

    // Destrói / remove a construção (simulando morte em combate ou cancelamento)
    sim.production.cancel(barracks.id);
    expect(sim.production.getRallyPoint(barracks.id)).toBeNull();
    expect(barracks.rallyPoint).toBeNull();
  });

  it('múltiplas unidades consecutivas no mesmo rally point: unidades subsequentes alcançam a formação mesmo com o ponto ocupado', () => {
    const sim = new Simulation(42);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 100);
    const rallyDest: [number, number] = [45, 100];

    sim.issueCommand({
      type: 'set-rally-point',
      team: 'blue',
      buildingId: barracks.id,
      point: rallyDest,
    });

    sim.teams.blue.coins = 2000;
    sim.teams.blue.wood = 2000;

    // Produz primeiro soldado
    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    });
    // Avança tempo de produção (5s) + marcha (10s)
    advanceSeconds(sim, 15);

    const s1 = sim.entities.all().find((e) => e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
    expect(s1).toBeDefined();
    if (!s1 || !isUnitEntity(s1)) throw new Error('Soldier 1 missing');
    // Soldado 1 chegou ao rally point
    expect(s1.x).toBe(rallyDest[0]);
    expect(s1.y).toBe(rallyDest[1]);
    expect(s1.moveTarget).toBeNull();

    // Produz segundo soldado na mesma barraca com o mesmo rally point
    sim.issueCommand({
      type: 'produce',
      team: 'blue',
      buildingId: barracks.id,
      unitKind: 'soldier',
    });
    advanceSeconds(sim, 15);

    const soldiers = sim.entities.all().filter((e): e is import('../entities/EntityStore').UnitEntity =>
      e.category === 'unit' && e.kind === 'soldier' && e.team === 'blue');
    expect(soldiers.length).toBe(2);

    const s2 = soldiers.find((s) => s.id !== s1.id)!;
    expect(s2).toBeDefined();
    // Soldado 2 NÃO ficou travado na barraca (x < 40)
    expect(s2.x).toBeGreaterThan(40);
    // Soldado 2 chegou adjacente ao soldado 1 no rally point
    const distToRally = Math.max(Math.abs(s2.x - rallyDest[0]), Math.abs(s2.y - rallyDest[1]));
    expect(distToRally).toBeLessThanOrEqual(2);
    expect(s2.moveTarget).toBeNull();
  });
});

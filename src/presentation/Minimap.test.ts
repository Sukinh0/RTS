import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/game/Simulation';
import { VisualFog } from './VisualFog';
import { Minimap } from './Minimap';

describe('Fase 9 — Minimapa', () => {
  it('posição proporcional correta: converte coordenadas de clique em células e calcula retângulo de câmera proporcionalmente', () => {
    const sim = new Simulation(1);
    const fog = new VisualFog(sim.map, sim.entities, 'blue');
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    // Teste de cantos e centro do mapa 200x200
    expect(minimap.coordsToCell(0, 0, 200, 200)).toEqual([0, 0]);
    expect(minimap.coordsToCell(100, 100, 200, 200)).toEqual([100, 100]);
    expect(minimap.coordsToCell(199, 199, 200, 200)).toEqual([199, 199]);

    // Teste de escala customizada (ex: minimap renderizado a 250px por 250px)
    expect(minimap.coordsToCell(125, 125, 250, 250)).toEqual([100, 100]);
    expect(minimap.coordsToCell(0, 0, 250, 250)).toEqual([0, 0]);

    // Limites seguros (clamp)
    expect(minimap.coordsToCell(-50, -50, 200, 200)).toEqual([0, 0]);
    expect(minimap.coordsToCell(500, 500, 200, 200)).toEqual([199, 199]);

    // Retângulo de câmera no minimapa
    const cellSize = 12;
    // Câmera cobrindo de (0, 0) até 600px por 400px (50x33.3 células)
    const cameraRect = minimap.cameraToMinimapRect({ x: 0, y: 0, width: 600, height: 400 }, cellSize, 200, 200);
    expect(cameraRect.x).toBe(0);
    expect(cameraRect.y).toBe(0);
    expect(cameraRect.width).toBeCloseTo(50, 1);
    expect(cameraRect.height).toBeCloseTo(33.33, 1);
  });

  it('fog: reflete terreno desconhecido (unknown), explorado (explored) e visível (visible)', () => {
    const sim = new Simulation(2);
    sim.map.setTerrain(100, 20, 'mountain');
    const fog = new VisualFog(sim.map, sim.entities, 'blue');
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    // Célula distante ainda não explorada
    const cellUnknown = minimap.getCell(100, 20);
    expect(cellUnknown.state).toBe('unknown');
    expect(cellUnknown.terrain).toBeNull();

    // Move um operário azul para revelar a célula (100, 20)
    const positions = new Map([['blue-worker-1', { x: 100, y: 20 }]]);
    fog.update(positions);

    const cellVisible = minimap.getCell(100, 20);
    expect(cellVisible.state).toBe('visible');
    expect(cellVisible.terrain).toBe('mountain');

    // Afasta a unidade: a célula passa a 'explored', mantendo memória do terreno conhecido
    positions.set('blue-worker-1', { x: 120, y: 20 });
    fog.update(positions);

    const cellExplored = minimap.getCell(100, 20);
    expect(cellExplored.state).toBe('explored');
    expect(cellExplored.terrain).toBe('mountain');
  });

  it('unidades e construções aliadas aparecem no minimapa', () => {
    const sim = new Simulation(3);
    const fog = new VisualFog(sim.map, sim.entities, 'blue');
    fog.update(new Map());
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    const visible = minimap.getVisibleEntities();
    // Base azul deve estar presente
    const blueBase = visible.find((e) => e.id === 'blue-base');
    expect(blueBase).toBeDefined();
    expect(blueBase?.team).toBe('blue');
    expect(blueBase?.category).toBe('building');
    expect(blueBase?.width).toBe(4);
    expect(blueBase?.height).toBe(4);

    // Operários iniciais azuis devem estar presentes
    const blueWorkers = visible.filter((e) => e.team === 'blue' && e.kind === 'worker');
    expect(blueWorkers.length).toBeGreaterThan(0);
  });

  it('inimigos visíveis vs inimigos ocultos: tropas e construções inimigas só aparecem se atualmente visíveis', () => {
    const sim = new Simulation(4);
    const fog = new VisualFog(sim.map, sim.entities, 'blue');
    fog.update(new Map());
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    // A base vermelha e unidades vermelhas estão no outro lado do mapa (sob fog)
    const initialVisible = minimap.getVisibleEntities();
    expect(initialVisible.some((e) => e.id === 'red-base')).toBe(false);
    expect(initialVisible.some((e) => e.team === 'red')).toBe(false);

    // Spawna um soldado inimigo em uma célula sob o fog (ex: 150, 100)
    const enemySoldier = sim.entities.spawnUnit('red', 'soldier', 150, 100);
    fog.update(new Map());

    // Soldado inimigo oculto NÃO aparece no minimapa
    let visible = minimap.getVisibleEntities();
    expect(visible.some((e) => e.id === enemySoldier.id)).toBe(false);

    // Posiciona um operário azul ao lado do soldado inimigo para revelá-lo
    const positions = new Map([['blue-worker-1', { x: 149, y: 100 }]]);
    fog.update(positions);

    // Agora o soldado inimigo é visível e APARECE no minimapa
    visible = minimap.getVisibleEntities(positions);
    const foundEnemy = visible.find((e) => e.id === enemySoldier.id);
    expect(foundEnemy).toBeDefined();
    expect(foundEnemy?.team).toBe('red');
    expect(foundEnemy?.category).toBe('unit');

    // Se o operário azul se afastar, o soldado inimigo volta a ficar oculto e DESAPARECE do minimapa
    positions.set('blue-worker-1', { x: 30, y: 100 });
    fog.update(positions);
    visible = minimap.getVisibleEntities(positions);
    expect(visible.some((e) => e.id === enemySoldier.id)).toBe(false);
  });

  it('torre de vigilância: reflete visão 20x20 no minimapa e revela inimigos dentro da área', () => {
    const sim = new Simulation(5);
    const fog = new VisualFog(sim.map, sim.entities, 'blue');

    // Constrói uma torre de vigilância em (80, 80)
    const tower = sim.entities.createBuilding('blue', 'tower', 80, 80);
    tower.underConstruction = false;

    // Spawna um soldado inimigo dentro da visão 20x20 da torre (ex: em 86, 86)
    const enemy = sim.entities.spawnUnit('red', 'soldier', 86, 86);

    fog.update(new Map());
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    // A célula na torre e no raio 20x20 deve estar com state 'visible'
    expect(minimap.getCell(86, 86).state).toBe('visible');

    // O soldado inimigo dentro da visão da torre APARECE no minimapa
    const visible = minimap.getVisibleEntities();
    expect(visible.some((e) => e.id === enemy.id)).toBe(true);
  });

  it('batedor inimigo: batedor invisível NÃO aparece; batedor detectado ou sob torre APARECE', () => {
    const sim = new Simulation(6);
    const fog = new VisualFog(sim.map, sim.entities, 'blue');

    // Arqueiro azul em (50, 50) com visão 6
    sim.entities.spawnUnit('blue', 'archer', 50, 50);
    // Batedor inimigo em (56, 50) a distância 6 (> 5 stealthDetectionDistance)
    const enemyScout = sim.entities.spawnUnit('red', 'scout', 56, 50);

    const positions = new Map([['blue-archer-1', { x: 50, y: 50 }], [enemyScout.id, { x: 56, y: 50 }]]);
    fog.update(positions);

    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    // A célula (56, 50) está dentro da visão do arqueiro (visão 6), portanto 'visible'
    expect(minimap.getCell(56, 50).state).toBe('visible');

    // Mas o batedor inimigo possui camuflagem ativa a distância > 5 e NÃO deve aparecer no minimapa
    let visible = minimap.getVisibleEntities(positions);
    expect(visible.some((e) => e.id === enemyScout.id)).toBe(false);

    // Caso 1: Batedor se aproxima para (55, 50) (distância 5 <= stealthDetectionDistance): detectado!
    positions.set(enemyScout.id, { x: 55, y: 50 });
    fog.update(positions);
    visible = minimap.getVisibleEntities(positions);
    expect(visible.some((e) => e.id === enemyScout.id)).toBe(true);

    // Afasta o batedor de volta para distância 6: volta a ficar invisível
    positions.set(enemyScout.id, { x: 56, y: 50 });
    fog.update(positions);
    visible = minimap.getVisibleEntities(positions);
    expect(visible.some((e) => e.id === enemyScout.id)).toBe(false);

    // Caso 2: Torre de Vigilância ativa cobre a área do batedor
    // Torre 2x2 em (52, 48) cobre 20x20 células (halfSpan=9)
    const tower = sim.entities.createBuilding('blue', 'tower', 52, 48);
    tower.underConstruction = false;
    fog.update(positions);
    visible = minimap.getVisibleEntities(positions);
    // Batedor sob o raio da torre perde camuflagem e APARECE no minimapa
    expect(visible.some((e) => e.id === enemyScout.id)).toBe(true);
  });

  it('construções aliadas de diferentes tipos aparecem com suas dimensões proporcionais', () => {
    const sim = new Simulation(7);
    const house = sim.entities.createBuilding('blue', 'house', 30, 95);
    const barracks = sim.entities.createBuilding('blue', 'barracks', 35, 95);
    const barricade = sim.entities.createBuilding('blue', 'barricade', 40, 95);
    const tower = sim.entities.createBuilding('blue', 'tower', 45, 95);

    const fog = new VisualFog(sim.map, sim.entities, 'blue');
    fog.update(new Map());
    const minimap = new Minimap({ map: sim.map, entities: sim.entities, fog, playerTeam: 'blue' });

    const visible = minimap.getVisibleEntities();

    const mHouse = visible.find((e) => e.id === house.id);
    expect(mHouse).toMatchObject({ width: 2, height: 2, team: 'blue' });

    const mBarracks = visible.find((e) => e.id === barracks.id);
    expect(mBarracks).toMatchObject({ width: 3, height: 3, team: 'blue' });

    const mBarricade = visible.find((e) => e.id === barricade.id);
    expect(mBarricade).toMatchObject({ width: 1, height: 1, team: 'blue' });

    const mTower = visible.find((e) => e.id === tower.id);
    expect(mTower).toMatchObject({ width: 2, height: 2, team: 'blue' });

    const mBase = visible.find((e) => e.id === 'blue-base');
    expect(mBase).toMatchObject({ width: 4, height: 4, team: 'blue' });
  });
});


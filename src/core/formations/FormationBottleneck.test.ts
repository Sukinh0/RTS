import { describe, expect, it } from 'vitest';
import { Simulation } from '../game/Simulation';
import { dispatchGroupMove } from '../commands/dispatchGroupMove';

describe('Teste de Gargalos com Formações (Bottlenecks)', () => {
  it('atravessa corredor estreito com grupo de 10 unidades mantendo progressão e sem travar unidades', () => {
    const sim = new Simulation(123);

    // Spawna 10 unidades (escudeiros, soldados e arqueiros)
    const unitIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = sim.instantSpawn('blue', 'shieldbearer', 60 + Math.floor(i / 2), 98 + (i % 2) * 4);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 4; i++) {
      const u = sim.instantSpawn('blue', 'soldier', 58 + Math.floor(i / 2), 97 + (i % 2) * 5);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 2; i++) {
      const u = sim.instantSpawn('blue', 'archer', 56, 99 + i * 2);
      if (u) unitIds.push(u.id);
    }

    expect(unitIds.length).toBe(10);

    // Ordem de marcha em Bloco através do centro para o outro lado (x=115, y=100)
    const dest = [115, 100] as const;
    const results = dispatchGroupMove(sim, 'blue', unitIds, dest, false, 'block');
    expect(results.every((r) => r.result.accepted)).toBe(true);

    const group = sim.formations.getFormationForUnit(unitIds[0]);
    expect(group).toBeDefined();

    // Simula a marcha através do gargalo ao longo de 250 ticks (25 segundos)
    for (let tick = 0; tick < 250; tick++) {
      sim.advance(100);
    }

    // Todas as unidades devem ter atravessado o corredor central (x >= 90)
    const units = unitIds.map((id) => sim.entities.get(id)!);
    const passedBottleneck = units.filter((u) => u.x >= 90).length;

    expect(passedBottleneck).toBe(units.length);
  });

  it('funila grupo de 20 tropas em formação de Linha através de um gargalo estrito de largura 2 e reagrupa do outro lado', () => {
    const sim = new Simulation(456);

    // Cria uma barreira vertical rígida em x=70 com abertura estrita de 2 tiles: y=99 e y=100
    for (let y = 80; y <= 120; y++) {
      if (y !== 99 && y !== 100) {
        sim.map.setTerrain(70, y, 'mountain');
      }
    }

    // Spawna 20 unidades militares em x=55..62, y=95..105
    const unitIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const u = sim.instantSpawn('blue', 'shieldbearer', 60 + Math.floor(i / 4), 96 + (i % 4) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 8; i++) {
      const u = sim.instantSpawn('blue', 'soldier', 58 + Math.floor(i / 4), 96 + (i % 4) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 4; i++) {
      const u = sim.instantSpawn('blue', 'archer', 56, 97 + i * 2);
      if (u) unitIds.push(u.id);
    }
    expect(unitIds.length).toBe(20);

    // Ordem de marcha em Linha atravessando o gargalo de largura 2 em direção a x=85, y=100
    const dest = [85, 100] as const;
    const results = dispatchGroupMove(sim, 'blue', unitIds, dest, false, 'line');
    expect(results.every((r) => r.result.accepted)).toBe(true);

    const group = sim.formations.getFormationForUnit(unitIds[0]);
    expect(group).toBeDefined();

    // Simula a passagem do grupo de 20 tropas pelo gargalo estrito (400 ticks = 40s)
    let maxCongestionTickDuration = 0;
    for (let tick = 0; tick < 400; tick++) {
      const start = performance.now();
      sim.advance(100);
      const elapsed = performance.now() - start;
      if (elapsed > maxCongestionTickDuration) {
        maxCongestionTickDuration = elapsed;
      }
    }

    // Mede quantas unidades conseguiram passar pela fenda de 2 tiles em x=70
    const units = unitIds.map((id) => sim.entities.get(id)!);
    const crossed = units.filter((u) => u.x > 70).length;

    console.log(`[Teste Gargalo 20 Unidades - Linha] Unidades que cruzaram o gargalo de 2 tiles: ${crossed}/${units.length}`);
    console.log(`[Teste Gargalo 20 Unidades - Desempenho] Pior tick: ${maxCongestionTickDuration.toFixed(2)}ms`);

    expect(crossed).toBe(20);
    // Em carga paralela, a simulação permanece estável e sem travar
    expect(maxCongestionTickDuration).toBeLessThan(150);
  });

  it('gerencia coluna dupla (double-column) e cunha (wedge) em gargalos sem perda de unidades', () => {
    const sim = new Simulation(789);

    // Gargalo em x=70 com abertura em y=99..101 (3 tiles de largura)
    for (let y = 85; y <= 115; y++) {
      if (y < 99 || y > 101) {
        sim.map.setTerrain(70, y, 'water');
      }
    }

    // Spawna 16 tropas em cunha
    const unitIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const u = sim.instantSpawn('blue', 'shieldbearer', 60 + Math.floor(i / 3), 98 + (i % 3) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 6; i++) {
      const u = sim.instantSpawn('blue', 'soldier', 58 + Math.floor(i / 3), 98 + (i % 3) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 4; i++) {
      const u = sim.instantSpawn('blue', 'archer', 56, 98 + i);
      if (u) unitIds.push(u.id);
    }

    const results = dispatchGroupMove(sim, 'blue', unitIds, [85, 100], false, 'wedge');
    expect(results.every((r) => r.result.accepted)).toBe(true);

    for (let tick = 0; tick < 350; tick++) {
      sim.advance(100);
    }

    const units = unitIds.map((id) => sim.entities.get(id)!);
    const crossed = units.filter((u) => u.x > 70).length;
    expect(crossed).toBe(16);
  });

  it('suporta grupo grande de 40 unidades em gargalo sem travamento nem degradação severa de tick', () => {
    const sim = new Simulation(999);

    // Gargalo em x=70 com abertura de 3 tiles em y=99..101
    for (let y = 80; y <= 120; y++) {
      if (y < 99 || y > 101) {
        sim.map.setTerrain(70, y, 'mountain');
      }
    }

    // Spawna 40 tropas militares (15 escudeiros, 15 soldados, 10 arqueiros)
    const unitIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const u = sim.instantSpawn('blue', 'shieldbearer', 58 + Math.floor(i / 5), 95 + (i % 5) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 15; i++) {
      const u = sim.instantSpawn('blue', 'soldier', 54 + Math.floor(i / 5), 95 + (i % 5) * 2);
      if (u) unitIds.push(u.id);
    }
    for (let i = 0; i < 10; i++) {
      const u = sim.instantSpawn('blue', 'archer', 51 + Math.floor(i / 5), 96 + (i % 5) * 2);
      if (u) unitIds.push(u.id);
    }
    expect(unitIds.length).toBe(40);

    const dest = [90, 100] as const;
    const results = dispatchGroupMove(sim, 'blue', unitIds, dest, false, 'block');
    expect(results.every((r) => r.result.accepted)).toBe(true);

    sim.setDiagnostics(true);
    let maxTickDurationMs = 0;
    let totalSimTimeMs = 0;
    const ticks = 1350;
    for (let tick = 0; tick < ticks; tick++) {
      const t0 = performance.now();
      sim.advance(33.34);
      const dt = performance.now() - t0;
      totalSimTimeMs += dt;
      if (dt > maxTickDurationMs) {
        maxTickDurationMs = dt;
      }
    }

    const units = unitIds.map((id) => sim.entities.get(id)!);
    const crossed = units.filter((u) => u.x > 70).length;
    const avgTickMs = totalSimTimeMs / ticks;

    expect(crossed).toBe(40);
    expect(avgTickMs).toBeLessThan(10);
    expect(maxTickDurationMs).toBeLessThan(250);
  });
});

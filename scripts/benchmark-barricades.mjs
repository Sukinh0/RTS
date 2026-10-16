import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `export { Simulation } from './src/core/game/Simulation';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { Simulation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function measureScenario(name, setupFn, actionFn, ticks = 300) {
  const sim = new Simulation(42, false);
  sim.teams.blue.wood = 5000;
  sim.teams.blue.stone = 5000;
  sim.teams.blue.coins = 5000;
  sim.construction.instantBuild = false;

  setupFn(sim);

  const startCmd = performance.now();
  actionFn(sim);
  const cmdMs = performance.now() - startCmd;

  const tickTimes = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    sim.advance(33.33);
    tickTimes.push(performance.now() - t0);
  }

  const avgTickMs = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;
  tickTimes.sort((a, b) => a - b);
  const p95TickMs = tickTimes[Math.floor(tickTimes.length * 0.95)];
  const maxTickMs = tickTimes[tickTimes.length - 1];

  console.log(`${name}: avg ${avgTickMs.toFixed(3)}ms | p95 ${p95TickMs.toFixed(3)}ms | max ${maxTickMs.toFixed(3)}ms | cmd ${cmdMs.toFixed(3)}ms`);
  return { avgTickMs, p95TickMs, maxTickMs, cmdMs };
}

console.log('--- BENCHMARK DE CONSTRUÇÃO DE BARRICADAS (V1.1.2) ---');

// 1. Partida sem construção
measureScenario('1. Partida sem construção', () => {}, () => {});

// 2. Construção de 1 barricada
measureScenario('2. Construção de 1 barricada', 
  (sim) => {
    return sim.entities.spawnUnit('blue', 'builder', 24, 94);
  },
  (sim) => {
    const builder = sim.entities.all().find(e => e.kind === 'builder');
    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells: [[24, 95]],
    });
  }
);

// 3. Linha de 10 barricadas
measureScenario('3. Linha de 10 barricadas', 
  (sim) => {
    return sim.entities.spawnUnit('blue', 'builder', 24, 90);
  },
  (sim) => {
    const builder = sim.entities.all().find(e => e.kind === 'builder');
    const cells = [];
    for (let i = 0; i < 10; i++) cells.push([25 + i, 90]);
    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
  }
);

// 4. Linha de 30 barricadas
measureScenario('4. Linha de 30 barricadas', 
  (sim) => {
    return sim.entities.spawnUnit('blue', 'builder', 24, 85);
  },
  (sim) => {
    const builder = sim.entities.all().find(e => e.kind === 'builder');
    const cells = [];
    for (let i = 0; i < 30; i++) cells.push([25 + i, 85]);
    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
  }
);

// 5. Linha próxima do limite (90 barricadas)
measureScenario('5. Linha próxima do limite (90 barricadas)', 
  (sim) => {
    return sim.entities.spawnUnit('blue', 'builder', 24, 80);
  },
  (sim) => {
    const builder = sim.entities.all().find(e => e.kind === 'builder');
    const cells = [];
    for (let i = 0; i < 90; i++) cells.push([25 + i, 80]);
    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
  }
);

// 6. Construção durante movimentação de tropas (30 tropas)
measureScenario('6. Construção durante movimentação (30 tropas)', 
  (sim) => {
    sim.entities.spawnUnit('blue', 'builder', 24, 75);
    const army = [];
    for (let i = 0; i < 30; i++) {
      army.push(sim.entities.spawnUnit('blue', 'soldier', 20 + (i % 6), 50 + Math.floor(i / 6)));
    }
    // Issue move to army
    for (const soldier of army) {
      sim.issueCommand({
        type: 'move',
        team: 'blue',
        unitId: soldier.id,
        destination: [soldier.x + 30, soldier.y + 20],
      });
    }
  },
  (sim) => {
    const builder = sim.entities.all().find(e => e.kind === 'builder');
    const cells = [];
    for (let i = 0; i < 20; i++) cells.push([25 + i, 75]);
    sim.issueCommand({
      type: 'build-line',
      team: 'blue',
      builderId: builder.id,
      buildingKind: 'barricade',
      cells,
    });
  }
);

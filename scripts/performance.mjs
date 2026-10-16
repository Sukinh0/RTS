import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The identical harness can run against the captured, unmodified engine.
const args = process.argv.slice(2);
const label = args.find(a => a.startsWith('--label='))?.split('=')[1] ?? 'optimized';
const out = 'reports/performance';
await mkdir(out, { recursive: true });
const bundle = await build({ stdin: { contents: `
export { Simulation } from './src/core/game/Simulation';
export { dispatchGroupMove } from './src/core/commands/dispatchGroupMove';
export { VisualFog } from './src/presentation/VisualFog';
export { BALANCE } from './src/config/balance';
export { findPath } from './src/map/findPath';`, resolveDir: process.cwd() },
bundle: true, platform: 'node', format: 'esm', write: false });
let source = bundle.outputFiles[0].text;
if (args.includes('--capture')) await writeFile(`${out}/baseline-engine.txt`, source);
if (args.includes('--baseline')) source = await readFile(`${out}/baseline-engine.txt`, 'utf8');
const { Simulation, dispatchGroupMove, VisualFog, BALANCE, findPath } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const sizes = (args.find(a => a.startsWith('--sizes='))?.split('=')[1] ?? '10,25,50,100,200,500').split(',').map(Number);
const repeats = Number(args.find(a => a.startsWith('--repeats='))?.split('=')[1] ?? 3);
const ticks = Number(args.find(a => a.startsWith('--ticks='))?.split('=')[1] ?? 60);
const scenarios = ['idle', 'move', 'paths', 'combat', 'formation', 'bottleneck', 'churn', 'ai'];
const summary = values => {
  const sorted = [...values].sort((a,b) => a-b);
  return { meanMs: values.reduce((a,b) => a+b,0) / values.length, p95Ms: sorted[Math.ceil(sorted.length*.95)-1], maxMs: sorted.at(-1) };
};
function fixture(count, scenario) {
  const sim = new Simulation(123);
  for (const e of sim.entities.all()) if (e.category === 'unit') sim.entities.remove(e.id);
  // Isolated stress fixture only. The shipped balance file is never changed.
  BALANCE.map.unitCapPerTeam = Math.max(60, count);
  const units = [];
  for (let i=0;i<count;i++) {
    const team = i%2 ? 'red' : 'blue';
    const j = Math.floor(i/2);
    const x = (team === 'blue' ? 30 : scenario === 'combat' ? 31 : 140) + (j%10)*2;
    const y = 30 + Math.floor(j/10)*2;
    units.push(sim.entities.spawnUnit(team, i%3 === 0 ? 'archer' : 'soldier', x, y));
  }
  if (scenario === 'bottleneck') {
    for (let y=0;y<sim.map.height;y++) if (y !== 100 && y !== 101) sim.map.setTerrain(80,y,'mountain');
  }
  sim.fog.update();
  if (scenario === 'ai') { sim.enableAI('blue'); sim.enableAI('red'); }
  return { sim, units };
}
function run(count, scenario, tickCount) {
  const { sim, units } = fixture(count, scenario);
  const visual = new VisualFog(sim.map,sim.entities,'blue');
  const positions = new Map();
  const systems = {};
  for (const key of ['movement','fog','economy','construction','production','engagements','formations','combat']) {
    const original = sim[key].update.bind(sim[key]);
    systems[key] = { calls:0, totalMs:0 };
    sim[key].update = (...a) => {
      const t = performance.now();
      try { return original(...a); } finally { systems[key].calls++; systems[key].totalMs += performance.now()-t; }
    };
  }
  const commandsStart = performance.now();
  if (['move','formation','bottleneck'].includes(scenario)) {
    for (const team of ['blue','red']) dispatchGroupMove(sim,team,units.filter(u=>u.team===team).map(u=>u.id),
      [team==='blue'?110:60,50], false, scenario==='formation'?'block':undefined);
  }
  if (scenario==='paths') for (const u of units) findPath(sim.map,[u.x,u.y],[u.team==='blue'?110:60,50],(x,y)=>sim.entities.isFreeForUnit(x,y,u.id));
  const commandMs = performance.now()-commandsStart;
  const samples = [], visualSamples = [];
  const longTicks = [];
  const heapStart = process.memoryUsage().heapUsed;
  for(let tick=0;tick<tickCount;tick++) {
    const t=performance.now();
    const movementBefore = systems.movement.totalMs;
    if(scenario==='churn') {
      const u=units[tick%units.length];
      sim.entities.remove(u.id);
      units[tick%units.length]=sim.entities.spawnUnit(u.team,u.kind,u.x,u.y);
    }
    sim.advance(1000/30);
    sim.movement.drainEvents(); sim.movement.drainFailures(); sim.combat.drainEvents(); sim.map.drainDirtyCells();
    const elapsed = performance.now()-t;
    samples.push(elapsed);
    if (elapsed > 16) longTicks.push({tick,elapsedMs:elapsed,movementMs:systems.movement.totalMs-movementBefore});
    const v=performance.now(); visual.update(positions); visual.drainDirtyTerrain(); visualSamples.push(performance.now()-v);
  }
  const state = sim.entities.all().map(e=>[e.id,e.x,e.y,e.hp,e.category==='unit'?e.moveTarget:null]);
  return { count, scenario, ticks:tickCount, commandMs, simulation:summary(samples), visualFog:summary(visualSamples), systems,
    longTicks,
    heapDeltaBytes:process.memoryUsage().heapUsed-heapStart, activeEntities:state.length,
    checksum:createHash('sha256').update(JSON.stringify(state)).digest('hex') };
}
const caseArg = args.find(a => a.startsWith('--case='));
if (caseArg) {
  run(10,'move',60); // JIT warmup, excluded
  const [count,scenario] = caseArg.split('=')[1].split(',');
  console.log(JSON.stringify(run(Number(count), scenario, ticks)));
  process.exit(0);
}
const results=[];
const report = () => writeFile(`${out}/${label}.json`,JSON.stringify({label,date:new Date().toISOString(),environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemory:os.totalmem()},method:{ticks,repeats,seed:123,productionCap:60,stressCapOverride:true,caseTimeoutMs:30000,rendering:'VisualFog only; no GPU, no FPS measurement'},results},null,2));
for (const count of sizes) for(const scenario of scenarios) for(let repeat=0;repeat<repeats;repeat++) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/performance.mjs', ...args.filter(a=>a!=='--capture'), `--case=${count},${scenario}`], { timeout:30000, maxBuffer:10*1024*1024 });
    const result=JSON.parse(stdout); results.push({...result,repeat});
    console.log(`${label} ${count} ${scenario} #${repeat+1}: tick ${result.simulation.meanMs.toFixed(2)}ms p95 ${result.simulation.p95Ms.toFixed(2)}ms command ${result.commandMs.toFixed(1)}ms`);
  } catch (error) {
    if (!error.killed) throw error;
    results.push({ count, scenario, repeat, timeout:true });
    console.log(`${label} ${count} ${scenario} #${repeat+1}: TIMEOUT 30s (no performance estimate)`);
  }
  await report();
}

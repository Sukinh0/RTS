import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

if (!global.gc) throw new Error('Run with node --expose-gc scripts/performance-memory.mjs');
const { outputFiles } = await build({ entryPoints:['src/core/game/Simulation.ts'],bundle:true,platform:'node',format:'esm',write:false });
const { Simulation } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const sim = new Simulation(123);
const units = [];
for (let i=0;i<50;i++) units.push(sim.entities.spawnUnit(i%2?'red':'blue','soldier',(i%2?140:30)+Math.floor(i/2)%10,30+Math.floor(i/20)));
const samples=[];
for(let batch=0;batch<11;batch++) {
  if(batch>0) for(let i=0;i<1000;i++) {
    const index=i%units.length,u=units[index];
    sim.movement.cancel(u.id); sim.combat.cancel(u.id); sim.entities.remove(u.id);
    units[index]=sim.entities.spawnUnit(u.team,u.kind,u.x,u.y);
    sim.advance(1000/30);
    sim.movement.drainEvents(); sim.movement.drainFailures(); sim.combat.drainEvents(); sim.map.drainDirtyCells();
  }
  global.gc();
  const sample={replacements:batch*1000,heapUsedBytes:process.memoryUsage().heapUsed,externalBytes:process.memoryUsage().external,entities:sim.entities.all().length};
  samples.push(sample); console.log(sample);
}
await mkdir('reports/performance',{recursive:true});
await writeFile('reports/performance/memory-soak.json',JSON.stringify({date:new Date().toISOString(),node:process.version,seed:123,explicitGC:true,scope:'Headless entity replacement; not a GPU or hidden-enemy memory test',samples},null,2));

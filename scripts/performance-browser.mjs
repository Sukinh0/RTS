import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

const url = process.argv.find(a=>a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:4173';
const label = process.argv.find(a=>a.startsWith('--label='))?.slice(8) ?? 'browser';
// Each load uses a distinct population per team. Defaults cover the game's intended density.
const loadArg = process.argv.find(a => a.startsWith('--units-per-team='))?.slice(17);
const loads = loadArg ? loadArg.split(',').map(Number) : [20, 40, 60];
if (loads.length === 0 || loads.some(n => !Number.isInteger(n) || n < 1 || n > 60)) {
  throw new Error('Expected --units-per-team=20,40,60 (each value 1..60)');
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let gpu = null;
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
try {
  for (const unitsPerTeam of loads) for (const scenario of ['idle', 'move', 'formation', 'combat', 'churn']) {
    await page.goto(`${url}/?noai=1&perf=1&sandbox=1`);
    await page.waitForSelector('#game[data-ready="true"]');
    if (gpu === null) gpu = await page.evaluate(() => {
      const canvas = document.querySelector('#game canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      if (!gl) return { renderer: 'Canvas 2D' };
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    });
    await page.evaluate(() => {
      const sim = window.__simulation;
      for (const entity of sim.entities.all()) if (entity.category === 'unit') sim.entities.remove(entity.id);
    });
    await page.evaluate(({ scenario, unitsPerTeam }) => {
      const sim = window.__simulation;
      for (let i=0;i<unitsPerTeam*2;i++) {
        const j=Math.floor(i/2), team=i%2?'red':'blue';
        sim.entities.spawnUnit(team, i%3===0?'archer':'soldier', (team==='blue'?30:scenario==='combat'?31:55)+(j%10)*2, 92+Math.floor(j/10)*2);
      }
      sim.fog.update();
    }, { scenario, unitsPerTeam });
    await page.locator('#sb-reveal-map').check();
    await page.evaluate(() => new Promise(resolve => {
      let frames=60;
      function warmup() { if (--frames===0) resolve(); else requestAnimationFrame(warmup); }
      requestAnimationFrame(warmup);
    }));
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable');
    const heapBefore=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    const result=await page.evaluate(async scenario => {
      const sim=window.__simulation;
      window.rtsPerformance.reset();
      const units=sim.entities.all().filter(e=>e.category==='unit');
      const start=performance.now();
      if (scenario==='move' || scenario==='formation') {
        for (const team of ['blue','red']) {
          const own=units.filter(u=>u.team===team);
          if (scenario==='formation') sim.formations.createFormation(team,own.map(u=>u.id),'block',[team==='blue'?65:35,100]);
          else for (const u of own) sim.issueCommand({type:'move',team,unitId:u.id,destination:[u.x+(team==='blue'?22:-22),u.y+8]});
        }
      }
      const commandMs=performance.now()-start;
      let created=0;
      const memorySamples=[];
      await new Promise(resolve=> {
        function frame() {
          if (scenario==='churn') {
            const u=units[created%units.length];
            if(sim.entities.get(u.id)) {
              sim.movement.cancel(u.id); sim.combat.cancel(u.id); sim.entities.remove(u.id);
              units[created%units.length]=sim.entities.spawnUnit(u.team,u.kind,u.x,u.y);
              created++;
            }
          }
          if(performance.now()-start>=5000) resolve();
          else { if(memorySamples.length<Math.floor((performance.now()-start)/1000)) memorySamples.push(window.rtsPerformance.snapshot().heapUsedBytes); requestAnimationFrame(frame); }
        }
        requestAnimationFrame(frame);
      });
      const snapshot=window.rtsPerformance.snapshot();
      window.rtsPerformance.setEnabled(false);
      return {scenario,commandMs,created,memorySamples,...snapshot};
    },scenario);
    const {profile}=await cdp.send('Profiler.stop');
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value;
    await mkdir('reports/performance',{recursive:true});
    await writeFile(`reports/performance/${label}-${unitsPerTeam}v${unitsPerTeam}-${scenario}.cpuprofile`,JSON.stringify(profile));
    results.push({unitsPerTeam,...result,heapBeforeGCBytes:heapBefore,heapAfterGCBytes:heapAfter});
    console.log(`${unitsPerTeam}v${unitsPerTeam} ${scenario}: ${result.fps?.toFixed(1)} FPS, p95 ${result.metrics.frameInterval?.p95Ms.toFixed(1)}ms, max ${result.metrics.frameInterval?.maxMs.toFixed(1)}ms`);
    await cdp.detach();
  }
  await page.screenshot({path:`reports/performance/${label}.png`});
  await writeFile(`reports/performance/${label}.json`,JSON.stringify({date:new Date().toISOString(),cpu:os.cpus()[0].model,gpu,browser:browser.version(),viewport:{width:1440,height:1000},durationMs:5000,unitsPerTeam:loads,headless:true,instrumented:true,errors,results},null,2));
} finally { await browser.close(); }
if(errors.length) throw new Error(errors.join('\n'));

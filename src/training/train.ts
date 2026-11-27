import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { BALANCE } from '../config/balance';
import { createState, runGeneration, type RunMatches, type TrainingConfig, type TrainingState } from './evolution';
import { GENES } from './genome';
import { playMatch, type MatchJob, type MatchOutcome } from './match';
import { renderReport } from './report';

if (!isMainThread) {
  parentPort!.on('message', ({ id, job }: { id: number; job: MatchJob }) => {
    parentPort!.postMessage({ id, outcome: playMatch(job) });
  });
}

function createPool(script: string, size: number, onProgress: (done: number, total: number) => void) {
  const workers = Array.from({ length: size }, () => new Worker(script));
  const run: RunMatches = (jobs) => new Promise((resolveAll, reject) => {
    const outcomes: MatchOutcome[] = new Array(jobs.length);
    let next = 0;
    let done = 0;
    if (jobs.length === 0) resolveAll(outcomes);
    const feed = (worker: Worker) => {
      if (next < jobs.length) {
        worker.postMessage({ id: next, job: jobs[next] });
        next += 1;
      }
    };
    for (const worker of workers) {
      worker.removeAllListeners();
      worker.on('error', reject);
      worker.on('message', ({ id, outcome }: { id: number; outcome: MatchOutcome }) => {
        outcomes[id] = outcome;
        done += 1;
        onProgress(done, jobs.length);
        if (done === jobs.length) resolveAll(outcomes);
        else feed(worker);
      });
      feed(worker);
    }
  });
  return { run, close: () => Promise.all(workers.map((worker) => worker.terminate())) };
}

/** Writes through a temporary file so stopping the training never leaves half a file. */
async function save(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, content, 'utf8');
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(`${path}.tmp`, path);
      return;
    } catch (error) {
      // Windows refuses to replace a file that another program is reading.
      if (attempt === 10) throw error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

/** A report open in Excel must not end hours of training; only the saved state is essential. */
async function saveOptional(path: string, content: string): Promise<void> {
  await save(path, content).catch(() => console.warn(`\nNão consegui atualizar ${path} (arquivo aberto em outro programa?). Tento de novo na próxima geração.`));
}

interface SavedTraining { balanceVersion: string; genes: string[]; config: TrainingConfig; state: TrainingState }

export async function runCli(args: string[], workerScript: string): Promise<void> {
  const options = new Map(args.map((arg) => {
    const match = /^--(hours|generations|out|workers|population|seeds|promotion-seeds|benchmark-seeds|max-seconds|seed|game-copy)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    return [match[1], match[2]];
  }));
  const positive = (name: string, fallback: number) => {
    const value = Number(options.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`--${name} must be a positive number`);
    return value;
  };
  const hours = positive('hours', 3);
  const generationLimit = positive('generations', 1_000_000);
  const workers = Math.floor(positive('workers', Math.max(1, availableParallelism() - 1)));
  const out = resolve(options.get('out') ?? 'treino-resultados');
  const gameCopy = options.get('game-copy') ?? 'public/ia-treinada.json';
  await mkdir(out, { recursive: true });
  const statePath = join(out, 'estado.json');
  const genes = GENES.map((gene) => gene.key as string);

  let saved: SavedTraining;
  const existing = await readFile(statePath, 'utf8').catch(() => null);
  if (existing !== null) {
    saved = JSON.parse(existing) as SavedTraining;
    if (saved.balanceVersion !== BALANCE.version || saved.genes.join() !== genes.join()) {
      throw new Error('O treino salvo é de outra versão do jogo. Escolha outra pasta com --out ou apague estado.json.');
    }
    console.log(`Continuando da geração ${saved.state.generation} (${saved.state.totalMatches} partidas).`);
  } else {
    saved = {
      balanceVersion: BALANCE.version, genes,
      config: {
        population: Math.floor(positive('population', 24)),
        seedsPerOpponent: Math.floor(positive('seeds', 4)),
        promotionSeeds: Math.floor(positive('promotion-seeds', 40)),
        benchmarkSeeds: Math.floor(positive('benchmark-seeds', 50)),
        maxSeconds: Math.floor(positive('max-seconds', 1200)),
      },
      state: createState(Math.floor(Number(options.get('seed') ?? Date.now() % 4_294_967_296))),
    };
    console.log('Novo treino, partindo da IA atual do jogo.');
  }

  const started = Date.now();
  const elapsed = () => (Date.now() - started) / 1000;
  let lastPrint = 0;
  const pool = createPool(workerScript, workers, (done, total) => {
    if (done === total || Date.now() - lastPrint > 5000) {
      lastPrint = Date.now();
      process.stdout.write(`\r  partidas deste lote: ${done}/${total}   `);
    }
  });
  console.log(`${workers} partidas em paralelo. Tempo previsto: ${hours} h. Pode fechar quando quiser: o progresso é salvo a cada geração.`);
  console.log(`Relatório: ${join(out, 'relatorio.html')}\n`);

  const persist = async (running: boolean) => {
    const { state } = saved;
    await save(statePath, JSON.stringify(saved));
    await saveOptional(join(out, 'relatorio.html'), renderReport(state, elapsed(), running));
    const champion = JSON.stringify({ version: state.championVersion, generation: state.generation, strategy: state.champion }, null, 2);
    await saveOptional(join(out, 'campea.json'), champion);
    if (gameCopy !== 'none') await saveOptional(resolve(gameCopy), champion);
    await saveOptional(join(out, 'historico.csv'), ['geracao;partidas;campea;nova_campea;vitorias_vs_atual;vitorias_vs_antiga',
      ...state.history.map((h) => [h.generation, h.matches, h.championVersion, h.promoted ? 'sim' : 'nao',
        h.benchmark.againstDefault.wins, h.benchmark.againstLegacy.wins].join(';'))].join('\n'));
  };

  try {
    await persist(true);
    for (let count = 0; count < generationLimit && elapsed() < hours * 3600; count += 1) {
      saved.state = await runGeneration(saved.state, saved.config, pool.run);
      await persist(true);
      const record = saved.state.history.at(-1)!;
      const { againstDefault, againstLegacy } = record.benchmark;
      const total = saved.config.benchmarkSeeds * 2;
      console.log(`\rGeração ${record.generation}: ${saved.state.totalMatches} partidas, ${Math.round(elapsed() / 60)} min. `
        + `${record.promoted ? 'NOVA CAMPEÃ. ' : ''}Campeã v${record.championVersion}: ${againstDefault.wins}/${total} contra a atual, ${againstLegacy.wins}/${total} contra a antiga.`);
    }
    await persist(false);
    console.log('\nTreino concluído. Abra o relatorio.html para ver o resultado.');
  } finally {
    await pool.close();
  }
}

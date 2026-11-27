/**
 * `?seed=N` reproduz uma partida (testes e depuração). Sem o parâmetro,
 * cada partida sorteia uma seed, variando a abertura da IA.
 */
export function resolveMatchSeed(search: string, random: () => number = Math.random): number {
  const raw = new URLSearchParams(search).get('seed');
  if (raw !== null && raw.trim() !== '') {
    const seed = Number(raw);
    if (Number.isSafeInteger(seed)) return seed;
  }
  return Math.floor(random() * 1_000_000);
}

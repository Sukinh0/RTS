# RTS V1.1.3 — Diagnóstico ofensivo e gate de qualidade

## Por que este incremento existe
O relatório versionado `reports/simulation-100games-seed123.md` registra 100 empates,
nenhum ataque e nenhum dano em partidas IA vs IA de 900 segundos. Os testes unitários
existentes mostram que a IA emite ordens em cenários artificiais, mas não explicam
o que acontece entre a ordem e um confronto partindo dos recursos iniciais.

## Reprodução
```bash
npm ci
npm run diagnose:ai -- --seed=123 --seconds=900 --interval=120
npm run simulate -- --games=10 --seed=123 --out=reports
```

O diagnóstico emite uma linha JSON por intervalo com:
- efetivos militares, posições e destinos de movimento de cada equipe;
- última intenção/ação da IA;
- quantidade de soldados que cruzaram a metade do mapa;
- posição mais avançada que a tropa atingiu durante a partida;
- falhas de movimentação, ataques e segundo do primeiro confronto.

Compare `furthestBlue` e `furthestRed` com os destinos de marcha.
Se ambos permanecerem próximos da própria base, investigar lançamento da leva,
comandos recusados, rota bloqueada e congestionamento. Se tropas avançarem
e não atacarem, investigar visibilidade, alvos válidos e engajamento.

## Quality gate
`.github/workflows/quality.yml` executa lint, typecheck, Vitest, build,
Playwright e diagnóstico nas PRs para a main.

**Não considerar a IA corrigida só porque a CI está verde.**
O diagnóstico é observabilidade, não um critério de combate;
os números só podem ser transformados em metas depois de reproduzir a causa.

## Próxima correção
1. Reproduzir a partida e inspecionar o JSON de telemetria.
2. Escrever teste de regressão para o comportamento específico.
3. Corrigir a causa sem dar recursos, visão ou bônus artificiais à IA.
4. Reexecutar seeds pareadas e verificar combate, vencedores, duração e performance.

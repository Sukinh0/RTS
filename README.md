# RTS V1 — Starter Pack

Pacote consolidado para iniciar a implementação da primeira versão jogável do RTS.

## Objetivo da V1
Entregar uma partida completa e testável no navegador:

**iniciar partida → explorar → gerar recursos → coletar madeira → construir → produzir unidades → combater → jogar contra IA → destruir/perder a base → tela de resultado.**

A V1 prioriza **jogabilidade, regras, IA e testabilidade**. O visual é propositalmente minimalista, top-down, baseado em grade/pixels coloridos.

## Stack recomendada
- TypeScript
- Phaser 3
- Vite
- Vitest
- Playwright

Regra arquitetural principal: **a simulação do jogo NÃO deve depender do Phaser**. Phaser é camada de renderização/input. Regras, economia, combate, pathfinding, fog e IA ficam em módulos testáveis isoladamente.

## Documentos principais
- `docs/GAME_DESIGN.md` — visão e loop principal
- `docs/GAME_RULES.md` — regras consolidadas da partida
- `docs/BALANCE.md` — números iniciais da V1
- `docs/ECONOMY.md` — moedas, madeira, mina e construção
- `docs/COMBAT_AND_ACTIONS.md` — ações, cooldown e combate
- `docs/FOG_AND_STEALTH.md` — fog, visão e furtividade
- `docs/AI.md` — comportamento da IA
- `docs/ARCHITECTURE.md` — arquitetura técnica
- `docs/TEST_PLAN.md` — suíte mínima obrigatória
- `docs/IMPLEMENTATION_PLAN.md` — ordem de implementação
- `docs/ACCEPTANCE_CRITERIA.md` — definição de pronto da V1
- `prompts/MASTER_PROMPT_ASTRA_CODEX.md` — prompt mestre para IA de desenvolvimento
- `config/balance.v1.json` — fonte central de números da V1
- `config/map-test-01.json` — contrato inicial do mapa de teste
- `references/visual_reference.png` — referência visual do protótipo

## Como começar
1. Crie o projeto TypeScript + Phaser + Vite.
2. Copie este pacote para a raiz do repositório.
3. Use `prompts/MASTER_PROMPT_ASTRA_CODEX.md` como instrução inicial para Astra/Codex.
4. Implemente na ordem de `docs/IMPLEMENTATION_PLAN.md`.
5. Nenhuma etapa deve ser considerada concluída sem os testes definidos em `docs/TEST_PLAN.md`.

## Executar a fundação (Fase 0)

Na pasta `rts_v1_pack`:

```sh
npm install
npm run dev
```

Abra o endereço local mostrado pelo Vite. Para verificar o gate:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

O estado de implementação está em `PROGRESS.md`.

Para simular 100 partidas IA vs IA sem abrir o navegador e gerar relatórios em `reports/`:

```sh
npm run simulate -- --games=100 --seed=123
```

O método e a leitura da linha de base estão em `docs/BALANCE_REPORT.md`.

Abra `/?debug=1` para clicar em uma célula e ver suas coordenadas, tipo de terreno e bloqueio. Clique em uma unidade ou base azul para selecionar; arraste com o botão esquerdo para seleção em caixa; use Shift para adicionar ou remover da seleção. Clique com o botão direito para ordenar movimento das unidades selecionadas. Arraste com o botão direito/meio ou use WASD/setas para pan; use a roda do mouse para zoom.

O terreno começa encoberto pela fog; mova os operários para explorar. Células exploradas permanecem descobertas com suas cores normais, enquanto tropas inimigas só aparecem na visão atual de uma unidade ou construção aliada. Clique com o botão direito numa floresta ou mina descoberta para ordenar coleta ou mineração com operários selecionados.

## Princípio da V1
Não balancear excessivamente no papel. Os valores em `balance.v1.json` são a **baseline V0.1** e devem permanecer centralizados em configuração para facilitar playtests e simulações IA vs IA.

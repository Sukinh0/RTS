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

## RTS V1.2 — como avaliar a versão atual

O ramo de estabilização é `fix/v1-2-main-stabilization` ([PR #5](https://github.com/Sukinh0/RTS/pull/5)).
Ele preserva o `MAP_ORGANIC_01`, HUD completo, FX, unidades, construções,
formações e economia já incluídos na `main`, integrando correções de IA.

**Primeiro uso local (arte do jogo):** o pacote oficial Tiny Swords precisa ser
obtido diretamente do [Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords).
Para visualizar sprites na prévia sem publicar os arquivos, clique no botão 🎨
e selecione `Tiny Swords (Free Pack).zip` no navegador. Eles ficam apenas
na memória da aba. A partida reinicia para aplicar as texturas; a página
recarregada perde as texturas importadas. Alternativamente, instale os PNGs
localmente em `external-assets/` e rode `npm run assets:install`, depois
**reinicie o servidor de desenvolvimento**.

O construtor com chapéu cobre usa derivados gerados **somente localmente**
por `python scripts/recolor-builder.py` (requer Pillow). Os 14 PNGs antigos
foram retirados desta branch para não redistribuir arte licenciada.

A CI executa lint, TypeScript, Vitest, torneios IA×IA e Playwright;
os resultados reproduzíveis ficam nos artifacts do GitHub Actions. O build
de prévia (com base `/RTS/`) está disponível para avaliação, mas não
equivale a uma publicação pública automática. Ver
[`docs/MAIN_STABILIZATION_V1_2.md`](docs/MAIN_STABILIZATION_V1_2.md).

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

### Visual provisório Tiny Swords

O jogo usa o pack [Tiny Swords, de Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords) como visual provisório. Coloque o ZIP obtido na página oficial em `external-assets/Tiny Swords (Free Pack).zip` e execute `npm run assets:install` antes de abrir o jogo. O ZIP e os PNGs extraídos ficam fora do Git por restrição de redistribuição do pack; sem eles, o jogo continua executando com formas simples. Mapeamentos, escala, placeholders e licença estão em [docs/ASSET_INTEGRATION.md](docs/ASSET_INTEGRATION.md).

Para simular 100 partidas IA vs IA sem abrir o navegador e gerar relatórios em `reports/`:

```sh
npm run simulate -- --games=100 --seed=123
```

O método e a leitura da linha de base estão em `docs/BALANCE_REPORT.md`.

As correções do playtest de 2026-10-06 e o estado do novo aceite estão em `BACKLOG.md`. O HUD atual é **fullscreen**, com comandos em uma barra inferior e recursos no topo. O mapa em `MAP_ORGANIC_01` é assimétrico e possui oito jazidas de ouro. Cada classe tem cor própria e identificação de equipe.

Abra `/?debug=1` para clicar em uma célula e ver suas coordenadas, tipo de terreno e bloqueio. Clique em uma unidade ou base azul para selecionar; arraste com o botão esquerdo para seleção em caixa; use Shift para adicionar ou remover da seleção. Clique com o botão direito para ordenar movimento, ataque contra um inimigo visível, coleta ou mineração conforme o alvo. Arraste com o botão direito/meio ou use WASD/setas para pan; use a roda do mouse para zoom.

O terreno começa encoberto pela fog; mova os operários para explorar. Células exploradas permanecem descobertas com suas cores normais, enquanto tropas inimigas só aparecem na visão atual de uma unidade ou construção aliada. Clique com o botão direito numa floresta ou mina descoberta para ordenar coleta ou mineração com operários selecionados.

## Princípio da V1
Não balancear excessivamente no papel. Os valores em `balance.v1.json` são a **baseline V0.1** e devem permanecer centralizados em configuração para facilitar playtests e simulações IA vs IA.

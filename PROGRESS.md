# Progresso

## Fase 0 — Fundação: concluída

- Projeto TypeScript, Vite e Phaser criado neste diretório.
- Vitest e Playwright configurados.
- `config/balance.v1.json` importado como fonte central dos valores de jogo.
- Relógio de passo fixo e RNG com seed implementados no core sem dependência de Phaser ou DOM.
- Cena Phaser inicial conectada ao relógio da simulação; jogo abre no navegador.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 5 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: teste de abertura no navegador passou.

## Fase 1 — Grid, mapa e câmera: concluída

- Grid lógico 200 × 200 com água, montanhas, florestas e minas; terreno simétrico definido em `config/map-test-01.json`.
- Bases iniciais ocupam footprints bloqueados. Água e montanha bloqueiam; floresta e mina são transitáveis para as próximas fases.
- Três corredores atravessam os bloqueios centrais.
- Renderização minimalista em Phaser, com pan por arrasto direito/meio ou teclado e zoom pela roda do mouse.
- `?debug=1` permite clicar em células para ver coordenadas, terreno, bloqueio e base.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 10 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 2 testes passaram (navegação e inspeção no navegador).
- Prévia visual inspecionada em navegador.

## Fase 2 — Entidades e seleção: concluída

- Core cria 1 base e 2 operários por equipe com IDs estáveis, ownership e atributos provenientes do balanceamento central.
- Clique seleciona unidade ou base azul; arrasto esquerdo seleciona operários em caixa; Shift alterna a seleção por clique ou adiciona por caixa. Entidades vermelhas não entram na seleção azul.
- Destaque visual para a seleção e HUD com recursos iniciais, população, quantidade selecionada, HP e coordenadas.
- Pan por arrasto usa botão direito/meio para coexistir com seleção em caixa.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 18 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 3 testes passaram, incluindo seleção e HUD no navegador.
- Prévia visual inspecionada em navegador.

## Fase 3 — Movimento: concluída

- `MoveCommand` é a API de ordem compartilhável por jogador e IA. O core valida ownership, disponibilidade, destino, ocupação e caminho.
- A* determinístico com oito direções, rota alternativa e bloqueio de diagonais que cruzariam quinas fechadas.
- Cada ação percorre no máximo o movimento configurado para a unidade. O cooldown vem do balanceamento central; ordens distantes continuam por segmentos após cada cooldown.
- Clique direito envia ordem de movimento às unidades selecionadas. Grupos recebem destinos distintos próximos ao ponto indicado. HUD mostra destino e cooldown.
- `DECISIONS_NEEDED.md` registra interpretações provisórias onde a regra não define duração visual ou continuação de ordens.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 28 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 4 testes passaram, incluindo movimento e cooldown no navegador.

## Fase 4 — Fog, visão e furtividade: concluída

- Fog por equipe com estados desconhecida, explorada e visível; raio de visão vem da configuração de cada unidade ou construção.
- Terreno descoberto e construções vistas permanecem na memória. Tropas inimigas só aparecem enquanto forem observáveis; o batedor exige também um inimigo próximo para ser detectado.
- API de observação do core retorna cópias dos dados permitidos, sem referências mutáveis a entidades ocultas.
- Phaser desenha fog e memória visual; HUD e debug exibem estado de visão. O movimento visual agora interpola cada célula da rota, preservando o passo lógico e o cooldown.
- Correção posterior: terreno explorado permanece totalmente descoberto; somente áreas nunca vistas recebem cobertura. Tropas inimigas continuam ocultas fora da visão atual de unidades ou construções.
- `DECISIONS_NEEDED.md` registra o valor inicial escolhido para visão de construções e a métrica de distância.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 33 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 4 testes passaram, incluindo verificação de movimento visual suave e exploração da fog.
- Prévia visual inspecionada em navegador.

## Fase 5 — Economia: concluída

- Operários livres geram moedas por segundo conforme `balance.v1.json`.
- Ordens de mina usam trabalhadores com timers individuais, limite de quatro por mina, pagamento após 30 segundos completos e perda do progresso em interrupções.
- Ordens de floresta fazem o operário coletar até a capacidade, voltar à base, depositar e repetir o trajeto.
- Comandos de trabalho passam pela mesma API de comandos que movimento, validam ownership, cooldown, terreno descoberto e rota. HUD mostra recursos, carga e atividade.
- A fog mantém todo terreno descoberto em sua aparência normal, sem expor tropas inimigas fora da visão de unidades ou construções aliadas.

### Gate

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 40 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 4 testes passaram, incluindo renda passiva no HUD e inspeção de célula explorada.

## Fase 6 — Construção e Produção (+ Recurso Limitado de Floresta): concluída

- **Exaustão de floresta**: células de floresta são consumidas e transformam-se em terreno plano (`plain`) quando o operário completa a carga de 20 madeiras. Ao retornar do depósito na base, se a célula original estiver esgotada, o operário busca automaticamente a floresta mais próxima em um raio de 16 células e continua a extração sem intervenção manual.
- **Sistema de construção**: validação de placement com checagem de custos (Casa: 150m/100w; Quartel: 200m/120w), células de terreno plano, fog explorada pela equipe, footprint livre e perímetro acessível. Reserva e bloqueio de footprint (`occupyStructure`), deslocamento do operário ao perímetro adjacente e timers de construção progressivos (Casa: 8s, Quartel: 12s) até ativação da estrutura e expansão da visão.
- **Sistema de produção**: filas sequenciais por edifício com custo deduzido no agendamento. Casa treina operários (150m, 6s); Quartel treina soldados (100m, 5s), arqueiros (180m, 7s), escudeiros (150m, 7s) e batedores (200m, 6s). Spawning no perímetro livre e limite global rígido de 60 unidades por equipe.
- **Interface e HUD**: barra de ações contextual (#action-bar) para operários e edifícios, fantasma de posicionamento com feedback visual em tempo real (verde/vermelho), cancelamento por botão direito e atualização reativa estável do DOM evitando desanexação de botões durante cliques.

### Gate

- `npm run lint`: passou (0 erros, 0 avisos).
- `npm run typecheck`: passou (0 erros).
- `npm test`: 49 testes passaram (10 suítes de testes unitários).
- `npm run build`: passou.
- `npm run test:e2e`: 5 testes passaram (navegação, debug de célula, HUD e seleção múltipla, movimento/cooldown, e construção + produção ponta a ponta no Chromium).

## Fase 7 — Combate e atributos das tropas: concluída

- **Sistema de Combate (`CombatSystem`)**: motor desacoplado com execução de ações discretas e cooldown individual (`cooldownUntilTick`). Suporta ordens manuais (`AttackCommand`) com prioridade de alvo sobre a IA de combate e autoalvo automático para tropas disponíveis quando há inimigos visíveis em alcance.
- **Autoalvo determinístico**: seleção estrita com desempate em cascata: (1) menor distância euclidiana ao alvo, (2) menor HP atual, (3) menor ID lexicográfico estável.
- **Papéis táticos e atributos**:
  - *Soldado*: dano 5, alcance 2, cooldown 3s.
  - *Arqueiro*: dano 8, alcance 4, cooldown 4s; ataca à distância sem sofrer retaliação física.
  - *Escudeiro*: absorve dano integral e reflete 80% (`floor(dano * 0.8)`) contra atacantes adjacentes (distância Chebyshev <= 1); reflexão não encadeia.
  - *Batedor*: sem dano; furtivo na fog sem inimigos próximos, detectável e atacável quando um inimigo entra em distância <= 5.
  - *Operário*: sem dano; não pode atacar.
- **Ataque a construções**: unidades ofensivas podem atacar edifícios inimigos (Base, Quartel, Casa) calculando a distância euclidiana até a célula mais próxima do footprint da estrutura. Redução e destruição da Base em HP <= 0 com liberação da grade.
- **Comando em grupo (`dispatchGroupAttack`) e Apresentação**: clique direito sobre inimigos visíveis envia comando de ataque; unidades no alcance disparam imediatamente, enquanto unidades fora do alcance navegam automaticamente para a célula livre mais próxima dentro do seu alcance efetivo de ataque. Renderização em Phaser com linhas de disparo e reflexão, barras de vida em entidades danificadas e dados de dano/alcance/alvo no HUD.

- **Ajuste UX do HUD e Produção**:
  - Alinhado estritamente a `docs/GAME_RULES.md`: a Base não produz nenhuma unidade. Para treinar Operários (`#btn-produce-worker`), o jogador deve construir uma Casa (`house`). A Base exibe orientações contextuais no HUD.
  - Seleção múltipla de operários (ex.: seleção por caixa ou Shift) mantém os botões de construção ativos (`#btn-build-house`, `#btn-build-barracks`), atribuindo a ordem ao primeiro operário disponível.

## Fase 8 — Inteligência Artificial (IA): concluída

- **Percepção e Memória (`AIMemory`)**:
  - Restrição rígida à névoa de guerra: a IA consome apenas células visíveis ou exploradas e entidades reveladas (`fog.visibleEntities(team)`). Jamais acessa informações em névoa desconhecida.
  - Memória de longo prazo: armazena coordenadas de minas e manchas de floresta descobertas.
  - Rastreamento e expiração: edifícios inimigos descobertos são memorizados e expurgados se a célula for revisitada com visão direta e o edifício não existir mais.
- **Utility AI e Controle Estratégico (`AIController`)**:
  - Ciclo de decisão periódico configurável (padrão de 30 ticks / 1 segundo), desacoplado da taxa de quadros.
  - Intenções avaliadas:
    - *Defend*: acionamento prioritário imediato quando invasores aproximam-se a <= 30 células da base.
    - *BuildBarracks* e *BuildHouse*: seleção automática de terreno plano explorado próximo à base para posicionamento de fundações e envio de operário construtor.
    - *ProduceMilitary*: composição equilibrada de unidades (Soldados, Arqueiros, Escudeiros e Batedores).
    - *ProduceWorker*: reposição e expansão contínua de operários até o teto econômico.
    - *GatherWood* e *Mine*: alocação automática de operários ociosos para florestas e minas descobertas.
    - *Scout*: exploração autônoma de quadrantes desconhecidos em direção à base adversária.
    - *AttackBase* e *AttackArmy*: coordenação de ordens de ataque em grupo quando o limiar de força militar é atingido.
- **Integração na Simulação e Navegador**:
  - Controlador anexado a `Simulation` com suporte a execução determinística para qualquer equipe (`enableAI('red')`).
  - Habilitado por padrão no `MapScene`, permitindo que o jogador humano jogue ativamente contra a IA no navegador.
  - Suporte ao parâmetro `?noai=1` para desativação em testes isolados.

### Gate

- `npm run lint`: passou (0 erros, 0 avisos).
- `npm run typecheck`: passou (0 erros).
- `npm test`: 87 testes passaram (16 suítes de testes unitários).
- `npm run build`: passou.
- `npm run test:e2e`: 16 testes passaram (boot, navegação, seleção, produção, combate, vitória e IA autônoma no Chromium).

## Fase 9 — Vitória e fluxo completo: concluída

- A destruição de qualquer base registra vencedor, perdedor, duração e recursos/unidades restantes no core, interrompe a simulação no mesmo tick e rejeita novas ordens com `game-over`.
- A interface mostra painel modal de vitória ou derrota com estatísticas completas da partida. O botão **Jogar novamente** reinicia a partida instantaneamente.
- Corrigida a abertura da IA: um operário explora a região próxima para descobrir madeira enquanto outro preserva a renda de moedas. O quartel e casas seguem regras estritas de produção de tropas e operários.
- Teste de regressão simula a partir dos recursos iniciais, sem injeção, e verifica produção militar da IA e destruição de base.

### Gate

- `npm run lint`: passou (0 erros, 0 avisos).
- `npm run typecheck`: passou (0 erros).
- `npm test`: 87 testes passaram (16 suítes).
- `npm run build`: passou.
- `npm run test:e2e`: 16 testes passaram.

## Fase 10 — Simulação e balanceamento: concluída

- Criado `npm run simulate -- --games=100 --seed=123`, que executa IA vs IA sem Phaser e gera JSON detalhado e relatório Markdown por lote.
- As 100 partidas da linha de base usam 50 seeds pareadas com a ordem de ativação da IA invertida. Resultado: 37 vitórias azuis, 63 vermelhas, nenhum empate, duração média de 805 segundos.
- Corrigidas assimetrias de exploração inicial, posicionamento de construções e destino de marcha. A variação de exploração usa o RNG com seed, preservando reprodução exata.
- O relatório em `docs/BALANCE_REPORT.md` registra método, resultados e limite da análise. Nenhum valor de `config/balance.v1.json` foi alterado sem evidência de playtest humano.

### Gate

- `npm run lint`, `npm run typecheck` e `npm run build`: passaram.
- `npm test`: 76 testes passaram, incluindo reprodução do torneio headless.
- `npm run test:e2e`: 11 testes passaram no Chromium.
- `npm run simulate -- --games=100 --seed=123`: 100 partidas concluídas e relatórios gerados.

## Fase 11 — E2E e entrega v0.1.0: concluída

- O E2E principal percorre a jornada completa do jogador no navegador usando recursos e regras reais; apenas o relógio da simulação é acelerado para a execução automatizada.
- A suíte mantém testes separados da IA ativa, seleção, combate, produção e fluxo de resultado.
- A versão do pacote foi alinhada para `0.1.0`. A nota de entrega está em `docs/RELEASE_V0.1.0.md`.

### Gate

- `npm run lint`, `npm run typecheck` e `npm run build`: passaram.
- `npm test`: 76 testes passaram.
- `npm run test:e2e`: 12 testes passaram, incluindo a jornada completa.
- `npm run simulate -- --games=100 --seed=123`: 100 partidas concluídas.

### Riscos / dívidas

- O bundle inicial do Phaser gera aviso de tamanho no build; avaliar divisão de código depois que houver cenas reais.
- `npm audit` aponta 2 avisos moderados em dependências de desenvolvimento do Vitest; dependências de produção: 0 avisos (`npm audit --omit=dev`). A correção indicada exige Vitest 4 e deve ser avaliada junto com atualização do Node do ambiente.
- A posição lógica muda por ação, enquanto a apresentação interpola o caminho. As interpretações de continuação automática e visão de construções estão anotadas em `DECISIONS_NEEDED.md`.
- Posicionamento dos trabalhadores em minas e timing de coleta/depósito estão registrados em `DECISIONS_NEEDED.md`.
- Esgotamento de floresta e busca de novo recurso em raio de 16 células registrados em `DECISIONS_NEEDED.md`.
- Métrica euclidiana para alcance de combate e checagem de adjacência de Chebyshev para reflexão do escudeiro registrados em `DECISIONS_NEEDED.md`.

## Pós V1 — seis correções do playtest de 2026-10-06

- A apresentação usa `VisualFog` ligada às posições interpoladas; inimigos aparecem e somem na fronteira visual correta, e alterações em terreno ou construções fora de visão permanecem na memória até nova observação.
- Movimento usa intervalo de 1s e a animação ocupa toda a ação. O arqueiro avança 3 células por ação e mantém ataque de 4s, dano 8 e alcance 4.
- Tropas ofensivas em marcha engajam inimigos em visão própria e depois retomam o destino. Ataques do mesmo tick são resolvidos em conjunto, a prioridade de células disputadas alterna a cada segundo e o desempate de rotas A* espelha a direção horizontal do objetivo.
- HUD lateral informa recursos, população, seleção, vida, ordem, destino, alvo, espera, trabalho, construção, produção e motivo de rejeições. Classes usam cores distintas com contorno por equipe e legenda.
- Regressões novas verificam memória visual, combate simultâneo, movimento disputado, engajamento, continuidade na fog, jornada com IA ativa e layout em telas larga e compacta. Capturas visuais em `artifacts/`.
- O torneio pareado foi repetido após as mudanças: 52 vitórias azuis, 30 vermelhas e 18 empates em 100 partidas. Ver `docs/BALANCE_REPORT.md` para a comparação e seus limites. O novo aceite humano da experiência segue pendente.
- Gate final revalidado em 2026-10-06: `npm run lint`, `npm run typecheck`, `npm test` (87 testes), `npm run build` e `npm run test:e2e` (16 testes) passaram.

## Pós V1 — IA ativa e relatório de fim de partida

- Corrigido o retorno antecipado do ciclo estratégico: a IA continua coletando, construindo e produzindo após formar um grupo de ataque. O batedor parte para explorar mesmo quando há produção na fila; duas unidades com dano podem iniciar a ofensiva.
- O painel final compara azul e vermelho em tropas e operários produzidos/abatidos, ouro e madeira coletados/gastos, além de unidades e recursos restantes. Contadores de produção usam unidades efetivamente criadas; custos usam ordens aceitas.
- Regressões de core cobrem economia durante o ataque, exploração do batedor e contadores de resultado. O navegador verifica a tabela e seu uso em tela compacta.
- Novo torneio de 100 partidas: 34 vitórias azuis, 30 vermelhas, 36 empates; primeiro combate em média aos 333,76 segundos. Ver `docs/BALANCE_REPORT.md`. A percepção da IA e a taxa de empates ainda requerem playtest humano.
- Gate revalidado: lint, typecheck, 91 testes unitários, build e 17 testes de navegador passaram. O painel final passou também na largura compacta de 480 px.

## Pós V1 — economia da IA e leitura visual

- A IA reserva ouro para Casa e novos operários após abrir com um soldado. Um operário coleta madeira; os demais procuram minas e geram ouro, sustentando novas filas militares. Um teste de 600 segundos usa somente recursos iniciais e confirma mina descoberta, expansão de operários e tropas e mais de 900 moedas coletadas.
- O HUD mostra o tempo de partida em `mm:ss` desde o começo, derivado do relógio do core e congelado no resultado.
- Efeitos curtos de poeira no movimento, brilho na coleta/mineração e construção, pulso ao surgir unidade ou depositar madeira, e anel de impacto no combate reforçam ações sem alterar a lógica. A camada de efeitos respeita a visibilidade da equipe azul.
- Gate revalidado: lint, typecheck, 93 testes unitários, build e 18 testes de navegador passaram. O novo torneio de 100 partidas terminou com 3 vitórias azuis, 3 vermelhas e 94 empates; ver `docs/BALANCE_REPORT.md`. A economia melhorou, mas a estratégia de ataque entre duas IAs ainda produz muitos impasses.

## Pós V1 — levas ofensivas e guarda da base

- Um atacante permanece de guarda. A IA lança levas com três atacantes além da guarda, retém reforços até formar outra leva, repõe a guarda quando ela morre e chama de volta o último sobrevivente de uma leva.
- Uma ameaça próxima da base adia a saída de novas levas, enquanto grupos já avançados prosseguem. A fila inicial prioriza combatentes para formar a primeira leva antes do batedor.
- Uma unidade em marcha pode receber outro destino durante o intervalo entre passos, inclusive para recuar; a cadência de deslocamento e os cooldowns de ações após uma parada permanecem.
- Lint, typecheck, build e 98 testes unitários passaram. O fluxo de produção que falhou em uma execução E2E passou quando repetido isoladamente. A amostra de dez partidas IA vs IA empatou integralmente; ver `docs/BALANCE_REPORT.md`. Ainda falta validar dificuldade contra humanos e pressão ofensiva antes do aceite da V1.

## Pós V1 — defesa dos operários

- A pedido do playtest, operários passam a causar 4 de dano com alcance 1 e cooldown de ataque de 3s. Aceitam ordem manual de ataque e reagem automaticamente quando um inimigo está adjacente e a ação está disponível.
- O deslocamento de coleta não desvia para perseguir inimigos. Escudeiro e batedor seguem sem ataque. A alteração está na configuração central e nos testes de combate e marcha.
- Lint, typecheck, build e 100 testes unitários passaram. Os cinco cenários direcionados de navegador passaram, incluindo ataque manual do operário e leitura do dano no HUD. A amostra de dez partidas IA vs IA manteve o mesmo resultado e marcos gerais; ver `docs/BALANCE_REPORT.md`.

## Pós V1 — áreas de visão de construções e limite territorial de obras

- **Raio de visão de construções**:
  - Base: visão de 40 casas a partir da borda do footprint.
  - Casa e Quartel: visão de 30 casas a partir da borda do footprint.
- **Limite territorial de expansão**:
  - Casas e Quartéis possuem distância máxima permitida de 80 células a partir do centro da Base (`BALANCE.construction.maxDistanceFromBase` em `config/balance.v1.json`).
  - O motor rejeita tentativas além do limite com `out-of-build-range`.
- **Apresentação e UX no navegador**:
  - O fantasma de posicionamento (`placementMode`) valida o limite de 80 casas em tempo real e exibe a circunferência da fronteira de construção ao redor da Base e a prévia do raio de visão de 30 casas ao redor do edifício sendo posicionado.
  - Ao selecionar Base, Casa ou Quartel, a seleção desenha anéis suaves de visão no mapa, e o painel do HUD informa os valores de visão e alcance de construção.
  - Suíte E2E atualizada para respeitar a cobertura visual contínua da Base em seu perímetro.
- **Gate revalidado**: `npm run lint` (0 erros), `npm run typecheck` (0 erros), `npm test` (102 testes unitários aprovados em 16 arquivos), `npm run build` (sucesso) e `npx playwright test` (19 testes E2E aprovados no Chromium).

## V1.1 — Fase 0: Auditoria e Preparação: concluída

- Auditoria da arquitetura realizada conforme `docs/v1.1.md`.
- Desacoplamento entre simulação e apresentação preservado.
- Visão da Base calibrada estritamente para 40 células no balanceamento central (`config/balance.v1.json`).

## V1.1 — Fase 1: Novo Recurso: Pedra: concluída

- **Balanceamento e Configuração**:
  - `config/balance.v1.json`: adicionado `"stone": 0` no `startingState` e `"stone": { "workerCapacity": 20, "gatherPerSecond": 2 }` na seção `economy`.
  - `config/map-test-01.json`: adicionadas jazidas de pedra simétricas em `(42, 70)` e `(45, 125)` (5×5 células cada, espelhadas no eixo X).
- **Core Engine & Simulação**:
  - `src/map/MapGrid.ts`: adicionado `'stone'` ao tipo `Terrain` e à lista de terrenos transitáveis.
  - `src/core/entities/EntityStore.ts`: adicionado atributo `carriedStone` na interface `UnitEntity` e inicialização no nascimento dos operários.
  - `src/core/systems/EconomySystem.ts`:
    - `TeamStock` atualizado para `{ coins: number; wood: number; stone: number }`.
    - `GatherTask` suporta `resourceKind: 'wood' | 'stone'`.
    - Coleta de pedra obedece taxa de 2 pedra/s até capacidade máxima (20), esgota célula de pedra para plain, transporta até depósito perimetral da base e deposita em `stocks[team].stone`, com redirecionamento automático para células adjacentes de pedra.
  - `src/core/game/MatchStats.ts` e `Simulation.ts`: rastreamento de `stoneCollected` e `stoneSpent` por equipe, exportado nos snapshots estatísticos e no resultado final de jogo (`blueStone`, `redStone`).
- **Inteligência Artificial (IA)**:
  - `src/core/ai/AIMemory.ts`: descoberta de jazidas de pedra registradas em `discoveredStones`.
  - `src/core/ai/AIController.ts`: suporte ao intento `GatherStone` quando a demanda por pedra é identificada (`desiredStone`) e a base econômica inicial possui mineradores alocados.
- **Apresentação e Interface (HUD)**:
  - `src/presentation/MapScene.ts`: renderização de células de pedra em tom ardósia distinto (`0x828b94`), clique direito em terreno de pedra emite ordem de coleta, HUD lateral exibe `${team.stone} pedra` no status da equipe azul e no painel de detalhes da unidade.
  - `tests/e2e/selection.spec.ts`: asserções de status do HUD atualizadas e compatíveis.
- **Gate de Validação**:
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 105 testes unitários aprovados em 16 arquivos.
  - `npm run build`: bundle de produção compilado com sucesso.
  - `npx playwright test`: 19 testes E2E aprovados no Chromium.

## V1.1 — Fase 2: Unidade Construtor: concluída

- **Balanceamento Central (`config/balance.v1.json`)**:
  - Nova unidade `"builder"` configurada centralmente sem valores hardcoded:
    - Atributos: `hp: 10`, `damage: 0`, `range: 0`, `vision: 5`, `movement: 5`, `movementCooldownSeconds: 1`, `cooldownSeconds: 3`.
    - Custos e tempo: `coins: 150`, `wood: 0`, `productionSeconds: 6`.
- **Produção e Infraestrutura (`src/core/systems/ProductionSystem.ts`, `ConstructionSystem.ts`)**:
  - Casa (`house`) produz tanto `worker` quanto `builder` via fila de produção regular (`command.unitKind !== 'worker' && command.unitKind !== 'builder'`).
  - `ConstructionSystem`: aceita `builder.kind === 'builder'` para construir edifícios (Casa e Quartel, e futuramente Barricadas e Torres de Vigilância).
  - Limite populacional geral de 60 unidades respeitado para treinamento de construtores.
- **Isolamento Econômico (`src/core/systems/EconomySystem.ts`)**:
  - Construtor não gera ouro passivamente (renda passiva restrita a `worker`).
  - Construtor não mina ouro nem coleta madeira ou pedra (`issueCommand` rejeita comandos de mina e coleta para construtor com `not-worker`).
- **Estatísticas e Combate (`src/core/game/MatchStats.ts`, `CombatSystem.ts`, `Simulation.ts`)**:
  - `MatchStats`: contabiliza `builder` como unidade civil em `workersProduced` e `workersKilled`.
  - Morte do construtor cancela ativamente qualquer tarefa de construção em andamento e atualiza a contagem de perdas civis da equipe adversária.
  - Distinção em `AIController.ts` e `tournament.ts`: construtor não é contabilizado como unidade militar.
- **Apresentação e Interface (HUD/Canvas)**:
  - `src/presentation/MapScene.ts`:
    - Cor visual do construtor `0xdd8833` (`UNIT_COLORS.builder`), rótulo `'Construtor'` (`LABELS.builder`).
    - Painel da Casa exibe botões `Treinar Operário (150m, 6s)` (`#btn-produce-worker`) e `Treinar Construtor (150m, 6s)` (`#btn-produce-builder`).
    - Seleção de construtor exibe `Construtor · Construções` na barra de ações com botões para construir Casa e Quartel.
    - Modo de posicionamento (`placementMode`) e clique com botão direito adaptados para aceitar o construtor como construtor válido.
    - Clique com botão direito em jazidas/florestas com construtor selecionado emite ordem de movimento comum (sem tentar coletar).
  - `src/style.css` e `index.html`:
    - Adicionado `.builder { --unit-color: #dd8833; }`.
    - Adicionado `<span class="builder">Construtor</span>` à legenda do HUD.
- **Testes e Validação Completa**:
  - Nova suíte de testes unitários dedicada `src/core/systems/BuilderUnit.test.ts` (6 testes cobrindo todos os requisitos e restrições).
  - Novo teste E2E Playwright em `tests/e2e/production.spec.ts` validando produção do construtor na Casa, seleção no mapa e exibição da barra de ações de construção no navegador.
  - Gates 100% aprovados: `npm run lint` (0 erros), `npm run typecheck` (0 erros), `npm test` (111 testes unitários aprovados em 17 arquivos), `npm run build` (sucesso), `npx playwright test` (20 testes E2E aprovados).

## Ajuste pós-Fase 2 — Calibração de visão de construções (-35%) e visualização de visão de unidades

- **Redução de visão das construções em 35%**:
  - Base: reduzida de 40 para 26 células em `config/balance.v1.json`.
  - Casa: reduzida de 30 para 20 células em `config/balance.v1.json`.
  - Quartel: reduzido de 30 para 20 células em `config/balance.v1.json`.
- **Revelação e feedback visual por unidades**:
  - Unidades deixam e mantêm a área em que estão revelada (névoa de guerra dissipada) com raio de alcance igual à sua visão comum (`entity.vision`), exatamente como as estruturas.
  - Seleção de unidades agora desenha o anel circular suave de visão no canvas (`0x9bdbff`), proporcionando a mesma visualização gráfica da área revelada que já existia para as construções.
- **Documentação e Gates Revalidados**:
  - `docs/FOG_AND_STEALTH.md` e `FogOfWar.test.ts` atualizados com os novos raios de visão.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 111/111 testes unitários aprovados.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: 20/20 testes E2E aprovados no Chromium.

## Fase 3 V1.1 — Sistema de capacidade por construções: concluída

- **Balanceamento Central (`config/balance.v1.json`)**:
  - Valores configurados centralmente em `buildings`:
    - `base`: `civilianCapacity: 2`, `militaryCapacity: 0`.
    - `house`: `civilianCapacity: 2`, `militaryCapacity: 0`.
    - `barracks`: `civilianCapacity: 0`, `militaryCapacity: 6`.
  - Zero hardcoding nos sistemas de regras.
- **Regras de Capacidade (`src/core/systems/ProductionSystem.ts`)**:
  - Distinção clara de categorias: unidades civis (`worker`, `builder`) vs unidades militares (`soldier`, `archer`, `shieldbearer`, `scout`).
  - Método `getCapacity(team: Team): TeamCapacity` calcula em tempo real slots civis, slots militares e totais (incluindo unidades vivas e em fila).
  - Apenas construções finalizadas (`!underConstruction`) e com vida concedem capacidade.
  - Rejeição de treinamento quando o limite da categoria é atingido:
    - Civil: `{ accepted: false, reason: 'civilian-capacity-reached' }`.
    - Militar: `{ accepted: false, reason: 'military-capacity-reached' }`.
    - Limite global de 60 unidades por jogador preservado estritamente com `'unit-cap-reached'`.
  - Tratamento de over-cap por destruição:
    - Se uma Casa ou Quartel for destruído, unidades existentes NÃO morrem e continuam funcionando normalmente.
    - Novas produções daquela categoria permanecem bloqueadas até que novas construções sejam erguidas ou ocorram baixas.
    - A reconstrução restaura a capacidade e libera novas produções.
- **Inteligência Artificial (`src/core/ai/AIController.ts`)**:
  - IA agora tem consciência de capacidade civil e militar:
    - Detecta quando a capacidade militar está esgotada e prioriza erguer novos Quartéis quando tem recursos.
    - Detecta quando a capacidade civil está esgotada e prioriza erguer novas Casas para acomodar mais operários.
    - Preserva a ordem tática de abertura (primeiro soldado antes da primeira casa).
- **HUD e Interface (`index.html`, `src/presentation/MapScene.ts`)**:
  - Adicionado elemento `#capacity-status` exibindo:
    `Civil: X / Y · Militar: X / Y · Total: X / 60`.
  - `#team-status` mantido intacto para preservar compatibilidade com regexes existentes.
  - Mensagens de feedback de comando adicionadas para `'civilian-capacity-reached'` e `'military-capacity-reached'`.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/CapacitySystem.test.ts` (8 testes cobrindo todas as regras da especificação).
  - Teste E2E Playwright em `tests/e2e/production.spec.ts` validando exibição da capacidade no HUD e bloqueio por capacidade civil no navegador.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 119/119 testes unitários aprovados em 18 arquivos de teste.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: 21/21 testes E2E aprovados no Chromium.

## Fase 4 V1.1 — Barricada: concluída

- **Balanceamento Central (`config/balance.v1.json`)**:
  - Configuração centralizada sob `buildings.barricade`:
    - Dimensões: `width: 1`, `height: 1`.
    - Atributos: `hp: 40`, `vision: 0`, `buildSeconds: 3`, `maxPerTeam: 100`.
    - Custos de construção: `coins: 0`, `wood: 10`, `stone: 5` (exigência estrita de madeira E pedra).
    - Capacidade: `civilianCapacity: 0`, `militaryCapacity: 0`.
    - Reparo: `repairRateHpPerSecond: 4`, `repairCostPerSecond: { wood: 1, stone: 1 }`.
  - Campo `"stone": 0` padronizado nas demais estruturas (`base`, `house`, `barracks`).
- **Regras de Construção e Restrição (`src/core/systems/ConstructionSystem.ts`)**:
  - Apenas unidades do tipo `builder` podem erguer barricadas; tentativas de `worker` são rejeitadas com `'not-builder'`.
  - Verificação estrita de madeira e pedra antes de aceitar construção (`'insufficient-wood'`, `'insufficient-stone'`).
  - Limite estrito de 100 barricadas simultâneas por jogador (`'building-limit-reached'`). A destruição ou remoção de uma barricada recupera o slot imediatamente.
  - Não há restrição de travamento de caminho na colocação (walling off / fechamento total é permitido por design estratégico).
- **Integração com Grid e Pathfinding (`src/core/entities/EntityStore.ts`, `src/map/findPath.ts`)**:
  - Pegada 1×1 bloqueia navegação terrestre (`map.isPassable(x, y) === false`) assim que a estrutura é criada no grid.
  - A* reconhece a barricada como obstáculo e contorna automaticamente por rotas abertas alternativas.
  - Se um objetivo for totalmente cercado por barricadas, o pathfinding retorna `null` (sem rota).
  - Destruição ou remoção da barricada desobstrui o grid instantaneamente (`map.clearStructure`), liberando a passagem para unidades.
- **Combate, Linha de Visão e Reparo (`src/core/systems/CombatSystem.ts`, `ConstructionSystem.ts`)**:
  - Barricadas não bloqueiam projéteis, ataques de arqueiros nem visão (`vision: 0`). Arqueiros atiram por cima da barricada se o alvo estiver visível e dentro do alcance.
  - Barricadas podem ser atacadas e destruídas por qualquer unidade com ataque.
  - Sistema de reparo (`RepairCommand`): construtores podem reparar barricadas danificadas no mapa ao custo contínuo de madeira e pedra até restaurar o `maxHp`.
- **HUD e Interface de Apresentação (`src/presentation/MapScene.ts`)**:
  - Botão `#btn-build-barricade` exibido no painel de ações quando um construtor está selecionado.
  - Modo de posicionamento 1×1 com feedback visual de validade de posição.
  - Clique direito em estruturas danificadas aliadas envia comando de reparo para o construtor.
  - Renderização gráfica da barricada no canvas com textura de madeira/pedra e cruzamento diagonal distintivo.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/BarricadeSystem.test.ts` (7 testes cobrindo todas as mecânicas: construtor exclusivo, custos de madeira e pedra, limite de 100 unidades e reciclagem de slot, contorno e bloqueio por pathfinding, desobstrução pós-destruição em combate, tiro de arqueiro sobre barricada e reparo).
  - Teste E2E Playwright em `tests/e2e/production.spec.ts` validando botão de barricada no navegador, posicionamento pelo construtor, dedução de 10 madeira / 5 pedra e bloqueio da célula transitável.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 126/126 testes unitários aprovados em 19 arquivos.
  - `npm run build`: bundle compilado com sucesso.
  - `npx playwright test`: todos os testes E2E aprovados no Chromium.

## Fase 5 V1.1 — Reparos: concluída

- **Balanceamento Central (`config/balance.v1.json`)**:
  - Parâmetros `repairRateHpPerSecond` e `repairCostPerSecond` configurados para todas as construções (sem custos de ouro):
    - `base`: `repairRate: 5 hp/s`, custo: `wood: 2, stone: 2 / s`.
    - `house`: `repairRate: 4 hp/s`, custo: `wood: 2, stone: 0 / s`.
    - `barracks`: `repairRate: 4 hp/s`, custo: `wood: 2, stone: 1 / s`.
    - `barricade`: `repairRate: 4 hp/s`, custo: `wood: 1, stone: 1 / s`.
- **Regras do Sistema de Reparo (`src/core/systems/ConstructionSystem.ts`, `Simulation.ts`)**:
  - Somente unidades do tipo `builder` podem reparar; operários são estritamente rejeitados com `'not-builder'`.
  - Rejeita com `'building-at-max-hp'` se a estrutura já estiver com vida total.
  - Rejeita com `'insufficient-wood'` ou `'insufficient-stone'` se o estoque não contiver recursos para iniciar o reparo.
  - Reparo ocorre continuamente ao longo do tempo, consumindo madeira e pedra por segundo e elevando a vida até o `maxHp`.
  - O construtor permanece ocupado durante o reparo e é liberado automaticamente ao completar `maxHp` ou se os recursos acabarem.
  - Interrupção por nova ordem (ex: `move`) cancela a tarefa imediatamente e cessa todo consumo de recursos.
  - Morte do construtor ou destruição da estrutura cancela a tarefa de forma limpa.
  - Consumo de recursos de reparo é contabilizado continuamente em `stats.spent`.
  - Suporte total a múltiplos reparadores: múltiplos construtores podem reparar a mesma estrutura no perímetro simultaneamente, somando suas taxas de reparo de HP e dividindo o esforço.
- **Inteligência Artificial (`src/core/ai/AIController.ts`)**:
  - IA avalia e prioriza reparos conforme relevância estratégica:
    1. Base em risco;
    2. Quartel;
    3. Casa;
    4. Barricada.
  - Comportamento não obsessivo: não repara danos cosméticos levianos (< 15% de perda em estruturas secundárias) e não repara se os recursos estiverem escassos.
  - Treina construtor na Casa caso haja estruturas danificadas e não possua construtores ativos.
  - Define intenção da IA como `Repair` ao ordenar reparos.
- **Apresentação e Interface (`src/presentation/MapScene.ts`)**:
  - Clique com botão direito com um ou mais construtores selecionados em uma estrutura aliada avariada emite ordem de reparo coletiva.
  - Destaque visual gráfico no canvas durante reparo ativo: borda luminosa esmeralda (`0x64e8a8`) e indicador esférico de atividade junto à barra de vida.
  - Feedback em português no `#command-feedback` detalhando início do reparo e motivos de indisponibilidade.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/RepairSystem.test.ts` (8 testes abrangendo: exclusividade de construtor, consumo de recursos ao longo do tempo, teto de HP máximo e liberação, interrupção por movimento, corte por falta de recursos, cancelamento por morte do construtor, múltiplos construtores em paralelo e priorização de reparo pela IA).
  - Teste E2E Playwright em `tests/e2e/production.spec.ts` validando ordem de reparo por clique direito com construtor no navegador e incremento de HP da estrutura.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 134/134 testes unitários aprovados em 20 arquivos.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: 23 testes E2E aprovados no Chromium.

## Fase 6 V1.1 — Torre de Vigilância: concluída

- **Balanceamento Central (`config/balance.v1.json`)**:
  - Estrutura `tower` configurada como fonte central da verdade:
    - `width: 2`, `height: 2`, `hp: 100`, `vision: 20` (área de 20×20 células);
    - Custos: `coins: 200`, `wood: 150`, `stone: 100`;
    - `buildSeconds: 10`, `civilianCapacity: 0`, `militaryCapacity: 0`;
    - Reparo: `repairRateHpPerSecond: 4`, `repairCostPerSecond: { wood: 2, stone: 2 }`.
- **Regras de Construção e Exclusividade (`src/core/systems/ConstructionSystem.ts`, `MoveCommand.ts`)**:
  - Somente unidades do tipo `builder` podem construir a Torre de Vigilância; operários tentando construir são rejeitados com `'not-builder'`.
  - Custos centrais de moedas (200), madeira (150) e pedra (100) estritamente validados e debitados do estoque.
  - Ocupa pegada 2×2 no mapa (`map.occupyStructure`), bloqueando o trânsito de unidades nas 4 células ocupadas.
- **Visão Territorial 20×20 e Detecção de Batedores (`src/core/systems/FogOfWar.ts`, `VisualFog.ts`)**:
  - Uma vez construída (`!underConstruction`), projeta uma área contínua e em tempo real de 20×20 células centrada na torre (`halfSpan = 9`, cobrindo 9 células para cada lado do footprint 2×2).
  - Atualização em tempo real: tropas inimigas entrando na área são imediatamente reveladas na visão da equipe.
  - Função especial de detecção de batedores: batedores inimigos dentro da área ativa de 20×20 da torre perdem a invisibilidade natural e são revelados. Fora da área da torre, a regra padrão de invisibilidade do batedor segue intacta.
  - Ao ser destruída ou removida, a visão da torre cessa imediatamente e a região volta a obedecer ao fog de guerra padrão (células sem outra fonte de visão retornam a `explored`).
- **Combate e Reparo (`src/core/systems/CombatSystem.ts`, `ConstructionSystem.ts`)**:
  - A torre é estritamente defensiva e de visão; NÃO ataca unidades inimigas (`damage: 0`, `range: 0`).
  - Pode ser alvejada e destruída por tropas inimigas em combate.
  - Pode ser reparada por construtores ao sofrer dano, gastando madeira e pedra por segundo à taxa configurada de 4 HP/s.
- **Inteligência Artificial (`src/core/ai/AIController.ts`, `AIMemory.ts`)**:
  - IA reconhece torres inimigas e prioriza atacá-las quando visíveis durante marchas militares para cegar o adversário.
  - IA considera construir torres de vigilância para controle de visão territorial assim que seu exército e economia se consolidam.
  - IA treina um construtor e acumula até 100 de pedra para viabilizar torres e reparos.
  - IA prioriza reparar torres de vigilância danificadas com prioridade 2 (logo após a base).
- **Apresentação e Interface (`src/presentation/MapScene.ts`)**:
  - Botão `#btn-build-tower` no painel de ações de construtores ("Construir Torre (200m, 150w, 100p)").
  - Modo de posicionamento 2×2 com ghost preview exibindo o retângulo delimitador da visão 20×20.
  - Renderização distinta no canvas: parapeito de pedra com baluarte e lanterna / olho de vigia luminoso central ciano/dourado.
  - Seleção da torre destaca no mapa a projeção translúcida da área 20×20 de visão.
  - Painéis de seleção e status do HUD identificam a torre e exibem `"Visão: 20×20 células (detecta batedores)"`.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/TowerSystem.test.ts` (10 testes cobrindo: exclusividade de construtor, validação de custos de moedas/madeira/pedra, revelação da área 20×20, atualização em tempo real, reversão imediata ao fog normal na destruição, função especial de revelação de batedores, integridade da regra de batedores fora da torre, ausência de ataque da torre, reparo e destruição em combate).
  - Teste E2E Playwright em `tests/e2e/production.spec.ts` validando botão de torre, posicionamento pelo construtor, finalização e detalhes da torre no navegador.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 144/144 testes unitários aprovados em 21 arquivos.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: todos os 24 testes E2E aprovados no Chromium.

## Fase 7 V1.1 — Attack-Move: concluída

- **Core de Simulação e Comandos (`src/core/commands/MoveCommand.ts`, `dispatchGroupMove.ts`, `Simulation.ts`)**:
  - Novo comando `attack-move` implementado e tipado via `AttackMoveCommand` e flag `attackMove?: boolean` no `MoveCommand`.
  - Função utilitária `dispatchGroupAttackMove` exportada para gerenciar deslocamento de grupos inteiros sob ordem de ataque em marcha.
  - Roteamento completo na `Simulation`: rotas para `{ type: 'attack-move' }` e `{ type: 'move', attackMove: true }` atribuindo `attackMoveTarget: Point`.
  - Distinção estrita entre Movimento Normal (`move`, clique direito do mouse comum, mantendo `attackMoveTarget === null`) e Attack Move (`attack-move`, mantendo `attackMoveTarget: Point`). Movimentos comuns não desviam para perseguir ou engajar inimigos avistados.
  - Prioridade absoluta das ordens manuais do jogador: qualquer nova ordem explícita (movimento comum, ataque manual focado, coleta, construção, reparo) limpa imediatamente `attackMoveTarget` e cancela engajamentos automáticos.
- **Sistema de Engajamento e Marcha (`src/core/systems/MarchEngagementSystem.ts`)**:
  - Tropas em marcha sob `attackMoveTarget` e com `damage > 0` que avistam inimigos válidos dentro do seu campo de visão interrompem a marcha e engajam o inimigo mais prioritário/próximo.
  - Respeitam tempo de recarga (cooldown) e alcance da unidade (unidades corpo a corpo avançam até distância 1 ou 2, arqueiros atiram a distância até 4).
  - Múltiplos inimigos no trajeto são combatidos sequencialmente: após a morte de uma ameaça, o sistema verifica novos inimigos no campo de visão antes de retomar a marcha.
  - Unidades sem ataque (`damage === 0`, como batedores e construtores) continuam marchando diretamente até o destino sem se desviar para combate.
  - Tratamento contextual de barricadas: barricadas inimigas que bloqueiam fisicamente o único caminho transitável até o destino são detectadas via `findBlockingEnemyStructure` e alvejadas para desobstrução do corredor; barricadas à margem da rota não são atacadas sem contexto.
  - Após limpar todas as ameaças do caminho, as tropas retomam automaticamente o trajeto até o ponto final designado pelo jogador.
- **Apresentação e Interface (`src/presentation/MapScene.ts`, `src/style.css`)**:
  - Totalmente jogável via mouse: botão `#btn-attack-move` disponível na barra de ações para qualquer seleção de unidades aliadas (tropas de combate, operários, construtores).
  - Atalho de teclado `A` implementado como conveniência opcional, alternando o estado ativo do botão e emitindo aviso no `#command-feedback`.
  - Indicador visual no canvas: mira/retículo vermelho dinâmico com reticulado semi-transparente acompanhando o cursor do mouse enquanto o modo Attack Move estiver armado.
  - Clique esquerdo no mapa envia ordem de Attack Move via `dispatchGroupAttackMove`; clique direito ou tecla Esc desarma o modo sem emitir ordem indesejada.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/AttackMoveSystem.test.ts` (9 testes cobrindo marcha até destino, detecção de inimigo, combate com cooldown, continuação ao destino, combate a múltiplos inimigos sequenciais, unidades sem ataque, destruição de barricadas obstrutivas, distinção com movimento normal, ataque em grupo e prioridade absoluta de ordens manuais).
  - Suíte `src/core/systems/MarchEngagementSystem.test.ts` atualizada e aprovada (5 testes).
  - Testes E2E no Playwright (`tests/e2e/combat.spec.ts` e `tests/e2e/full-journey.spec.ts`) validando o botão `#btn-attack-move`, atalho 'A', mira no mapa e engajamento automatizado em tempo real no navegador.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 156/156 testes unitários aprovados em 22 arquivos.
  - `npm run build`: bundle de produção gerado com sucesso.

## Fase 8 V1.1 — Rally Point / Ponto de Reunião: concluída

- **Core e Comandos (`src/core/commands/MoveCommand.ts`, `Simulation.ts`, `EntityStore.ts`)**:
  - Comando `set-rally-point` implementado e tipado através da interface `SetRallyPointCommand`, recebendo `buildingId: string` e `point: Point | null`.
  - Rejeição estrita com `'unsupported-building'` para construções que não treinam unidades (ex: Torre de Vigilância, Barricada, Base), além de proteções para construções inexistentes ou pertencentes ao adversário (`'enemy-building'`).
  - Campo `rallyPoint: Point | null` integrado à interface `BuildingEntity` e inicializado em `null` para todas as estruturas.
  - Type guards canônicos `isUnitEntity` e `isBuildingEntity` exportados em `EntityStore.ts` garantindo consistência e segurança estática de tipos.
- **Produção e Despacho Automático (`src/core/systems/ProductionSystem.ts`, `Simulation.ts`)**:
  - `ProductionSystem` gerencia o estado dos pontos de reunião por construção (`rallyPoints: Map<string, Point>`), com métodos `setRallyPoint`, `getRallyPoint`, `clearRallyPoint` e callback reativo `setOnUnitSpawned`.
  - Quando qualquer unidade (civil ou militar) tem sua produção concluída e é gerada na célula livre adjacente, a simulação verifica se a construção de origem possui um rally point configurado. Em caso positivo, emite automaticamente uma ordem de movimento em grupo (`dispatchGroupMove`) para a coordenada de destino.
  - Se a estrutura não tiver rally point configurado, a unidade permanece parada (*idle*) na célula de spawn, preservando 100% da compatibilidade do jogo base.
  - O deslocamento até o rally point respeita rigorosamente o pathfinding (A*): contorna rochas, florestas e barricadas sem teletransporte e sem travamentos mesmo se o destino for inacessível.
  - Cancelamento ou destruição da estrutura (`production.cancel(buildingId)`) remove e limpa imediatamente o rally point associado.
- **Apresentação e Interface (Canvas e HUD)**:
  - Botões `#btn-set-rally` ("Definir Rally Point") e `#btn-clear-rally` ("Remover Rally") adicionados à barra de ações para Casa e Quartel aliados.
  - Modo interativo de posicionamento (`toggleRallyPlacementMode`) com marcador dourado de pré-visualização acompanhando o cursor do mouse.
  - Suporte intuitivo a clique direito: com uma Casa ou Quartel selecionado, clicar com botão direito diretamente sobre qualquer célula transitável do mapa define o rally point instantaneamente.
  - Renderização visual no canvas: traçado de linha tracejada dourada suave conectando o centro da construção ao destino e renderização de uma bandeira dourada com mastro e flâmula no ponto de reunião.
  - Detalhes de seleção no HUD exibem o status e as coordenadas do rally point configurado (`Rally (x, y)`).
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/core/systems/RallyPointSystem.test.ts` (9 testes cobrindo definição, rejeição em alvos inválidos, alteração, remoção, despacho automático de operário e soldado, ociosidade sem rally, desvio de obstáculos via pathfinding, segurança com destino inacessível e limpeza pós-destruição).
  - Teste E2E Playwright em `tests/e2e/production.spec.ts` validando seleção de Casa, definição de rally point com clique direito, treinamento de operário com marcha automática até as coordenadas exatas do rally point e remoção do ponto de reunião.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 165/165 testes unitários aprovados em 23 arquivos.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: 26/26 testes E2E aprovados no Chromium.

## Fase 9 V1.1 — Minimapa: concluída

- **Modelo e Apresentação do Minimapa (`src/presentation/Minimap.ts`)**:
  - Implementada a classe `Minimap` com modelo modular e renderizador 2D de alta performance com buffer direto `Uint32Array` de 32 bits (renderização completa do frame em < 0.2ms).
  - Resolução 1:1 proporcional: mapeamento linear exato do grid 200×200 células para o canvas 200×200 pixels.
  - Métodos utilitários de conversão espacial e projeção: `coordsToCell(canvasX, canvasY, width, height)` com clamping defensivo aos limites do mapa `[0..199, 0..199]`, e `cameraToMinimapRect(worldView, cellSize)` calculando o retângulo exato da câmera principal no minimapa.
- **Terreno e Névoa de Guerra (Fog of War)**:
  - Células desconhecidas (`'unknown'`): renderizadas como névoa/vácuo escuro absoluto (`#080b0c`).
  - Células exploradas (`'explored'`): renderizadas com cores de terreno atenuadas/escurecidas (planície, água, montanha, floresta, mina, pedra), mantendo a memória topográfica explorada pela equipe.
  - Células atualmente visíveis (`'visible'`): renderizadas com as cores vibrantes do terreno em tempo real.
- **Entidades e Regras de Visibilidade Estratégica**:
  - Entidades aliadas (unidades e construções azuis): sempre visíveis no minimapa, com construções em blocos de tamanho proporcional (`width × height`) e unidades com pontos nítidos. Suporte a posições interpoladas dinâmicas (`displayPositions`) para movimento fluído.
  - Entidades inimigas (unidades e construções vermelhas): renderizadas estritamente quando atualmente visíveis no campo de visão (`state === 'visible'`).
  - Inimigos sob fog: estritamente ocultos e não desenhados no minimapa.
  - Batedor inimigo e camuflagem: batedores inimigos fora da distância de detecção (`stealthDetectionDistance: 5`) permanecem camuflados e NÃO aparecem no minimapa; ao serem detectados por proximidade ou entrarem no raio de uma torre, aparecem normalmente.
  - Torre de Vigilância: área contínua de 20×20 células é refletida no minimapa iluminando o terreno e revelando unidades e batedores inimigos no perímetro.
- **Navegação Interativa e Câmera**:
  - Retângulo do viewport da câmera renderizado com traçado branco nítido (`rgba(255, 255, 255, 0.9)`), indicando a área atualmente visível na tela principal.
  - Clique no minimapa: calcula instantaneamente a célula clicada e centraliza a câmera principal do jogo (`centerCameraOn(cellX, cellY)`).
  - Arraste contínuo: suporte total a arrastar com o botão esquerdo do mouse pressionado (`pointerdown` -> `pointermove` com `setPointerCapture`), proporcionando navegação suave e responsiva pelo mapa.
- **Interface e HUD (`index.html`, `src/style.css`, `src/presentation/MapScene.ts`)**:
  - Adicionado elemento `#minimap-section` contendo `<canvas id="minimap" width="200" height="200">` posicionado estrategicamente no painel `#hud`.
  - Estilização minimalista pixelated com borda `#435e66`, sombra interna e cursor crosshair.
  - Atributos dinâmicos `data-camera-center`, `data-visible-allies` e `data-visible-enemies` expostos no canvas para inspeção e testes automatizados.
- **Testes e Gates Aprovados**:
  - Nova suíte de testes unitários dedicada `src/presentation/Minimap.test.ts` (7 testes cobrindo proporção e conversão de coordenadas, clamping, cálculo do retângulo da câmera, estados do fog, unidades e construções aliadas, inimigos visíveis vs ocultos, visão 20×20 da torre, camuflagem e detecção de batedor, e dimensões proporcionais de construções).
  - Nova suíte de testes E2E Playwright dedicada `tests/e2e/minimap.spec.ts` (2 testes validando renderização no navegador, clique e arraste para navegação da câmera, e dinâmica de fog/torre/batedor em tempo real no Chromium).
  - Todos os testes de regressão de layout (`playtest-regressions.spec.ts`) aprovados sem quebra no layout desktop ou mobile.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 172/172 testes unitários aprovados em 24 arquivos.
  - `npm run build`: bundle de produção gerado com sucesso.
  - `npx playwright test`: 28/28 testes E2E aprovados no Chromium.

## Fase 10 V1.1 — Atualização da IA: concluída

- **Utility AI e Tomada de Decisão Multirrecurso (`src/core/ai/AIController.ts`, `AIMemory.ts`)**:
  - A IA agora opera com uma economia tripartite completa: Ouro, Madeira e Pedra, sem recursos gratuitos e estritamente subordinada ao Fog of War (`AIMemory`).
  - Rebalanceamento dinâmico de operários: quando o estoque de madeira atinge níveis saudáveis (>= 100), operários que estavam em corte de lenha são automaticamente redistribuídos para extração de jazidas de pedra conhecidas, mineração de ouro ou exploração territorial.
  - Dimensionamento escalonável de mineradores em função da população civil (1 minerador até 3 operários, 2 mineradores a partir de 4 operários), garantindo fluxo contínuo de moedas.
  - Consciência e expansão de capacidade:
    - Identifica estrangulamento de capacidade civil e constrói Casas (`BuildHouse`);
    - Identifica teto militar e ergue Quartéis (`BuildBarracks`);
    - Produz construtores (`builder`) em Casas assim que o exército inicial se estabelece para realizar fortificações e reparos de infraestrutura.
- **Fortificações, Visão Territorial e Reparos Autônomos**:
  - Barricadas: construtor ergue barricadas em gargalos estratégicos perimetrais consumindo estritamente 10 de madeira e 5 de pedra.
  - Torres de Vigilância: IA reserva 200 moedas, 150 madeira e 100 pedra após consolidar sua tropa inicial (>= 3 unidades) e constrói Torres de Vigilância para controle de visão territorial (revelação contínua 20×20 e detecção de batedores).
  - Reparos: IA detecta construções avariadas e despacha construtores com priorização tática estrita (Base > Torre > Quartel > Casa > Barricada) e sem desperdício de recursos em danos levianos.
- **Táticas Militares e Marcha com Attack-Move**:
  - Levas ofensivas de combatentes marcham em direção ao território ou base adversária utilizando estritamente `dispatchGroupAttackMove` (Attack Move).
  - Tropas em marcha engajam automaticamente inimigos no campo de visão, repelem ameaças, atacam e destroem barricadas ou torres inimigas que obstruam a rota, e retomam a progressão até o objetivo.
- **Observabilidade em Debug Mode**:
  - Exposição de telemetria completa via `getDebugState()`: decisão atual, prioridade, objetivo estratégico, recursos desejados (`coins`, `wood`, `stone`) e ação executada.
  - Renderização em tempo real no HUD e no DOM (`#ai-debug`, atributos `data-ai-red-*`) quando `?debug=1`.
- **Validação de Simulação IA vs IA Headless (`npm run simulate`)**:
  - Simulador de torneio headless atualizado rastreando marcos de quartel, casa, tropas, pedra, barricadas, torres, ataques e danos.
  - Amostra de torneio pareado executada com simetria e sem deadlocks: azul e vermelho obtêm pedra (~283s), constroem barricadas (~519s) e erguem torres (~641s) com saldo final de pedra saudável (> 370).
- **Testes e Gates Aprovados**:
  - `src/core/ai/AIController.test.ts`: 25 testes unitários cobrindo observabilidade, treino de construtor, construção de barricadas e torres, reparos sob pressão, ataque a barricadas/torres de campo e expansão de capacidade civil.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npm test`: 178/178 testes unitários aprovados em 24 arquivos.
## Playtest Feedback V1.1 — Correções Críticas de Movimento, Rally Point e Performance: concluída

- **Rally Point com Múltiplas Unidades Subsequentes**:
  - `src/core/commands/dispatchGroupMove.ts`: ajustado `maxRadius` para expandir dinamicamente a busca por células livres adjacentes (raio 1..5) mesmo para unidades individuais recém-geradas no spawn.
  - `src/core/systems/MovementSystem.ts`: quando o destino do rally point já está ocupado por um aliado estacionado, tropas subsequentes detectam proximidade (distância <= 1) e concluem sua chegada na formação de reunião ao invés de abortar ou ficar travadas. Se distantes, buscam o vizinho livre mais próximo para formar agrupamento coeso.
  - Teste unitário dedicado adicionado em `src/core/systems/RallyPointSystem.test.ts`.

- **Fluidez de Movimento em Grupo e Desobstrução de Tráfego Aliado**:
  - `src/core/systems/MovementSystem.ts`:
    - Eliminado o comportamento de abortar `entity.moveTarget = null` quando uma célula adiante no caminho está temporariamente ocupada por um aliado marchando. O sistema agora testa passos decrecentes (`steps` até 1); se todos os passos imediatos estiverem ocupados por aliados à frente, a unidade simplesmente aguarda 2 ticks pelo deslocamento do companheiro ao invés de cancelar permanentemente o comando de marcha.
    - Na checagem de rota, distinção clara entre bloqueios estáticos intransitáveis (água/montanha/edifícios) e congestionamento móvel de tropas aliadas.
  - Teste unitário dedicado adicionado em `src/core/systems/MovementSystem.test.ts`.

- **Otimização Massiva de Performance e Eliminação de Queda de FPS em Combate com a IA**:
  - `src/core/systems/MarchEngagementSystem.ts`:
    - Adicionada guarda rápida em `findBlockingEnemyStructure`: se a equipe inimiga não possui nenhuma barricada no mapa, o A* de 40.000 nós é imediatamente ignorado.
    - Varredura de estruturas bloqueantes estrangulada (throttle) para rodar apenas periodicamente (a cada 10/15 ticks) para tropas ociosas, eliminando mais de 450 buscas completas de A* por segundo durante confrontos.
  - `src/core/commands/dispatchGroupAttack.ts`: unidades fora de alcance que já estão marchando em direção ao alvo não sofrem cancelamento e reemissão redundante de comando de movimento a cada tick.
  - `src/core/entities/EntityStore.ts`: `isFreeForUnit` e `atCell` reescritos para iterar diretamente sobre o mapa interno sem alocar novos arrays de entidades a cada chamada.
  - `src/presentation/Minimap.ts`:
    - Implementado cache offscreen de canvas para terreno e fog de guerra, atualizando o buffer de 40.000 pixels somente quando a visão se altera (`visionChanged`), em vez de reescrever 40.000 pixels 60 vezes por segundo.
    - Leitura direta via `rawState` e `rawTerrain` com arrays tipados, eliminando a alocação de 2,4 milhões de objetos heap por segundo e erradicando picos de Garbage Collector.
  - `src/presentation/VisualFog.ts`: introduzidos métodos `rawState(x, y)` e `rawTerrain(x, y)` sem alocação de objetos.
  - `src/presentation/MapScene.ts`: removidas mais de 400 chamadas redundantes de desenho de linhas de grade em `drawFog()`.

- **Status do Gate e Validação Completa**:
  - `npm test`: 180/180 testes unitários aprovados em 24 arquivos.
  - `npm run lint`: 0 erros.
  - `npm run typecheck`: 0 erros.
  - `npx playwright test`: 29/29 testes E2E aprovados no Chromium.
  - Servidor Vite dev rodando estavelmente em `http://localhost:5173/`.

## Ambiente de Testes / Sandbox: concluída

- Painel retrátil acessível via botão `🧪 Sandbox` no HUD ou via parâmetros de URL `?sandbox=1` ou porta `5174`:
  - Recursos instantâneos (+5.000 moedas, madeira e pedra ou 99.999 infinitos).
  - Obra instantânea (1s) e Treino instantâneo (1s).
  - Controles de velocidade da simulação (1x, 2x, 4x).
  - Spawns imediatos de tropas e esquadrões azuis.
  - Spawn de inimigos vermelhos em posição tática central.
  - Pausar e retomar a IA para isolamento de testes.
  - Revelação total do mapa (desativação temporária de Fog of War).
- Testes E2E adicionados em `tests/e2e/sandbox.spec.ts`.

## Fase 11 — Polimento Visual Funcional: concluída

- **Estética Minimalista Preservada**: Blocos, pixels e formas geométricas limpas sem uso de sprites pesados.
- **Pedra (`stone`)**: Jazidas no mapa renderizadas com textura de granito cinza-claro mineral e sombras de rocha para diferenciação imediata de montanhas e planícies.
- **Construtor (`builder`)**: Destaque visual com crista amarela de capacete e ferramenta sobre o bloco da unidade, distinguindo instantaneamente o construtor do operário padrão.
- **Barricada (`barricade`)**: Traçado de viga dupla em X de madeira com rebites de fixação nos quatro cantos.
- **Torre (`tower`)**: Orbe ciano de vigia com núcleo pulsante e área de visão destacada na seleção.
- **Alerta de Capacidade**: Classe `.capacity-warning` aplicada dinamicamente ao `#capacity-status` no HUD quando a população civil, militar ou o teto global for atingido.
- **Reparo**: Contorno verde com indicador de ferramenta e emissão de centelhas periódicas na estrutura avariada sob reparo.
- **Attack-Move**: Pulso de onda vermelho (`0xff4d4f`) na célula clicada confirmando a ordem de marcha marcial.
- **Rally Point**: Traçado pontilhado dourado conectando a estrutura ao ponto de encontro com flâmula dourada.

## Fase 12 — Sons & Web Audio API Procedural: concluída

- **Síntese Procedural Pura**: Criação de `SoundSystem.ts` utilizando Web Audio API nativa com 0 dependências de arquivos de áudio externos ou downloads.
- **13 Efeitos Sonoros Implementados**:
  - `click`: cliques de seleção e botões no HUD.
  - `order`: confirmação de ordens recebidas (mover, coletar, construir, atacar, etc.).
  - `meleeAttack`: golpe corpo a corpo.
  - `rangedAttack`: sibilo de disparo de flechas de arqueiros.
  - `unitDeath`: queda e abatimento de unidade.
  - `buildingComplete`: acorde triunfante de conclusão de estrutura.
  - `unitProduced`: bipe duplo de recrutamento concluído.
  - `resourceDeposited`: tinido metálico de entrega de recursos no QG.
  - `buildingAttack`: impacto pesado contra edificações.
  - `baseUnderAttack`: alarme de emergência da base com cooldown de 3,5s.
  - `enemySpotted`: tom de contato visual com inimigo importante.
  - `victory`: fanfarra maior de destruição da base inimiga.
  - `defeat`: tom sombrio descendente de perda da base aliada.
- **Sistema Anti-Spam e Polifonia**: Cooldowns específicos por tipo de efeito sonoro e teto estrito de 4 vozes simultâneas, prevenindo cacofonia em batalhas massivas.
- **Controle e Persistência no HUD**: Botão `🔊 Som: ON` / `🔇 Som: OFF` integrado ao cabeçalho, com persistência em `localStorage` e desbloqueio seguro de áudio (`AudioContext.resume()`) no primeiro clique.
- **Testes**:
  - `SoundSystem.test.ts`: 6 testes unitários validando síntese, cooldowns, vozes concorrentes e persistência.
  - `tests/e2e/sound.spec.ts`: 2 testes ponta a ponta Playwright validando controle de áudio e alerta visual de capacidade.

---

## V1.1.1 — Sistema de Formações Militares Persistentes: 100% Concluída

- **4 Geometrias Táticas (`FormationGeometry.ts`)**:
  - `line`: Linha frontal única estendida perpendicularmente à direção de marcha.
  - `wedge`: Cunha / V-shape apontando para o vetor de deslocamento.
  - `block`: Bloco retangular sólido com fileiras proporcionais e coesas.
  - `double-rank`: Duas fileiras paralelas (frente e retaguarda).
  - Rotação dinâmica em 8 direções cardeais e diagonais (N, S, L, O, NE, NO, SE, SO).
- **Composição Inteligente por Função Militar**:
  - Escudeiros (`shieldbearer`): vanguarda / linha de frente / ponta da cunha.
  - Espadachins (`soldier`): frente secundária e preenchimento de posições de combate.
  - Batedores (`scout`): flancos laterais.
  - Arqueiros (`archer`): retaguarda e miolo protegido.
  - Operários e Construtores (`worker`, `builder`): mantidos estritamente fora do agrupamento militar automático.
- **Velocidade Coletiva Sincronizada**:
  - Grupo em marcha sincroniza o passo pela unidade mais lenta ativa (ex: escudeiro com velocidade 2).
  - Recálculo dinâmico caso a unidade mais lenta morra ou seja destacada.
  - Unidades presas temporariamente não travam todo o exército; tropas que ficam para trás podem usar velocidade nativa para reagrupar.
- **Controlador de Formações e Combate Integrado (`FormationController.ts`)**:
  - Máquina de estados: `MARCHANDO`, `EM_COMBATE`, `REAGRUPANDO`, `PARADO`.
  - Reorganização automática de slots em caso de baixas.
  - Desconexão de ordem individual: comando manual desconecta apenas aquela unidade da formação sem destruir o exército dos demais soldados.
- **Grupos de Controle e Interface HUD**:
  - Atalhos `Ctrl + 1..9` para gravar grupos de controle e `1..9` para selecionar.
  - Painel de seleção de formações no HUD para grupos militares com destaque para a formação ativa.
  - Prévia discreta (ghost markers ciano/azul) desenhada no terreno indicando onde os slots de frente e retaguarda se posicionarão.
  - Botão no Sandbox (`#sb-spawn-mixed-army`) para teste imediato de exército misto.

### Status de Qualidade V1.1.1:
- **TypeScript**: 0 erros (`npm run typecheck`).
- **ESLint**: 0 erros (`npm run lint`).
- **Vitest**: 205/205 testes passando (`npm test` — 27 suítes).
- **Playwright E2E**: 36/36 testes passando (`npx playwright test` — 12 suítes).

---

## V1.1.2 — Construção de Barricadas em Linha: 100% Concluída

- **Geometria de Linha Pura e Determinística (`LineGeometry.ts`)**:
  - Função pura `computeLineCells(start, end, bounds)` calculando linhas exclusivamente horizontais ou verticais conforme o eixo predominante ($|\Delta x| \ge |\Delta y|$).
  - Alinhamento determinístico à grade 200×200, suporte a arrasto bidirecional e clamping de bordas.
  - 7 testes unitários dedicados em `LineGeometry.test.ts`.
- **Validação Atômica Integral (*All-or-Nothing*)**:
  - `validateBuildLine(command, currentTick)` verifica 10 condições obrigatórias: integridade do construtor, cooldown, pertencimento ao mapa, distância da base (80 tiles), Fog of War, terreno plano sem estruturas prévias, reservas concorrentes, limite estrito de 100 barricadas por equipe, suficiência total de recursos e acessibilidade de perímetro.
  - Se qualquer célula for inválida, a ordem é integralmente rejeitada sem alterar recursos ou estado do jogo.
- **Reserva Antecipada de Recursos e Ledger**:
  - Débito integral e antecipado de madeira (10/peça) e pedra (5/peça) no momento da confirmação.
  - Ledger explícito de recursos (`committedWood`, `committedStone`, `spentWood`, `spentStone`) no plano.
  - Zero cobrança duplicada na inicialização ou término de cada barricada.
  - Em caso de cancelamento, reembolso automático e exato de todas as peças não iniciadas.
- **Reserva Lógica de Células (`reservedCells`)**:
  - Células planejadas são reservadas para impedir sobreposição de construções concorrentes.
  - Não altera a navegabilidade de tropas no pathfinding até o início físico da fundação.
- **Execução Sequencial e Comportamento Seguro do Construtor**:
  - Máquina de estados no plano: `PLANEJADA`, `DESLOCANDO`, `CONSTRUINDO`, `PAUSADA`, `CONCLUIDA`, `CANCELADA`.
  - Construção rigorosamente peça por peça com tempo real de 3 segundos por barricada.
  - `chooseOptimalLineDirection` avalia ambas as pontas e detecta afunilamentos/corredores com uma única saída (*corridor cut-off*), iniciando no fundo e recuando para garantir que o construtor nunca fique emparedado atrás de suas próprias barricadas.
- **Interface e Prévia Visual em Tempo Real (`MapScene.ts`)**:
  - Modo exclusivo de arrasto de barricadas ativado pelo botão `#btn-build-barricade`.
  - Prévia visual com grade semitransparente: Verde (`0x44dd88`) para linha 100% válida e Vermelho (`0xdd4444`) para inválida.
  - HUD Feedback dinâmico informando quantidade de barricadas, custos totais e motivo de rejeição.
  - Cancelamento intuitivo por tecla `ESC` ou clique com botão direito.
  - Clique simples preservado para posicionar uma única barricada.
- **Documentação e Benchmarks**:
  - Documentação completa em `docs/CONSTRUCAO_LINHA_V1_1_2.md`.
  - Script de benchmark em `scripts/benchmark-barricades.mjs` demonstrando impacto insignificante (< 0.07ms de tick médio).

### Status de Qualidade V1.1.2:
- **TypeScript**: 0 erros (`npm run typecheck`).
- **ESLint**: 0 erros (`npm run lint`).
- **Vitest**: 244/244 testes passando (`npm test` — 31 suítes).
- **Playwright E2E**: 42/42 testes passando (`npm run test:e2e` — 14 suítes).
- **Build de Produção**: 100% funcional (`npm run build`).











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
- `npm test`: 71 testes passaram (12 suítes de testes unitários).
- `npm run build`: passou.
- `npm run test:e2e`: 9 testes passaram (boot, navegação, seleção, produção, combate e IA autônoma no Chromium).

## Fase 9 — Vitória e fluxo completo: concluída

- A destruição de qualquer base registra vencedor, perdedor, duração e recursos/unidades restantes no core, interrompe a simulação no mesmo tick e rejeita novas ordens.
- A interface mostra vitória ou derrota e estatísticas básicas. O botão **Jogar novamente** inicia uma partida nova.
- Corrigida a abertura da IA: um operário explora a região próxima para descobrir madeira enquanto outro preserva a renda de moedas. O quartel tem prioridade sobre a casa no primeiro ciclo de construção.
- Teste de regressão simula 6 minutos a partir dos recursos iniciais, sem injeção, e verifica produção militar da IA.

### Gate

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e`: passaram.

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

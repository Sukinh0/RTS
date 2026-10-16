# Relatório de Implementação — RTS V1.1

## 1. Visão Geral
Este documento consolida a evolução da versão **V1** para a **V1.1** do RTS, cumprindo todos os requisitos estabelecidos em `docs/v1.1.md`. A arquitetura base (grid 200×200, desacoplamento estrito entre simulação lógica e renderização Phaser, fog of war, tempo real contínuo sem pausas e teto global de 60 unidades) foi integralmente preservada, recebendo novas camadas de estratégia, economia, fortificação, inteligência artificial, feedback visual funcional e áudio procedural.

---

## 2. Funcionalidades Implementadas por Fase

### Fase 1 — Economia & Recurso Pedra
- **Novo Recurso**: Jazidas de `stone` (pedra) integradas ao mapa em posições estratégicas e rotas secundárias.
- **Coleta**: Operários mineram/coletam pedra com taxa de coleta de 4/s e capacidade máxima de carga de 20 por viagem à base.
- **Estoque & HUD**: Indicadores de pedra em tempo real no HUD e na seleção da entidade.

### Fase 2 — Especialização Econômica: Construtor vs. Operário
- **Unidade Construtor (`builder`)**: Custo de 150 moedas, HP 10, velocidade 5. Especializado em erguer construções (Casas, Quartéis, Barricadas e Torres) e executar reparos. Não coleta recursos.
- **Ajuste do Operário (`worker`)**: Dano balanceado para 4, coleta ouro, madeira e pedra; constrói apenas Casas e Quartéis.
- **Feedback Visual**: Marcador visual de capacete/ferramenta amarelo no topo do sprite do construtor.

### Fase 3 — Sistema de Capacidade Populacional Diferenciada
- **Capacidade Civil**: Provida pela Base (2) e Casas (+2 por Casa concluída).
- **Capacidade Militar**: Provida por Quartéis (+5 por Quartel concluído).
- **Teto Absoluto**: 60 unidades por equipe.
- **Validação Estrita**: Filas de treino rejeitam novos civis ou militares se o teto respectivo for atingido.
- **Feedback Visual**: Classe `.capacity-warning` no HUD alertando quando o teto civil ou militar for alcançado.

### Fase 4 — Sistema de Barricadas
- **Especificação**: Pegada 1×1, HP 120, custo de 10 madeira e 5 pedra. Limite de 100 barricadas por jogador.
- **Mecânica Tática**: Bloqueia fisicamente passagem de unidades terrestres (podendo fechar caminhos/gargalos), mas permite projéteis de arqueiros por cima.
- **Visual**: Viga dupla em X de madeira com rebites de fixação.

### Fase 5 — Sistema de Reparos
- **Mecânica**: Construtores podem reparar construções danificadas com botão direito ou comando explícito.
- **Custos**: Consumo de madeira e pedra por segundo durante a restauração de HP até o valor máximo.
- **Visual**: Contorno verde, centelhas de ferramenta periódicas e status no painel de seleção.

### Fase 6 — Torre de Vigilância & Contra-Inteligência
- **Estrutura 2×2**: Custo de 200 moedas, 150 madeira e 100 pedra.
- **Visão 20×20**: Campo de visão estendido contínuo.
- **Detecção de Furtividade**: Revela Batedores (`scout`) inimigos mesmo que estejam invisíveis. Não ataca unidades.
- **Visual**: Base fortificada com orbe ciano de vigia e núcleo emissor.

### Fase 7 — Attack-Move & Marcha Militar
- **Comando de Marcha Marcial**: Unidades avançam em direção ao destino e atacam automaticamente qualquer inimigo no caminho.
- **Retomada de Marcha**: Ao abater a ameaça, a unidade prossegue até o destino original.
- **Atalho & HUD**: Tecla `A` e botão no painel de ações.
- **Feedback Visual**: Anel de pulso vermelho (`0xff4d4f`) na célula clicada ao ordenar.

### Fase 8 — Inteligência Artificial Autônoma (IA Vermelha)
- **Regras Idênticas ao Jogador**: A IA não possui visão através do Fog of War, não recebe recursos gratuitos e não burla cooldowns.
- **Árvore de Decisão Reativa**:
  - Avaliação de capacidade civil/militar e expansão preditiva (Casas e Quartéis).
  - Coleta de ouro, madeira e pedra conforme a necessidade de construção ou recrutamento.
  - Scouting de gargalos com Batedores.
  - Bloqueio de rotas com Barricadas e fortificação com Torres.
  - Defesa imediata quando a base for atacada e contra-ataques coordenados.
- **Observabilidade**: Atributos `data-ai-red-*` no DOM e linha informativa no HUD em modo `?debug=1`.

### Fase 9 — Rally Points (Pontos de Reunião)
- **Configuração**: Casas e Quartéis podem definir pontos de destino no mapa para unidades recém-treinadas.
- **Despacho Automático**: Unidades recém-nascidas marcham automaticamente para o ponto definido.
- **Visual**: Traçado pontilhado dourado conectando a construção ao destino com flâmula/bandeira dourada.

### Fase 10 — Minimapa Tático
- **Canvas Tático 160×160**: Renderização offscreen rápida com cores contrastantes para terreno, água, minas, pedra e bases.
- **Respeito ao Fog**: Oculta inimigos e áreas não exploradas.
- **Navegação**: Clique ou arrasto reposiciona a câmera principal suavemente.

### Fase 11 — Polimento Visual Funcional
- **Estética Minimalista**: Formas geométricas limpas e contrastantes (sem sprites pesados).
- **Diferenciação Visual**:
  - Jazidas de pedra com textura de granito cinza-claro mineral.
  - Construtores com crista distintiva amarela.
  - Barricadas com X de viga de madeira.
  - Contorno verde e centelhas em construções sob reparo.
  - Pulso vermelho no destino de Attack-Move.
  - Alerta de capacidade no HUD.

### Fase 12 — Áudio Procedural (Web Audio API)
- **Zero Assets Externos**: Toda a síntese de áudio é gerada programaticamente via Web Audio API.
- **Efeitos Implementados (13 SFX)**:
  - `click`: feedback de clique e seleção.
  - `order`: confirmação de ordem aceita (mover, atacar, construir, etc.).
  - `meleeAttack`: impacto metálico curto.
  - `rangedAttack`: sibilo e disparo de flecha.
  - `unitDeath`: ruído descendente de baixa frequência.
  - `buildingComplete`: acorde fanfarra ascendente de conclusão.
  - `unitProduced`: bipe duplo de spawn militar/civil.
  - `resourceDeposited`: tinido metálico de moedas/recursos na base.
  - `buildingAttack`: impacto pesado e estrondo em estrutura.
  - `baseUnderAttack`: sirene/alarme klaxon urgente.
  - `enemySpotted`: tom de alerta de contato visual.
  - `victory`: fanfarra triunfante em tríade maior.
  - `defeat`: tom sombrio dissonante descendente.
- **Anti-Spam & Limite de Vozes**:
  - Cooldowns específicos por efeito (ex: `baseUnderAttack` 3.5s, `meleeAttack` 75ms).
  - Limite máximo de 4 vozes concorrentes ativas.
- **Controles no HUD**: Botão `🔊 Som: ON` / `🔇 Som: OFF` com persistência em `localStorage`. Desbloqueio seguro de áudio (`AudioContext.resume()`) no primeiro gesto do usuário.

---

## 3. Ambiente de Testes & Sandbox (Adicional V1.1)
- Painel interativo acessível pelo cabeçalho do HUD ou diretamente via query `?sandbox=1` ou porta `5174`:
  - Recursos rápidos (+5.000 ou 99k).
  - Obra instantânea (1s) e Treino instantâneo (1s).
  - Velocidade do jogo acelerada (1x, 2x, 4x).
  - Spawns imediatos de qualquer tipo de unidade ou esquadrões inteiros.
  - Spawn de inimigos para testes de combate.
  - Pausa/Retomada da IA e revelação completa do mapa (sem fog).

---

## 4. Arquivos Principais Alterados e Criados
- **Economia & Configurações**:
  - `config/balance.v1.json`: Adição de custos, atributos de pedra, construtor, barricada, torre, taxas de reparo e capacidade.
  - `src/config/map.ts`: Mapa simétrico 200×200 com jazidas de pedra, gargalos defensivos e múltiplos corredores.
- **Núcleo de Simulação**:
  - `src/core/entities/EntityStore.ts`: Suporte às novas entidades (`builder`, `barricade`, `tower`).
  - `src/core/systems/EconomySystem.ts`: Coleta de pedra e balanceamento de operários.
  - `src/core/systems/ConstructionSystem.ts`: Construção de barricadas, torres e sistema de reparos.
  - `src/core/systems/ProductionSystem.ts`: Capacidade civil vs. militar e despacho de rally points.
  - `src/core/systems/CombatSystem.ts`: Ataque através de barricadas e priorização de alvos.
  - `src/core/systems/TowerSystem.ts`: Visão contínua 20×20 e revelação de batedores furtivos.
  - `src/core/systems/MarchEngagementSystem.ts`: Marcha com engajamento automático e retomada de avanço.
  - `src/core/commands/dispatchGroupAttackMove.ts`: Dispersão e validação em grupo de Attack-Move.
  - `src/core/ai/AIController.ts`: IA autônoma com consciência de recursos, capacidade, fortificação e combate.
- **Apresentação e Interface**:
  - `src/presentation/MapScene.ts`: Renderização integrada de novas estruturas, texturas de pedra, efeitos visuais, áudio e controles.
  - `src/presentation/Minimap.ts`: Componente do minimapa com suporte a fog, visão e navegação.
  - `src/presentation/SoundSystem.ts`: Sistema completo de síntese procedural via Web Audio API.
  - `index.html` & `src/style.css`: Estrutura de minimapa, controles de áudio, aviso de capacidade e painel sandbox.
- **Simulação e Testes**:
  - `src/simulation/tournament.ts`: Simulador headless IA vs. IA rodando partidas automatizadas.
  - `tests/e2e/*`: Cobertura ponta a ponta com Playwright para todas as mecânicas.

---

## 5. Decisões Arquiteturais
1. **Desacoplamento Rigoroso**: O núcleo lógico (`src/core/*`) não possui nenhuma referência a DOM, canvas ou Phaser. Isso viabiliza testes headless em milissegundos e simulações automatizadas de torneio em Node.
2. **Web Audio Procedural**: Ao invés de carregar arquivos MP3/WAV pesados (sujeitos a erros de rede, latência ou direitos autorais), todos os timbres utilizam osciladores (`sine`, `square`, `sawtooth`, `triangle`) e filtros passa-baixa nativos do navegador.
3. **Throttling e Limite de Polifonia**: Para evitar saturação sonora em batalhas massivas com dezenas de soldados, um pool com teto de 4 vozes simultâneas e cooldowns por categoria previne ruídos indesejados.
4. **Alinhamento da IA**: A IA do time vermelho utiliza os mesmos comandos e restrições que o jogador humano, garantindo competitividade justa sem "cheats" de fog ou recursos gratuitos.

---

## 6. Cobertura de Testes

### Testes Unitários e de Integração (Vitest)
- **Total**: 188 testes em 25 arquivos de teste.
- **Status**: 100% aprovados (`188/188 passed`).
- **Principais suítes**:
  - `CombatSystem.test.ts` (16 testes)
  - `BarricadeSystem.test.ts` (7 testes)
  - `ProductionSystem.test.ts` (5 testes)
  - `RallyPointSystem.test.ts` (10 testes)
  - `MovementSystem.test.ts` (12 testes)
  - `RepairSystem.test.ts` (9 testes)
  - `EconomySystem.test.ts` (10 testes)
  - `AttackMoveSystem.test.ts` (9 testes)
  - `CapacitySystem.test.ts` (8 testes)
  - `TowerSystem.test.ts` (10 testes)
  - `SoundSystem.test.ts` (6 testes)
  - `AIController.test.ts` (25 testes)
  - `tournament.test.ts` (2 testes)

### Testes End-to-End (Playwright)
- **Total**: 33 testes em 11 arquivos de teste.
- **Status**: 100% aprovados (`33/33 passed`).
- **Testes executados no navegador**:
  - `ai.spec.ts`: Operação autônoma da IA e observabilidade.
  - `boot.spec.ts`: Carregamento do jogo, relógio e inspeção.
  - `combat.spec.ts`: Ataques corporais, à distância, reflexão de dano e Attack-Move.
  - `full-journey.spec.ts`: Partida completa de ponta a ponta.
  - `minimap.spec.ts`: Renderização e navegação de câmera pelo minimapa.
  - `playtest-regressions.spec.ts`: Validações de fluidez e marcha.
  - `production.spec.ts`: Construção, capacidade, reparos, torres e rally points.
  - `result.spec.ts`: Condições de vitória e derrota.
  - `sandbox.spec.ts`: Painel e ferramentas de teste.
  - `selection.spec.ts`: Seleção individual, em área e comandos.
  - `sound.spec.ts`: Controles de áudio, persistência e alerta visual de capacidade.

### Simulação Headless IA vs. IA (`npm run simulate`)
- **Partidas**: 100 partidas automatizadas (seeds 123 a 172 com alternância de iniciativa).
- **Estabilidade**: 100/100 partidas executadas sem erros ou falhas de motor (`reports/simulation-100games-seed123.md`).
- **Marcos Médios Observados**:
  - Primeiro quartel: 143,6s (ambas as equipes).
  - Primeira tropa recrutada: 185,5s.
  - Primeira pedra coletada: 280,4s (azul) e 282,6s (vermelho).
  - Primeira casa concluída: 286,3s.
  - Primeira barricada erguida: 519,7s.
  - Primeira torre erguida: 889,7s.
  - Estoque final médio de pedra: 385,2.
  - Simetria total, sem deadlocks ou colapsos de IA.

---

## 7. Valores de Balanceamento Provisórios (V1.1)

| Entidade / Ação | Custo Moedas | Madeira | Pedra | Tempo / CD | Vida | Dano / Alcance |
|---|---:|---:|---:|---:|---:|---:|
| **Operário** | 150 | 0 | 0 | 6s / 3s cd | 10 | 4 dano (curto) |
| **Construtor** | 150 | 0 | 0 | 6s / 1s cd | 10 | 0 dano |
| **Soldado** | 100 | 0 | 0 | 5s / 3s cd | 18 | 5 dano (alc 2) |
| **Arqueiro** | 180 | 0 | 0 | 7s / 4s cd | 10 | 8 dano (alc 4) |
| **Escudeiro** | 150 | 0 | 0 | 7s / 3s cd | 24 | 2 dano + 80% reflexão |
| **Batedor** | 200 | 0 | 0 | 6s / 5s cd | 8 | 0 dano (visão 8, furtivo) |
| **Casa** | 150 | 100 | 0 | 8s | 60 | +2 capacidade civil |
| **Quartel** | 200 | 120 | 0 | 10s | 120 | +5 capacidade militar |
| **Barricada** | 0 | 10 | 5 | 3s | 120 | Bloqueio 1×1 (máx 100) |
| **Torre** | 200 | 150 | 100 | 12s | 150 | Visão 20×20 / Revela furtivos |
| **Reparo** | — | 2/s | 2/s | 5 HP/s | — | Até HP máximo |

---

## 8. Bugs Conhecidos e Limitações Observadas
1. **Política de Autoplay de Navegadores**: Alguns navegadores bloqueiam o início imediato de som caso o usuário não clique previamente na página. O método `soundSystem.unlock()` foi plugado para ser acionado com o primeiro clique.
2. **Agrupamento em Gargalos Estreitos**: Quando grandes pelotões (15+ unidades) avançam simultaneamente por desfiladeiros de 1 célula, o sistema de pathfinding pode gerar pequenos atrasos nas unidades do fim da fila até as primeiras liberarem espaço.

---

## 9. Sugestões para Playtest & Métricas para a V1.2
1. **Taxa de Uso de Torres vs. Barricadas**: Medir se os jogadores investem em torres na defensiva ou se preferem linhas contínuas de barricadas.
2. **Eficiência da Furtividade do Batedor**: Testar se batedores conseguem extrair informações valiosas da base inimiga antes de serem descobertos por torres de vigilância.
3. **Curva de Custo de Pedra**: Avaliar se o custo de pedra para torres (100) está balanceado com o tempo médio de partida (~4 a 8 minutos).
4. **Feedback de Combate Ranged**: Analisar se o dano dos arqueiros atirando sobre barricadas cria defesas impenetráveis e se requer unidades de cerco ou armas de cerco na V1.2.

---

## 10. Conclusão
A versão **V1.1** está **100% concluída**, atendendo com rigor a todos os requisitos arquiteturais, funcionais, de legibilidade visual, áudio e testes.

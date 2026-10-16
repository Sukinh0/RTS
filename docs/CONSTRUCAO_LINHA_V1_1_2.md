# RTS V1.1.2 — IMPLEMENTAÇÃO DE CONSTRUÇÃO DE BARRICADAS EM LINHA

## 1. Objetivo da Versão

A atualização **V1.1.2** adiciona ao jogo o sistema de **Construção de Barricadas em Linha** através de interação intuitiva de clique e arrasto (*click-and-drag*), mantendo a compatibilidade estrita com a construção individual por clique simples.

O objetivo é permitir que o jogador selecione um construtor, ative a opção de barricada e desenhe rapidamente linhas contínuas defensivas, contando com:
- Geração determinística de linha baseada no eixo predominante (horizontal ou vertical);
- Prévia visual em tempo real (Verde = Válido, Vermelho = Inválido) com cálculo de quantidade e custos (Madeira e Pedra);
- Validação atômica integral (*all-or-nothing*): a ordem só é aceita se todas as células forem simultaneamente válidas e puderem ser pagas;
- Reserva antecipada e integral dos recursos necessários, prevenindo gastos concorrentes ou saldos negativos;
- Reserva lógica de células para impedir sobreposição de estruturas sem interferir precocemente no pathfinding de unidades;
- Execução sequencial peça a peça, escolhendo a extremidade acessível e permitindo recuo seguro do construtor sem auto-aprisionamento em corredores;
- Ciclo de cancelamento completo com estorno exato das peças não iniciadas, sem duplicação de consumo ou reembolso;
- Preservação integral de balanceamento, determinismo e alta performance.

---

## 2. Arquitetura Utilizada

A funcionalidade foi integrada à arquitetura existente do motor do jogo, que opera desacoplada entre simulação e renderização:

```
[ Usuário: MapScene (Phaser 3) ]
       │
       ├─ Clique & Arrasto ──> computeLineCells(start, end, bounds) [LineGeometry.ts]
       ├─ Prévia em Tempo Real (Graphics verde/vermelho + Feedback HUD)
       │
       ▼ pointerup
[ Simulation.issueCommand({ type: 'build-line', ... }) ]
       │
       ├─ Record upfront resource spend in MatchStats
       ▼
[ ConstructionSystem ]
       ├─ validateBuildLine(): Validação atômica (recursos, terreno, fog, limite 100, acessibilidade)
       ├─ chooseOptimalLineDirection(): Avaliação de pontas e detecção de corte/gargalo
       ├─ Criação de BarricadeLinePlan (estado: PLANEJADA -> DESLOCANDO -> CONSTRUINDO)
       ├─ Reserva de células em reservedCells (Map<"x,y", planId>)
       ├─ Execução sequencial no método tick()
       └─ Cancelamento & Reembolso em cancelLinePlan() / cancel()
```

---

## 3. Arquivos Modificados e Criados

| Arquivo | Status | Responsabilidade |
|---------|--------|------------------|
| `src/core/construction/LineGeometry.ts` | **Novo** | Função pura determinística `computeLineCells` (sem dependência do Phaser). |
| `src/core/construction/LineGeometry.test.ts` | **Novo** | Testes unitários para geometria de linhas horizontais, verticais, arrasto inverso e bounds. |
| `src/core/commands/MoveCommand.ts` | **Modificado** | Interface `BuildLineCommand` e integração ao union `GameCommand`. |
| `src/core/systems/ConstructionSystem.ts` | **Modificado** | Tipagem `BarricadeLinePlan`, validação atômica `validateBuildLine`, emissão `issueBuildLine`, gerenciamento de reservas de células, seleção de direção ideal com detecção de afunilamento, execução sequencial no `tick()`, cancelamento e reembolso. |
| `src/core/game/Simulation.ts` | **Modificado** | Despacho do comando `build-line` com contabilidade de estatísticas de partida. |
| `src/presentation/MapScene.ts` | **Modificado** | Interação de clique e arrasto no modo de barricada, prévia colorida com grade, HUD feedback em tempo real com contagem e custos, confirmação no `pointerup`, e cancelamento via ESC / botão direito. |
| `src/core/systems/LineBarricade.test.ts` | **Novo** | 17 testes de sistema cobrindo geometria, validação atômica, reservas, ciclo de vida de recursos e comportamento do construtor em corredores estreitos. |
| `tests/e2e/barricade-line.spec.ts` | **Novo** | 4 testes E2E Playwright cobrindo interação no navegador (clique simples, arrasto válido, arrasto inválido, tecla ESC). |
| `scripts/benchmark-barricades.mjs` | **Novo** | Script de benchmark comparando 6 cenários de construção de barricadas. |
| `docs/CONSTRUCAO_LINHA_V1_1_2.md` | **Novo** | Esta documentação técnica. |
| `PROGRESS.md` | **Modificado** | Registro do progresso da versão V1.1.2. |

---

## 4. Geração da Linha (`LineGeometry.ts`)

A função pura `computeLineCells(start: Point, end: Point, bounds: { width: number; height: number }): Point[]`:
1. Calcula deslocamentos $\Delta x = x_2 - x_1$ e $\Delta y = y_2 - y_1$.
2. Determina o eixo predominante com base em $|\Delta x| \ge |\Delta y|$:
   - Se $|\Delta x| \ge |\Delta y|$, a linha é **horizontal** fixa em $y = y_1$, variando $x$ de $x_1$ a $x_2$ na direção $\text{stepX} = \text{sign}(\Delta x)$.
   - Caso contrário, a linha é **vertical** fixa em $x = x_1$, variando $y$ de $y_1$ a $y_2$ na direção $\text{stepY} = \text{sign}(\Delta y)$.
3. Clampa cada coordenada aos limites $[0, \text{bounds.width} - 1]$ e $[0, \text{bounds.height} - 1]$.
4. Não gera duplicatas, vazios ou diagonais. Garante que se `start === end`, resulta em exatamente 1 célula.

---

## 5. Validação Atômica

A validação ocorre via `validateBuildLine(command, currentTick)` e é estritamente atômica (*all-or-nothing*):
1. **Entidade do Construtor:** Deve existir, ser da categoria `unit`, pertencer à equipe solicitante e ser da classe `builder`.
2. **Cooldown:** Deve estar liberado de cooldowns de ações prévias.
3. **Células Válidas:** A lista de células não pode ser vazia e todas as células devem estar dentro do mapa.
4. **Distância da Base:** Nenhuma célula pode ultrapassar `BALANCE.construction.maxDistanceFromBase` (80 tiles).
5. **Fog of War:** Nenhuma célula pode estar no estado `'unknown'`.
6. **Terreno & Estruturas:** Todas as células devem ter terreno `'plain'`, sem `structureTeam` e sem construções pré-existentes.
7. **Reservas Concorrentes:** Nenhuma célula pode estar reservada por outro plano de construção (`isCellReserved`).
8. **Limite de Construção:** A soma de barricadas ativas + barricadas em fundação + reservas atuais + novas células não pode ultrapassar o teto configurado de **100 barricadas por equipe** (`maxPerTeam`).
9. **Recursos Totais:** O jogador deve possuir integralmente `cells.length * 10` de madeira e `cells.length * 5` de pedra.
10. **Acessibilidade:** Pelo menos uma das extremidades da linha precisa ter uma célula de perímetro acessível por pathfinding a partir da posição atual do construtor.

Se qualquer uma dessas 10 verificações falhar, a ordem é rejeitada com código explícito de falha sem tocar no estado do jogo.

---

## 6. Reserva de Recursos e Ledger

Adotou-se o modelo de **Débito Antecipado com Saldo Comprometido**:
- No momento da aceitação da ordem (`issueBuildLine`), o valor total de madeira e pedra é debitado de `stock[team]`.
- O plano registra:
  - `committedWood`: total debitado.
  - `committedStone`: total debitado.
  - `spentWood`: valor correspondente às peças que já iniciaram fundação.
  - `spentStone`: valor correspondente às peças que já iniciaram fundação.
- Conforme cada barricada tem sua fundação criada, o custo individual dela é transferido de não-iniciado para iniciado.
- Ao concluir a linha, o plano encerra sem débitos adicionais.
- Em caso de cancelamento, interrupção ou morte do construtor, os recursos das **peças não iniciadas** são imediatamente reembolsados:
  $$\text{Reembolso Madeira} = \text{committedWood} - \text{spentWood}$$
  $$\text{Reembolso Pedra} = \text{committedStone} - \text{spentStone}$$
- **Zero consumo duplicado**, **zero reembolso duplicado** (garantido por exclusão atômica do plano) e **ausência de saldo negativo**.

---

## 7. Reserva de Células

Para coordenar planos simultâneos sem poluir o mapa físico:
- As células planejadas são registradas no mapa de controle `reservedCells: Map<string, string>` (chave `"x,y"`, valor `planId`).
- Uma célula reservada rejeita novas ordens de construção (tanto individuais quanto em linha) que tentem sobrepor-se a ela.
- **Não altera a transitabilidade física de unidades no pathfinding**: as tropas continuam podendo atravessar células reservadas até o momento em que a fundação daquela peça específica seja efetivamente iniciada no mapa.
- Conforme o construtor inicia cada peça, a célula é removida de `reservedCells` e convertida em uma entidade `building` com `underConstruction: true` (que passa a seguir as regras físicas normais de bloqueio).

---

## 8. Estados de Execução e Ciclo de Vida do Plano

A interface `BarricadeLinePlan` gerencia o ciclo de vida com os estados:
- `PLANEJADA`: Ordem aceita e recursos comprometidos; aguardando início da primeira peça.
- `DESLOCANDO`: Construtor em trânsito para o perímetro da peça atual, ou aguardando expiração de cooldown entre peças.
- `CONSTRUINDO`: Fundação da peça ativa posicionada; pontos de vida e progresso de ticks sendo incrementados.
- `PAUSADA`: Estado transitório caso ocorra perda temporária de condições sem cancelamento imediato.
- `CONCLUIDA`: Todas as barricadas da linha foram erguidas com sucesso; reservas liberadas e plano finalizado.
- `CANCELADA`: Ordem abortada manualmente ou por bloqueio superveniente; recursos das peças não iniciadas estornados.

---

## 9. Comportamento do Construtor e Prevenção de Auto-Aprisionamento

A escolha da direção de construção é feita por `chooseOptimalLineDirection(builder, cells)`:
1. **Verificação de Corte / Gargalo (*Corridor Cut-off*):**
   - Testa se construir a partir da extremidade inicial (`first`) cortaria o acesso do construtor até a extremidade final (`last`).
   - Se o construtor estiver na entrada de um beco ou corredor estreito (com apenas uma saída), a função inverte a linha para construir do fundo do corredor em direção à saída (`[...cells].reverse()`).
   - Dessa forma, o construtor sempre recua em direção ao espaço aberto, construindo as barricadas atrás de si sem se emparedar.
2. **Proximidade:** Se ambas as pontas tiverem rotas abertas equivalentes, prioriza a ponta mais próxima do construtor.
3. **Sequenciamento no Loop:**
   - Cada barricada leva 3 segundos de construção real (tempo de balanceamento).
   - Ao concluir a peça $k$, o construtor recebe cooldown de ação e imediatamente avalia o perímetro da peça $k+1$.
   - Se o construtor estiver sobre a célula da próxima peça, ele primeiro se desloca para o perímetro adjacente antes de iniciar a fundação.

---

## 10. Cancelamentos e Interrupções

Tratamento completo de todas as hipóteses de cancelamento:
1. **Cancelamento Manual (`sim.construction.cancel(builderId)`):**
   - Interrompe a tarefa ativa do construtor.
   - Libera todas as células pendentes de `reservedCells`.
   - Reembolsa as peças não iniciadas.
   - Peças já concluídas ou em fundação permanecem no mapa.
2. **Nova Ordem para o Construtor:** Emitir novo comando de movimentação ou ataque para o construtor cancela automaticamente o plano em andamento com estorno devido.
3. **Morte do Construtor:** Detectada no início de `updateLinePlan`; o plano é cancelado com reembolso das peças não iniciadas.
4. **Destruição da Fundação Ativa:** Se inimigos destruírem a barricada enquanto ela ainda está sendo construída, o plano detecta `foundation-destroyed` e cancela a continuidade da linha.
5. **Obstáculo Superveniente:** Se uma célula reservada for bloqueada antes de seu início (ex: alteração de terreno ou estrutura), a validação no avanço da peça cancela o plano e estorna as peças restantes.

---

## 11. Interface e Experiência do Usuário (HUD / Phaser)

Na cena `MapScene`:
- Ao clicar no botão `#btn-build-barricade`, entra-se no `placementMode: { kind: 'barricade', width: 1, height: 1 }`.
- O modo de arrasto de barricada (`dragMode: 'barricade'`) assume controle exclusivo do mouse:
  - `pointerdown`: Registra a célula inicial.
  - `pointermove`: Recalcula as células da linha usando `computeLineCells` apenas quando a célula do mouse muda.
  - **Renderização Visual:** Grade semitransparente desenhada no canvas:
    - **Verde (`0x44dd88`):** Linha 100% válida.
    - **Vermelho (`0xdd4444`):** Linha inválida (obstáculo, falta de recursos ou fora de alcance).
  - **HUD Feedback Dinâmico:** Exibe quantidade de barricadas, custo total em madeira e pedra, e motivo de bloqueio quando inválido:
    - *Exemplo Válido:* `"Linha de 5 barricada(s) válida. Custo: 50 madeira, 25 pedra."`
    - *Exemplo Inválido:* `"Linha de 5 barricada(s) inválida: blocked (blocked) (Custo: 50m, 25p)."`
  - `pointerup`: Se válido, emite o comando `build-line`; se inválido, cancela a operação e informa o jogador.
  - **Cancelamento:** Pressionar `ESC` ou clicar com o `botão direito` descarta a prévia e retorna ao modo normal de seleção.
  - **Clique Simples Preservado:** Um clique sem arrasto gera uma linha de tamanho 1, posicionando uma única barricada normalmente.

---

## 12. Testes Realizados e Validação

### Testes Unitários e de Sistema (Vitest)
Executados com `npm test`: **31 arquivos de teste, 244 testes aprovados (100% de sucesso)**.

- `src/core/construction/LineGeometry.test.ts` (7 testes):
  - Linha horizontal esquerda -> direita e direita -> esquerda.
  - Linha vertical cima -> baixo e baixo -> cima.
  - Eixo predominante $|dx| \ge |dy|$.
  - Linha de uma única célula ($x_1=x_2, y_1=y_2$).
  - Clamping estrito nos limites da grade lógica.

- `src/core/systems/LineBarricade.test.ts` (17 testes):
  - Linha 100% válida aceita com débito antecipado.
  - Falha atômica com obstáculo no início, meio ou fim da linha.
  - Bloqueio por sobreposição com outra linha reservada.
  - Rejeição atômica por falta de madeira ou pedra.
  - Aceitação com recursos exatamente suficientes.
  - Limite estrito de 100 barricadas por equipe respeitado.
  - Ausência de cobrança duplicada durante a construção sequencial.
  - Cancelamento antes do início (estorno de 100%).
  - Cancelamento durante execução (estorno proporcional das não-iniciadas).
  - Cancelamento por morte do construtor.
  - Ausência de reembolso duplicado em cancelamentos concorrentes.
  - Execução sequencial completa até a conclusão.
  - Escolha determinística da extremidade aberta.
  - Construção em corredor estreito com recuo e sem auto-aprisionamento.
  - Obstáculo superveniente interrompendo e estornando restantes.

### Testes End-to-End no Navegador (Playwright)
Executados com `npm run test:e2e`: **42 testes aprovados (100% de sucesso)**.

- `tests/e2e/barricade-line.spec.ts` (4 testes):
  - Clique simples constrói uma única barricada normalmente.
  - Arrasto de mouse cria linha horizontal válida e inicia construção sequencial no canvas Phaser.
  - Arrasto sobre obstáculo exibe feedback inválido e rejeita confirmação.
  - Tecla ESC cancela o modo de prévia sem construir.

- `tests/e2e/production.spec.ts` (8 testes):
  - Todas as construções existentes (casas, quartéis, torres, reparos e barricada individual) mantêm 100% de compatibilidade.

---

## 13. Resultados de Performance

Bateria executada através de `scripts/benchmark-barricades.mjs` (300 ticks por cenário):

| Cenário Avaliado | Tick Médio | Tick p95 | Tick Máximo | Tempo Despacho Comando |
|------------------|------------|----------|-------------|------------------------|
| **1. Partida sem construção (baseline)** | 0.020 ms | 0.031 ms | 1.476 ms | 0.008 ms |
| **2. Construção de 1 barricada** | 0.021 ms | 0.016 ms | 3.892 ms | 1.336 ms |
| **3. Linha de 10 barricadas** | 0.061 ms | 0.020 ms | 10.296 ms | 1.809 ms |
| **4. Linha de 30 barricadas** | 0.011 ms | 0.020 ms | 0.358 ms | 0.219 ms |
| **5. Linha próxima do limite (90 barricadas)** | 0.007 ms | 0.009 ms | 0.387 ms | 0.129 ms |
| **6. Construção com 30 tropas em marcha** | 0.281 ms | 0.904 ms | 31.327 ms | 0.182 ms |

### Conclusões de Performance:
- O impacto do gerenciamento da linha no tick da simulação é insignificante (< 0.07 ms), correspondendo a menos de 0.2% do orçamento de 33.33 ms por frame.
- A validação atômica e o despacho de comandos para linhas de até 90 barricadas levam menos de 2 ms.
- Nenhuma estrutura física é instanciada antecipadamente, preservando a eficiência dos caches de navegação e do spatial indexing.

---

## 14. Limitações Conhecidas e Escopo Futuro

1. **Apenas Linhas Ortogonais:** Por especificação de projeto da V1.1.2, apenas linhas puramente horizontais ou verticais são geradas. Diagonais ou curvas não são suportadas.
2. **Um Construtor por Linha:** Cada plano de linha é atribuído a um único construtor responsável pela sequência completa. Apoio cooperativo de múltiplos construtores na mesma linha poderá ser explorado em versões futuras.
3. **IA Adversária:** Conforme especificado, a IA do time vermelho mantém seu comportamento atual de posicionamento de barricadas pontuais para defesa, não utilizando construção em linha nesta versão.

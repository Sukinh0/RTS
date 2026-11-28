# IA — V1

## Objetivo
A IA deve se comportar como um jogador real, sob as mesmas regras e sem bônus ocultos.

## Proibido
A IA não pode:
- enxergar através da fog;
- saber posição atual de inimigos fora da visão;
- receber recursos extras;
- acessar diretamente o estado secreto do jogador;
- teleportar ou ignorar cooldown/pathfinding.

## Responsabilidades
A IA deve:
- gerar economia;
- decidir quando usar minas;
- coletar madeira;
- construir casas e quartéis;
- produzir composição militar;
- explorar;
- guardar memória de descobertas;
- defender ameaças;
- atacar quando houver oportunidade;
- buscar a base inimiga e destruí-la.

## Arquitetura sugerida
Utility AI + máquina de estados para execução.

A cada intervalo de decisão, calcular utilidade para intenções como:
- Economy
- GatherWood
- Mine
- BuildHouse
- BuildBarracks
- ProduceWorker
- ProduceMilitary
- Scout
- Defend
- AttackArmy
- AttackBase
- Retreat/Reposition

A intenção escolhida gera ordens usando o mesmo sistema de comandos do jogador.

Na implementação atual, exploração, economia e produção continuam mesmo quando há uma ordem de ataque. O primeiro quartel prioriza soldados e arqueiros para formar a guarda e a primeira leva; o batedor explora depois. Essas escolhas não concedem recursos nem visão extra à IA.

**Abertura.** Cada time define quantas unidades de combate (2 a 4) quer antes de gastar moedas com civis extras. Enquanto essa força não foi encomendada, a IA não reserva moedas para operários; a primeira Casa espera as duas primeiras tropas (a menos que haja moedas para a Casa e um soldado); e, com três ou mais operários, novos civis aguardam. Depois de perdas, a mesma prioridade volta, desde que existam ao menos três operários. Com a força formada, a IA volta a reservar moedas para operários e construtor.

**Variedade por seed.** O tamanho da força inicial e o ponto de reunião do flanco variam conforme a seed e o time, sem depender da ordem de criação das IAs. Os corredores opostos norte/sul e o ataque direto pelo centro (1 em cada 4 seeds) continuam. Nada disso concede recursos nem visão extra.

**Ataque e defesa.** Um atacante fica designado como guarda da base e os demais que estiverem por perto respondem a invasores. Uma leva ofensiva parte quando há ao menos duas reservas além da guarda e a base não está ameaçada; reforços entram na leva ativa em grupos de ao menos duas. O último sobrevivente de uma leva recebe ordem de recuo, exceto se já estiver junto à base inimiga visível. Se a guarda morrer, a IA escolhe uma substituta. Uma unidade em marcha pode receber novo destino durante o intervalo entre passos, sem mover antes do fim desse intervalo.

Áreas reveladas mostram inimigos ao vivo para os dois lados. Para escolher defesa e alvos de ataque, a IA considera apenas o que está dentro do raio de visão atual das próprias unidades e construções.

## Estratégia parametrizada
Decisões ajustáveis ficam em `src/core/ai/AIStrategy.ts`. `DEFAULT_STRATEGY` é usada no jogo; `LEGACY_STRATEGY` é o comportamento anterior, mantido como adversário fixo. Nenhum parâmetro concede recursos, visão ou cooldown extras.

- **Economia:** com madeira ou pedra sobrando, coletores voltam para o ouro.
- **Defesa:** foca primeiro o invasor armado mais próximo, socorre operários e construções afastados e chama a leva de volta quando há mais combatentes inimigos na base do que defensores (exceto se ela já estiver atacando a base inimiga).
- **Aviso antecipado:** não lança nova leva enquanto dois ou mais combatentes inimigos aparecem, em área revelada, a até 60 casas da base.
- **Torre avançada:** depois da força inicial, pede um construtor e tenta erguer a primeira torre a cerca de 35 casas da base, rumo ao inimigo; sem área revelada ali, a torre fica perto da base. A torre só dá visão, não ataca.
- **Barricadas:** protegem a frente da torre avançada com até quatro peças espaçadas.

Para medir uma mudança contra o comportamento anterior, com os lados trocados em cada seed:

```
npm run duel -- --games=100 --seed=5000 --strategy='{"smartDefense":false}'
```

O JSON em `--strategy` sobrepõe valores de `DEFAULT_STRATEGY`. A pontuação vale 1 por vitória e 0,5 por empate; 0,5 indica forças iguais.

## Princípios
- Decisões determinísticas quando possível.
- Seed configurável.
- Não recalcular estratégia a cada frame.
- Separar decisão estratégica de micro das unidades.
- Recursos devem ser gastos considerando necessidades atuais, e não por roteiro fixo.

## Simulação IA vs IA
A arquitetura deve permitir rodar partidas sem renderização para análise de balanceamento.

Saídas mínimas:
- vencedor;
- duração;
- unidades produzidas;
- recursos acumulados/gastos;
- construções feitas;
- composição final;
- causa da vitória.

## Treino por vitória (`npm run train`)

Busca evolutiva (entropia cruzada) sobre os parâmetros de `AIStrategy` listados em
`src/training/genome.ts`. O aprendizado vem somente do resultado das partidas:
vitória 1, empate 0,1, derrota 0. A nota combina 70% da média geral com 30% da média no
lado (azul ou vermelho) em que a versão se sai pior. Não há rede neural nem aprendizado durante a
partida do jogador, e a IA treinada não recebe bônus.

- **Geração:** várias versões jogam as mesmas seeds, dos dois lados, contra a campeã,
  a IA padrão e uma campeã antiga. O melhor quarto orienta a geração seguinte.
- **Promoção:** a melhor desafiante só substitui a campeã se vencê-la em seeds novas
  (vitórias > derrotas × 1,15) sem pontuar menos que ela contra as IAs padrão e antiga.
- **Medida de progresso:** a campeã é medida em seeds fixas (900000+), fora do treino.
- **Variação no treino:** com a mesma estratégia, as seeds quase não mudam a partida
  (12 seeds chegaram a gerar só 2 partidas). Por isso o treino sorteia, por cor, um
  atraso inicial de 0 a 5 s e um intervalo de decisão de 0,8 a 1,2 s. O jogo e o
  `duel` mantêm o ritmo fixo.
- **Arquivos:** `estado.json` (retomada), `campea.json`, `relatorio.html` e
  `historico.csv` na pasta `--out`. A campeã é copiada para `public/ia-treinada.json`;
  `?ia=treinada` faz o adversário usá-la.
- **Uso fácil no Windows:** copie `tools/treino/` para uma pasta `treino` ao lado de
  `rts_v1_pack` e use os arquivos `.bat`.

Opções: `--hours`, `--generations`, `--out`, `--workers`, `--population`, `--seeds`,
`--promotion-seeds`, `--benchmark-seeds`, `--max-seconds`, `--seed`, `--game-copy`.
Os tamanhos de uma sessão salva valem até apagar o `estado.json`.

**Limites:** só os parâmetros listados são aprendidos; o mapa é sempre o mesmo; ser a
melhor contra outras IAs não garante dificuldade contra uma pessoa; uma campeã que fixa
`openingArmy` ou `route` varia menos de uma seed para outra.

## Guardar para a primeira torre (`defenseAfterTroops`)

Com essa quantidade de tropas de ataque vivas (padrão 3; 0 desliga), e sem ameaça perto
da base, a IA reserva recursos na ordem casa → construtor → torre. Enquanto reserva, só
treina tropas com o ouro que sobrar, não cria operários além de três, não faz um segundo
quartel nem barricadas na base, e mantém coletores de madeira e pedra (sempre com pelo
menos um minerador). Inimigos de combate a até 30 casas, ou o alerta antecipado,
cancelam a reserva. Depois da primeira torre, o gasto volta ao normal.

Motivo: soldados (100 de ouro) eram sempre comprados antes da casa e do construtor
(150), e a torre quase nunca saía. Em 80 partidas espelhadas contra a IA antiga
(seeds 5000+), a torre passou de 23 para 40 partidas; vitórias, de 46 para 44.

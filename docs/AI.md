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

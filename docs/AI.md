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

Após o primeiro soldado, a IA reserva moedas para uma Casa e novos operários. Mantém um coletor de madeira por vez; os demais mineram quando uma mina foi descoberta ou geram moedas passivamente. A exploração dos operários prossegue além da primeira floresta até encontrar uma mina. Com três operários, a produção militar volta a usar o excedente; ao formar três atacantes, a meta econômica sobe para quatro operários. Todas as ordens respeitam fog, custos e cooldowns do jogador.

Na defesa, um atacante fica designado como guarda da base e os demais que estiverem por perto respondem a invasores. Uma leva ofensiva parte com ao menos três atacantes além da guarda. Reforços aguardam outra leva de três; o último sobrevivente de uma leva destruída recebe ordem de recuo. Se a guarda morrer, a IA escolhe uma substituta. Uma unidade em marcha pode receber novo destino durante o intervalo entre passos, sem mover antes do fim desse intervalo.

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

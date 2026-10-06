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

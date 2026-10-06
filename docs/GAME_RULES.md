# Regras Consolidadas — RTS V1

## Mapa
- 200 x 200 células úteis.
- Quadrado.
- Coordenadas internas inteiras.
- 1 unidade por célula.
- Água, montanhas e construções bloqueiam passagem.
- Florestas são fonte de madeira.
- Minas são pontos de trabalho econômico.

## Unidades
- Limite global por equipe: 60.
- Operários contam no limite.
- Cada unidade tem vida, visão, movimento e cooldown próprios.

## Ações em tempo real
O jogo nunca pausa por ação.

Uma unidade pode receber ordem quando estiver disponível. Ao executar uma ação relevante, entra em cooldown. Durante esse período ela continua existindo no mundo, pode sofrer dano e ser descoberta, mas não inicia nova ação manual.

Ações principais:
- mover
- atacar
- coletar
- trabalhar em mina
- construir

Unidades militares podem executar ações reativas automáticas quando um inimigo entra no alcance, desde que estejam disponíveis.

## Movimento
- Movimento define o máximo de células percorridas em uma ação.
- Pathfinding obrigatório.
- V1 permite horizontal, vertical e diagonal.
- O motor não deve permitir atravessar células bloqueadas ou unidades.
- Ao finalizar a ação de movimento, a unidade entra no cooldown correspondente.

## Combate
- Ataque manual tem prioridade sobre seleção automática.
- Sem alvo manual, unidade ofensiva pode atacar automaticamente inimigo visível em alcance.
- Regra padrão de autoalvo: inimigo visível mais próximo; menor HP como desempate.
- Dano é determinístico na V1.
- HP <= 0 remove a unidade.

## Escudeiro
- Não ataca.
- Ao receber ataque de inimigo adjacente, reflete 80% do dano causado ao atacante.
- O escudeiro recebe 100% do dano original.

## Batedor
- Não ataca.
- Fica invisível quando nenhum inimigo está a distância <= 5.
- Torna-se detectável quando um inimigo entra a distância <= 5, respeitando a visão/fog.

## Construções
- Base: única por jogador. Não reconstruível na V1.
- Casa: produz operários.
- Quartel: produz unidades militares.

## Vitória
A partida termina imediatamente quando a base de uma equipe chega a 0 HP.

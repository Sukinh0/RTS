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

## Operário
- Causa 4 de dano a alcance 1, com cooldown de ataque de 3s.
- Pode receber ordem manual de ataque e se defende automaticamente de inimigos adjacentes quando estiver disponível.
- Não interrompe automaticamente uma marcha de coleta para perseguir inimigos.

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
- Base dá visão em raio de 40 casas; Casa e Quartel, em raio de 30 casas.
- Casa e Quartel podem ser colocados no máximo a 80 casas da Base, medindo a distância entre os centros.

## Vitória
A partida termina imediatamente quando a base de uma equipe chega a 0 HP.

## Ajustes pós-playtest da V1

- O movimento tem intervalo de 1 segundo entre ações; uma ordem longa continua por segmentos até o destino. O arqueiro anda até 3 células por ação. O ataque do arqueiro mantém intervalo de 4 segundos.
- Tropas com dano que marcham detectam unidades e construções inimigas na própria visão, respeitando furtividade. Elas se aproximam, atacam e retomam o destino original quando o alvo morre ou some da visão. A ordem manual prevalece.
- Ataques do mesmo tick são resolvidos em conjunto para que uma tropa abatida ainda complete o ataque já iniciado naquele instante. A disputa por uma mesma célula de movimento alterna a prioridade entre equipes a cada segundo.
- A camada visual da fog acompanha a posição desenhada da unidade. Terreno e construções descobertos ficam na memória da última visão e só são atualizados quando vistos novamente.

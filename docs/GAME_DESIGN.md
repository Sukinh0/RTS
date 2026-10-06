# Game Design — RTS V1

## Visão
RTS tático minimalista para navegador, com câmera fixa de cima, mapa em grade e unidades representadas por pixels/blocos coloridos.

A identidade do jogo vem de três pilares:
1. **Informação** — fog of war e batedores importam.
2. **Ações discretas em tempo real** — o jogo não pausa; unidades executam ações e entram em cooldown.
3. **Economia + posicionamento** — decisões de recurso e entrada em alcance geram risco real.

## Partida
- 1 jogador humano vs 1 IA.
- Mapa lógico quadrado de 200 x 200 células.
- Cada unidade ocupa 1 célula.
- Limite de 60 unidades por equipe, contando operários.
- Duração-alvo: ~20 minutos, sem limite rígido.
- Vitória: destruir a base inimiga.

## Estado inicial
Cada jogador começa com:
- 1 Base
- 2 Operários
- 100 moedas
- 50 madeira

## Loop principal
Explorar → gerar recursos → coletar madeira → construir → produzir tropas → obter informação → atacar/defender → destruir a base inimiga.

## Visual V1
- Top-down.
- Grade visível.
- Unidades: pontos/blocos coloridos.
- Água, montanhas, florestas e minas: células/pontos simples.
- Fog em 3 estados.
- Nada de sprites complexos, animações elaboradas ou arte final.

A referência visual está em `references/visual_reference.png`.

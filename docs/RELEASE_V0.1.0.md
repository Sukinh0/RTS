# RTS V1 — v0.1.0

## Entrega

A V1 abre no navegador e permite uma partida Humano vs IA: explorar o mapa, gerar e coletar recursos, construir casa e quartel, produzir unidades, combater e encerrar a partida com vitória ou derrota. A simulação permanece separada do Phaser.

## Verificação

- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: 76 testes passaram.
- `npm run build`: passou.
- `npm run test:e2e`: 12 testes passaram no Chromium.
- `npm run simulate -- --games=100 --seed=123`: 100 partidas IA vs IA concluídas; resultado e método em `docs/BALANCE_REPORT.md`.

O E2E principal percorre, pela interface, seleção, exploração, coleta de madeira, construção de casa e quartel, produção de operário e soldado, ataque e vitória. Ele acelera o relógio lógico e usa `?noai=1` para isolar a jornada do jogador. A ativação e as decisões da IA no navegador são verificadas em outro teste.

## Limites conhecidos

- O mapa é único e o visual é minimalista, como previsto para a V1.
- O torneio IA vs IA mostrou 37 vitórias azuis e 63 vermelhas em 100 partidas pareadas; a causa da vantagem residual vermelha ainda não foi isolada.
- O build emite um aviso de tamanho do bundle do Phaser. O aviso não impede a execução.

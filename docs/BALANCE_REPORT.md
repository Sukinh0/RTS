# Relatório de simulação e balanceamento — Fase 10

## Método

`npm run simulate -- --games=100 --seed=123` executa o core sem Phaser. São 50 seeds, cada uma repetida com a ordem de ativação das IAs invertida, totalizando 100 partidas. Cada partida usa o mapa e os recursos iniciais da V1 e tem limite de 900 segundos simulados. O JSON e a tabela completos estão em `reports/simulation-100games-seed123.*`.

## Resultado da linha de base

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 37 | 63 |
| Primeiro quartel (média) | 270,17 s | 280,85 s |
| Primeira tropa (média) | 275,17 s | 285,85 s |
| Ataques por partida (média) | 39,58 | 42,77 |
| Dano por partida (média) | 197,90 | 213,85 |

Não houve empate por tempo. A duração média foi de 805 segundos. Por ordem de ativação, o vermelho venceu 28 de 50 partidas quando o azul iniciou primeiro, e 35 de 50 quando o vermelho iniciou primeiro.

## Leitura e decisão

A IA vermelha vence mais apesar de o azul produzir a primeira tropa antes. A medição identifica uma vantagem residual na partida IA vs IA, mas não isola uma causa única. Foram corrigidas duas assimetrias de lógica encontradas durante a implementação: a rota inicial de exploração e o destino de marcha próximo à base adversária. Os valores de custo, tempo, dano, vida e renda em `config/balance.v1.json` não foram alterados nesta fase; um bônus numérico por equipe confundiria a análise do comportamento e mudaria a dificuldade da partida Humano vs IA.

Esta linha de base usa um único mapa e uma única política de IA. Ela não substitui playtests humanos nem mede todos os cenários de combate. O próximo ciclo de balanceamento pode comparar alterações em `config/balance.v1.json` com o mesmo comando e as mesmas seeds, além de observar partidas humanas.

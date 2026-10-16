# Balanceamento Inicial — V0.1

Todos os valores devem vir de `config/balance.v1.json`. Não espalhar números mágicos pelo código.

## Unidades

| Unidade | Vida | Dano | Alcance | Visão | Movimento | Cooldown | Moedas | Madeira |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Operário | 10 | 4 | 1 | 5 | 5 | 3s | 150 | 0 |
| Soldado | 18 | 5 | 2 | 5 | 3 | 3s | 100 | 0 |
| Escudeiro | 25 | Reflexão 80% | 1 | 3 | 2 | 3s | 150 | 0 |
| Batedor | 8 | — | — | 8 | 6 | 5s | 200 | 0 |
| Arqueiro | 10 | 8 | 4 | 6 | 3 | 4s | 180 | 0 |

O cooldown de **movimento** é de 1s para todas as unidades. A coluna Cooldown indica o intervalo de **ataque** ou ação especial; o arqueiro continua com ataque de 4s, dano 8 e alcance 4. Movimento e ataque usam a mesma disponibilidade de ação, com a duração definida pela última ação executada.

## Construções

| Construção | Tamanho inicial | HP | Moedas | Madeira | Tempo |
|---|---:|---:|---:|---:|---:|
| Base | 4x4 | 150 | inicial | inicial | — |
| Casa | 2x2 | 60 | 150 | 100 | 8s |
| Quartel | 3x3 | 80 | 200 | 120 | 12s |

A Base revela 40 casas; Casa e Quartel revelam 30 casas, medidos até a borda da construção. Casas e Quartéis só podem ser colocados até 80 casas da Base, usando a distância euclidiana entre os centros das construções.

## Produção

| Unidade | Tempo de produção |
|---|---:|
| Operário | 6s |
| Soldado | 5s |
| Escudeiro | 7s |
| Batedor | 6s |
| Arqueiro | 7s |

## Economia
- Operário livre: +1 moeda/s.
- Operário na mina: não gera renda passiva.
- Mina: +50 moedas após 30s completos.
- Madeira: capacidade inicial sugerida do operário = 20.
- Coleta inicial sugerida = 2 madeira/s.

Os valores de madeira/coleta são defaults técnicos para tornar a V1 completa e devem ser validados em playtest.

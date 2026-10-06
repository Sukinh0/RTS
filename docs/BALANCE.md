# Balanceamento Inicial — V0.1

Todos os valores devem vir de `config/balance.v1.json`. Não espalhar números mágicos pelo código.

## Unidades

| Unidade | Vida | Dano | Alcance | Visão | Movimento | Cooldown | Moedas | Madeira |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Operário | 10 | — | — | 5 | 5 | 3s | 150 | 0 |
| Soldado | 18 | 5 | 2 | 5 | 3 | 3s | 100 | 0 |
| Escudeiro | 25 | Reflexão 80% | 1 | 3 | 2 | 3s | 150 | 0 |
| Batedor | 8 | — | — | 8 | 6 | 5s | 200 | 0 |
| Arqueiro | 10 | 8 | 4 | 6 | 2 | 4s | 180 | 0 |

## Construções

| Construção | Tamanho inicial | HP | Moedas | Madeira | Tempo |
|---|---:|---:|---:|---:|---:|
| Base | 4x4 | 150 | inicial | inicial | — |
| Casa | 2x2 | 60 | 150 | 100 | 8s |
| Quartel | 3x3 | 80 | 200 | 120 | 12s |

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

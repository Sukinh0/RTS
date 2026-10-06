# Economia — V1

## Recursos
A V1 possui dois recursos:
- Moedas
- Madeira

## Renda passiva
Cada operário que estiver livre gera:
- +1 moeda por segundo.

Operários em atividades de trabalho não geram renda passiva.

## Mina
- Um operário pode receber ordem para trabalhar em uma mina.
- Enquanto trabalha, não gera +1 moeda/s.
- Após 30 segundos completos: +50 moedas.
- Se morrer, sair ou for interrompido antes do ciclo terminar: +0.
- Default V1: até 4 operários simultâneos por mina, cada um com timer próprio.

## Madeira
Fluxo da V1:
1. Operário recebe ordem em floresta.
2. Vai até célula válida de coleta.
3. Coleta até sua capacidade.
4. Retorna à base.
5. Deposita madeira.
6. Se a ordem continuar válida, retorna à floresta.

Defaults iniciais:
- capacidade: 20 madeira
- taxa: 2 madeira/s

## Construções
### Casa
- 150 moedas
- 100 madeira
- produz operários

### Quartel
- 200 moedas
- 120 madeira
- produz soldados, escudeiros, batedores e arqueiros

## Estado inicial
- 100 moedas
- 50 madeira
- 2 operários

Consequência de design: nenhuma construção adicional pode ser feita imediatamente; o jogador precisa desenvolver a economia.

# Arquitetura Técnica — V1

## Stack
- TypeScript
- Phaser 3
- Vite
- Vitest
- Playwright

## Regra principal
**Core de simulação independente da engine visual.**

Phaser não deve ser a fonte da verdade do jogo.

## Camadas

### 1. Core / Simulation
Responsável por:
- relógio do jogo;
- entidades;
- componentes/atributos;
- comandos;
- cooldowns;
- movimento;
- combate;
- economia;
- produção;
- construção;
- fog;
- vitória.

Sem dependência de Phaser/DOM.

### 2. AI
- recebe somente visão permitida do estado;
- gera comandos;
- usa mesma API de comandos do jogador.

### 3. Map / Navigation
- grid 200x200;
- ocupação;
- terreno;
- A*;
- validação de caminhos;
- distância.

### 4. Presentation
Phaser:
- câmera;
- zoom/pan;
- grid;
- unidades e prédios;
- fog visual;
- seleção;
- feedback de alcance/caminho;
- UI/HUD.

### 5. Input / Commands
Converte mouse/teclado em comandos de domínio:
- MoveCommand
- AttackCommand
- GatherCommand
- MineCommand
- BuildCommand
- ProduceCommand

### 6. Config
Toda regra numérica vem de arquivos de configuração.

## Estrutura sugerida
```text
src/
  core/
    game/
    entities/
    systems/
    commands/
    events/
  map/
  ai/
  presentation/
  input/
  config/
  tests/
```

## Determinismo
Para testes e IA vs IA:
- fixed timestep na simulação;
- RNG com seed;
- IDs estáveis;
- regras de desempate explícitas.

## Debug mode
Deve poder exibir:
- coordenadas;
- HP;
- cooldown;
- alvo;
- caminho;
- visão;
- alcance;
- célula ocupada;
- intenção atual da IA.

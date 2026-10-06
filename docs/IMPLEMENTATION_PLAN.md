# Plano de Implementação — ordem obrigatória

## Fase 0 — Fundação
- TypeScript + Vite + Phaser.
- Vitest + Playwright.
- balance config.
- fixed timestep.
- seed RNG.
- estrutura de módulos.

**Gate:** testes rodam e build abre no navegador.

## Fase 1 — Grid + mapa + câmera
- grid 200x200;
- terreno;
- bloqueios;
- pan/zoom;
- render minimalista.

**Gate:** mapa de teste é navegável e células são inspecionáveis em debug.

## Fase 2 — Entidades + seleção
- unidades;
- ownership;
- seleção única;
- box selection;
- shift selection;
- HUD básico.

## Fase 3 — Movimento
- comandos;
- A*;
- ocupação;
- movimento por ação;
- cooldown.

**Gate:** testes de movimento verdes.

## Fase 4 — Fog + visão
- 3 estados;
- visão por unidade;
- memória;
- batedor/furtividade.

## Fase 5 — Economia
- renda passiva;
- mina;
- floresta;
- transporte/deposito de madeira.

## Fase 6 — Construção + produção
- base;
- casa;
- quartel;
- placement;
- timers;
- filas;
- limite 60.

## Fase 7 — Combate
- ataque manual;
- autoataque;
- alcance;
- dano;
- cooldown;
- morte;
- escudeiro;
- arqueiro.

## Fase 8 — IA
- visão restrita;
- memória;
- Utility AI;
- economia;
- produção;
- scouting;
- ataque/defesa.

## Fase 9 — Vitória e fluxo completo
- destruição da base;
- tela de vitória/derrota;
- restart;
- estatísticas básicas.

## Fase 10 — Simulação e balanceamento
- modo headless;
- IA vs IA;
- 100 partidas;
- relatório;
- ajustes somente via config.

## Fase 11 — E2E
- jornada completa automatizada;
- correções finais;
- tag `v0.1.0`.

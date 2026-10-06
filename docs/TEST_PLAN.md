# Plano de Testes — V1

A V1 só é aceita se a lógica principal estiver coberta por testes automatizados.

## Unitários / Core

### Movimento
- não atravessa água;
- não atravessa montanha;
- não atravessa construção;
- não termina em célula ocupada;
- encontra rota alternativa;
- respeita movimento máximo;
- entra em cooldown ao terminar ação.

### Economia
- operário livre gera +1 moeda/s;
- operário na mina gera 0 passivo;
- 30s completos na mina = +50;
- interrupção antes de 30s = +0;
- madeira respeita capacidade;
- depósito aumenta estoque da equipe.

### Combate
- dano correto;
- alcance correto;
- cooldown impede nova ação;
- morte em HP <= 0;
- autoataque só em alvo visível;
- ordem manual tem prioridade;
- reflexão do escudeiro = 80% arredondado para baixo;
- reflexão não encadeia.

### Batedor
- invisível sem inimigo a <=5;
- detectável com inimigo a <=5;
- fog respeitada.

### Fog
- estado desconhecido;
- descoberta;
- perda de visão;
- manutenção da memória do terreno;
- informação dinâmica não atualiza fora da visão.

### Construção
- valida custo;
- valida madeira;
- valida footprint;
- não constrói em terreno bloqueado;
- não sobrepõe unidade/prédio;
- tempo de construção;
- recursos debitados corretamente.

### Produção
- fila funciona;
- custo debitado ao entrar na fila;
- tempo correto;
- limite de 60 respeitado;
- spawn em célula válida.

### Vitória
- base em 0 HP encerra a partida imediatamente;
- vencedor correto.

## Testes de cenário

### Scenario 001 — prioridade após movimento
- Soldado A move e entra no alcance de B.
- A fica em cooldown.
- B está disponível.
- B ataca primeiro.

### Scenario 002 — operário emboscado na fog
- Operário entra em área desconhecida.
- Descobre inimigos.
- Está em cooldown e não pode recuar imediatamente.
- Inimigo disponível pode atacar.

### Scenario 003 — escudeiro
- Atacante adjacente causa 5.
- Escudeiro perde 5.
- Atacante recebe 4.

### Scenario 004 — arqueiro fora da adjacência
- Arqueiro ataca escudeiro a distância >1.
- Não recebe reflexão.

### Scenario 005 — batedor
- Sem inimigo <=5: invisível.
- Inimigo entra em <=5: detectável.

## E2E com Playwright
- abrir jogo;
- iniciar partida;
- selecionar unidade;
- mover;
- coletar madeira;
- construir casa;
- produzir operário;
- construir quartel;
- produzir soldado;
- atacar;
- destruir base;
- exibir tela de vitória.

## Simulação
Comando-alvo:
`npm run simulate -- --games=100 --seed=123`

Deve produzir resumo estatístico sem abrir o Phaser.

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
# Regressões do playtest pós V1

- `VisualFog.test.ts`: posição visual determina a revelação; terreno explorado mantém a última imagem até voltar à visão.
- `MarchEngagementSystem.test.ts`: aquisição, aproximação e retomada da marcha, furtividade e prioridade manual.
- `CombatSystem.test.ts` e `MovementSystem.test.ts`: ataques simultâneos e alternância de prioridade de movimento.
- `playtest-regressions.spec.ts`: unidade inimiga aparece na fronteira visual sem salto, engajamento durante marcha, paleta e HUD fora do mapa em telas de 1280px e 760px. As capturas ficam em `artifacts/`.
- Jornada completa com economia real, sem injeção de recursos; torneio de 100 partidas deve ser repetido após qualquer ajuste de combate ou movimento.

## Regressões da IA e do relatório final

- `AIController.test.ts`: a IA constrói mesmo depois de formar grupo de ataque, envia batedor para explorar e treina unidade de combate com os recursos iniciais.
- `GameResult.test.ts` e `EconomySystem.test.ts`: contam produção concluída, baixas, ouro e madeira recebidos, custos aceitos e captura dos totais no encerramento.
- `result.spec.ts`: compara as duas equipes no navegador e garante que a tabela final cabe em tela compacta com rolagem.
- Repetir `npm run simulate -- --games=100 --seed=123` ao mudar a estratégia da IA; registrar tempo até primeiro combate e empates, além de vitórias.

## Economia da IA e efeitos leves

- Avançar 600 segundos com os recursos iniciais e conferir descoberta de mina, operário produzido, tropas produzidas e mais de 900 moedas coletadas, sem injeção de recursos.
- Verificar no navegador que o cronômetro do HUD segue os ticks da simulação e para no resultado.
- Inspecionar no navegador os pulsos curtos de coleta, mineração, construção, surgimento de unidades e impacto em combate. Efeitos de inimigos só aparecem em células atualmente visíveis.

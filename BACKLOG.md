# Backlog antes do aceite da V1

Origem: playtest humano de 2026-10-06. Os seis itens foram implementados e passaram pelas verificações automatizadas e pela inspeção visual no navegador. Estado: **aguardando novo aceite humano da experiência**.

## 1. Investigar unidades inimigas que somem ou parecem teleportar — P0

**Problema observado:** durante o avanço, algumas unidades inimigas desaparecem da tela e reaparecem em outra posição.

- Reproduzir com uma partida humana contra IA e registrar posição lógica, posição desenhada, eventos de movimento, estado de visão, morte e furtividade do batedor.
- Separar desaparecimento legítimo por fog/furtividade/morte de falha de renderização ou salto visual entre segmentos da ação.
- Corrigir a sincronização entre simulação e apresentação sem revelar tropas fora da visão. Verificar também o mapa já explorado: mudanças de terreno ou construções fora da visão atual não devem vazar pela camada visual.
- **Aceite:** tropas visíveis avançam continuamente sem sumir ou saltar; quando deixam de ser visíveis, a transição corresponde às regras de fog/furtividade. Um teste de navegador cobre o caso reproduzido e um teste protege a memória visual de células exploradas.

## 2. Tornar a movimentação mais fluida — P0

**Problema observado:** deslocamento parece travado, com paradas ou saltos excessivos.

- Avaliar separadamente interpolação visual, cadência das ações e cooldown. Ajustar a apresentação e, se necessário, os parâmetros centralizados de movimento após comparar em playtest; manter pathfinding, ocupação e determinismo do core.
- Garantir transições suaves entre segmentos de uma ordem longa e feedback claro quando a unidade estiver aguardando cooldown ou bloqueada.
- **Aceite:** em uma marcha longa, unidades não dão saltos visuais nem ficam aparentemente paradas sem indicação; a ordem continua até o destino ou falha explicada. Validar com teste automatizado de continuidade e playtest humano.

## 3. Ajustar o deslocamento do arqueiro — P1

- Alterar o alcance de movimento por ação do arqueiro de **2 para 3 casas**, igual ao soldado, na configuração central de balanceamento.
- Manter o tempo/cooldown do ataque do arqueiro em **4 segundos**, além do dano **8** e alcance de ataque **4** atuais. Não igualar sua cadência de ataque à do soldado.
- Atualizar a tabela de balanceamento e os testes afetados.
- **Aceite:** arqueiro percorre até 3 casas por ação, respeita cooldown e continua atacando a cada 4 segundos quando disponível.

## 4. Melhorar o HUD para acompanhar a partida — P1

- Dar leitura rápida de recursos, população, seleção, HP, ordem atual, alvo, destino e tempo restante de cooldown.
- Mostrar estado e progresso de construção, coleta e filas de produção; sinalizar ordens recusadas e motivo de forma legível.
- Preservar o visual minimalista e evitar que o HUD cubra a área útil do mapa. Incluir legenda para as cores das tropas.
- **Aceite:** em playtest, o jogador consegue identificar o que cada seleção está fazendo e por que uma ordem não foi executada, sem consultar o modo debug. Verificar interações e tamanhos de tela no navegador.

## 5. Tropas engajam inimigos vistos durante uma marcha — P0

- Enquanto seguem uma ordem de movimento, tropas capazes de causar dano devem detectar e atacar **unidades e construções inimigas que entrem no próprio campo de visão**, mesmo sem ordem manual de ataque. Aproximar-se até o alcance de ataque quando necessário.
- Respeitar fog, furtividade, pathfinding, cooldown, alvos válidos e desempate determinístico. Não atacar aliados. Escudeiro e batedor seguem sem dano; a regra posterior de V1 concedeu 4 de dano e alcance 1 ao operário.
- Após perder ou eliminar o alvo, retomar a marcha original quando ainda houver destino válido. A ordem manual de ataque mantém prioridade.
- Aplicar a regra a tropas do jogador e da IA. Esta é a regra provisória da V1; uma postura configurável pode ser definida depois.
- **Aceite:** tropa em marcha interrompe para engajar inimigo avistado, não reage a inimigo oculto, e retoma a rota quando o combate termina. Cobrir os três cenários em testes de core e ao menos um fluxo no navegador.

## 6. Cor própria para cada tipo de tropa — P1

- Definir cores distintas e consistentes para soldado, arqueiro, escudeiro e batedor; operário também deve ser reconhecível. Manter identificação inequívoca da equipe por contorno, marcador ou outro elemento simples.
- Aplicar as cores à unidade, seleção e legenda do HUD sem perder contraste com terreno e fog.
- **Aceite:** tipo e equipe são distinguíveis a zoom normal em ambos os lados; captura visual de navegador confirma a paleta.

## Gate para reavaliar a V1

- Todos os seis itens acima concluídos e conferidos em partida humana contra IA ativa.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e` passam.
- Revisar o balanceamento e a simulação IA vs IA após as mudanças de movimento e combate; registrar o efeito, sem compensação numérica por equipe.
- Atualizar documentação de regras, balanceamento, testes e progresso com o comportamento entregue.

## Verificação da implementação

1. Visão visual interpolada, memória de terreno e construções e teste de transição do inimigo na borda da visão: concluídos.
2. Movimento com intervalo de 1s, interpolação ao longo de toda a ação, feedback de espera e teste de continuidade no Chromium: concluídos.
3. Arqueiro com movimento 3, ataque 4s/dano 8/alcance 4, testes e tabela: concluídos.
4. HUD lateral responsivo com recursos, seleção, ordem, alvo, destino, cooldown, trabalho, construção, filas, rejeições e legenda: concluído. Capturas em `artifacts/`.
5. Engajamento oportunista de tropas em marcha para ambas as equipes, com retomada da rota e prioridade manual: concluído e coberto por testes de core e navegador.
6. Paleta por classe com contorno de equipe e seleção: concluída e inspecionada nas capturas desktop e compacta.

O fluxo de navegador com ordem do jogador e IA ativa passou usando apenas recursos iniciais. A jornada completa sem IA também passou. O novo torneio de 100 partidas está registrado em `reports/`; seus resultados e limites estão em `docs/BALANCE_REPORT.md`. O aceite final da sensação de jogo depende de novo playtest humano.

## Ajustes táticos ainda abertos para o aceite da V1

- Medir em playtest humano se a guarda segura uma investida real e se a IA reagrupa reforços sem ataques isolados.
- Reduzir o tempo até o primeiro confronto sem voltar a desperdiçar grupos pequenos. Na amostra tática, o primeiro combate ocorreu em média aos 570,4 segundos.
- Melhorar a escolha de alvos e o encerramento de ataques: dez partidas espelhadas IA vs IA terminaram empatadas, embora cinco tenham causado dano a uma base. Repetir a medição em uma amostra maior após mudanças concretas.

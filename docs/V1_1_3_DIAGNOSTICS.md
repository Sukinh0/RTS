# RTS V1.1.3 — Diagnóstico ofensivo e gate de qualidade

## Por que este incremento existe
O relatório versionado `reports/simulation-100games-seed123.md` registra 100 empates,
nenhum ataque e nenhum dano em partidas IA vs IA de 900 segundos. Os testes unitários
existentes mostram que a IA emite ordens em cenários artificiais, mas não explicam
o que acontece entre a ordem e um confronto partindo dos recursos iniciais.

## Reprodução
```bash
npm ci
npm run diagnose:ai -- --seed=123 --seconds=900 --interval=120
npm run simulate -- --games=10 --seed=123 --out=reports
```

O diagnóstico emite uma linha JSON por intervalo com:
- efetivos militares, posições e destinos de movimento de cada equipe;
- última intenção/ação da IA;
- quantidade de soldados que cruzaram a metade do mapa;
- posição mais avançada que a tropa atingiu durante a partida;
- falhas de movimentação, ataques e segundo do primeiro confronto.

Compare `furthestBlue` e `furthestRed` com os destinos de marcha.
Se ambos permanecerem próximos da própria base, investigar lançamento da leva,
comandos recusados, rota bloqueada e congestionamento. Se tropas avançarem
e não atacarem, investigar visibilidade, alvos válidos e engajamento.

## Quality gate
`.github/workflows/quality.yml` executa lint, typecheck, Vitest, build,
Playwright e diagnóstico nas PRs para a main.

**Não considerar a IA corrigida só porque a CI está verde.**
O diagnóstico é observabilidade, não um critério de combate;
os números só podem ser transformados em metas depois de reproduzir a causa.

## Próxima correção
1. Reproduzir a partida e inspecionar o JSON de telemetria.
2. Escrever teste de regressão para o comportamento específico.
3. Corrigir a causa sem dar recursos, visão ou bônus artificiais à IA.
4. Reexecutar seeds pareadas e verificar combate, vencedores, duração e performance.

## Evidências coletadas — 22/10/2026

| Cenário | Primeiro combate | Ataques | Empates | Pressão sobre bases |
|---|---:|---:|---:|---|
| Relatório legado, 100 × 900s | nenhum | 0 | 100/100 | não medida |
| Seed 123 antes do ajuste, 900s | nenhum | 0 | 1/1 | não medida |
| Seed 123 após reduzir a leva inicial, 900s | 603s | 39 | 1/1 | não medida |
| Seeds 123–124, ordem alternada, 4 × 1200s | 600–603s | 83–106 ataques por partida | 4/4 | HP final 150/150 |

### Falha confirmada
A IA preserva um guarda e aguardava **três reservas** para atacar. Com
recursos normais, ambas as equipes possuíam **apenas duas reservas** até o
segundo 900; por isso permaneciam em `Rally`, sem sair das bases.

**Correção 1**: liberar levas de duas reservas, preservando um guarda.
Testes de IA e simulação headless comprovaram combate real sem spawns
artificiais ou visão privilegiada.

### Falha de ritmo ainda aberta
A primeira correção provoca combate, mas as quatro partidas amostradas ainda
acabaram empatadas aos 20 minutos. O HP final 150/150 **não demonstra**
ausência de dano anterior, pois as bases podem ser reparadas.

**Correção tática adicional**: um invasor isolado continua atacando quando
está próximo de uma base inimiga visível, mas recua caso contrário. O teste
de intenção e recuo passou; a mudança ainda não produziu vencedores na amostra.

**Instrumentação adicionada**: `baseAttacks`, `baseDamageDealt` e
`firstBaseAttackSeconds` no torneio. Inspecionar esses números em seguida
para saber se o problema remanescente é alcançar a base ou manter pressão
suficiente contra defesa e reparos.

### Critérios de aceite ainda pendentes
- Verificar que o navegador permite jogar contra a IA sem regressões.
- Confirmar o comportamento de ofensiva e recuo nas duas equipes.
- Medir ataques e dano à base nas partidas naturais espelhadas.
- Analisar tempo de construção, recrutamento e renda antes de rebalancear.
- Alcançar partidas que progridam para vitória sem regras artificiais ou
  vantagens de informação e sem comprometer economia ou mapa.

## Experimento tático — acesso às bases (seed 123–124)

Após confirmar **zero ataques a bases** em quatro partidas de 20 minutos,
a primeira onda agora navega pelo corredor norte ou sul antes de se dirigir
ao território adversário. O lado é escolhido pela paridade da seed, com rotas
opostas para as equipes; nenhuma entidade oculta é consultada. Ao completar
o waypoint, a leva segue rumo ao objetivo sem regressar ao próprio flanco.

Amostra de validação (GitHub Actions):
- 4 partidas, seeds 123 e 124, ambas as ordens de ativação.
- 2 vitórias azuis, 0 vermelhas, 2 empates; **antes eram 4 empates**.
- Nas duas vitórias a base vermelha perdeu 150 HP e foi destruída.
- Na partida seed 123 com ordem vermelha inicial, a base azul recebeu 45
  pontos de dano (primeiro ataque no segundo 1191), sem ser destruída.
- O primeiro ataque à base na seed 124 ocorreu no segundo 936.
- A contagem de dano vem de eventos reais de combate, não apenas do HP final.

**Ressalva de equilíbrio:** o corredor norte parece mais eficaz na amostra
pequena. Isso é uma hipótese de teste, não conclusão estatística: precisamos
repetir com mais seeds e validar rotas com jogadores humanos. Não alterar
danos, HP, renda ou visibilidade para compensar sem comparação controlada.

### Testes de regressão
- IA mantém guarda em casa e envia dois atacantes como primeira leva.
- IAs não compartilham informações ocultas nem confundem waypoints.
- Sobrevivente perto da base inimiga pode manter a ofensiva.
- Partida completa com seed fixa atinge combate antes de 900s.
- Partida de vinte minutos com seed fixa consegue destruir uma base.

A conclusão da V1.1.3 segue condicionada à verificação de browser/performance
e distribuição de vitórias em amostra mais ampla. A PR é mantida como draft.

## Validação ampliada — 20 partidas, com foco em suporte de reparos

O teste com **20 partidas (seeds 123–132, cada seed com ordem de ativação
alternada, 1200 segundos)** revelou que a IA vermelha conseguia causar até
285 de dano acumulado contra a base azul, mas não a destruía por causa de
reparos durante o cerco. A decisão tática agora prioriza **construtores
inimigos visíveis** próximos à base, antes de voltar a atacá-la.
A IA não lê tarefas nem posições ocultas de construtores adversários.

| Versão | Vitórias azuis | Vitórias vermelhas | Empates | Partidas com combate | Partidas com ataque à base |
|---|---:|---:|---:|---:|---:|
| Com flancos, antes de priorizar construtores | 7 | 0 | 13 | 20 | 18 |
| Com flancos e supressão de reparos visíveis | **8** | **8** | **4** | **20** | **18** |

Este é um ganho de jogabilidade significativo, mas a amostra **não comprova
equilíbrio de mapa**. As 16 vitórias ficaram com o time que percorreu a rota
norte: o corredor sul não produziu nenhuma vitória. A alternância determinística
da seed distribuiu 8 vitórias para cada equipe, mas a rota norte permanece
preferencial na amostra. A V1.1.4 deverá abordar a topologia orgânica
dos corredores e reavaliar os resultados com mais mapas e agentes.

A CI agora falha se, nas 20 seeds pareadas, qualquer uma das equipes não
obtiver vitória, se alguma partida não tiver combate ou se menos de dez
partidas alcançarem ao menos um golpe contra uma base.

As restrições mantidas são: nenhuma vantagem oculta para IA, nenhuma alteração
nos valores de dano, HP, recursos, reparo ou condição de vitória, e manutenção
da simulação determinística desacoplada da renderização.

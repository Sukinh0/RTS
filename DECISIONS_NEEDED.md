# Decisões de regra a confirmar

## Movimento por ação (Fase 3)

Os documentos definem alcance de movimento por ação e cooldown, mas não especificam se uma ordem distante precisa ser repetida manualmente. A implementação atual aplica cada segmento de até `movement` células em um tick e continua a rota automaticamente após cada cooldown. O jogador não pode substituir a ordem durante o cooldown. Após o playtest, o intervalo entre ações de movimento é de 1 segundo para todas as unidades; a apresentação interpola o trajeto ao longo desse segundo, sem alterar a posição lógica ou o cooldown da simulação. O cooldown de ataque permanece próprio de cada classe.

Também não há regra explícita para diagonais entre dois bloqueios ortogonais. O A* impede esse corte de quina, para não atravessar células bloqueadas.

Confirmar essas interpretações antes de ajustar IA e cenários de combate nas próximas fases.

## Visão de construções e medida de distância (Fase 4 e revisão pós-playtest)

Conforme os ajustes pós-playtest, o raio de visão das construções foi expandido e centralizado em `config/balance.v1.json`:
- **Base**: visão de 40 células a partir do footprint.
- **Casa e Quartel**: visão de 30 células a partir do footprint.
- **Raio de construção**: Casas e Quartéis possuem distância máxima permitida de **80 células** a partir do centro da Base (`BALANCE.construction.maxDistanceFromBase`).

Raio de visão e distância de detecção do batedor usam distância euclidiana entre células. Construções inimigas contam para a proximidade que revela um batedor, usando o ponto mais próximo do footprint. Confirmar esses novos alcances em playtest contínuo.

## Trabalho econômico (Fase 5)

Uma mina aceita até quatro operários: um pode ocupar a célula da mina e os demais trabalham em células adjacentes livres. Cada operário repete ciclos próprios de 30 segundos enquanto a ordem permanecer ativa.

A coleta de madeira ocorre continuamente a 2 por segundo até a capacidade de 20. O operário deposita ao alcançar uma célula adjacente à base após o cooldown de movimento e retorna à floresta. Iniciar o trabalho consome o cooldown da unidade; o progresso de coleta ou mineração continua durante esse cooldown. Esses detalhes de posicionamento e tempo não estão fechados nos documentos e devem ser confirmados em playtest.

## Exaustão de Floresta e Redirecionamento Automático (Fase 6)

Conforme especificado, a floresta é um recurso limitado. Quando um operário completa a extração de uma célula de floresta atingindo sua capacidade máxima de carga (20 de madeira), o pixel/célula de floresta é consumido, convertendo-se em terreno plano (`plain`).
Ao retornar do depósito de madeira na base, se a célula original tiver sido esgotada, o operário busca automaticamente a célula de floresta mais próxima em um raio de até 16 células e redireciona sua coleta sem intervenção do jogador. Se não encontrar floresta restante no raio, o operário conclui o depósito e torna-se livre, passando a gerar renda passiva.

## Construção, Posicionamento e Filas de Produção (Fase 6)

O posicionamento de edifícios (Casa 2×2, Quartel 3×3) exige terreno plano (`plain`), células já exploradas pelo jogador, ausência de unidades ou estruturas no footprint e pelo menos uma célula de perímetro transitável para acesso do operário.
A dedução de custos de construção (Casa: 150 moedas, 100 madeira; Quartel: 200 moedas, 120 madeira) ocorre no momento da ordem. Caso o operário não consiga traçar caminho até o perímetro da fundação, o custo é reembolsado e a fundação cancelada.
A produção de unidades (Casa: operário; Quartel: soldado, arqueiro, escudeiro, batedor) deduz o custo em moedas no enfileiramento e processa itens sequencialmente respeitando o teto global de 60 unidades por equipe (unidades vivas + unidades na fila de produção). Ao concluir o timer, a unidade surge na célula de perímetro livre mais próxima.

## Combate, Alcance e Reflexão (Fase 7)

O alcance de ataque das unidades (Soldado: 2, Arqueiro: 4) e desempate de menor distância no autoalvo utilizam distância euclidiana (`dx^2 + dy^2 <= range^2`). Para construções (Base 4×4, Casa 2×2, Quartel 3×3), a distância é calculada em relação à célula mais próxima do footprint da estrutura.
A reflexão de 80% do Escudeiro (`reflectionPercent: 80`, `reflectionMaxDistance: 1`) é aplicada para atacantes adjacentes nas 8 direções da grade (distância de Chebyshev <= 1). O dano refletido (`floor(dano * 0.8)`) é determinístico, afeta a vida do atacante imediatamente e não encadeia nova reflexão.
Ordem manual de ataque fixa o alvo prioritário para a unidade enquanto ela estiver no alcance e viva; caso fique fora de alcance ou o alvo seja destruído, o autoalvo entra em ação selecionando deterministicamente inimigos visíveis com: (1) menor distância euclidiana, (2) menor HP, (3) menor ID estável. Ordens de ataque em grupo para alvos fora de alcance movem os atacantes automaticamente para a célula livre mais próxima dentro do seu alcance efetivo de ataque.

## Produção de Operários Exclusiva em Casas (Fase 6/8 Regra Estrita)

Conforme a especificação de `docs/GAME_RULES.md`, a Base não produz nenhuma unidade na V1. Operários são produzidos exclusivamente em Casas (`house`, 150 moedas, 6 segundos) e tropas militares exclusivamente em Quartéis (`barracks`). A Base funciona como centro de comando e depósito econômico de madeira, não possuindo opções de fabricação. Caso o jogador perca seus operários antes de construir uma Casa, o ciclo econômico ativo cessa.

## Inteligência Artificial e Utility AI (Fase 8)

- **Restrição estrita à Névoa de Guerra**: A IA opera sob as mesmas regras do jogador humano. Suas percepções vêm exclusivamente de `fog.visibleEntities(team)` e do mapa explorado (`fog.stateAt(team, x, y) !== 'unknown'`). Unidades e edifícios em névoa desconhecida não são acessíveis pela IA.
- **Intervalo de Decisão**: A estratégia da IA é reavaliada a cada 30 ticks (1 segundo), em vez de recalcular a cada frame, preservando performance e consistência determinística.
- **Memória de Construções e Inimigos**: A IA memoriza posições de minas e florestas vistas no território explorado. Se um edifício inimigo memorizado for revisitado na visão direta e tiver sido destruído, a memória é atualizada e a anotação limpa.
- **Limiares de Intenção e Composição**:
  - *Defesa*: ativa imediatamente quando qualquer inimigo visível estiver a uma distância <= 30 da base da IA.
  - *Ataque*: após o playtest, a IA começa a pressionar com 2 unidades capazes de causar dano, mantendo coleta, construção e produção no mesmo ciclo de decisão. Batedores não contam para esse limiar nem recebem ordens de ataque.
  - *Composição*: prioriza manter pelo menos 1 batedor para exploração furtiva, seguido por rotação equilibrada de Soldados, Arqueiros e Escudeiros.

Após o playtest, a IA passou a reservar 150 moedas para Casa e operários depois do primeiro soldado. Ela mantém no máximo um coletor de madeira ativo, procura minas além da primeira floresta e usa operários livres para renda passiva enquanto não encontra mina. A meta inicial é três operários e sobe para quatro após três atacantes. Em invasões, tropas próximas à base defendem, enquanto o grupo distante mantém a marcha. Confirmar esses limiares em novas partidas humanas; a simulação IA vs IA continua limitada pelo número de empates.

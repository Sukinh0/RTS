# Integração visual: Tiny Swords (Free Pack)

## Origem, licença e instalação

O conjunto provisório é [Tiny Swords, de Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords). O ZIP recebido está em `external-assets/Tiny Swords (Free Pack).zip`. Ele contém PNGs e fontes `.aseprite`, mas nenhum arquivo separado de licença/créditos. A página oficial informa uso pessoal e comercial e modificação permitidos; crédito é opcional; redistribuição, revenda e reempacotamento dos arquivos do pack são proibidos. Por isso os PNGs extraídos e o ZIP são ignorados pelo Git. O código do jogo e este documento podem ser versionados sem publicar os PNGs soltos.

No Windows, obtenha o ZIP na página oficial, coloque-o em `external-assets/` e rode `npm run assets:install`. O script extrai somente os PNGs para `public/assets/tiny-swords/`, sem editar os originais. Em outras plataformas, extraia manualmente o conteúdo do diretório `Tiny Swords (Free Pack)` para esse mesmo destino. O jogo mantém formas simples como fallback quando os arquivos não estão instalados.

## Inventário e escala

O ZIP tem 410 PNGs utilizáveis, além de arquivos `.aseprite` e metadados do macOS. Há variantes Black, Blue, Purple, Red e Yellow para unidades e edifícios; este jogo carrega apenas Yellow e Red. O conjunto também inclui `Terrain/Tileset`, `Terrain/Decorations`, `Terrain/Resources`, `Particle FX` e `UI Elements`. A estrutura original é preservada no diretório local.

- Grid lógico do pack: 64 × 64 px; tilemaps coloridos: 576 × 384 px.
- Unidades Pawn, Warrior, Archer e Monk: frames de 192 × 192 px em faixas horizontais de 3 a 11 frames. Lancer: 320 × 320 px, 3 a 12 frames.
- Edifícios: PNGs estáticos de 128 × 192 a 320 × 256 px. Árvores: 8 frames de 192 × 192 ou 192 × 256 px. Bushes: 8 frames de 128 × 128 px.
- FX: poeira e fogo em frames de 64 px; explosão/água em frames de 192 px. UI: botões, ícones, barras e painéis; mantidos disponíveis localmente, mas o HUD atual preserva sua organização e não força esses elementos em componentes de texto.
- Célula do jogo: 12 px em coordenadas de mundo; câmera inicial 125%, zoom de 38% a 250%. Sprite de unidade: 36 px de frame (40 para Lancer), com transparência própria do pack. Tiles de grama: escala 12/64. Sem filtro bilinear ou recoloração de pixels em runtime.

`VisualRegistry.ts` é o único catálogo de caminhos e definições. `MapScene.ts` consulta esse catálogo; nenhuma regra do core conhece PNGs. Para substituir por facções definitivas no futuro, crie conjuntos visuais por facção e altere o registro/seleção visual, sem mudar `UnitKind`, `BuildingKind` ou o motor.

## Mapeamento

| Jogo | Tiny Swords | Estados usados | Observação |
|---|---|---|---|
| Operário | Pawn | idle, run, axe, pickaxe, wood/pickaxe carry | O estado vem de `EconomySystem.taskFor` e carga atual. |
| Construtor | Pawn | idle, run, hammer | O estado vem de `ConstructionSystem.taskFor`. |
| Soldado | Warrior | idle, run, attack, guard disponível | Ataque visual é disparado por evento de combate. |
| Arqueiro | Archer + Arrow | idle, run, shoot, projétil | O projétil percorre a duração visual de 180 ms; dano e cooldown já foram resolvidos pelo core. |
| Escudeiro | Warrior | idle, run, guard, attack | Warrior Guard mantém proporção consistente com as demais tropas; Lancer ficou reservado para uma futura variante visual mais alta. |
| Batedor | Monk | idle, run | Placeholder sem montaria; nenhum poder de cura foi adicionado. |

| Jogo | Tiny Swords | Âncora visual |
|---|---|---|
| Base | Castle | Centro horizontal, base no limite inferior do footprint 4×4. |
| Casa | House1 | Mesmo princípio, footprint lógico 2×2. |
| Quartel | Barracks | Mesmo princípio, footprint lógico 3×3. |
| Torre | Tower | Mesmo princípio, footprint lógico 2×2. |
| Barricada | Wood Resource composto em runtime; Rock2 como fallback | Segmento visual 1×1; o pack livre não contém arte dedicada de cerca/paliçada. |

| Terreno/recurso | Tiny Swords | Natureza |
|---|---|---|
| Plano/grama | Centro da Tilemap_color3 | Fundo visual repetido; `MapGrid` mantém passabilidade. |
| Água/montanha | Cor de base e detalhes de rocha do pack | O desenho ainda é simplificado; a colisão vem de `MapGrid`. |
| Floresta/madeira | Tree1/Tree2, Bushe1, Pawn Wood | Árvore/bush é visual; só a célula `forest` é fonte de madeira. |
| Mina/ouro | Gold Stone 3 | A célula `mine` continua fornecendo moedas conforme as regras existentes. |
| Pedra | Rock2 | A célula `stone` continua fornecendo pedra conforme as regras existentes. |
| Decoração | Bushes, Rocks in the Water | Determinística por coordenada e sem qualquer efeito em pathfinding. |

## Animação, camadas e desempenho

O loader do Phaser pré-carrega as folhas uma vez. Worker e Builder compartilham as mesmas chaves de Pawn; estados com o mesmo PNG também compartilham a textura. Objetos de unidade/construção são reutilizados por ID; sprites de decoração e partículas usam pools. Somente células dentro da câmera recebem decoração. O terreno usa um único `TileSprite` repetido e a textura estática já existente para água/montanha, evitando milhares de draw calls de sprites por célula. O minimapa continua lógico.

O relógio visual escolhe frames por tempo de apresentação. Movimento interpolado, combate, coleta e construção são lidos do estado/eventos existentes. Nenhuma duração de folha controla cooldown, dano, alcance, coleta ou ocupação. Ausência de textura usa idle; ausência de idle volta às formas simples, com aviso em desenvolvimento. Fog, seleção, barras de vida e feedback permanecem separados dos sprites.

O time lógico `blue` usa Yellow Buildings/Units com marcador verde; `red` usa Red Buildings/Units com marcador bordô. Não há recoloração de textura nem assets duplicados por time. O rótulo lógico Azul do HUD foi mantido para compatibilidade com os dados de teste; a legenda explica a aparência provisória. Puggnas, Tengui e Raffitz não foram implementados.

## Limitações e próximos ajustes visuais

### Medição desta integração

No Chromium headless/SwiftShader usado pelo benchmark existente, a camada Tiny Swords mediu aproximadamente 16,8 FPS parada, 14,4 FPS em movimento, 15,6 FPS em formação, 17,5 FPS em combate e 16,5 FPS em churn com 100 unidades. O baseline V1.1 registrado anteriormente era 31,6 / 26,0 / 22,9 / 31,1 FPS nos cenários comparáveis. A lógica do core não mudou e os testes de regras permanecem verdes, mas a apresentação ainda tem uma regressão de desempenho nesse ambiente de software. Os perfis gerados localmente ficam ignorados em `reports/performance/tiny-swords-*`; a próxima etapa recomendada é medir em GPU física e, se necessário, reduzir a frequência de atualização de sprites ou usar atlases compactados.

- O tilemap do pack representa plataformas/elevacões, enquanto o mapa do jogo é uma grade plana de 200×200. A grama foi integrada sem transformar tile em regra; transições de água e caminhos continuam simplificados.
- Não existe asset de barricada dedicado no ZIP. Rock2 é um marcador visual temporário, sem alterar bloqueio, limite, construção em linha ou disparo sobre ela.
- Monk é placeholder de batedor, sem animação de ataque ou montaria. Guard/hit/death completos não existem para todos os tipos; explosão leve comunica morte.
- Os efeitos são leves e limitados; partículas não persistem na simulação. A UI completa do pack exigiria um redesenho do HUD e ficou fora deste passe.
- Os arquivos `.aseprite` permanecem no ZIP original e não são necessários em runtime.

Para trocar um asset, substitua o arquivo de referência e a contagem/tamanho de frames em `src/presentation/VisualRegistry.ts`. Para mudar âncora ou escala de uma classe visual, ajuste `updateUnitSprite` ou `updateBuildingSprite` em `MapScene.ts`; preserve os footprints do core.

## World Scale & Proportion Pass

As proporções foram auditadas pela caixa opaca (alpha) dos PNGs, não pelo canvas vazio do frame. O soldado Warrior, com cerca de 89 px de silhueta em um frame de 192 px, define a referência de altura visível de 17,2 px de mundo (`WORLD_VISUAL_METRICS.referenceUnitHeight`). `CELL_SIZE` segue em 12 px. O tamanho de exibição de cada folha é independente do footprint lógico e das dimensões do arquivo.

### Escala de personagens

| Unidade | Frame exibido | Silhueta estimada | Altura relativa ao soldado | Origem Y |
|---|---:|---:|---:|---:|
| Operário | 43 px | 16,6 px | 0,97 | 0,703 |
| Construtor | 43 px | 16,6 px | 0,97 | 0,703 |
| Soldado | 37 px | 17,2 px | 1,00 | 0,714 |
| Arqueiro | 37 px | 17,0 px | 0,99 | 0,708 |
| Escudeiro | 40 px | 18,5 px | 1,08 | 0,714 |
| Batedor | 46 px | 16,5 px | 0,96 | 0,698 |

Cada sprite é posicionado pelo centro horizontal e pelo ponto de apoio inferior no centro da célula lógica. Larguras/alturas visíveis também definem seleção e barras de vida, evitando que o canvas transparente amplie os marcadores.

### Construções e ambiente

As dimensões abaixo são `width × height` de exibição em pixels de mundo; os valores visíveis excluem áreas transparentes do PNG. Os footprints existentes permanecem: base 4×4, casa 2×2, quartel 3×3, torre 2×2 e barricada 1×1.

| Construção | Display | Caixa visível aprox. | Origem X/Y |
|---|---:|---:|---:|
| Base/Castelo | 54×44 | 52,6×35,8 | 0,5 / 0,973 |
| Casa | 22×33 | 19,3×27 | 0,5 / 0,901 |
| Quartel | 36×48 | 34,5×35,1 | 0,5 / 0,957 |
| Torre | 24×48 | 22,5×34,5 | 0,5 / 0,898 |
| Barricada | 16×16 | 15,5×10,5 | 0,5 / 0,8125 |

| Elemento | Display/altura de referência | Âncora/decisão |
|---|---:|---|
| Árvore pequena de decoração | 22×30 px; silhueta ≈22 px | Centro inferior; não altera terreno nem bloqueio |
| Árvore de floresta A | 30×40 px; silhueta ≈30 px | Centro inferior; espaçamento determinístico reduzido para uma árvore por cinco células elegíveis |
| Árvore de floresta B | 36×36 px; silhueta ≈27 px | Centro inferior ajustado ao alpha do asset |
| Arbusto | 14×14 px | Centro no ponto de apoio inferior do PNG |
| Jazida de ouro | 36×36 px de folha (Gold Stone 3–6; prioridade a 5/6) | Veios agrupados, silhueta maior; alpha inferior ancorado em 0,78 |
| Depósito de pedra | 15×15 px de folha | Diferenciado das pedras decorativas de 9×8 px |
| Montanha | célula de 12 px; face exposta de 24 px | Faces e cristas acompanham o relevo visual sem alterar pathfinding |
| Efeitos | poeira 13 px; explosão 20 px; projétil 10 px | Medidas centrais em `EFFECT_VISUALS` |

### Profundidade, feedback e limites

Entidades do mundo usam profundidade determinística derivada da coordenada Y do ponto de apoio, com desempate pequeno por categoria; assim unidades, árvores e estruturas podem passar à frente/atrás conforme a posição. HUD de vida e seleção permanecem em camadas superiores. Barras e seleção acompanham a caixa visível; os círculos de visão continuam obedecendo às métricas de jogo sem alteração.

As métricas ficam em `VisualRegistry.ts` (`WORLD_VISUAL_METRICS`, `UNIT_VISUALS`, `BUILDING_VISUALS`, `RESOURCE_VISUALS` e `EFFECT_VISUALS`) e são aplicadas em `MapScene.ts`. Os PNGs não foram redimensionados e o filtro pixel-art existente é preservado. A barricada tem célula lógica 1×1 e aparência composta de madeira; Rock2 é apenas fallback. Árvores de floresta são decoração visual, não impedem movimento. O relevo de montanha é uma representação por faces/cristas na grade plana, e não um sistema de elevação real.

Para conferir as proporções em uma única tela, abra `/?visualdebug=1`. A cena `VisualCalibrationScene` organiza seis unidades, cinco construções, árvores, arbustos, ouro, pedras, face de montanha, detalhes de água, FX, seleção e barras de vida em fileiras comuns. É só apresentação, sem entidades ou alterações na simulação; a URL normal continua abrindo o mapa.

## HUD Fullscreen & Builder Visual Differentiation

- A partida normal ocupa toda a viewport; o HUD é uma camada sobre o canvas, com recursos e relógio no topo e minimapa, seleção e comandos na base. O canvas mantém o redimensionamento do Phaser (`Scale.RESIZE`) e o filtro pixel-art. A cena visual de calibração conserva o modo `FIT`.
- O HUD se reorganiza por largura, incluindo telas pequenas. O minimapa permanece navegável e dimensionado por CSS; a apresentação do mundo e a câmera respondem ao tamanho da janela sem mudar os limites de zoom ou a escala lógica.
- As dicas usam `data-tooltip-title` e `data-tooltip-description` com um único `TooltipManager`, atraso curto, suporte a foco e posicionamento limitado à viewport. Recursos e comandos exibem explicações; unidades e estruturas visíveis recebem dica ao passar sobre elas no mapa, sem revelar entidades fora da névoa.
- A seleção resume grupos por tipo e mostra vida, ordem, trabalho, construção, fila ou formação pertinentes. IDs, coordenadas, cooldowns e detalhes de depuração não são exibidos no painel normal. Os comandos de teclado foram movidos para a janela de ajuda.
- A barra de ação cria custos e descrições com valores de `balance.v1.json`; nenhuma regra, custo ou atributo foi alterado. As dicas explicam coleta/mineração, capacidades, treino, ponto de reunião, ataque em movimento e formações existentes.
- Operário e Construtor usam as mesmas animações base Tiny Swords. O script offline `scripts/recolor-builder.py` deriva 14 folhas (estados relevantes para equipes azul e vermelha), identifica o chapéu por paleta e conectividade dentro de cada frame de 192×192 e aplica tons cobre/laranja. Pele, cabelo, roupa, ferramentas e marcas de equipe ficam preservados; PNGs originais permanecem intactos. `VisualRegistry` e `MapScene` carregam as variantes apenas para Construtores.
- Limite: o pack não fornece uma animação exclusiva para o Construtor; a diferença de função visual vem da recoloração do chapéu sobre as animações compartilhadas. Os arquivos derivados são produzidos a partir do pack Tiny Swords já instalado localmente.
## Segundo passe visual - Terrain & Environment

Este passe ficou restrito a camada visual do mapa. O MapGrid, a fog, o pathfinding, os recursos e as regras de gameplay continuam sendo a fonte de verdade.

- Terreno base: Tilemap_color3 com variantes deterministicas de grama por coordenada.
- Agua e montanha: preenchimento em camadas e bordas calculadas pelos vizinhos conhecidos; montanhas recebem base rochosa e detalhes.
- Florestas: Tree1 a Tree4 e Bushe1 a Bushe4 alternados por hash de coordenada; forest continua sendo o unico recurso de madeira.
- Recursos: Gold Stone 1/2/3/4 e Rock1/2/3/4 distinguem mina e pedra coletavel; pedras pequenas sao apenas decoracao.
- Margens: Water Foam, Water Rocks, bushes e rochas pequenas formam clusters leves, deterministas e sem colisao ou selecao.
- Limitacoes: o pack nao fornece autotile completo para a grade plana de 200x200; as transicoes usam bordas e variantes coerentes sem simular altura, correnteza ou novos biomas.

## Defensive Structures Visual Pass

- A barricada deixou de usar Rock2 como representação principal. O Tiny Swords não contém cerca, paliçada ou muralha apropriada; a nova peça é composta em runtime a partir do asset `Terrain/Resources/Wood/Wood Resource/Wood Resource.png`.
- Um CanvasTexture reutilizável por máscara desenha os trilhos de madeira e uma travessa curta. Cada barricada continua sendo um único `Image`; se a textura de origem ou canvas não estiver disponível, permanece o fallback Rock2.
- As máscaras cardinais usam N=1, E=2, S=4, W=8. O `VisualRegistry` classifica peça isolada, ponta horizontal/vertical, reta horizontal/vertical, canto, T e cruzamento; os 16 arranjos combinatórios têm uma textura. Segmentos alinhados avançam até a borda do tile para parecerem contínuos.
- `BarricadeTopology` é apresentação somente. Ele indexa peças visíveis e completas por célula, conecta apenas a mesma equipe e recalcula a célula alterada mais seus quatro vizinhos quando a revisão de entidades muda; conclusão da construção e mudança de visão invalidam o cache visual. Não roda por frame e não consulta nem altera regras lógicas.
- A barricada continua footprint 1×1. Métrica visual é 16×16, caixa aparente aproximada 15,5×10,5 e âncora inferior 0,8125; o asset é leve e mantém a tropa legível. A profundidade existente por posição Y permanece.
- A torre conserva as métricas auditadas de 24×48, caixa aparente 22,5×34,5, origem 0,5/0,898 e footprint lógico 2×2. O debug coloca torre e linha lado a lado, além de arqueiros atrás e à frente da barreira.
- Limitação: é uma composição simples de tronco (não uma arte dedicada de paliçada); o pack não oferece atlas de autotile defensivo. A página `/?visualdebug=1` mostra lado a lado peça isolada, linhas de 5 e 10, vertical, canto, T, cruzamento, remoção parcial, torre e arqueiros.

## Unit Visual Readability Pass

O quadro `/?visualdebug=1` agora é uma cena comparativa de apresentação: mostra as seis classes para os dois times, grupos mistos sem seleção e o mesmo exército em três escalas de leitura. `/?visualdebug=1&assets=1` conserva o quadro amplo anterior de construções/terreno/FX. A cena não cria entidades e não altera o mundo de jogo.

| Classe | Antes | Representação mantida/final | Tiny Swords e animações |
|---|---|---|---|
| Operário | Pawn Yellow/Red, com ferramenta conforme coleta/construção | Pawn permanece a referência de economia; sem redesign | `Pawn_Idle`, `Pawn_Run`, `Pawn_Interact Axe/Pickaxe`, `Pawn_Run Wood/Pickaxe` e `Pawn_Interact Hammer`. Mineração de ouro usa o gesto de picareta; ouro é entregue diretamente pelo sistema e não tem animação de carga. |
| Construtor | Mesmo Pawn do Operário com chapéu cobre/laranja derivado | Diferenciação existente preservada e conferida em idle; folhas correspondentes de movimento, coleta, carga e construção continuam carregando a mesma variante | 14 PNGs derivados (7 folhas × 2 times) em `public/assets/generated/builder/`; originais Tiny Swords não foram sobrescritos. |
| Soldado | Warrior com espada e escudo lateral | Referência de combate corpo a corpo; escala base mantida | `Warrior_Idle`, `Warrior_Run`, `Warrior_Attack1` e `Warrior_Guard`. |
| Arqueiro | Archer com arco | Mantido sem redesign; arco, disparo e flecha continuam nos mesmos sistemas | `Archer_Idle`, `Archer_Run`, `Archer_Shoot` e `Arrow`. |
| Escudeiro | Warrior da mesma família do Soldado, já com pose Guard ao ficar parado | Guard frontal, escala um pouco maior e `Warrior_Attack2` para reforçar escudo e resistência; a corrida continua sendo a animação real `Warrior_Run` | `Warrior_Idle/Run/Guard/Attack2`. O escudo da folha original permanece visível e o time continua sendo definido pela folha Yellow/Red. |
| Batedor | Monk em Idle/Run, cuja silhueta lembrava curandeiro | Lancer a pé: lança cria uma silhueta única; Run sugere mobilidade; não usa cura, aura ou montaria | `Lancer_Idle` (20), `Lancer_Run` (10), `Lancer_Down_Attack` (5) e `Lancer_Down_Defence` (10), disponíveis para Yellow e Red. O pack instalado não oferece unidade montada de reconhecimento. |

### Métricas e leitura

| Classe | Frame exibido | Caixa opaca aproximada | Origem Y | Observação |
|---|---:|---:|---:|---|
| Operário | 43 px | 12×16,6 px | 0,703 | Valores e seleção inalterados. |
| Construtor | 43 px | 12×16,6 px | 0,703 | Chapéu recolorido offline em ambas as equipes, incluindo folhas usadas em movimento e trabalho. |
| Soldado | 37 px | 15×17,2 px | 0,714 | Referência de escala global. |
| Arqueiro | 37 px | 14×17 px | 0,708 | Inalterado. |
| Escudeiro | 42 px | 17×19,5 px | 0,714 | Guarda e ataque frontal separam a leitura do Soldado; diferença de tamanho reforça a silhueta sem trocar família ou cores. |
| Batedor | 46 px | 16,5×34,5 px incluindo a lança | 1,0 | Corpo fica próximo à escala das tropas; a lança vertical aumenta a silhueta. A barra de vida acompanha a caixa opaca e fica acima da ponta da lança. |

A caixa de seleção continua sendo somente apresentação e não altera footprint/hitbox lógica. Barras de vida, Y-sort, origem e indicador usam as métricas centrais de `VisualRegistry.ts`; nenhum `setScale` de unidade foi espalhado em `MapScene.ts`. Team colors continuam Yellow para `blue` e Red para `red`. Fallbacks continuam retornando à folha idle da própria família quando um estado não é encontrado.

Não foi criado asset derivado nesta etapa. Permanecem os 14 PNGs derivados do chapéu do Construtor. A limitação é o conjunto visual compacto do pack: Escudeiro usa a família Warrior do Soldado, mas diferencia-se por escala e pose de guarda/ataque; o Batedor usa uma lança alta e não tem montaria nem roupa de batedor exclusiva. Nenhum valor de gameplay, HUD, mapa, IA ou FX foi alterado.

## FX & Gameplay Feedback Pass

### Diagnóstico e contrato

`MapScene` já recebia `CombatEvent` após o core aplicar dano, usava flechas do pack com pool, mostrava anéis de ordem e criava poeira no movimento. Porém, ataques corpo a corpo eram desenhados como um traço até o alvo, o anel aparecia antes da flecha chegar, não existia marca de impacto distinta para vida perdida, a morte de unidades usava `Explosion_01`, coleta/construção emitia cruzes brilhantes genéricas e o array de flechas não tinha limite. Construção e economia não publicam eventos de apresentação próprios; o MapScene consulta os estados/tarefas existentes sem alterar seus sistemas.

O core continua resolvendo ataque, HP, reflexão, morte, coleta e construção. `CombatEvent` agora inclui categoria/tipo do alvo, HP depois do dano e flags de morte para alvo e atacante. Esses campos são um retrato do resultado já aplicado; animações e projéteis não atrasam nem provocam gameplay.

### Efeitos e disparadores

| Evento real/estado já existente | Apresentação | Asset Tiny Swords |
|---|---|---|
| Unidade recebe dano corpo a corpo | Cruz/impacto claro localizado por 90 ms, sem tint destrutivo, knockback ou stun | Graphics pixel-sized, sem asset novo |
| Escudeiro reflete dano | Mesmo micro impacto em tom dourado no atacante; usa apenas `reflectedDamage > 0` do evento | Graphics pixel-sized |
| Arqueiro ataca | `Arrow.png` Yellow/Red sai da posição do arqueiro, aponta pela direção do alvo e viaja até a posição guardada no evento; impacto aparece somente na chegada | `Units/{Yellow,Red} Units/Archer/Arrow.png` |
| Unidade morre | Poeira breve e remoção que já veio do core; nenhuma explosão ou cadáver persistente | `Particle FX/Dust_01.png` |
| Construção recebe dano/destruição | Pequenos fragmentos; destruição acrescenta poeira e detrito, com escala menor para barricada | `Dust_01.png` + traços procedurais discretos |
| Construtor trabalha/construção termina | Animação de martelo existente; poeira ocasional e um pulso curto ao concluir | `Dust_01.png` |
| Operário coleta madeira/pedra ou minera ouro | Até um impacto de lascas/poeira por ciclo visual; madeira tem tom terroso, pedra cinza e ouro dourado. O trabalhador em retorno carregando recurso não emite partículas | Traços procedurais pequenos; animações Pawn existentes |
| Movimento começa | Dust limitado por unidade e por segundo, nunca em cada frame | `Dust_01.png` |
| Move, Attack Move e ataque direto | Marcadores curtos verde, vermelho e coral; rally continua visível enquanto a estrutura correspondente está selecionada | Anéis procedurais; estado de rally existente |

`Explosion_01.png` continua disponível no pack/quadro de comparação, mas não é usada como morte de pessoa. O ataque de flecha é somente visual: o core aplica HP no instante determinístico usual e o projétil então percorre sua duração visual curta; nada aguarda a animação.

### Limites, pooling e névoa

`FX_LIMITS` centraliza 96 efeitos de mundo, 36 projéteis ativos, 96 trilhas de ataque e oito efeitos ambientais por segundo. Poeira e flechas reutilizam `Image` pelo pool; efeitos de mundo têm prioridades, então impacto/morte pode retirar um efeito decorativo antigo ou ser descartado se não houver espaço. Esses limites só afetam desenho.

Eventos inimigos só criam FX quando origem e destino estão visíveis. Flechas também são removidas quando a trajetória cruza uma célula não visível; efeitos inimigos existentes são terminados se a célula deixa de estar visível. Posições de bosque, ouro e pedra não recebem FX até a tarefa de coleta ser realmente iniciada e permanecer visível. Nenhum FX escreve no `FogOfWar`, revela células ou altera visão. HP bars e regras do fog continuam iguais.

Para experimentar as apresentações sem chamar dano ou economia, abra `/?fxdebug=1&noai=1`. O painel temporário demonstra impacto, poeira de morte, flecha, construção, madeira, ouro, pedra e ordem; `Limpar` permite comparar isoladamente. A câmera aproximada existe apenas nesse modo de diagnóstico. A cena normal e `/?visualdebug=1` permanecem sem o painel.

### Cobertura e limitações

O teste automatizado de navegador captura os oito efeitos do painel em `artifacts/fx-hit.png`, `fx-death.png`, `fx-arrow.png`, `fx-construction.png`, `fx-wood.png`, `fx-gold.png`, `fx-stone.png` e `fx-order.png`. Há teste de contrato para limite/duração de FX e o teste de combate verifica os metadados de dano e reflexão.

O pacote não contém uma partícula específica de impacto, madeira, pedra ou ouro; estes micro efeitos usam traços pequenos ou Dust. A economia atual não publica eventos por golpe de ferramenta, então a apresentação coleta um pulso ocasional de tarefas que já estão trabalhando, não de cada golpe do frame. Não há cadáveres, dano sobre tempo, números flutuantes, screen shake, áudio novo ou novas regras. Os cenários E2E de interação e batalhas grandes dependem da validação visual/manual e são reportados separadamente do teste do painel de demonstração.

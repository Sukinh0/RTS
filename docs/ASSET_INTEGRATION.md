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
| Barricada | Rock2 | Placeholder estático 1×1: o pack livre não contém wall, fence ou palisade apropriados. |

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

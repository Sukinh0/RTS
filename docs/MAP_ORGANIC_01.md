# MAP_ORGANIC_01

## Filosofia

Mapa fixo de 200 × 200 células para representar um território disputado. A geometria é assimétrica e combina campos abertos, florestas, maciços de montanha, lagos e passagens de larguras diferentes. O jogo continua usando as regras atuais de movimentação, fog of war, construção e economia.

O lago central que fechava a passagem foi removido para abrir uma rota jogável pelo meio. A área não explorada recebe névoa teal translúcida, com silhuetas discretas de água e montanha para sugerir o relevo sem mostrar florestas, depósitos ou unidades ocultas.

A definição está em `config/map-test-01.json` (ID `MAP_ORGANIC_01`). Patches com `shape: "blob"` usam uma ondulação determinística controlada por `seed`; não existe geração aleatória em runtime. `mirrorX` permanece suportado por compatibilidade, mas todos os patches deste mapa usam `mirrorX: false`.

## Bases e ouro

Bases mantidas nos pontos conhecidos para preservar as condições iniciais dos cenários existentes:

- Blue: base em `[20, 100]`; operários em `[25, 99]` e `[25, 101]`.
- Red: base em `[176, 100]`; operários em `[174, 99]` e `[174, 101]`.

As bases têm terreno livre ao redor para expansão e circulação. A assimetria vem da distribuição das regiões e dos recursos, não de espelhar um lado.

Há exatamente oito jazidas:

| Categoria | Coordenadas | Papel pretendido |
| --- | --- | --- |
| Inicial Blue | `[48, 92]` | Acesso inicial; 24 passos pelo pathfinding a partir do primeiro operário. |
| Inicial Red | `[146, 100]` | Acesso inicial; 29 passos pelo pathfinding a partir do primeiro operário. |
| Expansão Blue | `[31, 145]` | Jazida mais distante, voltada à expansão para sul. |
| Expansão Red | `[168, 153]` | Jazida mais distante, voltada à expansão para sudeste. |
| Contestada | `[83, 36]` | Rota norte/noroeste, relativamente exposta. |
| Contestada | `[119, 62]` | Região norte-central, além da área inicial. |
| Contestada | `[105, 94]` | Região central, alcançável por mais de uma aproximação. |
| Contestada | `[83, 169]` | Região sul, incentiva controle e exploração do quadrante inferior. |

As distâncias iniciais de ouro diferem em cinco células no pathfinding, sem espelhamento.

## Madeira e pedra

A madeira está distribuída por 21 manchas irregulares: bosques pequenos perto das áreas iniciais, grupos médios no norte e centro, e manchas maiores no oeste, leste e sul. Isso dá acesso razoável aos dois lados e deixa algumas florestas relevantes para expansão e defesa.

Há sete manchas de pedra, aproximadamente centradas em `[42, 70]`, `[28, 127]`, `[95, 61]`, `[80, 115]`, `[137, 105]`, `[137, 129]` e `[157, 45]`. Elas ficam em regiões diferentes, em vez de formar um depósito espelhado para cada base.

## Geografia e rotas

- Lagos pequenos e médios, braços de água interrompidos e margens irregulares ficam espalhados entre norte, oeste, centro-leste e sul.
- Maciços rochosos aparecem em bolsões e cadeias curtas, sem formar uma muralha contínua entre as bases.
- Grandes campos permanecem abertos para exércitos, formações e flanqueamento.
- Passagens estreitas surgem entre água, montanha e bosque; nenhuma rota é definida como lane.
- Há vários pontos de interesse fora do centro, evitando que toda a disputa dependa de uma única região.

## Validações automatizadas

`src/map/MapGrid.test.ts` verifica tamanho 200 × 200, exatamente oito minas, assimetria, água/montanha/floresta, clareza nas saídas das bases, acesso das duas equipes às minas, madeira e pedra, diferença de acesso ao ouro inicial e rotas alternativas. Também verifica que uma forma blob permanece determinística para a mesma seed.

`src/map/findPath.test.ts` verifica desvios ao redor de água e montanha, destinos bloqueados, diagonal sem corte de esquina e desvio da footprint de base. A suíte de gameplay também cobre coleta, IA e passagem de grupos grandes por gargalos.

## Limitações e próximos passos

Este é um primeiro mapa fixo para playtest. A forma de blob é intencionalmente simples; não é um gerador procedural completo. As bases continuam na mesma linha horizontal para preservar referências existentes, embora o terreno e os recursos não sejam simétricos. Depois de jogar algumas partidas, vale revisar se as jazidas de expansão exigem risco semelhante e se alguma floresta ou pedra incentiva uma rota dominante.


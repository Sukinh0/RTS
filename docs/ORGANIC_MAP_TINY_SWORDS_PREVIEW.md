# V1.1.5 — terreno orgânico e Tiny Swords opcional, sem redistribuição

## O que mudou
- Terreno lógico de 200×200 preservado e obstáculos principais mantidos; bordas de
  rios, montanhas, florestas e jazidas de pedra agora recebem irregularidade determinística.
- As equipes continuam tendo posições iniciais e terrenos espelhados horizontalmente.
  Os corredores de validação (62/100/137) e a economia inicial não são modificados.
- A representação sem PNGs externos ganhou solo verde, vegetação, rochas, água
  e detalhes desenhados pelo Phaser, sem custo de sprites por célula.
- O HUD tem botão **🎨 Tiny Swords**. Escolha o arquivo original
  `Tiny Swords (Free Pack).zip` já baixado da página do autor.
- O ZIP é lido **somente em seu próprio navegador**: nenhuma imagem é enviada
  ao GitHub, ao provedor do site ou ao repositório. Os sprites ficam apenas na
  memória da aba e a partida reinicia para aplicar os novos gráficos.
- A biblioteca de caminhos das animações continua centralizada em
  `src/presentation/VisualRegistry.ts`; o loader local utiliza o mesmo manifesto.
- Os PNGs, ZIP e fontes Aseprite originais continuam fora do Git por licença.

## Tiny Swords: download e limites
Obtenha o ZIP gratuito na [página oficial de Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords)
e carregue diretamente no botão da versão de avaliação. O formato ZIP deve ser o
**Free Pack atual** e manter as pastas originais de `Units`, `Buildings`,
`Terrain` e `Particle FX`.

A licença autoriza uso em projetos pessoais e comerciais, mas proíbe
**redistribuir, revender ou reempacotar os assets**. Portanto, o site não
publica o pacote nem traz um espelho de download. O antigo pacote marcado
CC0 é diferente e não é automaticamente compatível com o manifesto atual.

Este carregador exige navegador com suporte a `DecompressionStream('deflate-raw')`.
Ele extrai até 30 MB de ZIP e admite até 1.600 entradas. A seleção deve ser
repetida se a página inteira for recarregada; uma reinicialização de partida
na própria aba mantém texturas na sessão.

## Testes e aceitação
- `npm run lint && npm run typecheck && npm test && npm run build`.
- `npm run test:e2e`: mininmap, construção, seleção, zoom e UI de upload.
- `npm run simulate -- --games=20 --seed=123 --max-seconds=1200 --out=reports-ci`;
  comparar vitórias, empates e pressão às bases com a V1.1.3.
- Não declarar arte do Tiny Swords validada até selecionar um ZIP real
  e inspecionar os sprites in-game em um navegador.
- Testar também em desktop com GPU; qualidade visual e FPS não são garantidos
  pelos testes headless de software.

**Pendências:** suavização de caminhos e relevo orgânico além das margens
dos patches, versões definitivas das facções, otimização da renderização e
validação dos sprites no navegador com o ZIP do usuário.

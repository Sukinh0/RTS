# O adversário "Fabio"

`src/core/ai/FabioController.ts` é um adversário roteirizado a partir das respostas
de um questionário sobre como o Fabio joga. Não aprende: serve de referência para
testar e, depois, treinar a IA. Para jogar contra ele, abra o jogo com `?ia=fabio`
(ou `tools/treino/JOGAR_CONTRA_FABIO.bat`).

Ele usa os mesmos comandos do jogador, não recebe bônus e enxerga o que a tela do
jogador mostraria.

## O que ele faz

- **Abertura:** casa, 3º operário, quartel, construtor (antes ou depois do 1º soldado), 2 soldados, 2ª casa.
- **Economia:** divide ouro e madeira no começo; depois só um operário fica na madeira (até ~300) ou na pedra. Operários: 3, depois 6, depois 8.
- **Prioridade:** com até 4 combatentes, tropas primeiro; acima disso, guarda recursos para construir.
- **Tropas:** a sequência das 6 primeiras muda se ele já foi atacado; depois 1 ou 2 escudeiros e cerca de 2 soldados por arqueiro.
- **Defesa:** 2 torres, barricadas à frente delas e da base, reparo imediato, operários recuam.
- **Batedor:** percorre as bordas do mapa.
- **Ataque:** em geral espera o primeiro ataque; sai com 6 ou 7 combatentes pelo centro, deixa um no meio, reforça em ondas ou em conta-gotas conforme a economia, mira primeiro os operários e recua quando vai perder todos.
- **Variação:** a semente da partida decide os pontos em que ele descreveu mais de uma opção.

## Limites conhecidos

- A microgestão é mais simples que a de uma pessoa: o posicionamento usa a formação em bloco do jogo, sem ajustes durante a luta, e o recuo é de uma vez, não gradual.
- No lado vermelho o mapa atrasa a descoberta de ouro e madeira, e ele rende bem menos que no azul.

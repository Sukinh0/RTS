# Fog of War e Furtividade

## Estados da célula
1. **Desconhecida** — nunca vista.
2. **Explorada** — terreno conhecido, sem informação dinâmica atual.
3. **Visível** — dentro da visão atual de pelo menos uma unidade/construção aliada.

## Memória
Ao perder visão:
- terreno continua conhecido;
- posição atual de tropas inimigas deixa de ser atualizada;
- construções vistas permanecem como última informação conhecida.

## Visão
Cada unidade possui raio próprio conforme `balance.v1.json`.

## Batedor
- visão alta;
- sem ataque;
- invisível se nenhum inimigo estiver a distância <= 5;
- detectável quando existe inimigo a distância <= 5 e a regra de visão permite.

## IA e fog
A IA não pode consultar estado oculto diretamente. Ela usa apenas:
- células visíveis;
- memória de informações já descobertas;
- eventos que um jogador humano também receberia.

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
Cada unidade e construção possui raio próprio definido centralmente em `config/balance.v1.json`:
- **Base**: visão em raio de 26 casas a partir da borda do footprint (reduzida em 35%).
- **Casa e Quartel**: visão em raio de 20 casas a partir da borda do footprint (reduzida em 35%).
- **Operário, Construtor e Soldado**: visão em raio de 5 casas.
- **Escudeiro**: visão em raio de 3 casas.
- **Arqueiro**: visão em raio de 6 casas.
- **Batedor**: visão em raio de 8 casas.
- **Revelação por Unidades**: as unidades mantêm e deixam a área em que estão revelada (assim como as estruturas), com alcance equivalente à sua visão comum. Ao serem selecionadas, exibem seu anel de visão circular.

### Limite territorial de construção
- Casas e Quartéis podem ser construídos a no máximo **80 casas** da Base, medindo a distância euclidiana entre os centros das construções (`BALANCE.construction.maxDistanceFromBase`).

## Batedor
- visão alta (8 casas);
- sem ataque;
- invisível se nenhum inimigo estiver a distância <= 5;
- detectável quando existe inimigo a distância <= 5 e a regra de visão permite.

## IA e fog
A IA não pode consultar estado oculto diretamente. Ela usa apenas:
- células visíveis;
- memória de informações já descobertas (`AIMemory`);
- eventos que um jogador humano também receberia.

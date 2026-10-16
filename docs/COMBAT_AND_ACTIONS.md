# Combate e Sistema de Ações

## Modelo
O jogo é tempo real, mas as unidades executam ações discretas.

Fluxo básico:
Disponível → recebe/executa ação → entra em cooldown → volta a ficar disponível.

## Cooldown
- Individual por tipo de unidade.
- Continua correndo enquanto o mundo segue normalmente.
- Durante cooldown, a unidade pode sofrer dano e morrer.
- Nova ação manual só pode começar após o cooldown terminar.

## Exemplo de risco
1. Operário recebe ordem para trabalhar.
2. Avança para região coberta pela fog.
3. Descobre soldados inimigos.
4. A ação/cooldown impede recuo instantâneo.
5. Inimigos disponíveis podem reagir e atacar.

## Reação automática
Unidades com ataque podem reagir automaticamente quando:
- o inimigo está visível;
- está dentro do alcance;
- a unidade está disponível;
- não existe ordem manual prioritária incompatível.

O ataque automático também consome a ação e inicia cooldown.

## Ordem manual
Tem prioridade sobre autoalvo.

## Autoalvo padrão
1. inimigos visíveis em alcance;
2. menor distância;
3. menor HP como desempate;
4. ID estável como último desempate para determinismo.

## Reflexão do Escudeiro
- Só ocorre contra atacante adjacente.
- Reflexão: floor(dano * 0.8).
- O escudeiro recebe o dano integral.
- Reflexão não gera nova reflexão em cadeia.

## Marcha ofensiva e resolução simultânea

Soldados e arqueiros em ordem de movimento procuram unidades ou construções inimigas dentro da própria visão, respeitando fog e furtividade. Ao encontrar um alvo, suspendem o destino, aproximam-se até o alcance e atacam. Quando o alvo morre ou deixa a visão, retomam a marcha. Uma ordem manual de ataque tem prioridade. O operário causa 4 de dano a alcance 1 quando recebe ordem manual ou quando um inimigo está adjacente e ele está livre para agir; seu trajeto de coleta não é desviado automaticamente para perseguir inimigos. Escudeiro e batedor continuam sem dano ofensivo.

O movimento tem intervalo de 1s entre ações. O intervalo de ataque permanece no valor da unidade; para o arqueiro são 4s. Ataques iniciados no mesmo tick são aplicados em conjunto antes de remover entidades mortas, evitando vantagem sistemática da equipe processada primeiro.

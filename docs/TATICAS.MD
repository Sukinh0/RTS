1. Objetivo da atualização
Implementar um sistema de formações militares persistentes, permitindo que grupos de unidades mantenham uma organização tática durante o deslocamento, reajam aos inimigos e se reorganizem após obstáculos ou alterações na composição.
O sistema deve aproveitar a movimentação, as colisões, o pathfinding e as regras de combate existentes na V1.1.
Escopo confirmado
Recurso	Definição
Formações	Linha, cunha, bloco e duas fileiras
Quantidade de unidades	Sem limite fixo
Velocidade coletiva	Limitada pela unidade mais lenta
Combate	Reação automática pelas regras existentes
Formação em movimento	Persistente
Obstáculos	Quebra temporária e reorganização
Composição	Posicionamento por função militar
Seleção	Individual e múltipla
Grupos de controle	Atalhos de 1 a 9
Bônus de atributos	Nenhum nesta versão
2. Composição inteligente de tropas
A organização deve respeitar a função de cada unidade, mas sem impedir o jogador de formar exércitos incomuns.
Exemplo: formação de bloco misto

Escudeiros


Espadachins


Arqueiros


A frente da formação aponta na direção do deslocamento.
As regras de prioridade serão:
- Escudeiros: ocupam preferencialmente a vanguarda.
- Espadachins: ocupam a frente secundária e completam a primeira linha quando necessário.
- Arqueiros: ficam na retaguarda, protegidos pelas unidades corpo a corpo.
- Batedores montados: preferencialmente nos flancos, respeitando o espaço necessário ao movimento.
- Operários e construtores: ficam fora do agrupamento militar automático.
Uma observação importante: a formação em linha não deve virar três fileiras escondidas. A geometria escolhida pelo jogador tem prioridade; a função da unidade define sua posição dentro dessa geometria.
3. Comportamento da formação
1. Criação do grupo
   Ao selecionar várias unidades combatentes e uma formação, o sistema calcula posições relativas ao centro do grupo e atribui um slot a cada unidade.
2. Marcha
   O grupo avança na velocidade máxima da unidade mais lenta. Unidades mais rápidas ajustam sua velocidade, evitando ultrapassagens constantes.
3. Rotação
   Quando o jogador altera a direção, a formação gira progressivamente. Sempre que possível, as unidades preservam sua posição relativa e evitam cruzamentos.
4. Obstáculos
   O grupo utiliza os caminhos disponíveis. Quando necessário, rompe temporariamente a geometria para atravessar gargalos, sem atravessar unidades ou construções.
5. Reagrupamento
   Após o obstáculo, as unidades retornam aos slots compatíveis, sem exigir que todo o exército pare.
6. Finalização
   O movimento termina quando as unidades sobreviventes alcançam posições válidas próximas dos slots finais, com tolerância para evitar oscilações infinitas.

Regra técnica importante
A velocidade coletiva deve ser calculada com base nas unidades ativas e participantes da marcha. Se a tropa mais lenta morrer, o grupo poderá recalcular a velocidade.
Da mesma forma, uma unidade presa permanentemente não pode bloquear o movimento de todo o exército. Ela deve tentar recuperar sua rota; caso não consiga, o grupo prossegue e a unidade tenta se reagrupar.
4. Formação e combate
Aqui precisamos ter bastante cuidado para preservar a V1.1.
Quando o grupo detectar inimigos, as unidades continuam respondendo de acordo com o comportamento atual do jogo.
Situação	Resultado esperado
Arqueiro encontra inimigo ao alcance	Ataca de sua posição
Escudeiro precisa alcançar um inimigo	Pode sair do slot para combater
Inimigo morre	Unidade tenta retornar à formação
Jogador ordena novo movimento	A ordem do jogador tem prioridade, respeitando as regras existentes
Tropas sofrem baixas	A formação reorganiza os slots
Combate prolongado	A formação pode ficar temporariamente desorganizada
Minha recomendação: usar estados internos como MARCHANDO, EM_COMBATE, REAGRUPANDO e PARADO, sem substituir os estados existentes das unidades.
O controlador da formação coordena o grupo; cada unidade continua tendo autonomia de combate.
5. Interface e comandos
A experiência deve continuar simples:
- Selecionar múltiplas unidades e escolher uma das quatro formações no painel.
- Clique direito para movimentar, mantendo a formação escolhida.
- Ctrl + 1 até Ctrl + 9 para registrar grupos de controle.
- 1 até 9 para selecionar os grupos.
- Uma ordem individual remove apenas aquela unidade da marcha coordenada.
- Uma nova ordem de grupo substitui a ordem anterior, sem destruir o grupo de controle.
Eu acrescentaria uma prévia discreta da formação no terreno ao escolher o destino, mostrando onde a linha de frente ficará posicionada. Não precisa ser algo visualmente elaborado, apenas suficientemente claro para que o jogador saiba o que está comandando.
6. Requisitos técnicos e de desempenho
Como não teremos limite fixo de unidades, a implementação precisa ser escalável, mas isso não significa garantir desempenho ilimitado.
Eu definiria as seguintes regras de engenharia:
- Recalcular slots apenas quando a composição, a formação ou uma condição relevante mudar.
- Evitar executar pathfinding completo para cada unidade a cada frame.
- Reaproveitar rotas de grupo quando possível, mas permitir desvios individuais.
- Evitar oscilações de slots, usando tolerância espacial e temporal.
- Usar identificadores estáveis para unidades e grupos.
- Remover referências de unidades mortas ou destruídas.
- Garantir que uma ordem substituída cancele corretamente seu processamento anterior.
- Manter compatibilidade com controles, colisões e combate existentes.
Testes de escala sugeridos
5
tropas

Grupo pequeno
Verificar precisão da geometria


20
tropas

Grupo médio
Validar curvas e reagrupamento


50
tropas

Grupo grande
Verificar gargalos e colisões


100
tropas

Teste de estresse
Medir desempenho, travamentos e perda de FPS



Esses números são cenários de teste, não limites de jogabilidade. A meta é comparar o desempenho da V1.1.1 com o da V1.1, medindo FPS, tempo de resposta às ordens e quantidade de unidades travadas.
7. Plano de implementação para o Codex
Etapa	Entrega	Prioridade
1	Análise da movimentação existente e testes de regressão	Crítica
2	Gerador das quatro geometrias	Alta
3	Distribuição inteligente das unidades	Alta
4	Marcha coletiva e rotação	Alta
5	Desvios e reorganização	Alta
6	Integração com combate	Alta
7	Painel de formação e controles	Média
8	Grupos por atalhos	Média
9	Testes de escala e otimização	Alta
8. Critérios de aceite
A versão estará pronta quando o jogador conseguir selecionar um grupo heterogêneo, escolher qualquer uma das quatro formações e atravessar o mapa mantendo uma organização coerente.
Durante esse deslocamento, o grupo deve conseguir mudar de direção, contornar obstáculos, reagir a inimigos, sofrer baixas e continuar operando sem comandos adicionais desnecessários.
A implementação também não pode introduzir regressões nas ações individuais, nos comandos de ataque nem na movimentação existente.

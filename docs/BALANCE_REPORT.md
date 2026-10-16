# Relatório de simulação e balanceamento — Fase 10

## Método

`npm run simulate -- --games=100 --seed=123` executa o core sem Phaser. São 50 seeds, cada uma repetida com a ordem de ativação das IAs invertida, totalizando 100 partidas. Cada partida usa o mapa e os recursos iniciais da V1 e tem limite de 900 segundos simulados. O JSON e a tabela completos estão em `reports/simulation-100games-seed123.*`.

## Resultado da linha de base

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 37 | 63 |
| Primeiro quartel (média) | 270,17 s | 280,85 s |
| Primeira tropa (média) | 275,17 s | 285,85 s |
| Ataques por partida (média) | 39,58 | 42,77 |
| Dano por partida (média) | 197,90 | 213,85 |

Não houve empate por tempo. A duração média foi de 805 segundos. Por ordem de ativação, o vermelho venceu 28 de 50 partidas quando o azul iniciou primeiro, e 35 de 50 quando o vermelho iniciou primeiro.

## Leitura e decisão

A IA vermelha vence mais apesar de o azul produzir a primeira tropa antes. A medição identifica uma vantagem residual na partida IA vs IA, mas não isola uma causa única. Foram corrigidas duas assimetrias de lógica encontradas durante a implementação: a rota inicial de exploração e o destino de marcha próximo à base adversária. Os valores de custo, tempo, dano, vida e renda em `config/balance.v1.json` não foram alterados nesta fase; um bônus numérico por equipe confundiria a análise do comportamento e mudaria a dificuldade da partida Humano vs IA.

Esta linha de base usa um único mapa e uma única política de IA. Ela não substitui playtests humanos nem mede todos os cenários de combate. O próximo ciclo de balanceamento pode comparar alterações em `config/balance.v1.json` com o mesmo comando e as mesmas seeds, além de observar partidas humanas.

## Reexecução após as correções do playtest (2026-10-06)

O mesmo comando, as mesmas 50 seeds pareadas e o mesmo limite de 900 segundos produziram o resultado abaixo na primeira revisão do playtest. Esta tabela preserva o marco histórico; os arquivos em `reports/` foram atualizados pela reexecução posterior descrita adiante.

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 52 | 30 |
| Primeiro quartel (média) | 128,67 s | 132,23 s |
| Primeira tropa (média) | 208,46 s | 208,46 s |
| Ataques por partida (média) | 44,07 | 35,03 |
| Dano por partida (média) | 220,35 | 175,15 |

Houve 18 empates por tempo. A duração média foi de 816,77 segundos e a mediana, 820,47 segundos. Quando o azul iniciou a IA primeiro, o resultado foi 26 vitórias azuis, 16 vermelhas e 8 empates; com o vermelho iniciando primeiro, foram 26 vitórias azuis, 14 vermelhas e 10 empates.

O resultado mudou junto com as regras de movimento, engajamento em marcha, combate simultâneo e desempate de rotas/células. Assim, a diferença em relação à linha de base não mede o efeito isolado de nenhuma dessas mudanças. A vantagem azul observada nessa revisão e os empates exigiam novo playtest humano e investigação antes de outro ajuste de balanceamento; não foi aplicado bônus numérico por equipe.

## Reexecução após correção da IA e relatório de partida (2026-10-06)

A IA passou a manter exploração, economia, construção e produção durante a ofensiva. Duas unidades que causam dano podem iniciar o avanço, enquanto o batedor explora em separado. O torneio repetiu as mesmas 50 seeds pareadas e o limite de 900 segundos. Esta tabela registra a revisão anterior; os arquivos em `reports/` contêm a reexecução mais recente abaixo.

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 34 | 30 |
| Primeiro quartel (média) | 128,67 s | 132,23 s |
| Primeira tropa (média) | 208,46 s | 208,46 s |
| Ataques por partida (média) | 31,54 | 31,54 |
| Dano por partida (média) | 157,70 | 157,70 |

Houve 36 empates por tempo. A duração média foi de 655,67 segundos e a mediana, 641,33 segundos. O primeiro combate ocorreu em média aos 333,76 segundos. Por ordem de ativação: com azul primeiro foram 14 vitórias azuis, 16 vermelhas e 20 empates; com vermelho primeiro foram 20 vitórias azuis, 14 vermelhas e 16 empates.

O primeiro confronto mais cedo responde à falta de atividade percebida, mas o aumento de empates mostra que uma pressão inicial nem sempre se converte em vitória. Não ajustamos custos, renda ou atributos por equipe. O próximo playtest humano deve avaliar se a IA agora aparece e pressiona em um tempo adequado; os empates continuam sendo uma questão de balanceamento a investigar.

## Reexecução após expansão econômica da IA e efeitos visuais (2026-10-06)

Os mesmos 100 jogos, 50 seeds pareadas e limite de 900 segundos foram repetidos após a IA passar a reservar moedas para Casa e operários, procurar minas além da primeira floresta e manter um coletor de madeira por vez. Na defesa, tropas perto da base enfrentam invasores enquanto unidades distantes prosseguem com a ofensiva. O relatório integral atual está em `reports/simulation-100games-seed123.json` e `.md`.

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 3 | 3 |
| Primeiro quartel (média) | 123,63 s | 128,11 s |
| Primeira tropa (média) | 198,63 s | 189,31 s |
| Ataques por partida (média) | 70,04 | 66,04 |
| Dano por partida (média) | 352,78 | 330,83 |

Houve 94 empates por tempo. A duração média foi de 893,65 segundos, a mediana foi de 900 segundos e o primeiro combate ocorreu em média aos 463,15 segundos. Com azul iniciando primeiro, ocorreram 2 vitórias azuis, 2 vermelhas e 46 empates; com vermelho iniciando primeiro, 1 vitória azul, 1 vermelha e 48 empates.

Um teste de partida contra adversário inativo, a partir dos recursos iniciais, confirma que a IA descobre mina, produz operários e ao menos três tropas e coleta mais de 900 moedas em 600 segundos. Isso demonstra a expansão econômica pedida, mas o torneio mostra que duas IAs com a nova capacidade se neutralizam com frequência e raramente destroem a base adversária em 15 minutos. Separar defesa local de ofensiva não resolveu esse impasse. O próximo trabalho tático deve investigar concentração de forças, prioridade de alvo e encerramento de ataques; não há evidência para bônus numéricos por equipe.

## Amostra após formação de levas e guarda da base (2026-10-06)

A IA passou a manter um atacante como guarda, esperar três atacantes adicionais para cada leva e chamar de volta o último sobrevivente de uma leva. Enquanto a base sofre ameaça, reservas ajudam na defesa e não iniciam uma nova ofensiva. A produção inicial prioriza a formação desse grupo. Ordens de movimento podem mudar o destino de uma unidade já em marcha durante seu intervalo entre passos, sem acelerar o deslocamento. O arquivo `reports/simulation-tactical-10games-seed123.json` registra dez jogos pareados, com as seeds 123 a 127 e limite de 900 segundos.

| Métrica | Azul | Vermelho |
|---|---:|---:|
| Vitórias | 0 | 0 |
| Ataques por partida (média) | 57,5 | 56,1 |
| Dano por partida (média) | 298 | 290,1 |

Os dez jogos empataram por tempo. O primeiro combate ocorreu em média aos 570,4 segundos; em cinco partidas uma base recebeu dano, mas nenhuma foi destruída. A amostra é pequena e usa a mesma política nos dois lados: demonstra que a regra evita ataques isolados e preserva uma guarda, mas não sustenta afirmar que a IA ficou mais difícil contra humanos. O primeiro confronto também ficou mais tardio do que no torneio anterior. O aceite tático da V1 ainda depende de novo playtest humano e de melhorar a pressão ofensiva sem abrir a defesa.

Após conceder 4 de dano e alcance 1 aos operários, as mesmas dez partidas foram repetidas. Vencedores, duração, primeiro combate, dano total e HP final das bases ficaram iguais nessa amostra. O novo ataque protege operários em encontros próximos, mas essa simulação não exercitou uma invasão que mudasse seu resultado.

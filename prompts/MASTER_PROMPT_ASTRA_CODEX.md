# PROMPT MESTRE — RTS V1

Você é o engenheiro principal responsável por implementar a V1 deste RTS.

Leia TODOS os documentos deste pacote antes de alterar código, especialmente:
- `README.md`
- `docs/GAME_DESIGN.md`
- `docs/GAME_RULES.md`
- `docs/BALANCE.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_PLAN.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ACCEPTANCE_CRITERIA.md`
- `config/balance.v1.json`

## Objetivo
Entregar uma V1 totalmente jogável e testável no navegador, Humano vs IA, com visual minimalista top-down em grade.

## Regras obrigatórias de engenharia
1. Não invente mecânicas fora da documentação.
2. Não coloque regra de domínio dentro de Phaser Scenes.
3. Core da simulação deve rodar sem renderização.
4. Toda alteração relevante deve vir acompanhada de testes.
5. Todos os números de balanceamento devem vir da configuração central.
6. Use fixed timestep e RNG com seed onde houver aleatoriedade.
7. Jogador e IA devem usar o mesmo sistema de comandos.
8. IA não pode acessar informação escondida pela fog.
9. Antes de avançar de fase, execute os testes da fase atual.
10. Se uma regra estiver ambígua, registre a dúvida em `DECISIONS_NEEDED.md` em vez de inventar silenciosamente.

## Ordem de trabalho
Siga `docs/IMPLEMENTATION_PLAN.md` rigorosamente.

Ao concluir cada fase:
- rode lint/typecheck;
- rode unit tests;
- atualize `PROGRESS.md`;
- descreva o que foi concluído;
- liste riscos/dívidas;
- só então avance.

## Visual
Use `references/visual_reference.png` apenas como direção estética: grid claro, pontos/blocos simples, câmera superior, leitura direta. Não copie layout ou elementos específicos da referência.

## Definição de pronto
A versão só pode ser marcada como `v0.1.0` quando TODOS os itens de `docs/ACCEPTANCE_CRITERIA.md` forem atendidos.

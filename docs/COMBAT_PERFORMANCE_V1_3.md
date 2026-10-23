# RTS V1.3 — benchmark de batalha densa

## Objetivo
Comparar a camada de apresentação, incluindo flash de dano, flechas e destruição, com **20, 40 e 60 unidades por equipe**. Não altera economia, dano, IA ou regras de combate.

## Execução
Em um terminal, inicie o build estático: `npm run build && npx vite preview --host 127.0.0.1 --port 4173`.
Em outro, após instalar Chromium com Playwright, execute:

```sh
npm run benchmark:browser -- --url=http://127.0.0.1:4173 --label=v1-3-combat
```

Opcional: `--units-per-team=20,40,60` (somente inteiros de 1 a 60).
O script roda os cenários `idle`, `move`, `formation`, `combat` e `churn` para cada carga. Salva relatório JSON, imagem de contexto e perfis CPU com nomes `{label}-{N}v{N}-{scenario}.cpuprofile` em `reports/performance/`.

## Leitura e critérios
- Comparar FPS e p95/max de tempo de frame, tempo de comando e memória pós-GC entre cargas e com o benchmark de referência.
- Verificar erros JavaScript; qualquer erro bloqueia o aceite.
- Em 60v60, procurar travamentos, atrasos visuais, acúmulo excessivo de FX e fugas de memória.
- A execução é headless/instrumentada e a GPU relatada pode ser virtualizada; não confundir com FPS em hardware físico.
- Repetir manualmente em GPU real com a build Tiny Swords e com o fallback, câmera acompanhando os combates.
- Registrar resultados medidos e ambiente antes de definir limiares de FPS ou declarar performance aprovada.

**Importante:** resultados de performance ainda não foram medidos nesta entrega; o script apenas amplia a cobertura reproduzível.
## Relatório comparativo

Após gerar o JSON, rode:

```sh
node scripts/summarize-combat-performance.mjs reports/performance/v1-3-combat.json
```

O resultado será `reports/performance/v1-3-combat-summary.md` com FPS, p95, memória pós-GC, delta comparativo entre cargas e alertas de frame acima de 33,3ms. Os alertas são diagnósticos, **não critérios absolutos de reprovação**.

Há também um workflow manual `RTS V1.3 — Dense combat benchmark` em `.github/workflows/combat-performance.yml`, com upload de relatórios e perfis. O GitHub geralmente requer que workflows de `workflow_dispatch` já existam na branch padrão para exibir o botão Run workflow; até lá, execute localmente ou valide em uma branch com o workflow registrado. O CI padrão não executa esse benchmark pesado automaticamente.

## Integridade da população

O benchmark agora procura células livres e transitáveis do mapa orgânico, em vez de presumir que uma grade fixa de posições está sempre desocupada. Cada cenário verifica explicitamente a população **exata** dos dois lados e aborta quando não consegue alocar as unidades. Isso impede comparar uma carga nominal de 60v60 quando a partida realmente contém menos tropas.

A configuração `combat` aproxima os pontos de origem dos dois exércitos, mas **não prova** que todos eles estejam atacando durante a janela de cinco segundos. Para diagnosticar o custo específico do combate, inspecionar as métricas `CombatSystem`, eventos de ataque e o perfil CPU; não tratar apenas o rótulo `combat` como prova de engajamento.

## Gate de combate efetivo (novo)

No cenário `combat`, as duas equipes são colocadas próximas (âncoras X=42/45) em células transitáveis. O benchmark registra `combatDamage`, `initialUnits` e `remainingUnits`, comparando HP total antes/depois dos cinco segundos. Se não houver qualquer redução de HP, o cenário **falha**, para que um FPS alto sem batalha não seja tomado como resultado válido. A janela e a densidade ainda precisam de validação empírica; verificar possível falta de engajamento em mapas alterados antes de interpretar desempenho.

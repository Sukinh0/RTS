# RTS V1.3 — benchmark de batalha densa

## Objetivo
Comparar a camada de apresentação, incluindo flash de dano, flechas e destruição, com **20, 40 e 60 unidades por equipe**. Não altera economia, dano, IA ou regras de combate.

## Execução
Em um terminal, inicie o build estático: `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`.
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
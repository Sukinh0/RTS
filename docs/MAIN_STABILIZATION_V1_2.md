# RTS — V1.2 Stabilization / Organic Map Baseline

This branch starts from `main@a8f5bef` to protect the newly implemented
`MAP_ORGANIC_01`, fullscreen HUD, combat FX and calibrated Tiny Swords visuals.
Do **not** merge the older stacked PRs #1 → #2 → #4 wholesale: they were
developed against the previous rectangular/symmetric map and presentation.

## Immediate fixes
- First offensive wave needs two field fighters plus a home guard, not three
  field fighters. Keep the defender when the home base is threatened.
- The last surviving raider can keep pressure on a **visible** nearby enemy base.
- A builder actually **visible** within 12 cells of that base is a priority target
  during siege; the AI cannot inspect hidden enemies or their tasks.
- Record combat and attacks to base in the headless seeded tournament.
- Guard real terrain navigation and tests with CI.

## Third-party art hygiene
- `public/assets/tiny-swords/` remains gitignored.
- Derived builder PNGs are excluded from the public branch (the build can
  fall back to the original Pawn look or temporary geometric render).
- Owners who obtained Pixel Frog's original Tiny Swords Free Pack may install
  the art locally: `npm run assets:install`.
- To restore the copper-hat **local** builder variant, run
  `python -m pip install Pillow` and `python scripts/recolor-builder.py`
  after installation. This intentionally generates local files only.
- The old history still contains derived assets; removing them from this
  branch does not rewrite Git history. Separate history remediation may be
  needed after reviewing the license.
- VisualRegistry tests only validate PNG presence if the owner's official
  pack is locally available; CI never fetches mirrors of licensed work.

## Gates
```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run simulate -- --games=4 --seed=123 --max-seconds=1200 --out=reports-ci
```
Compare the organic map against future seeds and GPU hardware before claiming
balance or 60 FPS. GitHub Actions uploads a Vite build with base path `/RTS/`.
The `main` branch is not modified by this PR.

## Validação inicial de IA em MAP_ORGANIC_01 — 22/10/2026
Testes com 20 partidas espelhadas, seeds 123–132 e até 1200 segundos:
| Estratégia | Azul | Vermelho | Empates | Combate | Ataques à base |
|---|---:|---:|---:|---:|---:|
| Nova leva com marcha direta | 20 | 0 | 0 | 20/20 | 20/20 |
| Nova leva com aproximação norte/sul (varia pela seed) | **3** | **9** | **8** | **20/20** | **20/20** |

**Não declarar equilíbrio concluído.** A nova estratégia elimina a vitória azul
obrigatória do primeiro experimento, mas 8 partidas ainda empatam e a vermelha
vence 3 vezes mais que a azul nesta amostra. Os pontos de aproximação do
primeiro avanço são (89, 62)/(89, 137) para blue e (110, 62)/(110, 137)
para red, alternados pela seed. O objetivo conhecido prevalece sobre o
ponto de aproximação; unidades inimigas ocultas continuam inacessíveis à IA.

## Visual da prévia pública
- O usuário pode escolher o arquivo oficial
  `Tiny Swords (Free Pack).zip` no botão 🎨 do HUD.
- O carregador de ZIP opera localmente com `DecompressionStream` do navegador;
  nenhuma imagem é transmitida para serviço externo.
- O carregador aceita apenas os nomes de arquivos previstos no manifesto
  `tinySwordsLocalManifest`, com validação de estrutura e tamanho do ZIP.
- A partida reinicia ao finalizar a importação para recriar terreno e sprites
  com as texturas em memória. Recarregar a página descarta o pacote.
- O pack não é versionado nem distribuído pelo CI. Para uso de construtor com
  chapéu diferenciado, gerar derivados localmente (script documentado acima).

## Estratégias de abertura mistas — resultado do torneio

Um terceiro experimento alterna **de maneira idêntica para as duas equipes**
entre ataque central (se `abs(seed) % 4 === 0`) e aproximação em flancos
opostos nas demais seeds. Isso evita que a IA escolha sempre o mesmo caminho,
mantendo roteamento normal até o destino conhecido. Não há buff de atributos.

| Estratégia (20 partidas, seeds 123–132) | Azul | Vermelho | Empates | Combate | Ataques à base |
|---|---:|---:|---:|---:|---:|
| Rota direta | 20 | 0 | 0 | 20/20 | 20/20 |
| Apenas flancos opostos | 3 | 9 | 8 | 20/20 | 20/20 |
| **Central 25% das seeds + flancos 75%** | **8** | **9** | **3** | **20/20** | **20/20** |

O modelo misto é o melhor desempenho equilibrado da **amostra pequena**:
17 partidas com vencedor e ambos os times ganhando, sem modificar mapa, névoa,
recursos, HP ou dano. Ainda falta ensaio com seeds independentes e humanos.

## Ainda necessário antes de chamar de release estável
1. Playwright completo na última SHA e teste visual com ZIP oficial verdadeiro.
2. Torneio mais longo, múltiplos conjuntos de seeds e cenários jogador vs IA.
3. Benchmark de FPS da versão atual com sprites instalados, incluindo GPU real.
4. Revisão de direitos de arte/histórico Git (o commit anterior à branch
   contém arquivos derivados).
5. Publicação em ambiente com autorização de deploy da branch; o build
   `v1-2-rts-preview-dist` não ativa hospedagem sozinho.

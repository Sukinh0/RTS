# Tiny Swords automático — RTS no navegador

**O jogador não precisa baixar nem selecionar ZIP.** Phaser pré-carrega
as texturas que foram incorporadas ao jogo **durante a compilação**.

## Como funciona

- O ZIP do *Free Pack* é obtido pelo responsável pelo jogo na
  [página oficial](https://pixelfrog-assets.itch.io/tiny-swords).
- Ele é armazenado fora do Git: localmente em
  `external-assets/Tiny Swords (Free Pack).zip`, ou numa origem HTTPS
  privada para o ambiente de build.
- `npm run dev` e `npm run build` executam
  `scripts/prepare-tiny-swords.mjs` automaticamente.
- Esse script extrai PNGs de `Terrain/`, `Units/`, `Buildings/` e
  `Particle FX/` para `public/assets/tiny-swords/`, preservando nomes.
- O Vite inclui as texturas na build e o Phaser as carrega sozinho no boot.
  Nenhum botão ou importador ZIP aparece para jogadores.

## Configurar a Vercel

Em **Project → Settings → Environment Variables**, configure:

| Variável | Valor |
|---|---|
| `TINY_SWORDS_ARCHIVE_URL` | URL HTTPS **privada** para o Free Pack |
| `TINY_SWORDS_ARCHIVE_TOKEN` | Token Bearer de leitura, caso exigido |
| `TINY_SWORDS_REQUIRED` | `1` |
| `RTS_BASE_PATH` | `/` |

O instalador usa o ZIP apenas na compilação. Não passe o token por prefixos
`VITE_`, não publique a URL privada e não salve o arquivo no GitHub público.
O script recusa redirects, arquivos com excesso de conteúdo descompactado,
entradas fora das pastas autorizadas e travessia de diretórios.

**Configuração Vercel:** framework Vite, build `npm run build`, output `dist`.
Com `TINY_SWORDS_REQUIRED=1`, o deploy falha se não houver sprites —
é melhor que anunciar Tiny Swords e publicar a arte provisória.

## Desenvolvimento no computador

Obtenha o pacote legalmente e salve em:

```text
external-assets/Tiny Swords (Free Pack).zip
```

Em seguida:

```sh
npm ci
npm run dev
```

A instalação é automática e funciona em Node 22 no Windows e Linux. O
script anterior PowerShell continua disponível opcionalmente. O ZIP e os
PNGs extraídos continuam cobertos por `.gitignore`.

Para validar o instalador sem possuir ou redistribuir o pacote:

```sh
npm run test:assets
```

## Restrição importante: licença e aplicação web

O autor permite uso em jogos pessoais/comerciais e adaptações, mas **não
permite redistribuir os arquivos da arte como recursos independentes**.
Ele também orienta a não colocar o pacote em um GitHub público:

- https://pixelfrog-assets.itch.io/tiny-swords
- https://itch.io/t/5783521/licensing-on-open-source-projects

**Uma origem de build privada não torna as texturas privadas no navegador:**
os PNGs precisam chegar ao computador do jogador para serem renderizados e
podem ser recuperados. Portanto, antes de publicar a versão **web aberta**
com esses PNGs, confirme com Pixel Frog se servir texturas individuais
durante a execução do jogo está autorizado. É possível usar a integração
numa prévia restrita até receber confirmação.

O script instala os arquivos do titular da licença; **não busca os assets em
sites espelho ou repositórios de terceiros**.

## Situação para avaliação

A integração automática foi implementada, mas só é possível verificar a
aparência Tiny Swords com o pack oficial disponível no ambiente de build.
Sem o ZIP original no projeto/segredo da Vercel, as compilações continuam
com os gráficos de fallback quando `TINY_SWORDS_REQUIRED` não está ativo.

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

## Configurar a Vercel com Blob privado

A equipe `fabio-sousa-s-projects` já tem um Blob **privado** conectado
ao projeto `rts`: `rts-tiny-swords-source`. Essa conexão fornece
`BLOB_READ_WRITE_TOKEN` automaticamente aos ambientes Vercel.

1. Na [Vercel → projeto RTS](https://vercel.com/fabio-sousa-s-projects/rts),
   abra **Storage → rts-tiny-swords-source**.
2. Faça upload do arquivo oficial **Tiny Swords (Free Pack).zip** como
   **objeto privado**, sem transformá-lo em público. O ZIP não deve ser
   distribuído a visitantes ou anexado ao repositório público.
3. Copie a **URL privada do objeto** disponibilizada no Blob Browser,
   por exemplo uma URL no domínio `.private.blob.vercel-storage.com`.
4. Em **Settings → Environment Variables**, crie
   `TINY_SWORDS_ARCHIVE_URL` com essa URL para **Production** e **Preview**.
   O instalador reconhece domínios `.private.blob.vercel-storage.com`
   e usa o `BLOB_READ_WRITE_TOKEN` já conectado, **sem criar nem copiar
   um token novo**.
5. Defina `TINY_SWORDS_REQUIRED=1` para Production e Preview **apenas
   depois do upload e da URL funcionarem**; caso contrário, novos
   builds falhariam deliberadamente e manteriam o deploy anterior ativo.
6. Configure `RTS_BASE_PATH=/` (opcional na Vercel, é o valor padrão).
   Execute **Deployments → Redeploy** e confira no log
   `Tiny Swords: prepared ... PNG game textures for automatic boot.`.
7. No navegador, teste se o RTS abre com as imagens reais e não gera
   404 em `/assets/tiny-swords/`.

`npm run build` já instala o ZIP na compilação, gerando `dist/`. O
jogador apenas abre o jogo, **sem importar ZIP**.

Se você usar outro servidor de armazenamento HTTPS autenticado, defina
`TINY_SWORDS_ARCHIVE_URL` e `TINY_SWORDS_ARCHIVE_TOKEN`. Este token
não é necessário quando a URL é do Blob privado vinculado ao projeto.
Nunca use variáveis `VITE_` para credenciais de servidor.

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

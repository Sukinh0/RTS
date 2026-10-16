# Performance do RTS V1.1/V1.1.1

## Integração Tiny Swords (2026-10-16)

O benchmark visual com o pack instalado foi executado separadamente para 100 unidades no Chromium headless/SwiftShader: idle 16,8 FPS, movimento 14,4 FPS, formação 15,6 FPS, combate 17,5 FPS e churn 16,5 FPS. O baseline anterior registrava 31,6 / 26,0 / 22,9 / 31,1 FPS nos quatro cenários equivalentes. A simulação, o pathfinding e os testes de regras não foram alterados; esta diferença é uma pendência da camada de apresentação e deve ser reavaliada em GPU física. Os perfis locais `reports/performance/tiny-swords-*` não são versionados.

## Problema e auditoria

O jogo simula a 30 passos por segundo em `Simulation` e desenha com Phaser 3 (WebGL quando disponível). Já existiam acumulador de tempo, separação entre lógica e apresentação, interpolação do movimento e decisões estratégicas da IA a cada 30 passos. O acumulador não tinha limite, portanto um frame atrasado podia executar uma quantidade ilimitada de passos. A apresentação redesenhava entidades quando a lógica avançava e o minimapa já mantinha um buffer de terreno.

Foram inspecionados o ciclo `MapScene.update → Simulation.advance → tick`, criação e remoção em `EntityStore`, ordens individuais e coletivas, A*, combate, visibilidade, IA, formações, produção, construção, economia, apresentação e descarte de eventos. Os problemas **comprovados por leitura e medição** foram:

1. `EntityStore.atCell` e `isFreeForUnit` percorriam todas as entidades. O A* chama essas operações para muitas células; a atualização da neblina consultava cada célula visível. O custo crescia com o mapa e com o número de unidades.
2. Cada ordem de movimento procurava um caminho dinâmico, e a primeira atualização procurava o mesmo caminho de novo. A cada ação posterior, o caminho inteiro era recalculado, inclusive em congestionamentos. Ordens de grupo amplificavam o pico de CPU.
3. Combate e busca de alvos da marcha examinavam todas as entidades por atacante. As formações resolviam alvos de slots repetidamente, mesmo sem avanço do grupo ou mudança do mapa.
4. O terreno era desenhado em um objeto `Graphics` cujos comandos cresciam com células reveladas ou modificadas e eram processados em frames seguintes. O perfil de CPU do Chromium mostrou `GraphicsWebGLRenderer` entre as funções ativas. Um teste no navegador com 100 unidades e essa implementação ainda ativa mediu 19,6 FPS em repouso no ambiente descrito abaixo.
5. O laço da simulação criava a cada passo um `Set` de todos os IDs de unidades para contabilizar produção; a descoberta de recursos da IA criava chaves de texto por célula. O torneio headless deixava eventos de movimento e células sujas sem consumo.

**Hipóteses não tratadas como fatos:** pressão de GPU em outros dispositivos, fragmentação de memória após partidas longas e a contribuição precisa de cada efeito visual. O perfil de CPU e o heap coletado aqui não substituem análise no hardware do jogador.

## Ambiente e metodologia

- Captura em 9 de outubro de 2026, Windows, AMD Ryzen 5 5625U. O benchmark do navegador usou Chromium 153 headless, 1440×1000 e WebGL via ANGLE/SwiftShader (renderização por software; textura máxima de 8192 px). A versão exata de Node consta nos JSON em `reports/performance/`.
- `scripts/performance.mjs` executa **o mesmo roteiro** contra `baseline-engine.txt` (bundle do motor antes das mudanças) e contra o código atual. Usa semente 123, passos fixos e cenários de 10, 25, 50, 100, 200 e 500 unidades: paradas, marcha, solicitação simultânea de caminhos, combate, formação, passagem estreita, criação/remoção contínuas e IA. Mede duração das ordens, média/p95/máximo do passo, fases da simulação, neblina visual sem GPU e heap Node. O cenário de 500 eleva apenas o teto na instância isolada; o balanceamento entregue mantém 60 unidades por equipe. Cada caso tem prazo de 30 s e um timeout é reportado como tal.
- `scripts/performance-browser.mjs` usa Chromium headless, 100 unidades iniciais, 5 s por cenário, `requestAnimationFrame`, CPU profile via CDP, heap após coleta explícita e a instrumentação `?perf=1`. O resultado contém FPS observado, média, p95 e máximo do intervalo entre frames e duração das fases. Uma captura foi feita antes do cache do terreno, **já com as otimizações de simulação**, e outra após as mudanças de renderização. Portanto a comparação de FPS isola principalmente o trabalho de apresentação; ela não representa uma medição do navegador com todo o código V1.1 original.
- O benchmark headless mede CPU de lógica. Ele não mede FPS ou trabalho real de GPU. CPU profiles, capturas e JSON estão em `reports/performance/`. Perfis com instrumentação ligada têm sobrecarga e servem para localizar custo, enquanto a comparação da lógica roda sem ela.

## Correções e razões

- Ocupação por célula e buckets de 8×8 em `EntityStore`: colisões e alvos próximos deixam de percorrer todas as entidades. A ordem de desempate de `atCell` e as células vizinhas permanecem preservadas. Índices acompanham spawn, deslocamento e remoção; snapshots de `all()` são reconstruídos apenas quando muda o conjunto de entidades.
- `MapGrid.isPassable` lê diretamente arrays já existentes. A conectividade do terreno é calculada quando a topologia muda; destinos desconectados são rejeitados sem explorar a área inteira no A*. Construções, barricadas e mudanças de terreno invalidam o cálculo.
- O A* existente reutiliza buffers por mapa; buscas aninhadas têm workspace separado. A movimentação reutiliza a rota enquanto as células dos próximos dois movimentos e os dois lados de cada diagonal continuarem livres. Obstáculos mais distantes são reavaliados quando a unidade se aproxima; mudança da topologia invalida a rota imediatamente. Guias de distância estática compartilhados por regiões próximas reforçam a heurística do mesmo A* quando grupos grandes atravessam distâncias longas. Têm limite de oito campos por mapa e invalidação por revisão da navegação. As colisões de unidades continuam no A* e no passo efetivo.
- A ordem valida a conectividade estática imediatamente. Congestionamento transitório continua sendo tratado durante a marcha. IA estratégica mantém seu intervalo anterior; alvos táticos usam consultas espaciais. A neblina reutiliza seu buffer e a IA usa uma máscara de células descobertas. Formações reutilizam alvos de slots até mudar o avanço da coluna ou a topologia.
- Nos cenários de estresse acima do limite de população do jogo (mais de 120 unidades), se um aliado bloquear temporariamente o próximo trecho de uma rota conhecida, a unidade espera até oito passos antes de calcular novo desvio. Dentro do limite normal, o replanejamento é imediato. Inimigos e mudanças de terreno também exigem reavaliação imediata. O limite simples de 16 novas rotas por passo foi medido e revertido porque escalonou a formação, aumentou o congestionamento e piorou o custo.
- O clock de tempo real executa no máximo cinco passos por frame e contabiliza tempo descartado para impedir crescimento indefinido do backlog. Simulações headless continuam sem esse limite. Em sobrecarga sustentada, o tempo descartado aparece em `droppedSimulationMs`; deve ser tratado como limitação observável, não como ganho de FPS.
- O terreno estático é consolidado em `RenderTexture` e o `Graphics` temporário é limpo após cada atualização. Em dispositivos cujo limite de textura é menor que o mapa, o desenho anterior permanece como fallback. Entidades fora da câmera deixam de gerar comandos de desenho e são redesenhadas quando a câmera muda.
- Produção contabiliza unidades pelo evento de spawn. O torneio consome filas de eventos. O minimapa remove listeners antes de novo `attach`. A memória da IA libera referências a inimigos mortos quando a morte está visível para sua equipe.

O cache de rota pode manter um desvio válido mesmo após abrir um atalho dinâmico; uma nova ordem, bloqueio próximo da rota ou alteração do terreno força novo planejamento. Isso não permite atravessar unidades, construções ou diagonais bloqueadas. A `RenderTexture` de 2400×2400 reserva aproximadamente 22 MiB de pixels RGBA por instância, além da representação interna do renderizador.

## Resultados e comparação

Os resultados detalhados e os checksums do estado ao fim de cada caso estão nos JSON. Métricas de duração variam com carga e aquecimento do JavaScript; cada comparação deve usar o mesmo roteiro e ambiente.

| Cenário | Antes | Depois | Leitura |
|---|---:|---:|---|
| Lógica, 100 unidades, comando coletivo de movimento | emissão 2.594 ms; passo médio 69,8 ms, máximo 2.242 ms | emissão 14,5 ms; passo médio 3,8 ms, máximo 162 ms | mesma semente e 60 passos |
| Lógica, 100 unidades, formação | emissão 105 ms; passo médio 29,6 ms, máximo 631 ms | emissão 25,7 ms; passo médio 4,2 ms, máximo 102 ms | inclui marcha e recuperação de congestionamento |
| Lógica, 100 unidades, IA ativa | passo médio 64,2 ms, máximo 1.436 ms | passo médio 4,6 ms, máximo 164 ms | duas IAs, 60 passos |
| Lógica, 100 unidades, passagem estreita | timeout de 30 s; sem medição válida | emissão 16,6 ms; passo médio 6,8 ms, máximo 269 ms | cenário ainda produz um pico |
| Lógica, 200 unidades, formação | timeout de 30 s; sem medição válida | passo médio 16,0 ms, máximo 258 ms | acima do teto normal do jogo |
| Lógica, 500 unidades, formação | timeout de 30 s; sem medição válida | passo médio 104,7 ms, máximo 1.283 ms | escala ainda inadequada |
| Navegador headless, 100 unidades paradas | 19,6 FPS; p95 de frame 57,5 ms | 31,6 FPS; p95 de frame 35,8 ms | antes da camada estática em textura vs. versão final |
| Navegador headless, 100 unidades em formação | 14,9 FPS; p95 de frame 153,8 ms | 22,9 FPS; p95 de frame 117,4 ms | marcha em formação, SwiftShader |
| Navegador headless, 100 unidades em combate | 18,9 FPS; p95 de frame 63,2 ms | 31,1 FPS; p95 de frame 36,4 ms | ataques simultâneos |

Os JSON `baseline-core.json` e `optimized-final.json` têm os 48 casos, seus máximos, fases e checksums. Em cenários parados, de combate e de criação/remoção, os checksums coincidem; marcha, formação e IA podem seguir células diferentes após a otimização da rota, embora os testes de regras e colisões passem. Os resultados são de **uma repetição** por caso, com 60 passos (2 s de simulação); diferenças pequenas devem ser medidas novamente antes de conclusões. Um p95 baixo pode esconder um único passo muito caro, por isso a tabela também mostra o máximo.

O soak de `memory-soak.json` substituiu 10 mil unidades em lotes, sempre com 56 entidades presentes. Após GC explícito, o heap medido foi 6,65 MiB depois de mil substituições e 6,67 MiB depois de 10 mil; a variação intermediária não mostrou crescimento sustentado nesse teste. Ele não cobre memória da GPU nem partidas longas com IA e muitos inimigos ocultos.

Os FPS dependem de Chromium headless, SwiftShader e da instrumentação ativa. O resultado final **não atingiu** a meta de 60 FPS com 100 unidades neste ambiente: foram 31,6 FPS paradas, 26,0 FPS em marcha, 22,9 FPS em formação e 31,1 FPS em combate. É necessário medir novamente em GPU física e partida representativa.

## Problemas restantes e evolução

- Pedidos de rota ainda são síncronos. Mesmo com 100 unidades, o maior passo de formação foi 102 ms; acima do teto normal do jogo, formação com 500 unidades consumiu 105 ms por passo em média. O próximo estágio é evoluir **o mesmo A*** para busca incremental com limite de nós por passo e fila justa, preservando confirmação imediata de ordens inválidas e resposta a ameaças. Uma fila simples de 16 rotas por passo foi testada e revertida porque causou mais congestionamento e elevou o custo médio com 200 unidades de cerca de 19 ms para 46 ms.
- A camada de neblina desenhada por `Graphics` e efeitos podem ter custo no WebGL de software. Perfil em GPU de referência, com a câmera em batalha representativa, antes de trocar a técnica.
- `AIMemory.lastSeenEnemies` preserva informação de inimigos desaparecidos na neblina, como definido pela mecânica. Partidas muito longas com produção/destruição contínua ainda precisam de política de expiração de inteligência que não revele mortes ocultas.
- Texturas do terreno consomem memória gráfica. A camada de 2400×2400 ocupa cerca de 22 MiB por superfície RGBA. Se o mapa crescer, dividir a camada estática em blocos menores e carregar apenas blocos próximos pode reduzir o pico.

## Como reproduzir

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run lint
npm.cmd run build
npm.cmd run benchmark -- --baseline --label=baseline-core --sizes=10,25,50,100,200,500 --repeats=1 --ticks=60
npm.cmd run benchmark -- --label=optimized-final --sizes=10,25,50,100,200,500 --repeats=1 --ticks=60
node --expose-gc scripts/performance-memory.mjs
npm.cmd run dev -- --host 127.0.0.1 --port 4173
npm.cmd run benchmark:browser -- --url=http://127.0.0.1:4173 --label=browser-final
```

Abra `http://127.0.0.1:4173/?perf=1`. No console do navegador, `window.rtsPerformance.snapshot()` retorna FPS, fases, chamadas/s, heap disponível, entidades e tempo descartado. `setEnabled(false)` remove os hooks; `setEnabled(true)` os recoloca; `reset()` inicia uma nova janela de amostragem. Sem `?perf=1`, nenhuma coleta é instalada. Os arquivos `.cpuprofile` podem ser abertos no DevTools; use as abas Performance e Memory para registrar uma partida real e obter snapshots de heap no computador alvo.

# PUBG Insight

Aplicacao web para consultar estatisticas de jogadores de PUBG, historico de partidas e replay 2D baseado em telemetry.

O projeto usa um backend simples em Node/Express para falar com a PUBG API, aplicar cache em disco e servir a interface vanilla JS em `public/`.

## Funcionalidades

- Busca de jogadores por nome e plataforma: Steam, Kakao, PSN, Xbox e Stadia.
- Selecao de temporada, com filtro entre seasons de PC e console.
- Estatisticas por modo: Solo, Duo e Squad em FPP/TPP.
- Tendencia de carreira nas ultimas temporadas com minimo de partidas por season.
- Historico de partidas com filtros por mapa, perspectiva e ranked/normal.
- Drawer de detalhes da partida, links compartilhaveis e jogadores salvos/recentes no `localStorage`.
- Replay 2D por telemetry, com mapa em tiles, timeline, killfeed, loadout e paineis de equipe.

## Como Rodar

Requisitos:

- Node.js 18 ou mais recente
- Chave da PUBG API

Crie um arquivo `.env` na raiz:

```env
API_KEY=sua_chave_pubg_aqui
PORT=8080
```

Instale as dependencias e inicie o servidor:

```bash
npm install
npm start
```

A aplicacao fica disponivel em `http://localhost:8080`.

## Scripts

```bash
npm start   # inicia o Express em server.js
npm test    # roda o runner de testes em tests/run.js
npm run tiles  # gera tiles de mapa a partir das imagens grandes em public/images
```

## Estrutura

- `server.js`: API local, cache, chamadas autenticadas para a PUBG API e proxy/cache de telemetry.
- `public/scripts.js`: SPA principal, busca, estatisticas, carreira, lista de partidas, drawer, historico e favoritos.
- `public/modal.js`: modal do replay, layout dos times, controles visuais e paineis fixados.
- `public/replay2d.js`: parse da telemetry, interpolacao, canvas, mapa em tiles, zonas, players, tiros, killfeed e loadout.
- `public/utils.js`: utilitarios compartilhados de mapa e cores.
- `tests/`: testes unitarios sem framework externo para regras de telemetry, filtros, plataforma, mapas, timing e loadout.
- `scripts/generate-tiles.js`: gerador de tiles JPEG dos mapas.
- `cache/`: cache local gerado em runtime (fora do `public/` pra não vazar via static serve).

## Cache

O cache e baseado em arquivos JSON dentro de `cache/` para reduzir chamadas rate-limited da PUBG API.

- Seasons e player IDs ficam por 24h.
- Estatisticas da season atual ficam por 10min.
- Lista de partidas fica por 5min.
- Detalhes de partidas e telemetry sao reutilizados porque partidas sao imutaveis.

## Observacoes

Os assets grandes de mapas, tiles e dicionarios da PUBG API ficam fora do fluxo normal do codigo e podem ser regenerados quando necessario. A pasta `AI_training/` esta fora do escopo atual do projeto.

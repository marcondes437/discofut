# PROGRESS — DiscoFut

Data: 21/10/2026. Repositório criado do zero (não havia código anterior a preservar).

## Concluído (etapas 1–8)

| Etapa | Status | Principais arquivos |
|---|---|---|
| 1. Base local jogável | ✅ | `shared/config/physicsConfig.js`, `shared/physics/*`, `shared/maps/arenaGeometry.js`, `client/src/render/*`, `client/src/input/InputManager.js` |
| 2. Regras completas | ✅ | `shared/game/MatchController.js`, `client/src/core/OfflineGame.js`, `client/src/ui/HUD.js` |
| 3. Bots | ✅ | `shared/ai/BotController.js` |
| 4. Lobby e interface | ✅ | `client/src/main.js`, `client/src/ui/*`, `client/src/audio/AudioManager.js`, `client/src/core/Settings.js` |
| 5. Servidor e multiplayer | ✅ | `server/*`, `shared/protocol/messages.js`, `client/src/network/ClientSocket.js`, `client/src/core/OnlineGame.js` |
| 6. Arenas e editor | ✅ | `shared/maps/arenas.js`, `shared/maps/arenaValidate.js`, `client/src/editor/ArenaEditor.js`, `client/src/core/ArenaStore.js` |
| 7. Polimento | ✅ | câmera (`Camera2D`), replay (`ReplayBuffer`), estatísticas, `client/sw.js` (offline), cache do campo |
| 8. Testes finais | ✅ | `tests/*.test.js`, `tests/e2e/browser_e2e.py`, `scripts/*` |

## Comandos executados e resultados reais

| Comando | Resultado |
|---|---|
| `npm test` | **49/49 testes passaram** (física 11, regras 15, bots 4, arenas 6, servidor: 2 testes + 11 subtestes com WebSocket real) |
| `npm run build` | 35 módulos verificados; `dist/public` gerado (32 arquivos, ~219 KB) |
| `npm run check` | sem problemas de sintaxe, imports ou dependência circular |
| `npm run dev` | servidor sobe e observa alterações (verificado por 3 s) |
| `python tests/e2e/browser_e2e.py` (Chromium headless, servidor real) | **SUCESSO**: partida offline com chute; 2 navegadores na mesma sala via link; time azul; só admin vê "Iniciar"; posição idêntica nos dois clientes; chat sanitizado; pausa sincronizada; reconexão automática; expulsão |
| E2E idem contra `STATIC_DIR=dist/public` | **SUCESSO** (build servido funciona) |

### Testes manuais automatizados no navegador (Playwright, com capturas de tela inspecionadas)
- Menu, configurações (atalhos, volume, qualidade, cor), "Como jogar".
- Offline: amistoso 1v1 até o fim por limite de gols → tela de resultado com estatísticas → replay do último gol.
- Offline 4v4 na arena Grande (F3 mostrando hitboxes/segmentos), 2 jogadores no mesmo teclado (WASD e setas movem jogadores diferentes), treino solo.
- Editor: criar segmento e disco, testar a arena, voltar ao editor pela pausa.
- Online com 3 navegadores: lista de salas real, entrar pela lista, menu ⋮ do admin (mover), bot de servidor, reconexão após queda do socket, pausa/retomada, expulsão.
- Partida online completa: bot difícil × humano, arena trocada para Compacta, limite de 1 gol → fim, resultado e botão de replay no lobby dos dois clientes.
- Offline real: página carregada uma vez, **servidor desligado**, página recarregada pelo service worker → menu mostra "Servidor indisponível", lista de salas informa indisponibilidade (sem salas falsas) e o treino offline funciona.
- Janela estreita (420 px): câmera passa a seguir a bola; HUD reorganizado.
- Nenhum erro de página/console registrado nesses fluxos.

### Medições com bots (simulação headless, 5 min por partida)
- Bola parada encostada na parede: 7–9 % do tempo, sequência máxima ≈ 2 s (após ajuste do chute em bola prensada; antes 11–19 % e até 5 s).
- Difícil × Fácil: o difícil vence (ex.: 11 × 1 em 1v1).

## Pendente / ideias futuras
- Controles de toque para celular.
- Persistência opcional (contas, ranking) — fora do escopo atual por exigir banco de dados.
- Replays salvos em arquivo (hoje: só o último gol, em memória).
- Escalonamento horizontal (hoje: um processo com salas em memória).

## Bugs conhecidos / limitações
- Se o jogador humano que deve dar a saída não se mexer, a partida espera (bots não roubam a saída de um humano) — comportamento intencional.
- Estatísticas de assistências/defesas/recuperações são estimadas.
- Ping de outros jogadores no lobby é o RTT informado pelos próprios clientes (valor indicativo).
- `npm install` não pôde ser executado no ambiente de desenvolvimento (registro npm inacessível); por isso o zip inclui `node_modules/ws` (8.21.3, MIT). Em uma máquina comum, `npm install` funciona normalmente.

## Próxima etapa sugerida
Controles de toque e um modo "observador" com câmera livre; depois, persistência opcional de replays.

# PLAN — DiscoFut

## Objetivo
Futebol 2D de discos para navegador, original, com prioridades nesta ordem: (1) física e resposta aos comandos, (2) partida local completa, (3) salas multiplayer reais, (4) estabilidade, (5) polimento visual.

## Decisões de arquitetura
- **JavaScript ES Modules** (sem etapa de compilação obrigatória). O mesmo código de `shared/` roda no navegador e no Node, garantindo física e regras idênticas.
- **Simulação determinística por tick** (1/60 s) com constantes "por tick" em `physicsConfig`. Renderização separada (rAF + interpolação `px/py → x/y`).
- **Servidor autoritativo** (Node + `ws`): cliente envia só bits de entrada com número de sequência; servidor valida, simula e publica snapshots; eventos críticos (gol, fim, fase, pausa) e estado da sala versionado (`rv`).
- **Cliente online**: interpolação de remotos/bola com atraso adaptativo ao jitter; predição + reconciliação do próprio jogador usando `applyMovementInput` e `kickoffConstraint` compartilhados.
- **Sem dependências circulares**: `shared/` não importa `client/` nem `server/` (verificado por `npm run check`).

```
client  ──import map @shared/──▶  shared  ◀──import relativo──  server
   │  (render, input, UI, áudio, predição)      (física, regras, bots, arenas, protocolo)      (salas, rede, autoridade)
   └──────────────────────────── WebSocket JSON (/ws) ─────────────────────────────┘
```

## Etapas e critérios de aceitação
1. **Base local jogável** — canvas, arena clássica, jogador, bola, controles, física, colisões, gol. *Aceite:* abrir, conduzir e chutar a bola para marcar gol; testes de colisão/gol passam.
2. **Regras completas** — estados (lobby, aguardando, contagem, kickoff, jogando, gol, pausa, prorrogação, encerrado), saída de bola com barreira, placar, tempo, fim, reinício, 1v1–4v4 locais. *Aceite:* partida começa, pontua, reinicia e termina; testes de regras.
3. **Bots** — papéis (goleiro/defensor/atacante), máquina de estados, previsão de trajetória, 3 dificuldades sem velocidade desumana. *Aceite:* partidas bot×bot terminam com gols; difícil vence fácil.
4. **Lobby e interface** — menus, configurações persistidas, HUD, áudio, atalhos remapeáveis, acessibilidade por teclado.
5. **Servidor e multiplayer** — salas reais, senha/código/link, admin, chat, snapshots, predição/interpolação, reconexão, segurança básica. *Aceite:* dois navegadores na mesma partida sincronizada; testes de integração com WebSocket real.
6. **Arenas e editor** — 5 arenas, formato JSON próprio, validação (cliente e servidor), editor com teste/salvar/importar/exportar.
7. **Polimento** — câmera com seguimento, DPI, replay curto, estatísticas, service worker para offline, desempenho (cache do campo).
8. **Testes finais** — suíte automatizada + E2E com navegadores reais; documentação de limites.

## Dependências
- Runtime: Node ≥ 18.17, pacote `ws` (^8). Navegador com Canvas 2D, ES Modules, import maps e WebSocket.
- Testes: `node:test` (nativo). E2E opcional: Python + Playwright.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Tunelamento da bola em alta velocidade | Subpassos automáticos (≤ 4 unidades), limite de velocidade, *failsafe* de posição; testes dedicados. |
| Contatos múltiplos instáveis (bola prensada) | 2 iterações de resolução por subpasso, correção posicional ponderada por massa; teste de 10 s com 4 jogadores. |
| Latência/jitter online | Interpolação com atraso adaptativo, predição local com suavização, fila de entradas limitada. |
| Cliente malicioso | Só bits de entrada; validação de cada campo; permissões no servidor; limites de taxa, tamanho e conexões. |
| Arenas importadas quebrando o jogo | Validador compartilhado (tamanho, números finitos, faixas, geometria, spawns, obstáculos) usado no editor e no servidor. |
| Partida "presa" (kickoff sem toque, bola na parede) | Bots chutam bola prensada; time vazio vai para "aguardando"; servidor solta teclas de cliente travado. |
| Hospedagem com hibernação/múltiplas instâncias | Documentado: processo único com estado em memória. |

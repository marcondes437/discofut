# DiscoFut — futebol de discos 2D multiplayer (navegador)

Jogo original de futebol 2D com visão superior, inspirado na *sensação* competitiva e minimalista dos jogos de futebol de discos (referência: HaxBall). Código, nome, interface, arenas e sons são próprios — nada foi copiado.

- **Física própria** (timestep fixo de 1/60 s, subpassos contra tunelamento, impulso na normal, correção de penetração).
- **Partida local completa**: treino solo, amistoso contra bots (1v1 a 4v4) e 2 jogadores no mesmo teclado.
- **Multiplayer real**: servidor Node.js autoritativo com WebSocket; o cliente só envia teclas.
- **Salas** públicas, privadas (senha) ou não listadas (código/link), com administração, chat e bots de servidor.
- **Editor de arenas** com validação, teste e importação/exportação JSON.

> Sobre a referência: a ferramenta usada no desenvolvimento não conseguiu navegar o jogo em haxball.com/play (a página só entrega um invólucro com menu; o jogo roda em canvas/JS). Por isso o projeto seguiu as especificações do prompt e mecânicas amplamente conhecidas do gênero (discos, chute por proximidade, saída de bola, salas com admin), implementadas do zero.

---

## Requisitos

- **Node.js 18.17+** (testado com Node 22).
- Um navegador moderno (Chrome, Edge, Firefox, Safari).

## Instalação e execução

```bash
npm install        # instala a única dependência: ws (WebSocket do servidor)
npm start          # servidor em http://localhost:8080
```

Abra **http://localhost:8080** no navegador. Para jogar online com outra pessoa, ela abre o mesmo endereço (na sua rede local use o IP da sua máquina, ex.: `http://192.168.0.10:8080`).

> O pacote `ws` já vem em `node_modules/` dentro do zip, então `npm start` funciona mesmo sem internet. `npm install` apenas confirma/atualiza.

| Script | O que faz |
|---|---|
| `npm start` | Sobe o servidor HTTP + WebSocket (serve `client/` e `shared/`). |
| `npm run dev` | Igual ao start, reiniciando ao alterar arquivos do servidor ou de `shared/` (node --watch). O cliente não precisa de build: basta recarregar a página. |
| `npm run build` | Verifica sintaxe/imports/dependências de todos os módulos e gera `dist/public` (site estático pronto). |
| `npm run check` | Só a verificação do build. |
| `npm test` | Testes automatizados (física, regras, bots, arenas, servidor real com WebSocket). |
| `npm run test:physics` / `npm run test:server` | Subconjuntos. |

### Variáveis de ambiente do servidor

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `8080` | Porta HTTP/WebSocket. |
| `HOST` | `0.0.0.0` | Interface de escuta. |
| `TRUST_PROXY` | — | `1` para usar `X-Forwarded-For` (IP real atrás de proxy, usado em banimentos e limite por IP). |
| `STATIC_DIR` | — | Ex.: `dist/public` para servir o build gerado. |

Exemplo: `PORT=3000 TRUST_PROXY=1 npm start` (no Windows PowerShell: `$env:PORT=3000; npm start`).

---

## Controles

| Ação | Teclas (remapeáveis em Configurações) |
|---|---|
| Mover (8 direções, diagonais normalizadas) | Setas ou W A S D |
| Chutar | Espaço, Ctrl, Shift ou X |
| Chat (online) | Enter (Esc fecha) |
| Menu da sala (online) / Pausa (offline) | Esc |
| Depuração (hitboxes, vetores, alcance do chute) | F3 |

- O chute só sai perto da bola (alcance de 5,5 unidades entre as superfícies) e vai na direção **centro do jogador → centro da bola**.
- Política padrão "um chute por toque": segurar a tecla arma o chute, que dispara quando a bola entra no alcance; para chutar de novo, solte e aperte. O anfitrião pode trocar para "repetir enquanto segura" e ajustar o cooldown.
- Toques rápidos ficam guardados por até 100 ms para não se perderem ao chegar à bola ou durante o cooldown. O intervalo padrão entre chutes é 100 ms; o som do chute online responde localmente, sem esperar o servidor.
- Segurar o chute deixa o jogador um pouco mais lento (domínio de bola).
- **2 jogadores no mesmo teclado:** J1 = W A S D + Espaço/X; J2 = Setas + Num0 / . / Enter.

## Regras

- Gol **só** quando a bola cruza inteira o plano da linha, entre as traves e vindo do campo; gols duplos são impossíveis (a fase muda para "gol" no mesmo tick).
- Saída de bola: bola no centro; cada time no próprio campo; só o time da saída entra no círculo central. A saída é liberada no primeiro toque. Quem sofre o gol dá a saída seguinte.
- Fim por limite de gols ou tempo. Empate no tempo: **gol de ouro** ou **termina empatado** (opção da sala).
- Time vazio durante a partida → estado "aguardando jogadores"; retoma automaticamente.

## Modos

- **Jogar Offline** (não precisa de servidor nem internet depois que a página carregou):
  - *Treino solo*: você, a bola e os dois gols, sem tempo/placar limite.
  - *Amistoso com bots*: 1v1 a 4v4, dificuldade Fácil/Médio/Difícil.
  - *2 jogadores (mesmo teclado)*: bots completam times maiores.
- **Buscar Salas / Criar Sala**: multiplayer real neste servidor.
- **Editor de Arenas**.

Depois de abrir o jogo uma vez por `http(s)`, um *service worker* guarda os arquivos: se o servidor cair, a página ainda abre e o treino offline funciona (identificado com o selo **OFFLINE**). A lista de salas nunca é simulada: sem servidor, ela informa que está indisponível.

## Online

1. **Criar Sala**: nome, visibilidade (pública / privada com senha / não listada), máximo de pessoas, modo (1v1–4v4), arena, tempo e gols.
2. Compartilhe o **link** (`?sala=CÓDIGO`) ou o **código** de 5 letras. Quem abre o link escolhe um apelido e entra.
3. No lobby há três colunas: **Vermelho · Espectadores · Azul**. Clique em "Entrar" para escolher time (se o anfitrião não bloqueou).
4. **Anfitrião/admin** (★/admin): iniciar/parar/reiniciar, pausar/retomar, auto-balancear, bloquear times, adicionar/remover bots (marcados como **BOT**), mudar regras e arena (inclusive enviar uma arena personalizada validada no servidor), e no menu ⋮ de cada jogador: mover, tornar/remover admin, silenciar, expulsar, banir por 10 min.
5. Chat com mensagens de sistema, limite de 140 caracteres e 5 mensagens a cada 5 s; texto sanitizado.
6. O HUD mostra ping, jitter e snapshots atrasados. Se a conexão cair, o cliente reconecta sozinho e o servidor guarda seu lugar por 25 s. Se o anfitrião sair, a administração passa a outra pessoa.

### Campeonato de duplas

No lobby, abra **Campeonato de duplas**. O anfitrião pode usar **Permitir até 16 participantes** para aumentar a capacidade da sala. Reúna de 4 a 16 jogadores em quantidade par, incluindo os espectadores, remova os bots e pare qualquer partida normal.

Clique em **Sortear duplas** para formar pares aleatórios e a chave de mata-mata. **Iniciar próxima partida** coloca somente as duas duplas do confronto em campo, em 2v2; os demais assistem. Depois de cada resultado, volte ao lobby com Esc e inicie a próxima partida. Os vencedores avançam até a final e a dupla campeã aparece na chave.

O torneio mantém os limites de tempo e gols da sala, usa gol de ouro para desempatar e distribui folgas quando necessário. Se tempo e gols estavam sem limite, passa a usar 3 gols. Os times e as regras ficam bloqueados durante o campeonato. Uma queda de conexão mantém o lugar por 25 segundos; a saída definitiva elimina a dupla por W.O. **Cancelar campeonato** ou **Voltar ao modo normal** restaura as regras anteriores. O campeonato fica na memória: reiniciar o servidor apaga a chave.

### Sincronização da rede

- O cliente envia **apenas** `{t:'in', s:seq, k:bits}` a cada tick (60 Hz). O servidor descarta sequências antigas e usa a direção mais recente no próximo tick, preservando toques rápidos de chute; se o cliente travar, solta as teclas após 500 ms.
- O servidor simula a 60 Hz com o mesmo código de `shared/` e publica snapshots (60 Hz por padrão; 20/30/60 Hz, configurável) com o número da última entrada processada (`a`).
- Jogadores e bola compartilham a mesma linha do tempo prevista durante a partida. Sem predição ou como espectador, usa **interpolação** curta adaptativa ao jitter.
- Próprio jogador: **predição** com as mesmas funções de movimento e **reconciliação** (reaplica entradas não confirmadas; correções pequenas são suavizadas). Desligável em Configurações.
- Gol, relógio, saída de bola, pausa, times, chat e administração vêm do servidor (eventos confiáveis + estado da sala versionado `rv`).
- Segurança: limite de tamanho de mensagem (70 KB), *token bucket* por conexão, até 12 conexões por IP, validação de todos os campos, permissões checadas no servidor, senhas comparadas por hash com `timingSafeEqual`, arquivos estáticos protegidos contra *path traversal*.

---

## Deploy

O servidor é um único processo Node que serve o cliente e o WebSocket na **mesma porta**.

### VPS com Nginx (HTTPS/WSS)

```nginx
server {
  server_name jogo.exemplo.com;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;     # necessário para WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
  # listen 443 ssl; ssl_certificate ...;  (ex.: certbot --nginx)
}
```

Rode com `PORT=8080 TRUST_PROXY=1 npm start` (use `pm2` ou um serviço systemd para manter no ar). Em HTTPS o cliente usa `wss://` automaticamente.

### Plataformas (Render, Railway, Fly.io etc.)

- Comando de start: `npm start`; a plataforma define `PORT`. Defina `TRUST_PROXY=1`.
- É preciso suporte a WebSocket e **uma única instância** (as salas ficam na memória do processo).
- Planos gratuitos que "dormem" derrubam as salas ao hibernar.

### Cliente estático separado (opcional)

`npm run build` gera `dist/public`, que pode ir para qualquer host estático. Para apontar a outro servidor, use `?server=wss://seu-servidor/ws` na URL ou o campo "Servidor" em Configurações.

### Limites de hospedagem

- Estado em memória: reiniciar o servidor encerra as salas (os clientes avisam e voltam ao menu).
- Cada sala custa uma simulação a 60 Hz (leve: dezenas de salas por núcleo) e ~30 snapshots/s por jogador (~0,3–1 KB cada em JSON).
- Máximo de 100 salas e 16 pessoas por sala (configurável em `shared/protocol/messages.js`).
- Latência alta (>150 ms) continua jogável graças à predição, mas disputas de bola favorecem quem tem ping menor (a bola é sempre a do servidor).

---

## Estrutura

```
client/                  cliente (ES Modules, sem build obrigatório)
  index.html, styles.css, sw.js
  src/main.js            app: telas, sessões, atalhos
  src/core/              GameLoop (timestep fixo), OfflineGame, OnlineGame (predição/interpolação), Settings, ArenaStore
  src/input/             InputManager (teclado por eventos, travamento de toques rápidos)
  src/render/            CanvasRenderer (cache do campo, DPI), Camera2D
  src/ui/                Menu, RoomBrowser, RoomLobby, HUD, Chat, dom
  src/audio/             AudioManager (Web Audio sintetizado)
  src/network/           ClientSocket (reconexão, ping/jitter)
  src/editor/            ArenaEditor
  src/replay/            ReplayBuffer (replay curto em memória)
server/
  index.js               HTTP + /healthz + /api/rooms + WebSocket /ws
  network/SocketServer.js  limites, heartbeat, token bucket
  rooms/RoomManager.js   sessões, salas, laço de 60 Hz
  rooms/Room.js          membros, admin, chat, partida, snapshots
shared/                  usado pelo cliente E pelo servidor
  config/physicsConfig.js  todas as constantes físicas
  physics/Collision.js, PhysicsWorld.js
  game/MatchController.js  regras, estados, estatísticas
  ai/BotController.js    bots (funções e máquina de estados)
  maps/arenas.js, arenaGeometry.js, arenaValidate.js
  protocol/messages.js   versão, limites, sanitização
tests/                   node:test (+ e2e/browser_e2e.py opcional)
scripts/                 build.js, run-tests.js
```

O cliente importa o código compartilhado pelo *import map* `@shared/` (definido em `index.html`); o servidor importa por caminho relativo. `shared/` não depende de cliente nem servidor (verificado no build).

## Física (`shared/config/physicsConfig.js`)

Valores por tick (1/60 s): jogador raio 15, massa inversa 0,5, aceleração 0,11 (0,075 chutando), amortecimento 0,955, reforço de 1,45× ao inverter direção; bola raio 10, massa inversa 1, amortecimento 0,988; chute 6,4 com alcance 5,5, cooldown padrão de 6 ticks e buffer de 6 ticks. Ao receber uma bola rápida, o chute garante velocidade de saída de pelo menos 75% da força base na direção do chute, preservando o movimento lateral. Restituição = produto dos coeficientes. Subpassos automáticos limitam o deslocamento a 4 unidades por subpasso; limites de velocidade e um *failsafe* recolocam qualquer corpo inválido (NaN/fora do mundo).

## Arenas

Formato próprio `discofut-arena` v1:

```json
{
  "format": "discofut-arena", "version": 1, "id": "minha", "name": "Minha arena",
  "width": 760, "height": 350, "margin": 50, "kickoffRadius": 80,
  "goal": { "width": 140, "depth": 45, "postRadius": 8 },
  "spawns": { "red": [[-150, 0], [-250, -95]], "blue": [[150, 0], [250, -95]] },
  "colors": { "grass": "#3f8f4a", "grassAlt": "#3a8544", "lines": "#e9f3e6", "net": "#d9e4d6", "border": "#2e6b37" },
  "obstacles": [
    { "type": "segment", "a": [-200, -60], "b": [-200, 60], "mask": "all", "bounce": 0.6 },
    { "type": "disc", "p": [0, -125], "r": 16, "mask": "ball", "bounce": 0.9 }
  ]
}
```

`mask`: `all`, `ball` ou `player`. A validação (cliente e servidor) limita o JSON a 64 KB e 64 obstáculos, checa números finitos e faixas, gol largo/profundo o bastante para a bola, spawns no próprio campo e fora do círculo/obstáculos, e obstáculos que bloqueiem a saída. Arenas embutidas: **Clássica, Compacta, Grande, Treino** e **Experimental** (a única com obstáculos). Formatos de outros jogos não são suportados.

## Testes

```bash
npm test
```

85 testes: colisões frontal/oblíqua, conservação de momento, rebote, tunelamento a velocidade máxima, traves, canto, estabilidade 10 s com 4 jogadores prensando a bola, determinismo, gol limítrofe (rente à trave por dentro/fora, bola parada sobre a linha), gol único, kickoff, chutes/cooldown, diagonais, fim por gols/tempo/gol de ouro, autoria/assistência/gol contra, bots (partidas completas, papéis, difícil > fácil), validação de arenas maliciosas e um servidor real com clientes WebSocket (salas, senha, permissões, chat, sincronização, gol decidido pelo servidor, bots, expulsão, reconexão, transferência de anfitrião, *path traversal*).

Teste ponta a ponta opcional com navegadores reais:

```bash
pip install playwright && python -m playwright install chromium
npm start   # outro terminal
python tests/e2e/browser_e2e.py http://localhost:8080/
```

## Limitações conhecidas

- Replay: apenas os últimos segundos do **último gol**, em memória (some ao recarregar a página).
- Estatísticas de assistências, defesas e recuperações são estimativas a partir dos toques.
- Sem contas/persistência: banimentos duram 10 min e valem por sessão/IP.
- Feito para teclado; em celular a interface abre, mas não há controles de toque.
- A predição de contatos e chutes usa os últimos comandos conhecidos dos adversários. Mudanças ainda não recebidas podem causar correções com ping alto; o servidor continua decidindo os gols.

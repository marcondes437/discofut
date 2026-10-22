import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol/messages.js';
import { IN_RIGHT, IN_KICK } from '../shared/config/physicsConfig.js';

/** Cliente de teste: conecta de verdade ao servidor via WebSocket. */
class TestClient {
  constructor(port, name, token = null) {
    this.port = port; this.name = name; this.msgs = []; this.waiters = []; this.token = token;
  }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
    });
    await new Promise((r, j) => { this.ws.once('open', r); this.ws.once('error', j); });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.token });
    const w = await this.wait((m) => m.t === 'welcome');
    this.id = w.id; this.token = w.token;
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 3000) {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`timeout esperando mensagem (${this.name})`)); }, ms);
      this.waiters.push(w);
    });
  }
  lastRoom() { return [...this.msgs].reverse().find((m) => m.t === 'room' || m.t === 'joined')?.room; }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('servidor: salas reais, sincronização, autoridade e administração', async (t) => {
  const srv = await createGameServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  const A = await new TestClient(srv.port, 'Ana').open();
  const B = await new TestClient(srv.port, 'Beto').open();
  t.after(() => { A.close(); B.close(); });

  await t.test('lista começa vazia (sem salas falsas)', async () => {
    A.send({ t: 'list' });
    const r = await A.wait((m) => m.t === 'rooms');
    assert.deepEqual(r.list, []);
  });

  let code;
  await t.test('criar sala privada e listar', async () => {
    A.send({ t: 'create', name: 'Pelada <b>', visibility: 'private', password: 'segredo', maxPlayers: 4, settings: { teamSize: 1, timeLimit: 1, scoreLimit: 1 }, arena: 'compact' });
    const j = await A.wait((m) => m.t === 'joined');
    code = j.room.code;
    assert.equal(j.room.name, 'Pelada b', 'nome sanitizado');
    assert.equal(j.room.hostId, A.id);
    assert.equal(j.room.arena.id, 'compact');
    B.send({ t: 'list' });
    const r = await B.wait((m) => m.t === 'rooms');
    assert.equal(r.list.length, 1);
    assert.equal(r.list[0].locked, true);
    assert.equal(r.list[0].players, 1);
  });

  await t.test('senha errada é rejeitada; certa entra', async () => {
    B.send({ t: 'join', code, password: 'errada' });
    const e = await B.wait((m) => m.t === 'err');
    assert.equal(e.code, 'password');
    B.send({ t: 'join', code, password: 'segredo' });
    const j = await B.wait((m) => m.t === 'joined');
    assert.equal(j.you, B.id);
    const me = j.room.members.find((x) => x.id === B.id);
    assert.equal(me.team, 'spec', 'entra como espectador');
  });

  await t.test('não-admin não pode executar comandos administrativos', async () => {
    B.send({ t: 'admin', a: 'start' });
    const e = await B.wait((m) => m.t === 'err');
    assert.equal(e.code, 'forbidden');
  });

  await t.test('chat sanitizado com limite de frequência', async () => {
    B.send({ t: 'chat', m: '<script>oi</script>' });
    const c = await A.wait((m) => m.t === 'chat' && m.id === B.id);
    assert.equal(c.m, 'scriptoi/script');
    for (let i = 0; i < 6; i++) B.send({ t: 'chat', m: `spam ${i}` });
    const e = await B.wait((m) => m.t === 'err' && m.code === 'rate');
    assert.ok(e);
  });

  await t.test('jogador entra no time e a partida começa com snapshots sincronizados', async () => {
    B.send({ t: 'team', team: 'blue' });
    await A.wait((m) => m.t === 'room' && m.room.members.find((x) => x.id === B.id)?.team === 'blue');
    A.send({ t: 'admin', a: 'start' });
    await A.wait((m) => m.t === 'ev' && m.e.type === 'phase' && m.e.phase === 'countdown');
    await A.wait((m) => m.t === 'ev' && m.e.type === 'phase' && m.e.phase === 'kickoff', 5000);
    const sa = await A.wait((m) => m.t === 's' && m.d.ph === 'kickoff');
    const sb = await B.wait((m) => m.t === 's' && m.d.tick === sa.d.tick);
    assert.deepEqual(sa.d.p, sb.d.p, 'os dois clientes recebem o mesmo estado');
    assert.equal(sa.d.ph, 'kickoff');
  });

  await t.test('entradas do cliente movem o jogador e são confirmadas (ack)', async () => {
    const before = (await A.wait((m) => m.t === 's')).d.p.find((p) => p[0] === A.id);
    for (let s = 0; s < 40; s++) { A.send({ t: 'in', s, k: IN_RIGHT }); await sleep(16); }
    const snap = await A.wait((m) => m.t === 's' && m.a >= 30);
    const after = snap.d.p.find((p) => p[0] === A.id);
    assert.ok(after[1] > before[1] + 5, `vermelho avançou (${before[1]} → ${after[1]})`);
    // Entrada inválida (bits fora da máscara / seq antiga) é ignorada.
    A.send({ t: 'in', s: 5, k: 999 });
    A.send({ t: 'in', s: 41, k: 1 << 9 });
  });

  await t.test('gol decidido pelo servidor e sincronizado para todos', async () => {
    // O vermelho conduz a bola até o gol azul (direita): o servidor decide o gol.
    let seq = 100;
    const deadline = Date.now() + 15000;
    let goal = null;
    while (!goal && Date.now() < deadline) {
      const snap = A.msgs.filter((m) => m.t === 's').pop();
      let k = IN_RIGHT;
      if (snap) {
        const me = snap.d.p.find((p) => p[0] === A.id);
        const [bx, by] = snap.d.b;
        // vai para trás da bola e empurra/chuta para a direita
        const tx = bx - 26, ty = by;
        k = 0;
        if (me[1] < tx - 3) k |= IN_RIGHT; else if (me[1] > tx + 3) k |= 4;
        if (me[2] < ty - 3) k |= 2; else if (me[2] > ty + 3) k |= 1;
        if (Math.hypot(bx - me[1], by - me[2]) < 30 && me[1] < bx) k |= IN_KICK | IN_RIGHT;
      }
      A.send({ t: 'in', s: seq, k });
      B.send({ t: 'in', s: seq++, k: 2 }); // azul sai do caminho (para baixo)
      goal = A.msgs.find((m) => m.t === 'ev' && m.e.type === 'goal');
      await sleep(16);
    }
    assert.ok(goal, 'gol aconteceu');
    const gb = await B.wait((m) => m.t === 'ev' && m.e.type === 'goal');
    assert.equal(gb.e.team, 'red');
    assert.equal(gb.e.scorer, A.id);
    const end = await B.wait((m) => m.t === 'ev' && m.e.type === 'end', 6000);
    assert.equal(end.e.winner, 'red', 'limite de 1 gol encerra a partida');
    const room = await B.wait((m) => m.t === 'room' && m.room.phase === 'ended');
    assert.equal(room.room.score.red, 1);
    assert.ok(room.room.stats.find((r) => r.id === A.id).goals === 1);
  });

  await t.test('admin: bots, mover, silenciar, expulsar', async () => {
    A.send({ t: 'admin', a: 'stop' });
    A.send({ t: 'admin', a: 'move', id: B.id, team: 'spec' });
    A.send({ t: 'admin', a: 'addbot', team: 'blue', difficulty: 'hard' });
    const r = await A.wait((m) => m.t === 'room' && m.room.members.some((x) => x.bot));
    const bot = r.room.members.find((x) => x.bot);
    assert.equal(bot.team, 'blue');
    assert.match(bot.name, /Bot/);
    A.send({ t: 'admin', a: 'mute', id: B.id });
    await A.wait((m) => m.t === 'room' && m.room.members.find((x) => x.id === B.id)?.muted);
    B.send({ t: 'chat', m: 'oi' });
    const e = await B.wait((m) => m.t === 'err' && m.code === 'muted');
    assert.ok(e);
    A.send({ t: 'admin', a: 'kick', id: B.id });
    const k = await B.wait((m) => m.t === 'kicked');
    assert.match(k.reason, /Expulso/);
  });

  await t.test('reconexão com token retoma o lugar na sala', async () => {
    const C = await new TestClient(srv.port, 'Caio').open();
    C.send({ t: 'join', code, password: 'segredo' });
    await C.wait((m) => m.t === 'joined');
    const token = C.token, id = C.id;
    C.ws.terminate();
    await A.wait((m) => m.t === 'room' && m.room.members.find((x) => x.id === id)?.away);
    const C2 = await new TestClient(srv.port, 'Caio', token).open();
    assert.equal(C2.id, id, 'mesma identidade');
    const j = await C2.wait((m) => m.t === 'joined');
    assert.equal(j.resumed, true);
    C2.close();
  });

  await t.test('anfitrião sai: administração é transferida; sala vazia é removida', async () => {
    const D = await new TestClient(srv.port, 'Duda').open();
    D.send({ t: 'join', code, password: 'segredo' });
    await D.wait((m) => m.t === 'joined');
    A.send({ t: 'leave' });
    const r = await D.wait((m) => m.t === 'room' && m.room.hostId !== A.id && m.room.hostId !== null);
    assert.ok(r.room.members.find((x) => x.id === r.room.hostId));
    D.send({ t: 'leave' });
    await sleep(100);
    // Remover qualquer humano restante ausente
    for (const room of srv.manager.rooms.values()) for (const m of room.humans()) room.leave(m.id);
    D.send({ t: 'list' });
    const l = await D.wait((m) => m.t === 'rooms');
    assert.equal(l.list.length, 0);
    D.close();
  });
});

test('servidor: arquivos estáticos e proteção contra path traversal', async (t) => {
  const srv = await createGameServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /DiscoFut/);
  const sh = await fetch(`${base}/shared/config/physicsConfig.js`);
  assert.equal(sh.status, 200);
  assert.match(sh.headers.get('content-type'), /javascript/);
  const trav = await fetch(`${base}/shared/..%2f..%2fpackage.json`);
  assert.notEqual(trav.status, 200);
  const api = await fetch(`${base}/api/rooms`);
  assert.deepEqual(await api.json(), []);
});

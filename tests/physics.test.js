import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody } from '../shared/physics/PhysicsWorld.js';
import { collideDiscDisc, collideDiscSegment, makeSegment } from '../shared/physics/Collision.js';
import { physicsConfig, CG_ALL } from '../shared/config/physicsConfig.js';
import { emptyWorld } from './helpers.js';

const BR = physicsConfig.ball.radius;

test('colisão frontal jogador→bola transfere momento e separa os corpos', () => {
  const { w, ball } = emptyWorld();
  const p = w.addBody(createBody('player', -40, 0));
  p.vx = 3;
  let touched = false;
  for (let i = 0; i < 30; i++) { w.step(); if (w.ballTouches.length) touched = true; }
  assert.ok(touched, 'houve contato');
  assert.ok(ball.vx > 0.5, `bola ganhou velocidade em x (${ball.vx})`);
  assert.ok(Math.abs(ball.vy) < 1e-6, 'colisão frontal não gera desvio lateral');
  const gap = Math.hypot(ball.x - p.x, ball.y - p.y) - ball.r - p.r;
  assert.ok(gap >= -0.01, `sem penetração residual (gap=${gap})`);
});

test('colisão oblíqua desvia a bola para o lado oposto ao contato', () => {
  const { w, ball } = emptyWorld();
  const p = w.addBody(createBody('player', -40, 12));
  p.vx = 3;
  for (let i = 0; i < 30; i++) w.step();
  assert.ok(ball.vx > 0, 'bola segue para frente');
  assert.ok(ball.vy < 0, 'contato por baixo empurra a bola para cima');
});

test('impulso conserva momento linear em colisão disco-disco', () => {
  const a = { x: 0, y: 0, vx: 2, vy: 0.3, r: 15, invMass: 0.5, bounce: 0.5 };
  const b = { x: 24, y: 2, vx: -1, vy: 0, r: 10, invMass: 1, bounce: 0.5 };
  const pBefore = [a.vx / a.invMass + b.vx / b.invMass, a.vy / a.invMass + b.vy / b.invMass];
  collideDiscDisc(a, b);
  const pAfter = [a.vx / a.invMass + b.vx / b.invMass, a.vy / a.invMass + b.vy / b.invMass];
  assert.ok(Math.abs(pBefore[0] - pAfter[0]) < 1e-9 && Math.abs(pBefore[1] - pAfter[1]) < 1e-9);
});

test('bola rebate na linha lateral com restituição previsível', () => {
  const { w, geo, ball } = emptyWorld();
  ball.x = 0; ball.y = -geo.H + 40; ball.vy = -6;
  let minY = Infinity;
  for (let i = 0; i < 40; i++) { w.step(); minY = Math.min(minY, ball.y); }
  assert.ok(minY >= -geo.H + BR - 0.01, 'bola não atravessa a linha');
  assert.ok(ball.vy > 0, 'velocidade invertida após o rebote');
  // e = 0.5 (bola) * 1 (parede): velocidade após rebote ≈ metade (com amortecimento)
  assert.ok(ball.vy < 4, `rebote amortecido (${ball.vy})`);
});

test('sem tunelamento: bola na velocidade máxima contra a parede por 200 ticks', () => {
  const { w, geo, ball } = emptyWorld();
  for (const angle of [0.3, 1.2, 1.57, 2.5, -1.2, -2.8]) {
    ball.x = 0; ball.y = 0;
    ball.vx = Math.cos(angle) * 30; ball.vy = Math.sin(angle) * 30; // acima do limite: será limitada
    for (let i = 0; i < 200; i++) {
      w.step();
      assert.ok(Math.abs(ball.y) <= geo.H - BR + 0.01, `y dentro do campo (ângulo ${angle})`);
      const awayFromMouth = Math.abs(ball.y) > geo.G + geo.postRadius + BR;
      if (awayFromMouth) assert.ok(Math.abs(ball.x) <= geo.W - BR + 0.01, `x dentro do campo (ângulo ${angle})`);
      if (Math.abs(ball.x) > geo.W) assert.ok(Math.abs(ball.y) <= geo.G - BR + 0.01, 'dentro do gol só pela abertura');
      assert.ok(Math.abs(ball.x) <= geo.W + geo.D, 'nunca atravessa a rede');
      assert.ok(Math.hypot(ball.vx, ball.vy) <= physicsConfig.ball.maxSpeed + 1e-9, 'velocidade limitada');
    }
  }
});

test('trave: bola rebate e não atravessa', () => {
  const { w, geo, ball } = emptyWorld();
  ball.x = geo.W - 100; ball.y = geo.G; ball.vx = 8; ball.vy = 0; // mira exatamente a trave
  let minDist = Infinity;
  for (let i = 0; i < 60; i++) {
    w.step();
    minDist = Math.min(minDist, Math.hypot(ball.x - geo.W, ball.y - geo.G));
  }
  assert.ok(minDist >= BR + geo.postRadius - 0.05, `não penetra a trave (${minDist})`);
  assert.ok(ball.vx < 0, 'rebateu para trás');
});

test('canto: bola em alta velocidade no canto permanece no campo', () => {
  const { w, geo, ball } = emptyWorld();
  ball.x = geo.W - 60; ball.y = geo.H - 60; ball.vx = 20; ball.vy = 20;
  for (let i = 0; i < 600; i++) {
    w.step();
    assert.ok(ball.x <= geo.W - BR + 0.01 && ball.y <= geo.H - BR + 0.01);
  }
});

test('segmento: colisão de disco com segmento de dupla face', () => {
  const s = makeSegment(-50, 0, 50, 0, CG_ALL, 1);
  const a = { x: 0, y: -8, vx: 0, vy: 3, r: 10, invMass: 1, bounce: 0.5 };
  collideDiscSegment(a, s);
  assert.ok(a.y <= -10 + 1e-9 && a.vy < 0);
  const b = { x: 0, y: 8, vx: 0, vy: -3, r: 10, invMass: 1, bounce: 0.5 };
  collideDiscSegment(b, s);
  assert.ok(b.y >= 10 - 1e-9 && b.vy > 0);
});

test('estabilidade: vários jogadores prensando a bola no canto por 10 s a 60 Hz', () => {
  const { w, geo, ball } = emptyWorld();
  ball.x = geo.W - 30; ball.y = geo.H - 30;
  const players = [];
  for (let i = 0; i < 4; i++) players.push(w.addBody(createBody('player', geo.W - 90 - i * 10, geo.H - 90 + i * 8)));
  for (let t = 0; t < 600; t++) {
    for (const p of players) { p.vx += 0.11; p.vy += 0.11; }
    w.step();
    for (const b of w.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy));
    }
    assert.ok(ball.x <= geo.W - BR + 0.5 && ball.y <= geo.H - BR + 0.5, 'bola não é expulsa do campo');
  }
});

test('bola desacelera gradualmente até parar', () => {
  const { w, ball } = emptyWorld();
  ball.vx = 2; // percorre ~166 unidades: não alcança a parede
  let prev = 2;
  for (let i = 0; i < 2000; i++) {
    w.step();
    assert.ok(ball.vx <= prev + 1e-12);
    prev = ball.vx;
  }
  assert.equal(ball.vx, 0);
});

test('simulação é determinística no mesmo ambiente', () => {
  const runOnce = () => {
    const { w, ball } = emptyWorld();
    const p = w.addBody(createBody('player', -100, 20));
    for (let i = 0; i < 300; i++) { p.vx += 0.11 * Math.sin(i / 17); p.vy += 0.11 * Math.cos(i / 23); w.step(); }
    return [ball.x, ball.y, p.x, p.y].join(',');
  };
  assert.equal(runOnce(), runOnce());
});

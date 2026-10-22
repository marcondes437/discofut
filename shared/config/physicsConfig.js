// Constantes físicas centralizadas. Todas as grandezas são "por tick" com
// timestep fixo de 1/60 s (TICK_RATE), o que torna a simulação determinística
// dentro do mesmo ambiente JavaScript.

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** Grupos de colisão (bitmask). */
export const CG_BALL = 1;
export const CG_PLAYER = 2;
export const CG_ALL = CG_BALL | CG_PLAYER;

export const physicsConfig = Object.freeze({
  player: Object.freeze({
    radius: 15,
    invMass: 0.5,
    damping: 0.955,        // multiplicador de velocidade por tick (atrito/inércia)
    accel: 0.11,           // aceleração por tick com direção pressionada
    kickingAccel: 0.075,   // aceleração enquanto a tecla de chute está pressionada
    turnBoost: 1.45,       // multiplicador quando a direção desejada se opõe à velocidade
    bounce: 0.5,
    maxSpeed: 6,           // limite de segurança (px/tick)
  }),
  ball: Object.freeze({
    radius: 10,
    invMass: 1,
    damping: 0.988,
    bounce: 0.5,
    maxSpeed: 22,          // limite de segurança (px/tick)
  }),
  kick: Object.freeze({
    strength: 6.4,         // impulso adicionado à velocidade da bola
    range: 5.5,            // distância máxima entre as superfícies jogador-bola
    kickback: 0.0,         // recuo aplicado ao jogador
    defaultCooldown: 6,    // ticks mínimos entre chutes do mesmo jogador
    bufferTicks: 6,        // preserva toques rápidos por até 100 ms
  }),
  wall: Object.freeze({
    bounce: 1,             // multiplicado pelo "bounce" do corpo
    postBounce: 0.5,
  }),
  solver: Object.freeze({
    maxSubstepTravel: 4,   // deslocamento máximo por subpasso (px), evita tunelamento
    maxSubsteps: 8,
    iterations: 2,         // passes de resolução por subpasso
  }),
  match: Object.freeze({
    goalCelebrationTicks: 150,
    countdownTicks: 180,
    assistWindowTicks: 480,
  }),
});

/** Tecla/estado de entrada empacotado em bits (o cliente envia apenas isso). */
export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_KICK = 16;
export const IN_MASK = 31;

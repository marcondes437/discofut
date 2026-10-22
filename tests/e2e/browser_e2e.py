"""
Teste ponta a ponta OPCIONAL com navegadores reais (Chromium headless via Playwright).

Pré-requisitos:  pip install playwright && python -m playwright install chromium
Uso:             npm start  (em outro terminal)  →  python tests/e2e/browser_e2e.py [http://localhost:8080/]

Cobre: menu, partida offline com chute, duas pessoas em navegadores separados
na mesma sala (link de convite), times, início pelo anfitrião, movimento
sincronizado, chat, pausa e expulsão pelo admin, reconexão.
"""
import sys
import time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
errors = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        errors.append(msg)


def watch(page, name):
    page.on('pageerror', lambda e: errors.append(f'{name}: erro de página: {e}'))
    page.on('console', lambda m: errors.append(f'{name}: console.error: {m.text}') if m.type == 'error' else None)


with sync_playwright() as p:
    browser = p.chromium.launch()

    print('1) Offline')
    page = browser.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    watch(page, 'offline')
    page.goto(URL)
    page.wait_for_selector('text=Jogar Offline')
    page.fill('#nick', 'Teste')
    page.click('text=Jogar Offline')
    page.click('text=Começar ▶')
    page.wait_for_function("window.__discofut.session.match.phase === 'kickoff'", timeout=6000)
    # Segurar o chute enquanto corre: o chute dispara quando a bola entra no alcance.
    page.keyboard.down('ArrowRight'); page.keyboard.down('Space'); time.sleep(1.6); page.keyboard.up('Space'); page.keyboard.up('ArrowRight')
    st = page.evaluate("(() => { const m = window.__discofut.session.match; return { phase: m.phase, kicks: [...m.players.values()][0].stats.kicks, bx: m.ball.x } })()")
    check(st['phase'] in ('playing', 'goal'), f"partida em andamento após tocar na bola ({st['phase']})")
    check(st['kicks'] >= 1, 'chute registrado pela física local')

    print('2) Online com dois navegadores')
    A = browser.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    B = browser.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    watch(A, 'A'); watch(B, 'B')
    A.goto(URL); A.fill('#nick', 'Ana'); A.click('text=Criar Sala')
    A.fill('#screens form input >> nth=0', 'Sala E2E')
    A.click('text=Criar e entrar')
    A.wait_for_function("window.__discofut.session?.kind === 'online'", timeout=6000)
    code = A.evaluate('window.__discofut.session.room.code')
    check(len(code) == 5, f'sala criada com código {code}')
    B.goto(f'{URL}?sala={code}')
    B.fill('input[aria-label=Apelido]', 'Beto'); B.click('text=Entrar na sala')
    B.wait_for_function("window.__discofut.session?.kind === 'online'", timeout=6000)
    B.locator('.room-col.blue header button').click()
    A.wait_for_function("window.__discofut.session.room.members.some(m => m.name === 'Beto' && m.team === 'blue')", timeout=4000)
    check(True, 'Beto entrou no time azul (visto pelo anfitrião)')
    check(B.locator('text=▶ Iniciar').count() == 0 or not B.locator('text=▶ Iniciar').is_visible(), 'não-admin não vê o botão Iniciar')
    A.click('text=▶ Iniciar')
    A.wait_for_function("window.__discofut.session.latest?.ph === 'kickoff'", timeout=7000)
    A.keyboard.down('KeyD'); time.sleep(1.2); A.keyboard.up('KeyD'); time.sleep(0.5)
    sa = A.evaluate('window.__discofut.session.latest')
    sb = B.evaluate('window.__discofut.session.latest')
    pa = {x[0]: x for x in sa['p']}; pb = {x[0]: x for x in sb['p']}
    my = A.evaluate('window.__discofut.session.myId')
    check(abs(pa[my][1] - pb[my][1]) < 40, f'posição do jogador A igual nos dois clientes ({pa[my][1]} vs {pb[my][1]})')
    check(pa[my][1] > -140, 'servidor aplicou a entrada de A (avançou)')
    B.keyboard.press('Enter'); B.keyboard.type('oi <b>Ana</b>'); B.keyboard.press('Enter')
    A.wait_for_function("document.getElementById('chat-log').innerText.includes('oi bAna/b')", timeout=3000)
    check(True, 'chat entregue e sanitizado')
    A.keyboard.press('Escape'); A.click('text=Pausar')
    B.wait_for_function('window.__discofut.session.room.paused === true', timeout=3000)
    check(True, 'pausa do admin sincronizada')
    A.click('text=Retomar')
    B.evaluate('window.__discofut.net.ws.close()')
    B.wait_for_function("window.__discofut.net.state === 'open' && window.__discofut.session?.kind === 'online'", timeout=8000)
    check(True, 'reconexão automática retomou a sala')
    A.locator('.room-col.blue li', has_text='Beto').locator('button.menu').click()
    A.click('.popmenu >> text=Expulsar')
    B.wait_for_function("window.__discofut.session?.kind !== 'online'", timeout=4000)
    check(True, 'expulsão pelo admin removeu Beto da sala')

    browser.close()

real_errors = [e for e in errors if 'console.error' not in e or 'WebSocket' not in e]
print('\nResultado:', 'SUCESSO' if not real_errors else f'{len(real_errors)} problema(s)')
for e in real_errors:
    print(' -', e)
sys.exit(1 if real_errors else 0)

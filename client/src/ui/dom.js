// Utilitários de DOM. Todo texto vindo de usuários é inserido com textContent
// (nunca innerHTML), o que impede injeção de HTML pelo chat/nomes.

/**
 * h('div', {class:'x', onclick: fn}, 'texto', h('span'))
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function $(sel, root = document) { return root.querySelector(sel); }

let toastRoot = null;
export function toast(msg, type = 'info', ms = 3200) {
  toastRoot ||= document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
  toastRoot.append(t);
  setTimeout(() => t.remove(), ms);
}

export function field(label, input, extra) {
  return h('label', { class: 'field' }, label, input, extra);
}

export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    const opt = h('option', { value: String(v) }, l);
    if (String(v) === String(value)) opt.selected = true;
    s.append(opt);
  }
  return s;
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const btns = options.map(([v, l]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value) }, l);
    b.addEventListener('click', () => {
      for (const x of btns) x.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onChange(v);
    });
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

export function fmtClock(ticks) {
  const s = Math.floor(ticks / 60);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function keyLabel(code) {
  const map = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Espaço',
    ControlLeft: 'Ctrl Esq', ControlRight: 'Ctrl Dir', ShiftLeft: 'Shift Esq', ShiftRight: 'Shift Dir',
    Enter: 'Enter', Escape: 'Esc', Numpad0: 'Num 0', Period: '.', Slash: '/', AltLeft: 'Alt',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Popmenu simples, fecha ao clicar fora / Esc. */
export function popMenu(x, y, items) {
  const m = h('div', { class: 'popmenu', role: 'menu' });
  const close = () => { m.remove(); document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey, true); };
  const onDoc = (e) => { if (!m.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  for (const it of items) {
    if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
    m.append(h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { close(); it.action(); } }, it.label));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey, true); m.querySelector('button')?.focus(); }, 0);
  return close;
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      if (f.size > 64 * 1024) return resolve({ error: 'Arquivo grande demais (máx. 64 KB).' });
      const r = new FileReader();
      r.onload = () => resolve({ text: String(r.result), name: f.name });
      r.onerror = () => resolve({ error: 'Não foi possível ler o arquivo.' });
      r.readAsText(f);
    });
    inp.click();
  });
}

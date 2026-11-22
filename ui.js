export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  if (value !== undefined) el.value = value;
  return el;
}

export const icon = (name) => h('i', { class: 'ti ti-' + name, 'aria-hidden': 'true' });

export const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const opts = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('fr-CA', opts);
}

export function longDate() {
  const s = new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
export const fmtMoney = (n) => money.format(n || 0);

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const plur = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
export const initials = (name) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const errMsg = (e) => (e && e.message) || 'Une erreur est survenue.';

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function row(title, sub, right, onclick) {
  return h('div', { class: 'row' + (onclick ? ' tap' : ''), onclick },
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), sub != null && h('div', { class: 's' }, sub)),
    right);
}

export const empty = (title, text) => h('div', { class: 'empty' }, h('strong', {}, title), text);

export function field(label, input) {
  return h('label', { class: 'f' }, h('span', {}, label), input);
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const draw = () =>
    el.replaceChildren(
      ...options.map(([v, l]) =>
        h('button', {
          type: 'button',
          class: v === value ? 'on' : '',
          onclick: () => { value = v; draw(); onChange(v); },
        }, l)
      )
    );
  draw();
  return el;
}

export function group(items) {
  return h('div', { class: 'group' },
    items.map((it) =>
      h('button', { class: 'g' + (it.danger ? ' danger' : ''), type: 'button', onclick: it.onclick },
        h('span', {}, it.label),
        it.danger ? null : icon('chevron-right'))
    ));
}

export function sheet(title, build) {
  const wrap = h('div', { class: 'sheet-wrap' });
  const close = () => {
    wrap.classList.remove('open');
    sh.classList.remove('open');
    setTimeout(() => wrap.remove(), 240);
  };
  const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Fermer', type: 'button', onclick: close }, icon('x'))),
    build(close));
  wrap.append(h('div', { class: 'sheet-bg', onclick: close }), sh);
  document.body.append(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('open'); sh.classList.add('open'); }));
  return close;
}

export const getTheme = () => {
  try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; }
};

export function applyTheme() {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = dark ? '#1a1c1b' : '#ffffff';
}

export function setTheme(t) {
  try { localStorage.setItem('theme', t); } catch (e) { /* stockage indisponible */ }
  applyTheme();
}

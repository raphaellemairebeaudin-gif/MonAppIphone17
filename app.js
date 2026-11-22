import * as db from './db.js';
import { h, icon, applyTheme, initials } from './ui.js';
import * as train from './view-train.js';
import * as notes from './view-notes.js';
import * as budget from './view-budget.js';
import * as supp from './view-supp.js';
import * as profile from './view-profile.js';
import * as settings from './view-settings.js';

const views = { train, notes, budget, supp, profile, settings };
const NAV = ['train', 'notes', 'budget', 'supp'];
const root = document.getElementById('app');

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

let session = null;
let ui = null;
let current = 'train';
let backHref = null;
let dataHandler = null;
let leaveHandler = null;
let started = false;

function setMenu(open) { document.body.classList.toggle('menu-open', open); }

function buildShell() {
  const menuBtn = h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'Ouvrir le menu',
    onclick: () => { if (backHref) location.hash = backHref; else setMenu(true); },
  }, icon('menu-2'));
  const actions = h('div', { class: 'actions' });
  const sub = h('p', { class: 'sub' });
  const title = h('h1');
  const head = h('div', { class: 'head' }, sub, title);
  const main = h('main');
  const fab = h('button', { class: 'fab', type: 'button', 'aria-label': 'Ajouter' }, icon('plus'));
  const overlay = h('div', { class: 'overlay', onclick: () => setMenu(false) });
  const drawer = h('nav', { class: 'drawer', 'aria-label': 'Menu' });
  root.replaceChildren(h('header', { class: 'topbar' }, h('div', { class: 'bar' }, menuBtn, actions)), head, main, fab, overlay, drawer);

  const ctx = {
    main,
    session,
    setHead(t, s, opts = {}) {
      title.textContent = t || '';
      sub.textContent = s || '';
      head.hidden = !t && !s;
      backHref = opts.back || null;
      menuBtn.replaceChildren(icon(backHref ? 'chevron-left' : 'menu-2'));
      menuBtn.setAttribute('aria-label', backHref ? 'Retour' : 'Ouvrir le menu');
    },
    setActions(list) { actions.replaceChildren(...(list || []).filter(Boolean)); },
    setFab(fn) { fab.style.display = fn ? 'flex' : 'none'; fab.onclick = fn || null; },
    onData(fn) { dataHandler = fn; },
    onLeave(fn) { leaveHandler = fn; },
  };
  ui = { ctx, drawer };
}

function drawDrawer() {
  const name = db.getProfile().data.name || (session.user.email || '').split('@')[0] || 'Moi';
  const link = (k) => h('a', { href: '#/' + k, class: 'nav' + (k === current ? ' on' : ''), onclick: () => setMenu(false) },
    icon(views[k].meta.icon), views[k].meta.label);
  ui.drawer.replaceChildren(
    h('a', { href: '#/profile', class: 'profile-link', onclick: () => setMenu(false) },
      h('div', { class: 'avatar' }, initials(name)),
      h('div', { class: 'grow' }, h('div', { class: 'pname' }, name), h('div', { class: 'psub' }, 'Voir le profil')),
      icon('chevron-right')),
    ...NAV.map(link),
    h('div', { class: 'spacer' }),
    h('div', { class: 'bottom' }, link('settings'))
  );
}

function route() {
  if (!ui) return;
  if (leaveHandler) { try { leaveHandler(); } catch (e) { /* ignore */ } }
  leaveHandler = null;
  dataHandler = null;
  const [, name, param] = location.hash.split('/');
  current = views[name] ? name : 'train';
  ui.ctx.setActions([]);
  ui.ctx.setFab(null);
  ui.ctx.main.replaceChildren();
  window.scrollTo(0, 0);
  views[current].render(ui.ctx, param);
  drawDrawer();
  setMenu(false);
}

db.onChange(() => {
  if (!ui) return;
  drawDrawer();
  if (dataHandler) dataHandler();
});

function start(s) {
  session = s;
  db.useUser(s.user.id);
  buildShell();
  route();
  if (!started) { window.addEventListener('hashchange', route); started = true; }
  db.refresh();
}

function showLogin() {
  ui = null;
  leaveHandler = null;
  dataHandler = null;
  setMenu(false);
  const email = h('input', { type: 'email', placeholder: 'Courriel', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'err' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter');
  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try {
        start(await db.signIn(email.value.trim(), pass.value));
      } catch (ex) {
        err.textContent = ex && ex.status === 400
          ? 'Courriel ou mot de passe invalide.'
          : `Erreur (${ex?.status || '?'}) : ${ex?.message || 'Connexion impossible.'}`;
        btn.disabled = false;
      }
    },
  }, h('h1', {}, 'Mon app'), h('p', { class: 'sub' }, 'Connecte-toi pour retrouver tes données.'), email, pass, btn, err);
  root.replaceChildren(form);
}

db.sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showLogin(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && leaveHandler) leaveHandler();
});

(async () => {
  const s = await db.getSession();
  if (s) start(s); else showLogin();
})();

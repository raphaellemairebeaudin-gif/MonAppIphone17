import * as db from './db.js';
import { h, icon, applyTheme } from './ui.js';
import * as train from './view-train.js';
import * as notes from './view-notes.js';
import * as budget from './view-budget.js';
import * as supp from './view-supp.js';
import * as home from './view-profile.js';
import * as settings from './view-settings.js';

const views = { home, train, notes, budget, supp, settings };
const NAV = ['home', 'train', 'notes', 'budget', 'supp'];
const root = document.getElementById('app');

window.addEventListener('error', (e) => {
  if (root && !root.children.length) {
    root.replaceChildren(h('p', { class: 'err', style: { padding: '24px' } }, 'Erreur : ' + (e.message || 'inconnue')));
  }
});

// Demander le mode portrait lorsque le navigateur le permet.
// iOS peut ignorer cette demande pour une application web installée.
async function requestPortraitOrientation() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('portrait');
    }
  } catch (_) {
    // Certains navigateurs, notamment Safari sur iPhone, refusent le verrouillage.
  }
}

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

if ('serviceWorker' in navigator) {
  // Ne pas recharger automatiquement lors d'une mise à jour :
  // une recharge détruirait les formulaires ouverts après un retour d'arrière-plan.
  // La nouvelle version sera utilisée au prochain véritable démarrage.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

let session = null;
let ui = null;
let current = 'home';
let backHref = null;
let dataHandler = null;
let leaveHandler = null;
let started = false;
let previousRouteHash = null;

function setMenu(open) { document.body.classList.toggle('menu-open', open); }

let gesture = null;
let skipNoteBackAnimation = false;
let gestureFinishTimer = null;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const isNoteEditor = () => current === 'notes' &&
  /^#\/notes\/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|new~[^/]*)$/i.test(location.hash);

function clearGesture() {
  clearTimeout(gestureFinishTimer);
  gestureFinishTimer = null;
  document.body.classList.remove('gesture-dragging', 'gesture-note-back', 'gesture-menu');
  document.documentElement.style.removeProperty('--gesture-x');
  document.documentElement.style.removeProperty('--drawer-progress');
  document.documentElement.style.removeProperty('--drawer-x');
  document.getElementById('notes-swipe-preview')?.remove();
  gesture = null;
}
function noteSwipePreview() {
  const preview = h('div', { id: 'notes-swipe-preview', 'aria-hidden': 'true' },
    h('div', { class: 'notes-swipe-heading' }, h('span', {}, 'Notes'),
      h('span', { class: 'notes-swipe-sub' }, db.all('note').length + ' notes')));
  const notes = db.all('note').slice().sort((a, b) =>
    Number(!!b.data.pinned) - Number(!!a.data.pinned) ||
    (b.updated_at || '').localeCompare(a.updated_at || ''));
  for (const n of notes.slice(0, 15)) {
    preview.append(h('div', { class: 'notes-swipe-row' },
      h('strong', {}, n.data.title || 'Sans titre')));
  }
  document.body.append(preview);
}
document.addEventListener('touchstart', e => {
  if (!ui || e.touches.length !== 1 || gesture) return;
  if (document.querySelector('.sheet-wrap.open') ||
      e.target.closest('.toolbar, .budget-cards-scroll, .notes-folder-strip, input[type=range]')) return;
  const t = e.touches[0];
  const menuOpen = document.body.classList.contains('menu-open');
  const note = isNoteEditor() && !menuOpen;
  // Une animation précédente ne doit jamais survivre à un nouveau geste.
  clearTimeout(gestureFinishTimer);
  gestureFinishTimer = null;
  // Les gestes de retour/menu commencent sur le bord pour ne pas gêner
  // la sélection de texte, les listes horizontales et le défilement.
  if (!menuOpen && t.clientX > 48) return;
  gesture = { id: t.identifier, startX: t.clientX, startY: t.clientY,
    x: t.clientX, mode: menuOpen ? 'close' : note ? 'note' : 'open',
    active: false, width: 0, progress: 0 };
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!gesture) return;
  const t = [...e.touches].find(t => t.identifier === gesture.id);
  if (!t) return;
  const dx = t.clientX - gesture.startX;
  const dy = t.clientY - gesture.startY;
  if (!gesture.active) {
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 9) {
      if (Math.abs(dy) > 12) gesture = null;
      return;
    }
    if (gesture.mode !== 'close' && dx < 0) { gesture = null; return; }
    if (gesture.mode === 'close' && dx > 0) { gesture = null; return; }
    gesture.active = true;
    if (gesture.mode === 'note') {
      noteSwipePreview();
      document.body.classList.add('gesture-note-back');
    } else {
      document.body.classList.add('gesture-menu');
    }
    document.body.classList.add('gesture-dragging');
    gesture.width = gesture.mode === 'note' ? window.innerWidth :
      ui.drawer.getBoundingClientRect().width;
  }
  if (e.cancelable) e.preventDefault();
  const width = gesture.width || 1;
  const progress = gesture.mode === 'close' ? clamp(1 + dx / width, 0, 1) :
    clamp(dx / width, 0, 1);
  gesture.progress = progress;
  document.documentElement.style.setProperty('--drawer-progress', progress);
  document.documentElement.style.setProperty('--drawer-x', ((progress - 1) * width) + 'px');
  document.documentElement.style.setProperty('--gesture-x', (progress * width) + 'px');
}, { passive: false });
function finishGesture(cancelled = false) {
  if (!gesture) return;
  const g = gesture;
  if (!g.active) { gesture = null; return; }
  const commit = !cancelled && (g.mode === 'close' ? g.progress < .55 : g.progress > .42);
  document.body.classList.remove('gesture-dragging');
  if (g.mode === 'note') {
    if (commit) {
      // Finir le glissement avec le doigt avant de remplacer l'éditeur.
      document.documentElement.style.setProperty('--gesture-x', window.innerWidth + 'px');
      const noteHash = location.hash;
      gestureFinishTimer = setTimeout(() => {
        clearGesture();
        if (location.hash !== noteHash || !isNoteEditor()) return;
        skipNoteBackAnimation = true;
        location.hash = '#/notes';
      }, 180);
    } else {
      document.documentElement.style.setProperty('--gesture-x', '0px');
      gestureFinishTimer = setTimeout(clearGesture, 210);
    }
  } else {
    const targetProgress = commit ? (g.mode === 'close' ? 0 : 1) : (g.mode === 'close' ? 1 : 0);
    document.documentElement.style.setProperty('--drawer-progress', targetProgress);
    document.documentElement.style.setProperty('--drawer-x', ((targetProgress - 1) * g.width) + 'px');
    gestureFinishTimer = setTimeout(() => {
      setMenu(commit ? g.mode === 'open' : g.mode === 'close');
      clearGesture();
    }, 210);
  }
  gesture = null;
}
document.addEventListener('touchend', e => {
  if (!gesture || ![...e.changedTouches].some(t => t.identifier === gesture.id)) return;
  finishGesture();
}, { passive: true });
document.addEventListener('touchcancel', () => finishGesture(true), { passive: true });

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
  const link = (k) => h('a', { href: '#/' + k, class: 'nav' + (k === current ? ' on' : ''), onclick: () => setMenu(false) },
    icon(views[k].meta.icon), views[k].meta.label);
  ui.drawer.replaceChildren(
    ...NAV.map(link),
    h('div', { class: 'spacer' }),
    h('div', { class: 'bottom' }, link('settings'))
  );
}

function renderRoute() {
  if (!ui) return;
  if (gestureFinishTimer || document.body.classList.contains('gesture-dragging')) clearGesture();
  if (leaveHandler) { try { leaveHandler(); } catch (e) { /* ignore */ } }
  leaveHandler = null;
  dataHandler = null;
  const [, name, param] = location.hash.split('/');
  current = views[name] ? name : 'home';
  ui.ctx.setActions([]);
  ui.ctx.setFab(null);
  ui.ctx.main.replaceChildren();
  window.scrollTo(0, 0);
  try {
    views[current].render(ui.ctx, param);
    drawDrawer();
  } catch (err) {
    ui.ctx.main.replaceChildren(h('p', { class: 'err' }, 'Erreur : ' + (err && err.message ? err.message : String(err))));
  }
  setMenu(false);
}

function route() {
  if (!ui) return;
  const nextHash = location.hash;
  const previous = previousRouteHash || '';
  const backFromNote = previous.startsWith('#/notes/') && previous !== '#/notes/all' &&
    !previous.startsWith('#/notes/folder-') &&
    (nextHash === '#/notes' || nextHash === '#/notes/');
  previousRouteHash = nextHash;
  if (skipNoteBackAnimation) {
    skipNoteBackAnimation = false;
    renderRoute();
    return;
  }
  if (!backFromNote || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    renderRoute();
    return;
  }
  if (typeof document.startViewTransition === 'function') {
    document.documentElement.classList.add('notes-back-transition');
    const transition = document.startViewTransition(() => renderRoute());
    transition.finished.finally(() => document.documentElement.classList.remove('notes-back-transition'));
  } else {
    renderRoute();
    ui.ctx.main.animate([
      {transform:'translateX(-24px)',opacity:.55},
      {transform:'translateX(0)',opacity:1}
    ],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'});
    root.querySelector('.head')?.animate([
      {transform:'translateX(-18px)',opacity:.55},
      {transform:'translateX(0)',opacity:1}
    ],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'});
  }
}

db.onChange(() => {
  if (!ui) return;
  drawDrawer();
  if (dataHandler) dataHandler();
});

function start(s) {
  requestPortraitOrientation();
  session = s;
  db.useUser(s.user.id);
  buildShell();
  // Une nouvelle exécution JavaScript signifie un nouveau démarrage.
  // Un simple passage en arrière-plan ne relance pas ce code.
  // replaceState évite de conserver l'ancienne page dans l'historique.
  if (location.hash !== '#/home') {
    history.replaceState(history.state, '', location.pathname + location.search + '#/home');
  }
  previousRouteHash = location.hash;
  route();
  if (!started) { window.addEventListener('hashchange', route); started = true; }
  // Afficher immédiatement l'interface depuis les données locales; synchroniser ensuite.
  window.finishLaunch?.();
  db.refresh().catch(() => {});
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
        const msg = (ex && ex.message) || '';
        if (!navigator.onLine) {
          err.textContent = 'Connexion impossible. Vérifie ta connexion Internet.';
        } else if (msg.includes('Email not confirmed')) {
          err.textContent = 'Courriel non confirmé dans Supabase (coche Auto Confirm User).';
        } else if (ex && ex.status === 400) {
          err.textContent = 'Courriel ou mot de passe invalide.';
        } else {
          err.textContent = msg || 'Erreur de connexion à Supabase.';
        }
        btn.disabled = false;
      }
    },
  }, h('h1', {}, 'Mon app'), h('p', { class: 'sub' }, 'Connecte-toi pour retrouver tes données.'), email, pass, btn, err);
  root.replaceChildren(form);
  window.finishLaunch?.();
}

db.sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showLogin(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && leaveHandler) leaveHandler();
});

(async () => {
  try {
    const s = await db.getSession();
    if (s) start(s); else showLogin();
  } catch (e) {
    window.launchFailed?.();
    root.replaceChildren(h('p', { class: 'err', style: { padding: '24px' } }, 'Erreur de démarrage : ' + (e?.message || 'connexion impossible')));
  }
})();

import * as db from './db.js';
import { h, seg, group, getTheme, setTheme, today, toast } from './ui.js';

export const meta = { label: 'Réglages', icon: 'settings' };

function download() {
  const blob = new Blob([JSON.stringify(db.exportAll(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'mes-donnees-' + today() + '.json' });
  document.body.append(a);
  a.click();
  a.remove();
}

async function clearLocal() {
  if (!navigator.onLine) {
    toast('Connexion Internet requise pour vider et recharger le cache.');
    return;
  }
  if (!confirm('Vider le cache de l’app et la recharger ? Tes données en ligne ne sont pas touchées.')) return;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('cache:')).forEach((k) => localStorage.removeItem(k));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    location.replace(location.pathname);
  } catch (e) {
    toast('Impossible de vider le cache.');
  }
}

export function render(ctx) {
  ctx.setHead(meta.label, 'Apparence');
  ctx.main.append(
    h('h3', { class: 'sec' }, 'Thème'),
    seg([['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']], getTheme(), setTheme),
    h('p', { class: 'hint' }, 'Auto suit le réglage de ton iPhone. Ton choix est conservé.'),
    group([
      { label: 'Exporter mes données', onclick: download },
      { label: 'Vider le cache de l’app', onclick: clearLocal },
    ]),
    h('p', { class: 'hint' }, 'Version 1.0')
  );
}

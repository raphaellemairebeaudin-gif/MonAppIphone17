import * as db from './db.js';
import { h, sheet, field, group, today, fmtMoney, initials, toast, errMsg } from './ui.js';

export const meta = { label: 'Profil', icon: 'user' };

export function render(ctx) {
  ctx.setHead(meta.label, 'Mon espace');
  const body = h('div');
  ctx.main.append(body);

  function draw() {
    const prof = db.getProfile().data;
    const name = prof.name || (ctx.session.user.email || '').split('@')[0] || 'Moi';
    const ym = today().slice(0, 7);
    const spent = db.all('tx')
      .filter((t) => (t.data.date || '').startsWith(ym) && t.data.type !== 'income')
      .reduce((n, t) => n + t.data.amount, 0);
    const tile = (v, l) => h('div', { class: 'tile' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    body.replaceChildren(
      h('div', { class: 'profilehead' },
        h('div', { class: 'avatar lg' }, initials(name)),
        h('div', { style: { fontSize: '20px', fontWeight: 600, marginTop: '6px' } }, name),
        h('div', { class: 'psub' }, ctx.session.user.email || '')),
      h('div', { class: 'tiles' },
        tile(db.all('workout').length, 'Entraînements'),
        tile(db.all('note').length, 'Notes'),
        tile(fmtMoney(spent), 'Dépensé ce mois'),
        tile(db.all('supp').length, 'Suppléments')),
      group([
        { label: 'Modifier le nom', onclick: () => nameSheet(name) },
      ]),
      group([{ label: 'Se déconnecter', danger: true, onclick: async () => {
        if (confirm('Te déconnecter ?')) await db.signOut();
      } }]));
  }
  ctx.onData(draw);
  draw();
}

function nameSheet(current) {
  sheet('Modifier le nom', (close) => {
    const input = h('input', { value: current, placeholder: 'Ton prénom' });
    return h('div', {}, field('Nom affiché', input),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        try { await db.saveProfile({ name: input.value.trim() }); close(); } catch (e) { toast(errMsg(e)); }
      } }, 'Enregistrer')));
  });
}


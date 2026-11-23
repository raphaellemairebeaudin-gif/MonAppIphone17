import * as db from './db.js';
import { h, seg, sheet, field, today, num, toast, errMsg } from './ui.js';

export const meta = { label: 'Budget', icon: 'wallet' };
const CATS = ['Épicerie', 'Restaurant', 'Transport', 'Logement', 'Santé', 'Loisirs', 'Abonnements', 'Shopping', 'Autre'];

// Page volontairement vide : le menu glissant, le titre et le bouton + sont fournis par app.js.
export function render(ctx) {
  ctx.setHead('Budget', '');
  ctx.setActions([]);
  ctx.main.replaceChildren();
  ctx.setFab(() => txSheet());
}

function txSheet(existing) {
  const d = existing ? { ...existing.data } : { type: 'expense', amount: 0, category: '', note: '', date: today() };
  sheet(existing ? 'Modifier la transaction' : 'Nouvelle transaction', (close) => {
    const err = h('p', { class: 'err' });
    const used = [...new Set([...CATS, ...db.all('tx').map((t) => t.data.category).filter(Boolean)])];
    const listId = 'cats-' + Date.now();
    const amount = h('input', { inputmode: 'decimal', placeholder: '0,00', value: d.amount || '' });
    const cat = h('input', { list: listId, placeholder: 'Épicerie', value: d.category });
    const note = h('input', { placeholder: 'Facultatif', value: d.note });
    const date = h('input', { type: 'date', value: d.date });
    return h('div', {},
      seg([['expense', 'Dépense'], ['income', 'Revenu']], d.type, (v) => { d.type = v; }),
      field('Montant ($)', amount),
      field('Catégorie', cat), h('datalist', { id: listId }, used.map((c) => h('option', { value: c }))),
      field('Description', note), field('Date', date), err,
      h('div', { class: 'btnrow' },
        existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('Supprimer cette transaction ?')) return;
          try { await db.remove(existing.id); close(); } catch (e) { toast(errMsg(e)); }
        } }, 'Supprimer'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const a = num(amount.value);
          if (a <= 0) { err.textContent = 'Entre un montant plus grand que 0.'; return; }
          if (!date.value) { err.textContent = 'Choisis une date.'; return; }
          const data = { type: d.type, amount: a, category: cat.value.trim(), note: note.value.trim(), date: date.value };
          try {
            if (existing) await db.update(existing.id, data); else await db.add('tx', data);
            close();
          } catch (e) { err.textContent = errMsg(e); }
        } }, 'Enregistrer')));
  });
}

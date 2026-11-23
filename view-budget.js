import * as db from './db.js';
import { bankSection } from './view-budget-banks.js';
import { salarySection, investmentSection } from './view-budget-extra.js';
import { h, icon, seg, sheet, field, row, empty, today, fmtDate, fmtMoney, num, toast, errMsg } from './ui.js';

export const meta = { label: 'Budget', icon: 'wallet' };

const CATS = ['Épicerie', 'Restaurant', 'Transport', 'Logement', 'Santé', 'Loisirs', 'Abonnements', 'Shopping', 'Autre'];
let ym = today().slice(0, 7);

const shift = (s, delta) => {
  const [y, m] = s.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
const monthLabel = (s) => {
  const [y, m] = s.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
};

export function render(ctx) {
  const body = h('div');
  const label = h('strong');
  const nav = h('div', { class: 'monthnav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mois précédent', onclick: () => { ym = shift(ym, -1); draw(); } }, icon('chevron-left')),
    label,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mois suivant', onclick: () => { ym = shift(ym, 1); draw(); } }, icon('chevron-right')));
  ctx.main.append(nav, body);
  ctx.setFab(() => txSheet());

  function draw() {
    ctx.setHead(meta.label, '');
    label.textContent = monthLabel(ym);
    const tx = db.all('tx').filter((t) => (t.data.date || '').startsWith(ym))
      .sort((a, b) => b.data.date.localeCompare(a.data.date) || b.created_at.localeCompare(a.created_at));
    const spent = tx.filter((t) => t.data.type !== 'income').reduce((n, t) => n + t.data.amount, 0);
    const manualIncome = tx.filter((t) => t.data.type === 'income').reduce((n, t) => n + t.data.amount, 0);
    const confirmedPay = db.all('pay_override').filter((p) => p.data.received && (p.data.payday || '').startsWith(ym));
    const vacationPay = db.all('vacation_pay').filter((p) => (p.data.date || '').startsWith(ym));
    const income = manualIncome + confirmedPay.reduce((n, p) => n + Number(p.data.amount || 0), 0)
      + vacationPay.reduce((n, p) => n + Number(p.data.amount || 0), 0);
    const budget = db.getProfile().data.budget || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

    const card = h('div', { class: 'card row tap', style: { display: 'block' }, onclick: budgetSheet },
      h('div', { class: 'lbl' }, h('span', {}, 'Dépensé ce mois'), h('span', {}, budget > 0 ? 'sur ' + fmtMoney(budget) : 'Définir un budget')),
      h('div', { class: 'big' }, fmtMoney(spent)),
      budget > 0 && h('div', { class: 'track' + (spent > budget ? ' over' : '') }, h('div', { style: { width: pct + '%' } })),
      budget > 0 && h('div', { class: 'row s', style: { border: 0, padding: '8px 0 0' } },
        spent > budget ? h('span', { class: 'warn' }, 'Dépassé de ' + fmtMoney(spent - budget)) : 'Il reste ' + fmtMoney(budget - spent)));

    const tiles = h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'v pos' }, fmtMoney(income)), h('div', { class: 'l' }, 'Revenus')),
      h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtMoney(income - spent)), h('div', { class: 'l' }, 'Solde du mois')));

    const byCat = {};
    tx.filter((t) => t.data.type !== 'income').forEach((t) => { const c = t.data.category || 'Autre'; byCat[c] = (byCat[c] || 0) + t.data.amount; });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const catBox = cats.length ? h('div', {}, h('h3', { class: 'sec' }, 'Par catégorie'),
      cats.map(([c, v]) => h('div', { class: 'cat' },
        h('div', { class: 'top' }, h('span', {}, c), h('span', {}, fmtMoney(v))),
        h('div', { class: 'track' }, h('div', { style: { width: Math.round((v / spent) * 100) + '%' } }))))) : null;

    const list = (tx.length || confirmedPay.length || vacationPay.length)
      ? h('div', {}, h('h3', { class: 'sec' }, 'Transactions'), tx.map((t) =>
        row(t.data.note || t.data.category || 'Sans titre',
          [t.data.category, fmtDate(t.data.date)].filter(Boolean).join(' · '),
          h('span', { class: t.data.type === 'income' ? 'pos' : '', style: { fontWeight: 500, whiteSpace: 'nowrap' } },
            (t.data.type === 'income' ? '+' : '−') + fmtMoney(t.data.amount)),
          () => txSheet(t))),
        ...confirmedPay.map((p) => row('Salaire CCQ', fmtDate(p.data.payday) + ' · Paie confirmée', h('span', { class: 'pos' }, '+' + fmtMoney(p.data.amount)))),
        ...vacationPay.map((p) => row('Paiement de vacances CCQ', fmtDate(p.data.date), h('span', { class: 'pos' }, '+' + fmtMoney(p.data.amount)))))
      : empty('Aucune transaction', 'Touche + pour ajouter une dépense ou un revenu.');

    body.replaceChildren(...[card, tiles, salarySection(ym), bankSection(), investmentSection(), catBox, list].filter(Boolean));
  }
  ctx.onData(draw);
  draw();
}

function budgetSheet() {
  sheet('Budget mensuel', (close) => {
    const input = h('input', { inputmode: 'decimal', placeholder: '2000', value: db.getProfile().data.budget || '' });
    return h('div', {},
      field('Montant maximum à dépenser par mois ($)', input),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try { await db.saveProfile({ budget: num(input.value) }); close(); } catch (e) { toast(errMsg(e)); }
        } }, 'Enregistrer')));
  });
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
            ym = data.date.slice(0, 7);
            close();
          } catch (e) { err.textContent = errMsg(e); }
        } }, 'Enregistrer')));
  });
}

import * as db from './db.js';
import { h, icon, seg, sheet, field, row, empty, num, toast, errMsg } from './ui.js';

export const meta = { label: 'Suppléments', icon: 'pill' };

const UNITS = ['capsules', 'portions', 'comprimés', 'gélules', 'sachets'];
let filter = 'all';

const isLow = (s) => num(s.remaining) <= num(s.low);

export function render(ctx) {
  const body = h('div');
  const tabs = seg([['all', 'Tous'], ['like', 'Aimés'], ['dislike', 'Moins aimés'], ['low', 'À racheter']], filter, (v) => { filter = v; draw(); });
  ctx.main.append(tabs, body);
  ctx.setFab(() => suppSheet());

  function draw() {
    const all = db.all('supp');
    ctx.setHead(meta.label, all.length + ' produit' + (all.length > 1 ? 's' : ''));
    const list = all
      .filter((s) => filter === 'all' || (filter === 'low' ? isLow(s.data) : s.data.rating === filter))
      .sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));
    if (!list.length) {
      body.replaceChildren(all.length ? empty('Rien dans cette catégorie', 'Change le filtre pour voir les autres produits.')
        : empty('Ajoute ton premier supplément', 'Note ce que tu prends, ce que tu aimes et ce qu’il en reste.'));
      return;
    }
    body.replaceChildren(...list.map((s) => {
      const d = s.data;
      const low = isLow(d);
      const rating = d.rating === 'like' ? h('span', { class: 'pos' }, icon('thumb-up'))
        : d.rating === 'dislike' ? h('span', { style: { color: 'var(--sec)' } }, icon('thumb-down')) : null;
      const minus = h('button', {
        class: 'pill', type: 'button', 'aria-label': 'Retirer une unité',
        onclick: async (e) => {
          e.stopPropagation();
          const left = Math.max(0, num(d.remaining) - 1);
          try { await db.update(s.id, { ...d, remaining: left }); } catch (er) { toast(errMsg(er)); }
        },
      }, '−1');
      return row(d.name,
        h('span', { class: low ? 'warn' : '' }, `Il en reste ${num(d.remaining)} ${d.unit || ''}`.trim()),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '20px' } }, rating, minus),
        () => suppSheet(s));
    }));
  }
  ctx.onData(draw);
  draw();
}

function suppSheet(existing) {
  const d = existing ? { ...existing.data } : { name: '', rating: 'neutral', remaining: '', unit: 'capsules', low: 7, notes: '' };
  sheet(existing ? 'Modifier le supplément' : 'Nouveau supplément', (close) => {
    const err = h('p', { class: 'err' });
    const name = h('input', { placeholder: 'Oméga 3', value: d.name });
    const remaining = h('input', { inputmode: 'numeric', placeholder: '60', value: d.remaining });
    const unitId = 'units-' + Date.now();
    const unit = h('input', { list: unitId, value: d.unit });
    const low = h('input', { inputmode: 'numeric', value: d.low });
    const notes = h('textarea', { rows: 3, placeholder: 'Goût, effets, marque, où l’acheter…' }, '');
    notes.value = d.notes || '';
    return h('div', {},
      field('Nom', name),
      h('span', { class: 'hint' }, 'Ton avis'),
      seg([['like', 'Aimé'], ['neutral', 'Neutre'], ['dislike', 'Moins aimé']], d.rating || 'neutral', (v) => { d.rating = v; }),
      field('Quantité restante', remaining),
      field('Unité', unit), h('datalist', { id: unitId }, UNITS.map((u) => h('option', { value: u }))),
      field('M’alerter quand il en reste', low),
      field('Notes', notes), err,
      h('div', { class: 'btnrow' },
        existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('Supprimer ce supplément ?')) return;
          try { await db.remove(existing.id); close(); } catch (e) { toast(errMsg(e)); }
        } }, 'Supprimer'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const n = name.value.trim();
          if (!n) { err.textContent = 'Donne un nom au produit.'; return; }
          const data = { name: n, rating: d.rating || 'neutral', remaining: num(remaining.value), unit: unit.value.trim(), low: num(low.value), notes: notes.value.trim() };
          try {
            if (existing) await db.update(existing.id, data); else await db.add('supp', data);
            close();
          } catch (e) { err.textContent = errMsg(e); }
        } }, 'Enregistrer')));
  });
}

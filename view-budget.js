import * as db from './db.js';
import { h, field, sheet, num, errMsg, fmtMoney, fmtDate } from './ui.js';
import { balance } from './view-budget-banks.js';

export const meta = { label: 'Budget', icon: 'wallet' };

// Cartes affichées sur la page principale et utilisées dans le menu +.
export function render(ctx, param) {
  if (param === 'card') {
    renderCardDetail(ctx, decodeURIComponent(location.hash.split('/')[3] || ''));
    return;
  }
  ctx.setHead('Budget', '');
  ctx.setActions([]);
  ctx.setFab(openAddMenu);
  const section = h('section', { class: 'budget-cards-section' });
  const draw = () => {
    const cards = db.all('bank_account').filter(a =>
      a.data.type === 'checking' || a.data.type === 'credit'
    );
    const heading = h('div', { class: 'budget-cards-heading' },
      h('h2', {}, 'Mes Cartes'),
      h('button', { type: 'button', class: 'budget-card-add',
        onclick: () => cardSheet(draw) }, '+ Ajouter'
      )
    );
    const scroller = h('div', {
      class: 'budget-cards-scroll',
      role: 'region', 'aria-label': 'Mes cartes', tabindex: '0'
    }, ...cards.map(card =>
      h('div', { class: 'budget-bank-card', role: 'button', tabindex: '0',
        'aria-label': 'Voir les détails de ' + (card.data.name || 'la carte'),
        onclick: () => { location.hash = '#/budget/card/' + encodeURIComponent(card.id); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/budget/card/' + encodeURIComponent(card.id); } }
      },
        h('div', { class: 'budget-bank-card-top' },
          h('span', { class: 'budget-bank-card-type' },
            card.data.type === 'credit' ? 'CRÉDIT' : 'DÉBIT')
        ),
        h('span', { class: 'budget-bank-card-name' }, card.data.name || 'Ma carte'),
        h('span', { class: 'budget-bank-card-finances' },
          h('span', { class: 'budget-bank-card-amount' }, fmtMoney(balance(card))),
          h('span', { class: 'budget-bank-card-bottom' },
            card.data.type === 'credit' ? 'Montant dû' : 'Solde disponible'),
          card.data.type === 'credit' && Number(card.data.limit) > 0
            ? h('span', { class: 'budget-bank-card-limit' },
                'Limite : ' + fmtMoney(Number(card.data.limit)))
            : null
        )
      )
    ));
    section.replaceChildren(heading,
      cards.length ? scroller : h('p', { class: 'budget-cards-empty' }, 'Aucune carte')
    );
  };
  draw();
  ctx.main.replaceChildren(section);
  ctx.onData(draw);
}


function cardOperations(card) {
  const events = db.all('bank_event').filter(e => e.data.accountId === card.id).map(e => ({
    id: e.id, date: e.data.date || e.created_at?.slice(0, 10) || '',
    created: e.created_at || '', type: e.data.type, amount: Number(e.data.amount) || 0,
    note: e.data.note || '', source: 'event'
  }));
  const transfers = db.all('bank_transfer').filter(t =>
    t.data.fromId === card.id || t.data.toId === card.id
  ).map(t => ({
    id: t.id, date: t.data.date || t.created_at?.slice(0, 10) || '',
    created: t.created_at || '', type: 'transfer',
    amount: Number(t.data.amount) || 0, note: t.data.note || '',
    source: 'transfer', from: t.data.fromId === card.id,
    other: t.data.fromId === card.id ? t.data.toId : t.data.fromId
  }));
  return [...events, ...transfers].sort((a, b) =>
    a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id)
  );
}

function operationDelta(op, credit) {
  if (op.type === 'balance') return 0;
  if (op.type === 'transfer') return op.from ? -op.amount : (credit ? -op.amount : op.amount);
  return (op.type === 'increase' ? 1 : -1) * op.amount;
}

function historyData(card) {
  const ops = cardOperations(card);
  let amount = Number(card.data.openingBalance) || 0;
  const points = [{ date: card.created_at?.slice(0, 10) || ops[0]?.date || '', value: amount }];
  const credit = card.data.type === 'credit';
  const history = ops.map(op => {
    const before = amount;
    amount = op.type === 'balance' ? op.amount : amount + operationDelta(op, credit);
    points.push({ date: op.date, value: amount });
    return { ...op, before, after: amount, delta: amount - before };
  });
  return { history, points, amount };
}

function cardChart(points, period) {
  const cutoff = period === 'all' ? '' : (() => {
    const d = new Date(); d.setDate(d.getDate() - Number(period));
    return d.toISOString().slice(0, 10);
  })();
  const lastBefore = [...points].reverse().find(p => p.date < cutoff);
  const visible = cutoff ? [
    ...(lastBefore ? [{ date: cutoff, value: lastBefore.value }] : []),
    ...points.filter(p => p.date >= cutoff)
  ] : points;
  const values = visible.length ? visible : [{ value: 0, date: '' }];
  const min = Math.min(...values.map(p => p.value));
  const max = Math.max(...values.map(p => p.value));
  const span = Math.max(1, max - min);
  const W = 320, H = 148, pad = 15;
  const x = i => pad + i * (W - 2 * pad) / Math.max(1, values.length - 1);
  const y = v => H - pad - ((v - min) / span) * (H - 2 * pad);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 320 148');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Évolution du solde selon les opérations enregistrées');
  svg.classList.add('budget-detail-chart-svg');
  const line = document.createElementNS(ns, 'line');
  for (const [k, v] of Object.entries({ x1: pad, x2: W-pad, y1: H-pad, y2: H-pad })) line.setAttribute(k, v);
  line.setAttribute('class', 'budget-chart-axis'); svg.append(line);
  const path = document.createElementNS(ns, 'path');
  const coords = values.map((p, i) => [x(i), y(p.value)]);
  path.setAttribute('d', coords.map(([a,b],i) => (i ? 'L' : 'M') + a.toFixed(2) + ' ' + b.toFixed(2)).join(' '));
  path.setAttribute('class', 'budget-chart-line'); svg.append(path);
  const last = coords[coords.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', 4);
  dot.setAttribute('class', 'budget-chart-dot'); svg.append(dot);
  return h('div', { class: 'budget-detail-chart' }, svg,
    h('div', { class: 'budget-chart-labels' },
      h('span', {}, values[0]?.date ? fmtDate(values[0].date) : 'Début'),
      h('span', {}, values[values.length-1]?.date ? fmtDate(values[values.length-1].date) : 'Aujourd’hui')
    )
  );
}

function renderCardDetail(ctx, id) {
  const account = db.get(id);
  if (!account || account.kind !== 'bank_account') {
    ctx.setHead('Carte introuvable', '', { back: '#/budget' });
    ctx.main.replaceChildren(h('p', { class: 'budget-detail-empty' }, 'Cette carte est introuvable.'));
    ctx.setFab(null); return;
  }
  ctx.setHead(account.data.name || 'Ma carte', '', { back: '#/budget' });
  ctx.setFab(null);
  ctx.setActions([h('button', {
    type: 'button', class: 'icon-btn budget-detail-top-edit',
    'aria-label': 'Modifier la carte',
    onclick: () => {
      const card = db.get(id);
      if (card) cardSheet(draw, card);
    }
  }, '⋯')]);
  let period = '90';
  const root = h('div', { class: 'budget-detail' });
  const draw = () => {
    const card = db.get(id);
    if (!card) { location.hash = '#/budget'; return; }
    const credit = card.data.type === 'credit';
    const { history, points, amount } = historyData(card);
    const limit = Number(card.data.limit) || 0;
    const summary = h('div', { class: 'budget-detail-summary' },
      h('div', { class: 'budget-detail-metric budget-detail-primary' },
        h('span', {}, credit ? 'Montant dû' : 'Solde disponible'),
        h('strong', {}, fmtMoney(amount))
      ),
      credit && limit > 0 && h('div', { class: 'budget-detail-metrics' },
        h('div', { class: 'budget-detail-metric' },
          h('span', {}, 'Limite de crédit'), h('strong', {}, fmtMoney(limit))),
        h('div', { class: 'budget-detail-metric' },
          h('span', {}, 'Crédit disponible'), h('strong', {}, fmtMoney(limit - amount)))
      )
    );
    const graph = h('section', { class: 'budget-detail-panel' },
      h('div', { class: 'budget-detail-section-title' },
        h('h2', {}, 'Évolution du solde'),
        h('div', { class: 'budget-detail-periods' },
          ...[['30','30 j'],['90','90 j'],['all','Tout']].map(([value,label]) =>
            h('button', { type: 'button', class: period === value ? 'on' : '',
              'aria-pressed': String(period === value),
              onclick: () => { period = value; draw(); }
            }, label))
        )
      ),
      cardChart(points, period),
      h('p', { class: 'budget-detail-hint' },
        'Évolution basée sur les soldes et opérations enregistrés, sans connexion bancaire.')
    );
    const sorted = history.slice().reverse();
    const historySection = h('section', { class: 'budget-detail-history' },
      h('h2', {}, 'Historique des opérations'),
      sorted.length ? h('div', { class: 'budget-detail-operations' },
        ...sorted.map(op => {
          const label = op.type === 'balance' ? 'Solde constaté'
            : op.type === 'transfer' ? (op.from ? 'Virement sortant' : 'Remboursement / virement')
            : op.type === 'increase' ? (credit ? 'Achat' : 'Dépôt')
            : (credit ? 'Remboursement' : 'Retrait');
          const related = op.other && db.get(op.other);
          return h('div', { class: 'budget-detail-operation' },
            h('div', { class: 'budget-detail-operation-info' },
              h('strong', {}, op.note || label),
              h('span', {}, fmtDate(op.date) + (op.note ? ' · ' + label : '') +
                (related ? ' · ' + (related.data.name || 'Autre carte') : ''))
            ),
            h('div', { class: 'budget-detail-operation-amount' },
              h('strong', {}, (op.type !== 'balance' && op.delta > 0 ? '+' : '') +
                fmtMoney(op.type === 'balance' ? op.amount : op.delta)),
              h('span', {}, 'Solde : ' + fmtMoney(op.after))
            )
          );
        })
      ) : h('p', { class: 'budget-detail-empty' }, 'Aucune opération enregistrée pour cette carte.')
    );
    root.replaceChildren(
      h('div', { class: 'budget-detail-cardhead' },
        h('span', {}, credit ? 'CARTE DE CRÉDIT' : 'CARTE DE DÉBIT')
      ),
      graph, summary, historySection
    );
  };
  draw();
  ctx.main.replaceChildren(root);
  ctx.onData(draw);
}

function cardSheet(redraw, existing = null) {
  sheet(existing ? 'Modifier la carte' : 'Ajouter une carte', close => {
    const type = h('select', {},
      h('option', { value: 'checking' }, 'Carte de débit'),
      h('option', { value: 'credit' }, 'Carte de crédit')
    );
    type.value = existing?.data.type || 'checking';
    const name = h('input', {
      value: existing?.data.name || '', placeholder: 'Nom de la carte'
    });
    const initial = h('input', {
      inputmode: 'decimal', placeholder: '0,00',
      value: existing ? String(existing.data.openingBalance || 0) : ''
    });
    const limit = h('input', {
      inputmode: 'decimal', placeholder: '0,00',
      value: existing ? String(existing.data.limit || 0) : ''
    });
    const limitRow = field('Limite de crédit ($)', limit);
    const updateType = () => { limitRow.hidden = type.value !== 'credit'; };
    type.addEventListener('change', updateType);
    updateType();
    const err = h('p', { class: 'err' });
    const save = h('button', { type: 'button', class: 'btn primary',
      onclick: async () => {
        const label = name.value.trim();
        if (!label) { err.textContent = 'Entre un nom de carte.'; return; }
        const openingBalance = existing
          ? Number(existing.data.openingBalance || 0) : num(initial.value);
        if (!Number.isFinite(openingBalance) || openingBalance < 0 ||
            !Number.isFinite(num(limit.value)) || num(limit.value) < 0) {
          err.textContent = 'Montant invalide.'; return;
        }
        save.disabled = true;
        err.textContent = '';
        try {
          const data = {
            ...(existing?.data || {}),
            name: label, type: type.value, openingBalance,
            limit: type.value === 'credit' ? num(limit.value) : 0
          };
          if (existing) await db.update(existing.id, data);
          else await db.add('bank_account', data);
          close();
          redraw();
        } catch (e) {
          err.textContent = errMsg(e);
          save.disabled = false;
        }
      }
    }, 'Enregistrer');
    return h('div', { class: 'budget-card-form' },
      field('Type de carte', type),
      field('Nom', name),
      !existing && field('Solde initial ($)', initial),
      limitRow, err, save,
      existing && h('button', {
        type: 'button', class: 'budget-card-delete',
        onclick: async (event) => {
          if (!confirm('Supprimer « ' + (existing.data.name || 'cette carte') +
            ' » ? Cette action est irréversible.')) return;
          const linkedEvents = db.all('bank_event').filter(e => e.data.accountId === existing.id);
          const linkedTransfers = db.all('bank_transfer').filter(t =>
            t.data.fromId === existing.id || t.data.toId === existing.id
          );
          if (linkedEvents.length || linkedTransfers.length) {
            err.textContent = 'Cette carte contient des opérations ou des virements. Supprime-les avant de supprimer la carte.';
            return;
          }
          const button = event.currentTarget;
          button.disabled = true;
          err.textContent = '';
          try {
            await db.remove(existing.id);
            close();
            redraw();
          } catch (e) {
            err.textContent = errMsg(e);
            button.disabled = false;
          }
        }
      }, 'Supprimer la carte')
    );
  });
}

function openAddMenu() {
  sheet('Nouvelle transaction', () => {
    let kind = 'pay';
    const amount = h('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0,00',
      'aria-label': 'Montant en dollars'
    });
    const details = h('div', { class: 'budget-add-details' });
    const accounts = () => db.all('bank_account');
    const selectAccounts = (items, placeholder) => {
      const select = h('select', { 'aria-label': placeholder },
        h('option', { value: '' }, placeholder),
        ...items.map(a => h('option', { value: a.id }, a.data.name || 'Compte sans nom')));
      return select;
    };

    const drawDetails = () => {
      const checking = accounts().filter(a => a.data.type === 'checking');
      const credit = accounts().filter(a => a.data.type === 'credit');
      if (kind === 'pay') {
        details.replaceChildren(
          field('Carte de débit', selectAccounts(checking, 'Choisir une carte de débit'))
        );
      } else if (kind === 'transaction') {
        details.replaceChildren(
          field('Carte', selectAccounts(
            [...checking, ...credit],
            'Choisir une carte de débit ou de crédit'
          ))
        );
      } else if (kind === 'credit_payment') {
        details.replaceChildren(
          field('Compte de débit', selectAccounts(checking, 'Choisir un compte de débit')),
          field('Carte de crédit', selectAccounts(credit, 'Choisir une carte de crédit'))
        );
      } else if (kind === 'investment') {
        const investments = db.all('investment_account');
        details.replaceChildren(
          field('Placement', selectAccounts(investments, 'Choisir un placement')),
          !investments.length && h('p', { class: 'budget-add-empty' }, 'Aucun placement')
        );
      }
    };

    const choices = h('div', { class: 'budget-add-choices' },
      ...[
        ['pay', 'Paie'],
        ['transaction', 'Transaction'],
        ['credit_payment', 'Paiement de carte'],
        ['investment', 'Placement']
      ].map(([value, label]) => {
        const button = h('button', {
          type: 'button', class: 'budget-add-choice',
          onclick: () => {
            kind = value;
            for (const item of choices.querySelectorAll('button')) {
              item.classList.toggle('selected', item === button);
              item.setAttribute('aria-pressed', String(item === button));
            }
            drawDetails();
          },
          'aria-pressed': String(kind === value)
        }, label);
        if (kind === value) button.classList.add('selected');
        return button;
      })
    );
    drawDetails();
    return h('div', { class: 'budget-add-form' },
      field('Montant', amount),
      choices,
      details,
      h('button', { type: 'button', class: 'btn primary budget-add-confirm', onclick: () => {} }, 'Confirmer')
    );
  });
}

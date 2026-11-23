import * as db from './db.js';
import { h, field, sheet, num, errMsg, fmtMoney } from './ui.js';
import { balance } from './view-budget-banks.js';

export const meta = { label: 'Budget', icon: 'wallet' };

// Cartes affichées sur la page principale et utilisées dans le menu +.
export function render(ctx) {
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
      h('button', { type: 'button', class: 'budget-bank-card',
        onclick: () => cardSheet(draw, card) },
        h('span', { class: 'budget-bank-card-type' },
          card.data.type === 'credit' ? 'CRÉDIT' : 'DÉBIT'),
        h('span', { class: 'budget-bank-card-name' }, card.data.name || 'Ma carte'),
        card.data.type === 'credit'
          ? h('span', { class: 'budget-bank-card-finances' },
              h('span', { class: 'budget-bank-card-amount' }, fmtMoney(balance(card))),
              h('span', { class: 'budget-bank-card-bottom' }, 'Montant dû'),
              Number(card.data.limit) > 0 &&
                h('span', { class: 'budget-bank-card-limit' },
                  'Limite : ' + fmtMoney(Number(card.data.limit)))
            )
          : h('span', { class: 'budget-bank-card-bottom' }, 'Carte de débit')
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
      limitRow, err, save
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

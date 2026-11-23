import * as db from './db.js';
import { h, field, sheet, seg } from './ui.js';

export const meta = { label: 'Budget', icon: 'wallet' };

// La page principale reste volontairement vide.
export function render(ctx) {
  ctx.setHead('Budget', '');
  ctx.setActions([]);
  ctx.main.replaceChildren();
  ctx.setFab(openAddMenu);
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
    const info = message => h('p', { class: 'budget-add-hint' }, message);

    const drawDetails = () => {
      const checking = accounts().filter(a => a.data.type === 'checking');
      const credit = accounts().filter(a => a.data.type === 'credit');
      if (kind === 'pay') {
        details.replaceChildren(
          info('La paie sera ajoutée automatiquement à la carte de crédit.'),
          field('Carte de crédit', selectAccounts(credit, 'Choisir une carte de crédit'))
        );
      } else if (kind === 'transaction') {
        const paymentDetails = h('div');
        const drawPayment = type => {
          paymentDetails.replaceChildren(field(
            type === 'debit' ? 'Compte de débit' : 'Carte de crédit',
            selectAccounts(type === 'debit' ? checking : credit, 'Choisir un compte')
          ));
        };
        details.replaceChildren(
          h('p', { class: 'budget-add-label' }, 'Mode de paiement'),
          seg([['debit', 'Carte de débit'], ['credit', 'Carte de crédit']], 'debit', drawPayment),
          paymentDetails
        );
        drawPayment('debit');
      } else if (kind === 'credit_payment') {
        details.replaceChildren(
          info('Transfert du compte de débit vers la carte de crédit pour rembourser la dette.'),
          field('À partir du compte de débit', selectAccounts(checking, 'Choisir un compte de débit')),
          field('Vers la carte de crédit', selectAccounts(credit, 'Choisir une carte de crédit'))
        );
      } else if (kind === 'investment') {
        const investments = db.all('investment_account');
        details.replaceChildren(
          field('Placement', selectAccounts(investments, 'Choisir un placement')),
          !investments.length && info('Aucun placement créé pour le moment.')
        );
      }
    };

    const choices = h('div', { class: 'budget-add-choices' },
      h('p', { class: 'budget-add-label' }, 'Type d’opération'),
      ...[
        ['pay', 'Paie'],
        ['transaction', 'Transaction'],
        ['credit_payment', 'Paiement de carte de crédit'],
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
      field('Montant ($)', amount),
      choices,
      details
    );
  });
}

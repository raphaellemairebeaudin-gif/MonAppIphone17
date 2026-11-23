import { sheet } from './ui.js';

export const meta = { label: 'Budget', icon: 'wallet' };

// Le contenu du Budget et la fenêtre du bouton + restent vides pour la reconstruction.
export function render(ctx) {
  ctx.setHead('Budget', '');
  ctx.setActions([]);
  ctx.main.replaceChildren();
  ctx.setFab(() => sheet('Nouvelle transaction', () => null));
}

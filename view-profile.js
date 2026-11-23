import * as db from './db.js';
import { h, initials, toast, errMsg, sheet, field } from './ui.js';

export const meta = { label: 'Accueil', icon: 'home' };

export function render(ctx) {
  ctx.setHead('', '');
  ctx.setActions([]);
  ctx.setFab(null);
  const root = h('section', { class: 'home-welcome' });
  const photoInput = h('input', {
    type: 'file', accept: 'image/*', class: 'home-photo-input',
    'aria-label': 'Choisir une photo de profil'
  });
  const draw = () => {
    const profile = db.getProfile().data;
    const parts = String(profile.name || '').trim().split(/\s+/).filter(Boolean);
    const firstName = profile.firstName || parts[0] || (ctx.session.user.email || '').split('@')[0] || 'Moi';
    const lastName = profile.lastName || parts.slice(1).join(' ');
    const name = [firstName, lastName].filter(Boolean).join(' ');
    const avatar = h('button', { type: 'button', class: 'home-avatar',
      'aria-label': 'Changer ma photo de profil', onclick: () => photoInput.click()
    }, profile.avatarDataUrl
      ? h('img', { src: profile.avatarDataUrl, alt: 'Photo de profil' })
      : h('span', {}, initials(name)));
    const editName = () => sheet('Modifier mon nom', close => {
      const first = h('input', { value: firstName, placeholder: 'Prénom', autocomplete: 'given-name' });
      const last = h('input', { value: lastName, placeholder: 'Nom de famille', autocomplete: 'family-name' });
      return h('div', {}, field('Prénom', first), field('Nom de famille', last),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'button',
          onclick: async () => {
            try {
              const given = first.value.trim();
              const family = last.value.trim();
              if (!given) { toast('Entre ton prénom.'); return; }
              await db.saveProfile({ firstName: given, lastName: family, name: [given, family].filter(Boolean).join(' ') });
              close();
            } catch (error) { toast(errMsg(error)); }
          }
        }, 'Enregistrer')));
    });
    root.replaceChildren(avatar,
      h('button', { type: 'button', class: 'home-name-button', 'aria-label': 'Modifier mon prénom et mon nom',
        onclick: editName },
        h('span', { class: 'home-name' }, firstName),
        lastName ? h('span', { class: 'home-surname' }, lastName) : null),
      photoInput);
  };
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choisis une image valide.'); return; }
    if (file.size > 12 * 1024 * 1024) { toast('Image trop volumineuse (maximum 12 Mo).'); return; }
    try {
      const image = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const size = 320;
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d');
      const side = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2,
        side, side, 0, 0, size, size);
      image.close?.();
      await db.saveProfile({ avatarDataUrl: canvas.toDataURL('image/jpeg', 0.78) });
      toast('Photo mise à jour.');
    } catch (error) {
      toast('Impossible d’enregistrer la photo : ' + errMsg(error));
    }
    photoInput.value = '';
  });
  ctx.main.replaceChildren(root);
  ctx.onData(draw);
  draw();
}

import * as db from './db.js';
import { h, initials, toast, errMsg } from './ui.js';

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
    const name = profile.name || (ctx.session.user.email || '').split('@')[0] || 'Moi';
    const avatar = h('button', { type: 'button', class: 'home-avatar',
      'aria-label': 'Changer ma photo de profil', onclick: () => photoInput.click()
    }, profile.avatarDataUrl
      ? h('img', { src: profile.avatarDataUrl, alt: 'Photo de profil' })
      : h('span', {}, initials(name)));
    root.replaceChildren(avatar, h('h1', { class: 'home-name' }, name),
      h('p', { class: 'home-photo-hint' }, 'Toucher la photo pour la modifier'),
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

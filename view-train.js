import * as db from './db.js';
import { h, icon, seg, sheet, field, row, empty, today, fmtDate, longDate, toast, num, plur, errMsg } from './ui.js';

export const meta = { label: 'Entraînements', icon: 'barbell' };

const MUSCLES = ['Pectoraux', 'Dos', 'Épaules', 'Biceps', 'Triceps', 'Jambes', 'Fessiers', 'Abdos', 'Cardio', 'Autre'];
let tab = 'hist';

export function render(ctx) {
  ctx.setHead(meta.label, longDate());
  const body = h('div');
  const tabs = seg([['hist', 'Historique'], ['ex', 'Exercices']], tab, (v) => { tab = v; draw(); });
  ctx.main.append(tabs, body);

  function draw() {
    ctx.setFab(() => (tab === 'hist' ? workoutSheet() : exerciseSheet()));
    body.replaceChildren(tab === 'hist' ? history() : library());
  }
  ctx.onData(draw);
  draw();
}

function history() {
  const list = db.all('workout').sort((a, b) =>
    (b.data.date || '').localeCompare(a.data.date || '') || b.created_at.localeCompare(a.created_at));
  if (!list.length) return empty('Crée ton premier entraînement', 'Touche + pour enregistrer une séance.');
  return h('div', {}, list.map((w) => {
    const exs = w.data.exercises || [];
    const sets = exs.reduce((n, e) => n + (e.sets || []).length, 0);
    return row(w.data.name || 'Sans titre',
      `${fmtDate(w.data.date)} · ${plur(exs.length, 'exercice')} · ${plur(sets, 'série')}`,
      null, () => workoutSheet(w));
  }));
}

function lastPerformance(name) {
  const key = name.toLowerCase();
  const ws = db.all('workout').sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  for (const w of ws) {
    const ex = (w.data.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex && ex.sets && ex.sets.length) {
      const s = ex.sets[ex.sets.length - 1];
      const parts = [];
      if (s.reps) parts.push(s.reps + ' reps');
      if (s.weight) parts.push(s.weight + ' kg');
      if (parts.length) return 'Dernière série : ' + parts.join(' × ');
    }
  }
  return '';
}

function library() {
  const list = db.all('exercise').sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));
  if (!list.length) return empty('Ta liste d’exercices est vide', 'Touche + pour en ajouter. Les exercices utilisés dans un entraînement s’y ajoutent aussi.');
  return h('div', {}, list.map((e) => {
    const last = lastPerformance(e.data.name);
    return row(e.data.name, [e.data.muscle, last].filter(Boolean).join(' · '), null, () => exerciseSheet(e));
  }));
}

function exerciseSheet(existing) {
  sheet(existing ? 'Modifier l’exercice' : 'Nouvel exercice', (close) => {
    const name = h('input', { value: existing ? existing.data.name : '', placeholder: 'Développé couché' });
    const muscle = h('select', { value: existing ? existing.data.muscle : 'Pectoraux' }, MUSCLES.map((m) => h('option', { value: m }, m)));
    const err = h('p', { class: 'err' });
    return h('div', {},
      field('Nom', name), field('Groupe musculaire', muscle), err,
      h('div', { class: 'btnrow' },
        existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('Supprimer cet exercice de ta liste ? Ton historique n’est pas touché.')) return;
          try { await db.remove(existing.id); close(); } catch (e) { toast(errMsg(e)); }
        } }, 'Supprimer'),
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const n = name.value.trim();
          if (!n) { err.textContent = 'Donne un nom à l’exercice.'; return; }
          try {
            const data = { name: n, muscle: muscle.value };
            if (existing) await db.update(existing.id, data); else await db.add('exercise', data);
            close();
          } catch (e) { err.textContent = errMsg(e); }
        } }, 'Enregistrer')));
  });
}

function workoutSheet(existing) {
  const d = existing ? JSON.parse(JSON.stringify(existing.data)) : { name: '', date: today(), exercises: [] };
  d.exercises = d.exercises || [];
  sheet(existing ? 'Modifier l’entraînement' : 'Nouvel entraînement', (close) => {
    const err = h('p', { class: 'err' });
    const name = h('input', { value: d.name, placeholder: 'Pectoraux et triceps', oninput: () => { d.name = name.value; } });
    const date = h('input', { type: 'date', value: d.date, oninput: () => { d.date = date.value; } });
    const exBox = h('div');
    const listId = 'exlib-' + Date.now();
    const lib = h('datalist', { id: listId }, db.all('exercise').map((e) => h('option', { value: e.data.name })));
    const addName = h('input', { list: listId, placeholder: 'Ajouter un exercice…' });

    const addExercise = () => {
      const n = addName.value.trim();
      if (!n) return;
      d.exercises.push({ name: n, sets: [{ reps: '', weight: '' }] });
      addName.value = '';
      drawEx();
    };

    function drawEx() {
      exBox.replaceChildren(...d.exercises.map((ex, i) =>
        h('div', { class: 'exblock' },
          h('div', { class: 'exhead' },
            h('strong', {}, ex.name),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Retirer l’exercice', onclick: () => { d.exercises.splice(i, 1); drawEx(); } }, icon('trash'))),
          ex.sets.map((s, j) =>
            h('div', { class: 'setrow' },
              h('span', {}, String(j + 1)),
              h('input', { inputmode: 'numeric', placeholder: 'reps', value: s.reps, oninput: (e) => { s.reps = e.target.value; } }),
              h('span', {}, '×'),
              h('input', { inputmode: 'decimal', placeholder: 'kg', value: s.weight, oninput: (e) => { s.weight = e.target.value; } }),
              h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Retirer la série', onclick: () => { ex.sets.splice(j, 1); drawEx(); } }, icon('x')))),
          h('button', { class: 'link', type: 'button', onclick: () => {
            const l = ex.sets[ex.sets.length - 1] || { reps: '', weight: '' };
            ex.sets.push({ reps: l.reps, weight: l.weight });
            drawEx();
          } }, '+ Ajouter une série'))));
    }

    async function save() {
      const n = d.name.trim();
      if (!n) { err.textContent = 'Donne un nom à l’entraînement.'; return; }
      d.name = n;
      d.exercises.forEach((ex) => ex.sets.forEach((s) => { s.reps = String(num(s.reps) || ''); s.weight = String(num(s.weight) || ''); }));
      try {
        if (existing) await db.update(existing.id, d); else await db.add('workout', d);
        const known = new Set(db.all('exercise').map((e) => e.data.name.toLowerCase()));
        for (const ex of d.exercises) {
          if (!known.has(ex.name.toLowerCase())) {
            await db.add('exercise', { name: ex.name, muscle: 'Autre' });
            known.add(ex.name.toLowerCase());
          }
        }
        close();
      } catch (e) { err.textContent = errMsg(e); }
    }

    drawEx();
    return h('div', {},
      field('Nom', name), field('Date', date),
      h('h3', { class: 'sec' }, 'Exercices'),
      exBox,
      h('div', { class: 'addrow' }, addName, h('button', { class: 'btn', type: 'button', onclick: addExercise }, icon('plus'), 'Ajouter'), lib),
      err,
      h('div', { class: 'btnrow' },
        existing && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('Supprimer cet entraînement ?')) return;
          try { await db.remove(existing.id); close(); } catch (e) { toast(errMsg(e)); }
        } }, 'Supprimer'),
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Enregistrer')));
  });
}

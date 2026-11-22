import * as db from './db.js';
import { h, icon, seg, sheet, field, row, empty, today, fmtDate, longDate, toast, num, plur, errMsg } from './ui.js';

export const meta = { label: 'Entraînements', icon: 'barbell' };

const DAYS = [
  { idx: 1, label: 'Lundi' },
  { idx: 2, label: 'Mardi' },
  { idx: 3, label: 'Mercredi' },
  { idx: 4, label: 'Jeudi' },
  { idx: 5, label: 'Vendredi' },
  { idx: 6, label: 'Samedi' },
  { idx: 0, label: 'Dimanche' },
];

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

function getPlan() {
  const row = db.all('plan')[0];
  return { row, days: (row && row.data && row.data.days) || {} };
}

async function savePlan(days) {
  const { row } = getPlan();
  if (row) return db.update(row.id, { days });
  return db.add('plan', { days });
}

export function render(ctx) {
  ctx.setHead(meta.label, longDate());
  ctx.setActions([
    h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Plan de la semaine',
      onclick: () => weekPlanSheet(),
    }, icon('calendar-repeat')),
  ]);
  ctx.setFab(() => workoutSheet());

  const body = h('div');
  ctx.main.append(body);

  function draw() {
    const now = today();
    const dow = new Date().getDay();
    const todayInfo = DAYS.find((d) => d.idx === dow);
    const { days } = getPlan();
    const todayRoutine = days[String(dow)];
    const hasActivePlan = Object.values(days).some((d) => d && d.name);

    const allWorkouts = db.all('workout');
    const upcoming = allWorkouts
      .filter((w) => w.data.planned || (w.data.date || '') > now)
      .sort((a, b) => (a.data.date || '').localeCompare(b.data.date || '') || a.created_at.localeCompare(b.created_at));

    const historyList = allWorkouts
      .filter((w) => !w.data.planned && (w.data.date || '') <= now)
      .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.created_at.localeCompare(a.created_at));

    const sections = [];

    // 1. Carte du plan hebdomadaire (séance du jour ou invitation à créer le plan)
    if (todayRoutine && todayRoutine.name) {
      const exCount = (todayRoutine.exercises || []).length;
      sections.push(
        h('div', {
          class: 'card row tap',
          style: { display: 'block', marginTop: '6px' },
          onclick: () => startFromTemplate(todayRoutine),
        },
          h('div', { class: 'lbl' },
            h('span', { class: 'pos', style: { fontWeight: 600 } }, `Programme · ${todayInfo.label}`),
            h('button', {
              class: 'link',
              type: 'button',
              style: { padding: 0, fontSize: '12px' },
              onclick: (e) => { e.stopPropagation(); weekPlanSheet(); },
            }, 'Modifier la semaine')),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '6px' } },
            h('div', { class: 'grow' },
              h('div', { style: { fontSize: '18px', fontWeight: 600 } }, todayRoutine.name),
              h('div', { class: 's' }, exCount ? plur(exCount, 'exercice') : 'Séance libre')),
            h('span', { class: 'pill', style: { display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--text)', color: 'var(--bg)' } },
              icon('player-play'), 'Démarrer')))
      );
    } else if (hasActivePlan) {
      sections.push(
        h('div', {
          class: 'card row tap',
          style: { display: 'block', marginTop: '6px' },
          onclick: () => weekPlanSheet(),
        },
          h('div', { class: 'lbl' },
            h('span', {}, `Programme · ${todayInfo.label}`),
            h('span', { class: 'pos' }, 'Voir la semaine')),
          h('div', { style: { fontSize: '16px', fontWeight: 500, marginTop: '4px' } }, 'Jour de repos prévu'))
      );
    } else {
      sections.push(
        h('div', {
          class: 'card row tap',
          style: { display: 'block', marginTop: '6px' },
          onclick: () => weekPlanSheet(),
        },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
            h('div', { class: 'grow' },
              h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'Plan d’entraînement hebdomadaire'),
              h('div', { class: 's' }, 'Organise tes jours de la semaine, ils recommencent chaque semaine.')),
            icon('chevron-right')))
      );
    }

    // 2. Entraînements prévus pour plus tard
    if (upcoming.length) {
      sections.push(
        h('div', {},
          h('h3', { class: 'sec' }, 'À venir'),
          upcoming.map((w) => {
            const exs = w.data.exercises || [];
            const startBtn = h('button', {
              class: 'pill',
              type: 'button',
              onclick: (e) => {
                e.stopPropagation();
                workoutSheet(w, { startNow: true });
              },
            }, 'Démarrer');
            return row(
              w.data.name || 'Sans titre',
              `${fmtDate(w.data.date)} · ${plur(exs.length, 'exercice')}`,
              startBtn,
              () => workoutSheet(w)
            );
          }))
      );
    }

    // 3. Historique des entraînements
    if (historyList.length) {
      sections.push(
        h('div', {},
          h('h3', { class: 'sec' }, 'Historique'),
          historyList.map((w) => {
            const exs = w.data.exercises || [];
            const sets = exs.reduce((n, e) => n + (e.sets || []).length, 0);
            return row(
              w.data.name || 'Sans titre',
              `${fmtDate(w.data.date)} · ${plur(exs.length, 'exercice')} · ${plur(sets, 'série')}`,
              null,
              () => workoutSheet(w)
            );
          }))
      );
    } else if (!upcoming.length) {
      sections.push(empty('Aucun entraînement', 'Touche + pour enregistrer une séance ou en prévoir une pour plus tard.'));
    }

    body.replaceChildren(...sections);
  }

  ctx.onData(draw);
  draw();
}

function startFromTemplate(routine) {
  const prefilled = {
    name: routine.name,
    date: today(),
    planned: false,
    exercises: (routine.exercises || []).map((ex) => {
      const lastSets = lastExerciseSets(ex.name);
      return {
        name: ex.name,
        sets: lastSets || (ex.sets && ex.sets.length ? JSON.parse(JSON.stringify(ex.sets)) : [{ reps: '', weight: '' }]),
      };
    }),
  };
  workoutSheet(null, { initialData: prefilled });
}

function lastPerformance(name) {
  const key = name.toLowerCase();
  const ws = db.all('workout')
    .filter((w) => !w.data.planned)
    .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  for (const w of ws) {
    const ex = (w.data.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex && ex.sets && ex.sets.length) {
      const s = ex.sets[ex.sets.length - 1];
      const parts = [];
      if (s.reps) parts.push(s.reps + ' reps');
      if (s.weight) parts.push(s.weight + ' kg');
      if (parts.length) return 'Dernier : ' + parts.join(' × ');
    }
  }
  return '';
}

function lastExerciseSets(name) {
  const key = name.toLowerCase();
  const ws = db.all('workout')
    .filter((w) => !w.data.planned)
    .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  for (const w of ws) {
    const ex = (w.data.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex && ex.sets && ex.sets.length) {
      return ex.sets.map((s) => ({ reps: s.reps || '', weight: s.weight || '' }));
    }
  }
  return null;
}

function buildExercisePicker(onSelect) {
  const searchIn = h('input', {
    placeholder: 'Rechercher ou créer un exercice…',
    oninput: () => drawList(),
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTyped();
      }
    },
  });
  const listBox = h('div', {
    style: {
      maxHeight: '190px',
      overflowY: 'auto',
      background: 'var(--card)',
      borderRadius: '12px',
      marginTop: '8px',
      padding: '0 12px',
    },
  });

  const addTyped = () => {
    const val = searchIn.value.trim();
    if (!val) return;
    onSelect(val);
    searchIn.value = '';
    drawList();
  };

  function drawList() {
    const q = searchIn.value.trim().toLowerCase();
    const saved = db.all('exercise')
      .filter((e) => !q || e.data.name.toLowerCase().includes(q))
      .sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));

    const items = [];
    const exactMatch = saved.some((e) => e.data.name.toLowerCase() === q);

    if (q && !exactMatch) {
      items.push(
        h('div', {
          class: 'row tap',
          style: { padding: '11px 0' },
          onclick: addTyped,
        },
          h('div', { class: 'grow' },
            h('div', { class: 't pos' }, `+ Créer « ${searchIn.value.trim()} »`)),
          icon('plus'))
      );
    }

    if (!saved.length && !q) {
      items.push(
        h('div', { class: 's', style: { padding: '12px 0', textAlign: 'center' } },
          'Aucun exercice enregistré. Écris un nom ci-dessus pour l’ajouter.')
      );
    } else {
      saved.forEach((ex) => {
        const last = lastPerformance(ex.data.name);
        const delBtn = h('button', {
          class: 'icon-btn sm',
          type: 'button',
          'aria-label': 'Supprimer de la liste',
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm(`Retirer « ${ex.data.name} » de ta liste d’exercices ?`)) return;
            try {
              await db.remove(ex.id);
              drawList();
            } catch (err) {
              toast(errMsg(err));
            }
          },
        }, icon('trash'));

        items.push(
          h('div', {
            class: 'row tap',

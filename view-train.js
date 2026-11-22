import * as db from './db.js';
import { h, icon, sheet, field, row, empty, today, fmtDate, longDate, toast, num, plur, errMsg } from './ui.js';

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

function getPlan() {
  const plans = db.all('plan');
  const planRow = plans.length ? plans[0] : null;
  return { row: planRow, days: (planRow && planRow.data && planRow.data.days) || {} };
}

async function savePlan(days) {
  const { row: planRow } = getPlan();
  if (planRow) return db.update(planRow.id, { days });
  return db.add('plan', { days });
}

export function render(ctx) {
  ctx.setHead(meta.label, longDate());
  ctx.setActions([
    h('button', {
      class: 'pill',
      type: 'button',
      style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '8px' },
      onclick: () => weekPlanSheet(),
    }, icon('calendar-repeat'), 'Plan semaine'),
  ]);
  ctx.setFab(() => workoutSheet());

  const body = h('div');
  ctx.main.append(body);

  function draw() {
    try {
      const now = today();
      const dow = new Date().getDay();
      const todayInfo = DAYS.find((d) => d.idx === dow);
      const { days } = getPlan();
      const todayRoutine = days[String(dow)];

      const allWorkouts = db.all('workout');
      const upcoming = allWorkouts
        .filter((w) => (w.data.date || '') > now)
        .sort((a, b) => (a.data.date || '').localeCompare(b.data.date || '') || (a.created_at || '').localeCompare(b.created_at || ''));

      const historyList = allWorkouts
        .filter((w) => (w.data.date || '') <= now)
        .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));

      const sections = [];

      if (todayRoutine && todayRoutine.name) {
        const exCount = (todayRoutine.exercises || []).length;
        sections.push(
          h('div', {
            class: 'card row tap',
            style: { display: 'block', marginTop: '6px' },
            onclick: () => startFromTemplate(todayRoutine),
          },
            h('div', { class: 'lbl' },
              h('span', { class: 'pos', style: { fontWeight: 600 } }, `Programme · ${todayInfo.label}`)),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '6px' } },
              h('div', { class: 'grow' },
                h('div', { style: { fontSize: '18px', fontWeight: 600 } }, todayRoutine.name),
                h('div', { class: 's' }, exCount ? plur(exCount, 'exercice') : 'Séance libre')),
              h('span', { class: 'pill', style: { display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--text)', color: 'var(--bg)' } },
                icon('player-play'), 'Démarrer')))
        );
      }

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
        sections.push(empty('Aucun entraînement', 'Touche + pour enregistrer une séance ou choisis une date future pour la prévoir.'));
      }

      body.replaceChildren(...sections);
    } catch (err) {
      body.replaceChildren(h('p', { class: 'err' }, 'Erreur affichage : ' + (err && err.message ? err.message : String(err))));
    }
  }

  ctx.onData(draw);
  draw();
}

function startFromTemplate(routine) {
  const prefilled = {
    name: routine.name,
    date: today(),
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
  const now = today();
  const ws = db.all('workout')
    .filter((w) => (w.data.date || '') <= now)
    .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  for (const w of ws) {
    const ex = (w.data.exercises || []).find((e) => e.name.toLowerCase() === key);
    if (ex && ex.sets && ex.sets.length) {
      const s = ex.sets[ex.sets.length - 1];
      const parts = [];
      if (s && s.reps) parts.push(s.reps + ' reps');
      if (s && s.weight) parts.push(s.weight + ' kg');
      if (parts.length) return 'Dernier : ' + parts.join(' × ');
    }
  }
  return '';
}

function lastExerciseSets(name) {
  const key = name.toLowerCase();
  const now = today();
  const ws = db.all('workout')
    .filter((w) => (w.data.date || '') <= now)
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
            style: { padding: '10px 0' },
            onclick: () => {
              onSelect(ex.data.name);
              searchIn.value = '';
              drawList();
            },
          },
            h('div', { class: 'grow' },
              h('div', { class: 't' }, ex.data.name),
              last ? h('div', { class: 's' }, last) : null),
            h('span', { class: 'pos', style: { fontSize: '13px', fontWeight: 500 } }, '+ Ajouter'),
            delBtn)
        );
      });
    }

    listBox.replaceChildren(...items);
  }

  drawList();
  return h('div', { style: { marginTop: '10px' } },
    h('div', { class: 'addrow' },
      searchIn,
      h('button', { class: 'btn', type: 'button', onclick: addTyped }, icon('plus'), 'Ajouter')),
    listBox);
}

async function ensureExercisesInLibrary(exercises) {
  const known = new Set(db.all('exercise').map((e) => e.data.name.toLowerCase()));
  for (const ex of exercises) {
    if (!known.has(ex.name.toLowerCase())) {
      await db.add('exercise', { name: ex.name, muscle: 'Autre' });
      known.add(ex.name.toLowerCase());
    }
  }
}

function workoutSheet(existing, opts = {}) {
  const now = today();
  let d;

  if (opts.initialData) {
    d = JSON.parse(JSON.stringify(opts.initialData));
  } else if (existing) {
      d = JSON.parse(JSON.stringify(existing.data));
if (opts.startNow) {
d.date = now;
}
} else {
d = { name: '', date: now, exercises: [] };
}
d.exercises = d.exercises || [];
const title = opts.startNow
? 'Démarrer la séance'
: existing
? 'Modifier l’entraînement'
: 'Nouvel entraînement';
sheet(title, (close) => {
const err = h('p', { class: 'err' });
const name = h('input', {
value: d.name,
placeholder: 'Pectoraux et triceps',
oninput: () => { d.name = name.value; },
});
const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: save },
(d.date || now) > today() ? 'Planifier' : 'Enregistrer');
const date = h('input', {
type: 'date',
value: d.date,
oninput: () => {
d.date = date.value;
saveBtn.textContent = d.date > today() ? 'Planifier' : 'Enregistrer';
},
});
const exBox = h('div');
const picker = buildExercisePicker((exName) => {
const prev = lastExerciseSets(exName);
d.exercises.push({
name: exName,
sets: prev || [{ reps: '', weight: '' }],
});
drawEx();
});
function drawEx() {
exBox.replaceChildren(...d.exercises.map((ex, i) =>
h('div', { class: 'exblock' },
h('div', { class: 'exhead' },
h('strong', {}, ex.name),
h('button', {
class: 'icon-btn sm',
type: 'button',
'aria-label': 'Retirer l’exercice',
onclick: () => { d.exercises.splice(i, 1); drawEx(); },
}, icon('trash'))),
ex.sets.map((s, j) =>
h('div', { class: 'setrow' },
h('span', {}, String(j + 1)),
h('input', { inputmode: 'numeric', placeholder: 'reps', value: s.reps, oninput: (e) => { s.reps = e.target.value; } }),
h('span', {}, '×'),
h('input', { inputmode: 'decimal', placeholder: 'kg', value: s.weight, oninput: (e) => { s.weight = e.target.value; } }),
h('button', {
class: 'icon-btn sm',
type: 'button',
'aria-label': 'Retirer la série',
onclick: () => { ex.sets.splice(j, 1); drawEx(); },
}, icon('x')))),
h('button', {
class: 'link',
type: 'button',
onclick: () => {
const l = ex.sets.length ? ex.sets[ex.sets.length - 1] : { reps: '', weight: '' };
ex.sets.push({ reps: l.reps, weight: l.weight });
drawEx();
},
}, '+ Ajouter une série'))));
}
async function save() {
const n = d.name.trim();
if (!n) { err.textContent = 'Donne un nom à l’entraînement.'; return; }
if (!date.value) { err.textContent = 'Choisis une date.'; return; }
d.name = n;
d.date = date.value;
delete d.planned;
d.exercises.forEach((ex) =>
ex.sets.forEach((s) => {
s.reps = String(num(s.reps) || '');
s.weight = String(num(s.weight) || '');
})
);
try {
if (existing) await db.update(existing.id, d);
else await db.add('workout', d);
await ensureExercisesInLibrary(d.exercises);
close();
} catch (e) {
err.textContent = errMsg(e);
}
}
drawEx();
return h('div', {},
field('Nom', name),
field('Date', date),
h('h3', { class: 'sec' }, 'Exercices de la séance'),
exBox,
h('h3', { class: 'sec' }, 'Choisir un exercice'),
picker,
err,
h('div', { class: 'btnrow' },
existing && h('button', {
class: 'btn danger',
type: 'button',
onclick: async () => {
if (!confirm('Supprimer cet entraînement ?')) return;
try {
await db.remove(existing.id);
close();
} catch (e) {
toast(errMsg(e));
}
},
}, 'Supprimer'),
saveBtn));
});
}
function weekPlanSheet() {
sheet('Plan de la semaine', (close) => {
const body = h('div');
function drawDays() {
const { days } = getPlan();
body.replaceChildren(
h('p', { class: 'hint', style: { marginTop: '4px' } },
'Configure tes journées types. Ce programme recommence automatiquement chaque semaine.'),
...DAYS.map((day) => {
const item = days[String(day.idx)];
const exCount = item && item.exercises ? item.exercises.length : 0;
return row(
day.label,
item && item.name
? ${item.name} · ${plur(exCount, 'exercice')}
: 'Repos / Libre',
icon('chevron-right'),
() => dayPlanSheet(day, drawDays)
);
}),
h('div', { class: 'btnrow' },
h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Terminer'))
);
}
drawDays();
return body;
});
}
function dayPlanSheet(day, onSaved) {
const { days } = getPlan();
const existing = days[String(day.idx)];
const d = existing
? JSON.parse(JSON.stringify(existing))
: { name: '', exercises: [] };
d.exercises = d.exercises || [];
sheet(Programme · ${day.label}, (close) => {
const err = h('p', { class: 'err' });
const name = h('input', {
value: d.name,
placeholder: 'Ex. Pectoraux / Triceps, Jambes…',
oninput: () => { d.name = name.value; },
});
const exBox = h('div');
const picker = buildExercisePicker((exName) => {
d.exercises.push({
name: exName,
sets: [{ reps: '', weight: '' }],
});
drawEx();
});
function drawEx() {
exBox.replaceChildren(...d.exercises.map((ex, i) =>
h('div', { class: 'exblock' },
h('div', { class: 'exhead' },
h('strong', {}, ex.name),
h('button', {
class: 'icon-btn sm',
type: 'button',
'aria-label': 'Retirer l’exercice',
onclick: () => { d.exercises.splice(i, 1); drawEx(); },
}, icon('trash'))),
ex.sets.map((s, j) =>
h('div', { class: 'setrow' },
h('span', {}, String(j + 1)),
h('input', { inputmode: 'numeric', placeholder: 'reps', value: s.reps, oninput: (e) => { s.reps = e.target.value; } }),
h('span', {}, '×'),
h('input', { inputmode: 'decimal', placeholder: 'kg', value: s.weight, oninput: (e) => { s.weight = e.target.value; } }),
h('button', {
class: 'icon-btn sm',
type: 'button',
'aria-label': 'Retirer la série',
onclick: () => { ex.sets.splice(j, 1); drawEx(); },
}, icon('x')))),
h('button', {
class: 'link',
type: 'button',
onclick: () => {
const l = ex.sets.length ? ex.sets[ex.sets.length - 1] : { reps: '', weight: '' };
ex.sets.push({ reps: l.reps, weight: l.weight });
drawEx();
},
}, '+ Ajouter une série'))));
}
async function saveDay() {
const fallbackName = d.exercises.length ? d.exercises[0].name : '';
const n = d.name.trim() || fallbackName;
d.name = n;
d.exercises.forEach((ex) =>
ex.sets.forEach((s) => {
s.reps = String(num(s.reps) || '');
s.weight = String(num(s.weight) || '');
})
);
try {
const nextDays = { ...getPlan().days };
if (!d.name) delete nextDays[String(day.idx)];
else nextDays[String(day.idx)] = d;
await savePlan(nextDays);
await ensureExercisesInLibrary(d.exercises);
toast('Programme enregistré');
if (onSaved) onSaved();
close();
} catch (e) {
err.textContent = errMsg(e);
}
}
drawEx();
return h('div', {},
field('Nom de la séance', name),
h('h3', { class: 'sec' }, 'Exercices prévus'),
exBox,
h('h3', { class: 'sec' }, 'Ajouter depuis mes exercices'),
picker,
err,
h('div', { class: 'btnrow' },
existing && h('button', {
class: 'btn danger',
type: 'button',
onclick: async () => {
try {
const nextDays = { ...getPlan().days };
delete nextDays[String(day.idx)];
await savePlan(nextDays);
toast('Jour mis en repos');
if (onSaved) onSaved();
close();
} catch (e) {
toast(errMsg(e));
}
},
}, 'Jour de repos'),
h('button', { class: 'btn primary', type: 'button', onclick: saveDay }, 'Enregistrer')));
});
}
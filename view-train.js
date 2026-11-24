
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
  const plans = db.all('plan').sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const row = plans.find(p => p.data.active !== false) || null;
  return { row, days: row?.data.days || {}, name: row?.data.name || 'Mon plan' };
}
async function savePlan(days, name) {
  const { row } = getPlan();
  if (row) return db.update(row.id, { ...row.data, name: name || row.data.name || 'Mon plan', days, active: true });
  return db.add('plan', { name: name || 'Mon plan', days, active: true });
}
function addMenu() {
  sheet('Ajouter', close => h('div', { class: 'notes-options' },
    h('button', { class: 'notes-option-row', onclick: () => { close(); workoutSheet(); } },
      icon('barbell'), 'Nouvel entraînement'),
    h('button', { class: 'notes-option-row', onclick: () => { close(); weekPlanSheet(); } },
      icon('calendar-repeat'), 'Nouveau plan d’entraînement')
  ));
}

const isCompleted = w => w.data.status === 'completed' || (!w.data.status && (w.data.date || '') <= today());
const isPending = w => w.data.status === 'planned' || (!w.data.status && (w.data.date || '') > today());
let cleaningExpired = false;
async function cleanupExpired() {
  if (cleaningExpired) return;
  const expired = db.all('workout').filter(w => w.data.status === 'planned' && w.data.date < today());
  if (!expired.length) return;
  cleaningExpired = true;
  try { for (const w of expired) await db.remove(w.id); }
  catch (e) { console.warn('Nettoyage des séances expirées impossible', e); }
  finally { cleaningExpired = false; }
}
export function render(ctx) {
  ctx.setHead(meta.label, longDate());

  ctx.setActions([]);
  ctx.setFab(addMenu);

  const body = h('div');
  ctx.main.append(body);

  function draw() {
    try {
      const now = today();
      const dow = new Date().getDay();
      const todayInfo = DAYS.find((d) => d.idx === dow);
      const { row: activePlan, days, name: planName } = getPlan();
      const todayRoutine = days[String(dow)];

      const allWorkouts = db.all('workout');

      const upcoming = allWorkouts.filter(w => isPending(w) && w.data.date >= now)
        .sort((a,b) => a.data.date.localeCompare(b.data.date));
      const historyList = allWorkouts.filter(isCompleted)
        .sort((a,b) => (b.data.date || '').localeCompare(a.data.date || ''));
      const sections = [];

      if (activePlan) {
        sections.push(h('div', { class: 'card row tap', onclick: weekPlanSheet },
          h('div', { class: 'grow' }, h('div', { class: 't' }, planName),
            h('div', { class: 's' }, 'Plan actif · Répété chaque semaine')),
          icon('chevron-right')));
      }

      if (todayRoutine && (todayRoutine.exercises || []).length) {
        const exCount = (todayRoutine.exercises || []).length;

        sections.push(
          h('div', {
            class: 'card row tap',
            style: { display: 'block', marginTop: '6px' },
            onclick: () => startFromTemplate(todayRoutine),
          },
            h('div', { class: 'lbl' },
              h('span', {
                class: 'pos',
                style: { fontWeight: 600 },
              }, `Programme · ${todayInfo.label}`)
            ),
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                marginTop: '6px',
              },
            },
              h('div', { class: 'grow' },
                h('div', {
                  style: { fontSize: '18px', fontWeight: 600 },
                }, todayInfo.label),
                h('div', { class: 's' },
                  exCount ? plur(exCount, 'exercice') : 'Séance libre')
              ),
              h('span', {
                class: 'pill',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'var(--text)',
                  color: 'var(--bg)',
                },
              }, icon('player-play'), 'Démarrer')
            )
          )
        );
      }

      if (upcoming.length) {
        sections.unshift(h('div', {},
          h('h3', { class: 'sec' }, 'Entraînements à faire'),
          upcoming.map(w => row(
            w.data.name || 'Sans titre',
            fmtDate(w.data.date) + ' · ' + plur((w.data.exercises || []).length, 'exercice'),
            h('button', { class: 'pill', type: 'button',
              onclick: e => { e.stopPropagation(); workoutSheet(w, { startNow: true }); }
            }, 'Démarrer'),
            () => workoutSheet(w)
          ))
        ));
      }

      if (historyList.length) {
        sections.push(
          h('div', {},
            h('h3', { class: 'sec' }, 'Historique'),
            historyList.map((w) => {
              const exs = w.data.exercises || [];
              const sets = exs.reduce(
                (n, e) => n + (e.sets || []).length,
                0
              );

              return row(
                w.data.name || 'Sans titre',
                `${fmtDate(w.data.date)} · ${plur(exs.length, 'exercice')} · ${plur(sets, 'série')}`,
                null,
                () => workoutSheet(w)
              );
            })
          )
        );
      } else if (!upcoming.length && !activePlan) {
        sections.push(
          empty(
            'Aucun entraînement',
            'Touche + pour préparer un entraînement. Il ira dans l’historique une fois terminé.'
          )
        );
      }

      body.replaceChildren(...sections);
    } catch (err) {
      body.replaceChildren(
        h('p', {
          class: 'err',
        }, 'Erreur affichage : ' + (
          err && err.message ? err.message : String(err)
        ))
      );
    }
  }

  ctx.onData(draw);
  draw();
  cleanupExpired();
}

function startFromTemplate(routine) {
  const prefilled = {
    name: DAYS.find(d => d.idx === new Date().getDay())?.label || 'Séance',
    date: today(),
    exercises: (routine.exercises || []).map((ex) => {
      const lastSets = lastExerciseSets(ex.name);

      return {
        name: ex.name,
        sets: lastSets || (
          ex.sets && ex.sets.length
            ? JSON.parse(JSON.stringify(ex.sets))
            : [{ reps: '', weight: '' }]
        ),
      };
    }),
  };

  workoutSheet(null, { initialData: prefilled });
}

function lastPerformance(name) {
  const key = name.toLowerCase();
  const now = today();

  const ws = db.all('workout')
    .filter((w) => isCompleted(w) && (w.data.date || '') <= now)
    .sort((a, b) =>
      (b.data.date || '').localeCompare(a.data.date || '')
    );

  for (const w of ws) {
    const ex = (w.data.exercises || []).find(
      (e) => e.name.toLowerCase() === key
    );

    if (ex && ex.sets && ex.sets.length) {
      const s = ex.sets.at(-1);
      const parts = [];

      if (s && s.reps) parts.push(s.reps + ' reps');
      if (s && s.weight) parts.push(s.weight + ' kg');

      if (parts.length) {
        return 'Dernier : ' + parts.join(' × ');
      }
    }
  }

  return '';
}

function lastExerciseSets(name) {
  const key = name.toLowerCase();
  const now = today();

  const ws = db.all('workout')
    .filter((w) => isCompleted(w) && (w.data.date || '') <= now)
    .sort((a, b) =>
      (b.data.date || '').localeCompare(a.data.date || '')
    );

  for (const w of ws) {
    const ex = (w.data.exercises || []).find(
      (e) => e.name.toLowerCase() === key
    );

    if (ex && ex.sets && ex.sets.length) {
      return ex.sets.map((s) => ({
        reps: s.reps || '',
        weight: s.weight || '',
      }));
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
      .filter((e) =>
        !q || e.data.name.toLowerCase().includes(q)
      )
      .sort((a, b) =>
        a.data.name.localeCompare(b.data.name, 'fr')
      );

    const items = [];

    const exactMatch = saved.some(
      (e) => e.data.name.toLowerCase() === q
    );

    if (q && !exactMatch) {
      items.push(
        h('div', {
          class: 'row tap',
          style: { padding: '11px 0' },
          onclick: addTyped,
        },
          h('div', { class: 'grow' },
            h('div', { class: 't pos' },
              `+ Créer « ${searchIn.value.trim()} »`
            )
          ),
          icon('plus')
        )
      );
    }

    if (!saved.length && !q) {
      items.push(
        h('div', {
          class: 's',
          style: {
            padding: '12px 0',
            textAlign: 'center',
          },
        }, 'Aucun exercice enregistré. Écris un nom ci-dessus pour l’ajouter.')
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

            if (!confirm(
              `Retirer « ${ex.data.name} » de ta liste d’exercices ?`
            )) return;

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
              last ? h('div', { class: 's' }, last) : null
            ),
            h('span', {
              class: 'pos',
              style: {
                fontSize: '13px',
                fontWeight: 500,
              },
            }, '+ Ajouter'),
            delBtn
          )
        );
      });
    }

    listBox.replaceChildren(...items);
  }

  drawList();

  return h('div', {
    style: { marginTop: '10px' },
  },
    h('div', { class: 'addrow' },
      searchIn,
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: addTyped,
      }, icon('plus'), 'Ajouter')
    ),
    listBox
  );
}

async function ensureExercisesInLibrary(exercises) {
  const known = new Set(
    db.all('exercise').map((e) => e.data.name.toLowerCase())
  );

  for (const ex of exercises) {
    if (!known.has(ex.name.toLowerCase())) {
      await db.add('exercise', {
        name: ex.name,
        muscle: 'Autre',
      });

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
    d = {
      name: '',
      date: now,
      exercises: [],
    };
  }

  d.exercises = d.exercises || [];
  if (!existing) d.status = 'planned';

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
      oninput: () => {
        d.name = name.value;
      },
    });

    const saveBtn = h('button', {
      class: 'btn primary',
      type: 'button',
      onclick: save,
    }, 'Enregistrer pour plus tard');

    const date = h('input', {
      type: 'date',
      value: d.date,
      oninput: () => {
        d.date = date.value;
        saveBtn.textContent = 'Enregistrer pour plus tard';
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
      exBox.replaceChildren(
        ...d.exercises.map((ex, i) =>
          h('div', { class: 'exblock' },
            h('div', { class: 'exhead' },
              h('strong', {}, ex.name),
              h('button', {
                class: 'icon-btn sm',
                type: 'button',
                'aria-label': 'Retirer l’exercice',
                onclick: () => {
                  d.exercises.splice(i, 1);
                  drawEx();
                },
              }, icon('trash'))
            ),
            ex.sets.map((s, j) =>
              h('div', { class: 'setrow' },
                h('span', {}, String(j + 1)),
                h('input', {
                  inputmode: 'numeric',
                  placeholder: 'reps',
                  value: s.reps,
                  oninput: (e) => {
                    s.reps = e.target.value;
                  },
                }),
                h('span', {}, '×'),
                h('input', {
                  inputmode: 'decimal',
                  placeholder: 'kg',
                  value: s.weight,
                  oninput: (e) => {
                    s.weight = e.target.value;
                  },
                }),
                h('button', {
                  class: 'icon-btn sm',
                  type: 'button',
                  'aria-label': 'Retirer la série',
                  onclick: () => {
                    ex.sets.splice(j, 1);
                    drawEx();
                  },
                }, icon('x'))
              )
            ),
            h('button', {
              class: 'link',
              type: 'button',
              onclick: () => {
                const l = ex.sets.at(-1) || {
                  reps: '',
                  weight: '',
                };

                ex.sets.push({
                  reps: l.reps,
                  weight: l.weight,
                });

                drawEx();
              },
            }, '+ Ajouter une série')
          )
        )
      );
    }

    async function save() {
      const n = d.name.trim();

      if (!n) {
        err.textContent = 'Donne un nom à l’entraînement.';
        return;
      }

      if (!date.value) {
        err.textContent = 'Choisis une date.';
        return;
      }

      d.name = n;
      d.date = date.value;
      delete d.planned;
      if (!isCompleted({ data: d })) d.status = 'planned';

      d.exercises.forEach((ex) =>
        ex.sets.forEach((s) => {
          s.reps = String(num(s.reps) || '');
          s.weight = String(num(s.weight) || '');
        })
      );

      if (d.status === 'planned' && d.date < today()) {
        err.textContent = 'Choisis aujourd’hui ou une date future.';
        return;
      }
      try {
        if (existing) {
          await db.update(existing.id, d);
        } else {
          await db.add('workout', d);
        }

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
        (!existing || !isCompleted(existing)) && h('button', {
          class: 'btn primary', type: 'button', onclick: async () => {
            if (!d.name.trim()) { err.textContent = 'Donne un nom à l’entraînement.'; return; }
            d.name = d.name.trim();
            d.date = opts.startNow ? today() : date.value;
            d.status = 'completed';
            d.completedAt = new Date().toISOString();
            try {
              if (existing) await db.update(existing.id, d);
              else await db.add('workout', d);
              await ensureExercisesInLibrary(d.exercises);
              close();
              toast('Entraînement terminé et ajouté à l’historique');
            } catch (e) { err.textContent = errMsg(e); }
          }
        }, 'Terminer l’entraînement'),
        saveBtn
      )
    );
  });
}

function weekPlanSheet() {
  const currentPlan = getPlan();
  const editing = !!currentPlan.row;
  const planName = h('input', {
    value: editing ? currentPlan.name : '',
    placeholder: 'Nom du plan',
    oninput: () => { draftName = planName.value; }
  });
  let draftName = editing ? currentPlan.name : '';
  let draftDays = JSON.parse(JSON.stringify(editing ? currentPlan.days : {}));
  sheet(editing ? 'Plan d’entraînement' : 'Nouveau plan d’entraînement', close => {
    const body = h('div');
    const err = h('p', { class: 'err' });
    const drawDays = () => {
      body.replaceChildren(
        field('Nom du plan', planName),
        h('p', { class: 'hint' }, 'Ce plan se répète chaque semaine jusqu’à ce que tu y mettes fin. Choisis les jours où tu souhaites t’entraîner.'),
        ...DAYS.map(day => {
          const exercises = draftDays[String(day.idx)]?.exercises || [];
          return row(day.label,
            exercises.length ? plur(exercises.length, 'exercice') : 'Repos / Aucun exercice',
            icon('chevron-right'),
            () => dayPlanSheet(day, draftDays, drawDays));
        }),
        err,
        h('div', { class: 'btnrow' },
          editing ? h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Mettre fin à ce plan d’entraînement ? Les séances déjà enregistrées seront conservées.')) return;
            try {
              await db.update(currentPlan.row.id, { ...currentPlan.row.data, active: false, endedAt: new Date().toISOString() });
              toast('Plan terminé');
              close();
            } catch (e) { err.textContent = errMsg(e); }
          } }, 'Mettre fin au plan') : null,
          h('button', { class: 'btn primary', onclick: async () => {
            if (!draftName.trim()) { err.textContent = 'Donne un nom à ton plan.'; return; }
            try {
              await savePlan(draftDays, draftName.trim());
              await ensureExercisesInLibrary(Object.values(draftDays).flatMap(d => d.exercises || []));
              toast('Plan enregistré');
              close();
            } catch (e) { err.textContent = errMsg(e); }
          } }, editing ? 'Enregistrer les modifications' : 'Créer le plan')
        )
      );
    };
    drawDays();
    return body;
  });
}

function dayPlanSheet(day, draftDays, onSaved) {
  const exercises = JSON.parse(JSON.stringify(draftDays[String(day.idx)]?.exercises || []));
  sheet(day.label, close => {
    const err = h('p', { class: 'err' });
    const exBox = h('div');
    const picker = buildExercisePicker(name => {
      exercises.push({ name, sets: lastExerciseSets(name) || [{ reps: '', weight: '' }] });
      drawEx();
    });
    function drawEx() {
      exBox.replaceChildren(...exercises.map((ex, i) => h('div', { class: 'exblock' },
        h('div', { class: 'exhead' }, h('strong', {}, ex.name),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Retirer l’exercice',
            onclick: () => { exercises.splice(i, 1); drawEx(); } }, icon('trash'))),
        ...(ex.sets || []).map((set, j) => h('div', { class: 'setrow' },
          h('span', {}, String(j + 1)),
          h('input', { inputmode: 'numeric', placeholder: 'reps', value: set.reps || '',
            oninput: e => { set.reps = e.target.value; } }),
          h('span', {}, '×'),
          h('input', { inputmode: 'decimal', placeholder: 'kg', value: set.weight || '',
            oninput: e => { set.weight = e.target.value; } }),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Retirer la série',
            onclick: () => { ex.sets.splice(j, 1); drawEx(); } }, icon('x')))),
        h('button', { class: 'link', type: 'button', onclick: () => {
          const last = ex.sets?.at(-1) || { reps: '', weight: '' };
          (ex.sets ||= []).push({ ...last }); drawEx();
        } }, '+ Ajouter une série')
      )));
    }
    drawEx();
    return h('div', {},
      h('p', { class: 'hint' }, 'Ajoute les exercices prévus pour ' + day.label.toLowerCase() + '. Laisse vide pour un jour de repos.'),
      h('h3', { class: 'sec' }, 'Exercices prévus'),
      exBox,
      h('h3', { class: 'sec' }, 'Ajouter un exercice'),
      picker,
      err,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', onclick: () => {
          if (exercises.length) {
            draftDays[String(day.idx)] = { name: day.label, exercises };
          } else {
            delete draftDays[String(day.idx)];
          }
          onSaved();
          close();
        } }, 'Enregistrer ' + day.label)
      )
    );
  });
}

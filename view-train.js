
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

const CATALOG = [["Développé couché barre","Pectoraux","Triceps, deltoïdes antérieurs","Barre","Pieds au sol, omoplates serrées. Descends la barre vers la poitrine puis pousse.","press"],["Développé incliné haltères","Pectoraux","Triceps, épaules","Haltères","Sur banc incliné, descends les haltères de façon contrôlée puis pousse.","press"],["Écarté à la poulie","Pectoraux","Épaules","Poulie","Rapproche les mains devant la poitrine, coudes légèrement fléchis.","press"],["Tractions","Dos","Biceps","Barre fixe","Tire les coudes vers le bas et monte la poitrine vers la barre.","pull"],["Tirage vertical","Dos","Biceps","Poulie","Tire la barre vers le haut de la poitrine sans balancer le buste.","pull"],["Rowing haltère","Dos","Biceps, arrière des épaules","Haltère","Garde le dos neutre et tire le coude vers la hanche.","pull"],["Squat barre","Quadriceps","Fessiers, adducteurs","Barre","Descends en gardant les genoux dans l’axe des pieds puis remonte.","legs"],["Presse à cuisses","Quadriceps","Fessiers","Machine","Descends la plateforme sans décoller le bassin puis pousse.","legs"],["Extension des jambes","Quadriceps","—","Machine","Étends les genoux de façon contrôlée sans élan.","legs"],["Soulevé de terre roumain","Ischio-jambiers","Fessiers, dos","Barre","Recule les hanches, dos neutre, puis redresse-toi.","legs"],["Leg curl","Ischio-jambiers","Mollets","Machine","Fléchis les genoux sans soulever le bassin.","legs"],["Hip thrust","Fessiers","Ischio-jambiers","Barre","Pousse les hanches vers le haut sans cambrer le dos.","legs"],["Élévations latérales","Épaules","Trapèzes","Haltères","Monte les bras sur les côtés sans élan.","arms"],["Développé militaire","Épaules","Triceps","Haltères","Pousse au-dessus de la tête en gardant le tronc stable.","press"],["Curl biceps","Biceps","Avant-bras","Haltères","Fléchis les coudes en gardant les bras près du corps.","arms"],["Curl marteau","Biceps","Brachial, avant-bras","Haltères","Garde les paumes face à face et fléchis les coudes.","arms"],["Extension triceps poulie","Triceps","—","Poulie","Garde les coudes fixes et tends les avant-bras.","arms"],["Dips","Triceps","Pectoraux, épaules","Barres parallèles","Descends de façon contrôlée puis pousse.","press"],["Crunch machine","Abdominaux","Obliques","Machine","Enroule le buste en contractant les abdominaux.","core"],["Crunch à la poulie","Abdominaux","Obliques","Poulie","Enroule le tronc sans tirer avec les bras.","core"],["Mollets debout","Mollets","—","Machine","Monte sur la pointe des pieds puis redescends lentement.","legs"]];
function exerciseInfo(name) {
  return CATALOG.find(e => e[0].toLowerCase() === name.toLowerCase()) || [name, db.all('exercise').find(e=>e.data.name===name)?.data.muscle || 'Autre','—','Non précisé','Exercice personnalisé.','core'];
}
function muscleImage(ex) {
  const zones={press:'<path d="M18 24 L29 24 L29 35 L18 32Z M31 24 L42 24 L42 32 L31 35Z"/>',pull:'<path d="M18 24 L28 25 L28 43 L21 37Z M32 25 L42 24 L39 37 L32 43Z"/>',legs:'<path d="M21 48 L29 48 L27 70 L20 70Z M31 48 L39 48 L40 70 L33 70Z"/>',arms:'<path d="M12 26 L19 28 L15 44 L8 42Z M41 28 L48 26 L52 42 L45 44Z"/>',core:'<rect x="24" y="34" width="12" height="14" rx="3"/>'};
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 88"><g fill="#777"><circle cx="30" cy="10" r="7"/><path d="M23 19 L37 19 L44 25 L53 44 L48 48 L39 33 L38 48 L43 80 L35 82 L30 57 L25 82 L17 80 L22 48 L21 33 L12 48 L7 44 L16 25Z"/></g><g fill="#eee">'+(zones[ex[5]]||zones.core)+'</g></svg>';
  return h('img',{class:'train-muscle-img',src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),alt:'Schéma musculaire indicatif'});
}
function exerciseDetails(name,onSelect) {
  const ex=exerciseInfo(name);
  const sessions=db.all('workout').filter(isCompleted).flatMap(w=>(w.data.exercises||[]).filter(e=>e.name.toLowerCase()===name.toLowerCase()).map(e=>({date:w.data.date,sets:e.sets||[]})));
  const best=Math.max(0,...sessions.flatMap(w=>w.sets.map(s=>Number(s.weight)||0)));
  sheet(name,close=>h('div',{},
    h('div',{class:'train-info-hero'},muscleImage(ex)),
    field('Muscle principal',h('p',{},ex[1])),field('Muscles secondaires',h('p',{},ex[2])),field('Équipement',h('p',{},ex[3])),
    h('h3',{class:'sec'},'Exécution'),h('p',{},ex[4]),
    h('div',{class:'card'},h('strong',{},'Statistiques personnelles'),h('p',{},sessions.length+' séances · Record de charge : '+(best?best+' kg':'—')),h('p',{},lastPerformance(name)||'Aucun historique')),
    onSelect?h('button',{class:'btn primary',onclick:()=>{onSelect(name);close();}},'Ajouter à la séance'):null));
}
function openExercisePicker(onSelect, muscle) {
  sheet('Ajouter un exercice',close=>buildExercisePicker(name=>{onSelect(name);close();},muscle));
}
function buildExercisePicker(onSelect, initialMuscle='') {
  const searchIn=h('input',{placeholder:'Rechercher un exercice…',oninput:drawList});
  const filter=h('select',{onchange:drawList},h('option',{value:''},'Tous les muscles'),...[...new Set(CATALOG.map(e=>e[1])),'Autre'].map(m=>h('option',{value:m},m)));
  filter.value=initialMuscle;
  const list=h('div',{class:'train-catalog'});
  function drawList(){
    const q=searchIn.value.trim().toLowerCase();
    const names=[...new Set([...CATALOG.map(e=>e[0]),...db.all('exercise').map(e=>e.data.name)])];
    const matches=names.filter(n=>{const e=exerciseInfo(n);return (!filter.value||e[1]===filter.value)&&(!q||e.slice(0,4).join(' ').toLowerCase().includes(q));});
    list.replaceChildren(...matches.map(n=>{const e=exerciseInfo(n);return h('div',{class:'row train-catalog-row'},muscleImage(e),h('button',{class:'train-info-link grow',onclick:()=>exerciseDetails(n)},h('strong',{},n),h('span',{class:'s'},e[1]+' · '+e[3])),h('button',{class:'icon-btn',onclick:()=>onSelect(n),'aria-label':'Ajouter '+n},icon('plus')));}),
      q&&!names.some(n=>n.toLowerCase()===q)?h('button',{class:'btn',onclick:()=>onSelect(searchIn.value.trim())},'+ Créer « '+searchIn.value.trim()+' »'):null);
  }
  drawList();return h('div',{},searchIn,field('Muscle',filter),list);
}

async function ensureExercisesInLibrary(exercises) {
  const known = new Set(
    db.all('exercise').map((e) => e.data.name.toLowerCase())
  );

  for (const ex of exercises) {
    if (!known.has(ex.name.toLowerCase())) {
      await db.add('exercise', {
        name: ex.name,
        muscle: exerciseInfo(ex.name)[1],
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
    }, 'Enregistrer');

    const date = h('input', {
      type: 'date',
      value: d.date,
      oninput: () => {
        d.date = date.value;
        saveBtn.textContent = 'Enregistrer';
      },
    });

    const exBox = h('div');

    const addExercise = (exName) => {
      const prev = lastExerciseSets(exName);

      d.exercises.push({
        name: exName,
        sets: prev || [{ reps: '', weight: '' }],
      });

      drawEx();
    };
    let restSeconds=Number(d.restSeconds)||120, deadline=0, remaining=restSeconds, autoRest=d.autoRest!==false;
    const clock=h('strong',{class:'train-clock'});
    const toggle=h('button',{class:'btn',onclick:()=>{if(deadline){remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));deadline=0;}else{if(!remaining)remaining=restSeconds;deadline=Date.now()+remaining*1000;}tick();}},'Démarrer');
    function tick(){if(deadline){remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));if(!remaining){deadline=0;toast('Repos terminé');}}clock.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');toggle.textContent=deadline?'Pause':'Démarrer';}
    function startRest(){remaining=restSeconds;deadline=Date.now()+remaining*1000;tick();}
    const timer=h('div',{class:'card train-timer'},h('div',{class:'s'},'Temps de repos'),h('div',{class:'train-timer-row'},h('button',{class:'icon-btn',onclick:()=>{deadline=0;remaining=restSeconds;tick();}},icon('refresh')),clock,toggle,h('button',{class:'icon-btn',onclick:()=>sheet('Temps de repos',done=>{const input=h('input',{type:'number',min:5,max:3600,value:restSeconds});const auto=h('input',{type:'checkbox',checked:autoRest});return h('div',{},field('Secondes',input),field('Démarrage automatique',auto),h('button',{class:'btn primary',onclick:()=>{restSeconds=Math.max(5,Math.min(3600,Number(input.value)||120));autoRest=auto.checked;d.restSeconds=restSeconds;d.autoRest=autoRest;deadline=0;remaining=restSeconds;tick();done();}},'Enregistrer'));})},icon('settings'))));
    tick();const interval=setInterval(()=>{if(!timer.isConnected){clearInterval(interval);return;}tick();},250);
    function drawEx() {
      exBox.replaceChildren(
        ...d.exercises.map((ex, i) =>
          h('div', { class: 'exblock' },
            h('div', { class: 'exhead' },
              h('button',{class:'train-info-link grow',onclick:()=>exerciseDetails(ex.name)},h('strong',{},ex.name),h('span',{class:'s'},exerciseInfo(ex.name)[1])),
              h('button',{class:'icon-btn sm',onclick:()=>sheet('Notes · '+ex.name,done=>{const input=h('textarea',{value:ex.notes||'',placeholder:'Technique, réglages, sensations…'});return h('div',{},input,h('button',{class:'btn primary',onclick:()=>{ex.notes=input.value;done();}},'Enregistrer'));})},icon('note')),
              h('button',{class:'icon-btn sm',onclick:()=>openExercisePicker(n=>{ex.name=n;drawEx();},exerciseInfo(ex.name)[1])},icon('arrows-exchange')),
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
                h('button',{class:'train-set-kind',onclick:()=>{s.kind=s.kind==='warmup'?'drop':s.kind==='drop'?'work':'warmup';drawEx();}},s.kind==='warmup'?'É':s.kind==='drop'?'D':String(j+1)),
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
                h('button',{class:'icon-btn sm '+(s.done?'on':''),'aria-label':'Valider la série',onclick:()=>{s.done=!s.done;if(s.done&&autoRest)startRest();drawEx();}},icon(s.done?'circle-check-filled':'circle-check')),
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
      if (opts.startNow || opts.initialData) {
        d.status = 'completed';
        d.completedAt = new Date().toISOString();
      } else if (!existing || !isCompleted(existing)) {
        d.status = 'planned';
      } else {
        d.status = 'completed';
      }

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
      h('button',{class:'btn',onclick:()=>openExercisePicker(addExercise)},'+ Ajouter un exercice'),
      timer,
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
    const addExercise = name => {
      exercises.push({ name, sets: lastExerciseSets(name) || [{ reps: '', weight: '' }] });
      drawEx();
    };
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
      h('button',{class:'btn',onclick:()=>openExercisePicker(addExercise)},'+ Ajouter un exercice'),
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

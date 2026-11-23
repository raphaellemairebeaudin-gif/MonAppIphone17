
import * as db from './db.js';
import { h, icon, sheet, field, row, fmtMoney, fmtDate, num, today, toast, errMsg } from './ui.js';

const periods = [
  ['2025-12-21','2026-01-03'],['2026-07-19','2026-08-01'],
  ['2026-12-20','2027-01-02'],['2027-07-25','2027-08-07'],
  ['2027-12-19','2028-01-01'],['2028-07-23','2028-08-05'],
  ['2028-12-24','2029-01-06']
];
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const date = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const plus = (s,n) => { const d=date(s); d.setDate(d.getDate()+n); return iso(d); };
const monday = s => { const d=date(s); return plus(s,-(d.getDay()+6)%7); };
const vacation = s => periods.some(([a,b])=>s>=a&&s<=b);
const profile = () => db.getProfile().data;
const rates = () => (profile().salaryRates||[{from:'2020-01-01',full:808.24,short:686.73}]).slice().sort((a,b)=>a.from.localeCompare(b.from));
const rateAt = s => rates().filter(x=>x.from<=s).at(-1) || rates()[0];
const savedHolidays = () => profile().ccqHolidays || [];
const holidayCount = mon => [0,1,2,3,4].filter(n=>savedHolidays().includes(plus(mon,n))).length;
const salaryFor = mon => {
  const days=[0,1,2,3,4].map(n=>plus(mon,n));
  const working=days.filter(d=>!vacation(d));
  if (!working.length) return {hours:0,amount:0,label:'Vacances CCQ'};
  const holidays=working.filter(d=>savedHolidays().includes(d)).length;
  const hours=(working.length-holidays)*8;
  const r=rateAt(mon);
  return {hours,amount:hours===40?r.full:hours===32?r.short:null,label:hours+' h'};
};
const moneyInput = (label,value='') => field(label,h('input',{inputmode:'decimal',value:String(value)}));
const btn = (label,action,kind='') => h('button',{type:'button',class:'btn '+kind,onclick:action},label);
const note = text => h('p',{class:'sub',style:{fontSize:'12px',lineHeight:'1.5'}},text);
const section = (title,...nodes) => h('section',{},h('h3',{class:'sec'},title),...nodes);
const errorText = () => h('p',{class:'err'});
const safe = async (fn,err) => {try {await fn();}catch(e){err.textContent=errMsg(e);}};

export function salarySection(ym) {
  const wrap=h('div');
  const draw=()=>{
    const first=ym+'-01', end=plus(ym+'-01',42);
    const paydays=[];
    let mon=monday(first);
    for(let i=0;i<8;i++,mon=plus(mon,7)){
      const payday=plus(mon,8);
      if(payday.startsWith(ym))paydays.push({mon,payday,...salaryFor(mon)});
    }
    const overrides=db.all('pay_override');
    const vacationPays=db.all('vacation_pay').filter(r=>r.data.date.startsWith(ym));
    const total=paydays.reduce((sum,p)=>{
      const o=overrides.find(r=>r.data.week===p.mon);
      return sum+(o?Number(o.data.amount):p.amount||0);
    },0)+vacationPays.reduce((sum,r)=>sum+Number(r.data.amount),0);
    const list=paydays.map(p=>{
      const override=overrides.find(r=>r.data.week===p.mon);
      const amount=override?Number(override.data.amount):p.amount;
      const label=override?'Corrigée · '+(override.data.hours??p.hours)+' h':p.label;
      return row('Mardi '+fmtDate(p.payday),'Semaine du '+fmtDate(p.mon)+' · '+label,
        h('strong',{},amount===null?'À vérifier':fmtMoney(amount)),
        ()=>paySheet(p,override,draw));
    });
    wrap.replaceChildren(section('Salaires CCQ · commercial',
      h('div',{class:'card'},h('div',{class:'lbl'},'Prévision du mois (non confirmée)'),h('div',{class:'big'},fmtMoney(total)),
        note('Paie le mardi pour la semaine précédente. Les prévisions ne sont pas ajoutées aux revenus réels.')),
      h('div',{class:'btnrow'},btn('Taux de salaire',()=>rateSheet(draw)),btn('Calendrier CCQ',()=>calendarSheet(draw))),
      note('Vacances CCQ : 0 $ de salaire régulier. Les jours fériés doivent être vérifiés et enregistrés selon le calendrier officiel.'),
      ...list,
      h('div',{class:'btnrow'},btn('Ajouter une paie de vacances',()=>vacationSheet(null,draw),'primary')),
      ...vacationPays.map(v=>row('Vacances · '+fmtDate(v.data.date),v.data.note||'Saisie manuelle',fmtMoney(v.data.amount),()=>vacationSheet(v,draw)))
    ));
  };
  draw();return wrap;
}

function rateSheet(redraw){
  sheet('Taux de salaire net',(close)=>{
    const from=h('input',{type:'date',value:today()});
    const full=h('input',{inputmode:'decimal',value:String(rateAt(today()).full)});
    const short=h('input',{inputmode:'decimal',value:String(rateAt(today()).short)});
    const err=errorText();
    return h('div',{},note('Une augmentation s’applique à partir de la date choisie. Les anciens taux restent enregistrés.'),
      field('Date d’entrée en vigueur',from),field('40 h ($ net)',full),field('32 h ($ net)',short),
      section('Historique',...rates().map(r=>row(fmtDate(r.from),fmtMoney(r.full)+' (40 h) · '+fmtMoney(r.short)+' (32 h)',null,()=>{
        from.value=r.from;full.value=r.full;short.value=r.short;
      }))),
      err,btn('Enregistrer',()=>safe(async()=>{
        const a=num(full.value),b=num(short.value);
        if(!from.value||a<=0||b<=0)throw Error('Entre une date et deux montants valides.');
        const next=rates().filter(r=>r.from!==from.value).concat({from:from.value,full:a,short:b});
        await db.saveProfile({salaryRates:next});close();redraw();
      },err),'primary'));
  });
}
function calendarSheet(redraw){
  sheet('Calendrier CCQ',(close)=>{
    const input=h('textarea',{rows:7,placeholder:'AAAA-MM-JJ, une date par ligne'},savedHolidays().join('\n'));
    const err=errorText();
    return h('div',{},
      note('Vacances officielles 2026 à 2028 intégrées. Les jours fériés doivent être saisis ou vérifiés manuellement. Ne pas supposer qu’un nouveau calendrier est importé automatiquement.'),
      h('a',{href:'https://www.ccq.org/congesvacances',target:'_blank',rel:'noopener noreferrer'},'Consulter les calendriers officiels CCQ'),
      field('Jours fériés chômés (un par ligne)',input),
      err,btn('Enregistrer les dates',()=>safe(async()=>{
        const days=input.value.split(/[\s,;]+/).filter(Boolean);
        if(days.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||iso(date(d))!==d))throw Error('Utilise le format AAAA-MM-JJ.');
        await db.saveProfile({ccqHolidays:[...new Set(days)].sort()});close();redraw();
      },err),'primary'));
  });
}
function paySheet(p,existing,redraw){
  sheet('Corriger une paie',(close)=>{
    const hours=h('input',{inputmode:'numeric',value:String(existing?.data.hours??p.hours)});
    const amount=h('input',{inputmode:'decimal',value:String(existing?.data.amount??p.amount??'')});
    const received=h('input',{type:'checkbox',checked:!!existing?.data.received});
    const err=errorText();
    return h('div',{},note('Paie prévue le '+fmtDate(p.payday)+' pour la semaine du '+fmtDate(p.mon)+'. Une correction reste prioritaire.'),
      field('Heures travaillées',hours),field('Montant net ($)',amount),field('Paie reçue (confirmation)',received),err,
      h('div',{class:'btnrow'},
        existing&&btn('Réinitialiser',()=>safe(async()=>{await db.remove(existing.id);close();redraw();},err)),
        btn('Enregistrer',()=>safe(async()=>{
          if(amount.value.trim()===''||num(amount.value)<0)throw Error('Montant invalide.');
          const data={week:p.mon,payday:p.payday,hours:num(hours.value),amount:num(amount.value),received:received.checked};
          if(existing)await db.update(existing.id,data);else await db.add('pay_override',data);
          close();redraw();
        },err),'primary')));
  });
}
function vacationSheet(existing,redraw){
  sheet(existing?'Modifier un paiement de vacances':'Paiement de vacances',(close)=>{
    const d=existing?.data||{date:today(),amount:'',note:''};
    const dt=h('input',{type:'date',value:d.date});
    const amount=h('input',{inputmode:'decimal',value:String(d.amount)});
    const description=h('input',{value:d.note||'',placeholder:'Chèque CCQ'});
    const err=errorText();
    return h('div',{},field('Date du paiement',dt),field('Montant net ($)',amount),field('Description',description),err,
      h('div',{class:'btnrow'},existing&&btn('Supprimer',()=>safe(async()=>{await db.remove(existing.id);close();redraw();},err)),
        btn('Enregistrer',()=>safe(async()=>{
          if(!dt.value||num(amount.value)<=0)throw Error('Date ou montant invalide.');
          const data={date:dt.value,amount:num(amount.value),note:description.value};
          if(existing)await db.update(existing.id,data);else await db.add('vacation_pay',data);
          close();redraw();
        },err),'primary')));
  });
}

const accounts=()=>db.all('investment_account');
const events=id=>db.all('investment_event').filter(x=>x.data.accountId===id).sort((a,b)=>a.data.date.localeCompare(b.data.date)||a.created_at.localeCompare(b.created_at));
const balance=acc=>events(acc.id).reduce((v,e)=>{
  const d=e.data;
  return d.type==='balance'?Number(d.amount):v+(d.type==='deposit'?1:-1)*Number(d.amount);
},Number(acc.data.openingBalance||0));
export function investmentSection(){
  const wrap=h('div');
  const draw=()=>{
    const acc=accounts();
    const total=acc.reduce((s,a)=>s+balance(a),0);
    wrap.replaceChildren(section('Placements',
      h('div',{class:'card'},h('div',{class:'lbl'},'Valeur totale déclarée'),h('div',{class:'big'},fmtMoney(total))),
      note('Soldes saisis manuellement, sans connexion bancaire. Chaque modification est enregistrée dans Supabase.'),
      ...acc.map(a=>row(a.data.name,a.data.type||'Placement',h('strong',{},fmtMoney(balance(a))),()=>accountSheet(a,draw))),
      h('div',{class:'btnrow'},btn('Ajouter un placement',()=>accountSheet(null,draw),'primary'))));
  };draw();return wrap;
}
function accountSheet(existing,redraw){
  sheet(existing?'Placement · '+existing.data.name:'Nouveau placement',(close)=>{
    const name=h('input',{value:existing?.data.name||'',placeholder:'CELI, CELIAPP, Épargne Placements Québec…'});
    const type=h('input',{value:existing?.data.type||'',placeholder:'Type de compte'});
    const opening=h('input',{inputmode:'decimal',value:String(existing?.data.openingBalance||'')});
    const err=errorText();
    const history=existing?events(existing.id):[];
    return h('div',{},
      field('Nom du placement',name),field('Type',type),
      !existing&&field('Solde initial ($)',opening),
      existing&&h('div',{class:'card'},h('div',{class:'lbl'},'Solde actuel'),h('div',{class:'big'},fmtMoney(balance(existing)))),
      existing&&h('div',{class:'btnrow'},
        btn('Modifier le solde',()=>investmentEventSheet(existing,'balance',redraw)),
        btn('Dépôt',()=>investmentEventSheet(existing,'deposit',redraw)),
        btn('Retrait',()=>investmentEventSheet(existing,'withdrawal',redraw))),
      existing&&section('Historique',...history.slice().reverse().map(e=>row(
        e.data.type==='balance'?'Solde constaté':e.data.type==='deposit'?'Dépôt':'Retrait',
        fmtDate(e.data.date)+(e.data.note?' · '+e.data.note:''),fmtMoney(e.data.amount),
        ()=>investmentEventSheet(existing,e.data.type,redraw,e)))),
      err,h('div',{class:'btnrow'},
        existing&&btn('Supprimer le compte',()=>safe(async()=>{
          if(!confirm('Supprimer ce compte et son historique ?'))return;
          for(const e of history)await db.remove(e.id);
          await db.remove(existing.id);close();redraw();
        },err)),
        btn('Enregistrer le compte',()=>safe(async()=>{
          if(!name.value.trim())throw Error('Entre un nom.');
          const data={name:name.value.trim(),type:type.value.trim(),openingBalance:existing?.data.openingBalance||num(opening.value)};
          if(existing)await db.update(existing.id,data);else await db.add('investment_account',data);
          close();redraw();
        },err),'primary')));
  });
}
function investmentEventSheet(account,type,redraw,existing){
  sheet(existing?'Modifier une opération':'Nouvelle opération',(close)=>{
    const d=existing?.data||{};
    const dt=h('input',{type:'date',value:d.date||today()});
    const amount=h('input',{inputmode:'decimal',value:d.amount===undefined?'':String(d.amount)});
    const description=h('input',{value:d.note||'',placeholder:'Facultatif'});
    const err=errorText();
    return h('div',{},note(type==='balance'?'Un nouveau solde constaté ne crée pas un dépôt fictif.':'Les dépôts et retraits ajustent le solde.'),
      field('Date',dt),field(type==='balance'?'Nouveau solde ($)':'Montant ($)',amount),field('Note',description),err,
      h('div',{class:'btnrow'},existing&&btn('Supprimer',()=>safe(async()=>{await db.remove(existing.id);close();redraw();},err)),
        btn('Enregistrer',()=>safe(async()=>{
          if(!dt.value||amount.value.trim()===''||num(amount.value)<0)throw Error('Date ou montant invalide.');
          const data={accountId:account.id,type,date:dt.value,amount:num(amount.value),note:description.value};
          if(existing)await db.update(existing.id,data);else await db.add('investment_event',data);
          close();redraw();
        },err),'primary')));
  });
}

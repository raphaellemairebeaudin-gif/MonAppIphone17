import * as db from './db.js';
import { h, icon, sheet, field, row, fmtMoney, fmtDate, num, today, errMsg } from './ui.js';

const accounts=()=>db.all('bank_account');
const transfers=()=>db.all('bank_transfer');
const events=id=>db.all('bank_event').filter(e=>e.data.accountId===id).sort((a,b)=>a.data.date.localeCompare(b.data.date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
const balance=a=>{
 const operations=[
  ...events(a.id).map(e=>({date:e.data.date,created:e.created_at,id:e.id,type:e.data.type,amount:Number(e.data.amount)})),
  ...transfers().filter(t=>t.data.fromId===a.id||t.data.toId===a.id).map(t=>({
   date:t.data.date,created:t.created_at,id:t.id,type:'transfer',
   amount:Number(t.data.amount)*(t.data.fromId===a.id?-1:(a.data.type==='credit'?-1:1))
  }))
 ].sort((x,y)=>x.date.localeCompare(y.date)||x.created.localeCompare(y.created)||x.id.localeCompare(y.id));
 return operations.reduce((v,e)=>e.type==='balance'?e.amount:v+(e.type==='transfer'?e.amount:(e.type==='increase'?1:-1)*e.amount),Number(a.data.openingBalance||0));
};
const button=(label,onclick,primary=false)=>h('button',{type:'button',class:'btn'+(primary?' primary':''),onclick},label);
const title=t=>h('h3',{class:'sec'},t);
const hint=t=>h('p',{style:{fontSize:'12px',opacity:'.7',lineHeight:'1.5'}},t);
const fail=async(fn,err)=>{try{await fn();}catch(e){err.textContent=errMsg(e);}};
export function bankSection(){
 const root=h('div');
 const draw=()=>{
  const list=accounts(),checking=list.filter(a=>a.data.type==='checking'),cards=list.filter(a=>a.data.type==='credit');
  const cash=checking.reduce((s,a)=>s+balance(a),0),debt=cards.reduce((s,a)=>s+balance(a),0);
  root.replaceChildren(title('Comptes bancaires'),
   h('div',{class:'tiles'},
    h('div',{class:'tile'},h('div',{class:'v'},fmtMoney(cash)),h('div',{class:'l'},'Comptes chèques')),
    h('div',{class:'tile'},h('div',{class:'v'},fmtMoney(debt)),h('div',{class:'l'},'Dettes de cartes'))),
   hint('Soldes manuels enregistrés dans Supabase. Les mouvements de comptes ne sont pas ajoutés automatiquement aux dépenses du Budget.'),
   ...checking.map(a=>row(a.data.name,'Compte chèques',h('strong',{},fmtMoney(balance(a))),()=>accountSheet(a,draw))),
   ...cards.map(a=>row(a.data.name,'Carte de crédit · Limite '+fmtMoney(a.data.limit||0),h('strong',{},fmtMoney(balance(a))),()=>accountSheet(a,draw))),
   h('div',{class:'btnrow'},button('Ajouter un compte',()=>accountSheet(null,draw),true)));
 };
 draw();return root;
}
function accountSheet(existing,redraw){
 sheet(existing?'Modifier le compte':'Nouveau compte bancaire',close=>{
  let kind=existing?.data.type||'checking';
  const select=h('select',{},h('option',{value:'checking'},'Compte chèques'),h('option',{value:'credit'},'Carte de crédit'));
  select.value=kind;
  const name=h('input',{value:existing?.data.name||'',placeholder:'Nom de la banque ou du compte'});
  const initial=h('input',{inputmode:'decimal',value:String(existing?.data.openingBalance??'')});
  const limit=h('input',{inputmode:'decimal',value:String(existing?.data.limit??'')});
  const limitField=field('Limite de crédit ($)',limit);limitField.hidden=kind!=='credit';
  select.addEventListener('change',()=>{kind=select.value;limitField.hidden=kind!=='credit';});
  const err=h('p',{class:'err'});
  const history=existing?events(existing.id):[];
  const related=existing?transfers().filter(t=>t.data.fromId===existing.id||t.data.toId===existing.id):[];
  return h('div',{},field('Type de compte',select),field('Nom du compte',name),
   !existing&&field('Solde initial ($)',initial),limitField,
   existing&&h('div',{class:'card'},h('div',{class:'lbl'},kind==='credit'?'Montant dû':'Solde disponible'),h('div',{class:'big'},fmtMoney(balance(existing)))),
   existing&&h('div',{class:'btnrow'},
    button('Modifier le solde',()=>eventSheet(existing,'balance',redraw)),
    button(kind==='credit'?'Achat':'Dépôt',()=>eventSheet(existing,'increase',redraw)),
    kind==='credit'?button('Rembourser du compte chèques',()=>transferSheet(existing,redraw)):button('Retrait',()=>eventSheet(existing,'decrease',redraw))),
   existing&&title('Historique du compte'),
   ...history.slice().reverse().map(e=>row(e.data.type==='balance'?'Solde constaté':e.data.type==='increase'?(kind==='credit'?'Achat':'Dépôt'):(kind==='credit'?'Remboursement':'Retrait'),
    fmtDate(e.data.date)+(e.data.note?' · '+e.data.note:''),fmtMoney(e.data.amount),()=>eventSheet(existing,e.data.type,redraw,e))),
   ...related.slice().reverse().map(t=>row('Virement · '+(t.data.fromId===existing.id?'Sortie':'Entrée'),fmtDate(t.data.date)+' · '+(accounts().find(a=>a.id===(t.data.fromId===existing.id?t.data.toId:t.data.fromId))?.data.name||'Compte supprimé'),fmtMoney(t.data.amount),()=>transferSheet(existing,redraw,t))),
   err,h('div',{class:'btnrow'},
    existing&&button('Supprimer',()=>fail(async()=>{
     if(!confirm('Supprimer ce compte et toutes ses opérations ?'))return;
     if(related.length)throw Error('Ce compte possède des virements liés. Supprime-les avant de supprimer le compte.');
     for(const e of history)await db.remove(e.id);
     await db.remove(existing.id);close();redraw();
    },err)),
    button('Enregistrer',()=>fail(async()=>{
     if(!name.value.trim())throw Error('Entre un nom.');
     if((!existing&&num(initial.value)<0)||num(limit.value)<0)throw Error('Montant invalide.');
     const data={name:name.value.trim(),type:kind,openingBalance:existing?Number(existing.data.openingBalance||0):num(initial.value),limit:kind==='credit'?num(limit.value):0};
     if(existing)await db.update(existing.id,data);else await db.add('bank_account',data);
     close();redraw();
    },err),true)));
 });
}
function eventSheet(account,type,redraw,existing){
 sheet(existing?'Modifier une opération':'Nouvelle opération',close=>{
  const d=existing?.data||{};
  const dt=h('input',{type:'date',value:d.date||today()});
  const amount=h('input',{inputmode:'decimal',value:d.amount===undefined?'':String(d.amount)});
  const note=h('input',{value:d.note||'',placeholder:'Facultatif'});
  const err=h('p',{class:'err'});
  return h('div',{},hint(type==='balance'?'Ce solde remplace la valeur précédente à cette date, sans créer une transaction de dépense.':'Cette opération ajuste uniquement le solde du compte.'),
   field('Date',dt),field(type==='balance'?'Solde constaté ($)':'Montant ($)',amount),field('Description',note),err,
   h('div',{class:'btnrow'},existing&&button('Supprimer',()=>fail(async()=>{await db.remove(existing.id);close();redraw();},err)),
    button('Enregistrer',()=>fail(async()=>{
     if(!dt.value||amount.value.trim()===''||num(amount.value)<0)throw Error('Date ou montant invalide.');
     const data={accountId:account.id,type,date:dt.value,amount:num(amount.value),note:note.value.trim()};
     if(existing)await db.update(existing.id,data);else await db.add('bank_event',data);
     close();redraw();
    },err),true)));
 });
}

function transferSheet(card,redraw,existing){
 sheet(existing?'Modifier un remboursement':'Rembourser la carte de crédit',close=>{
  const checking=accounts().filter(a=>a.data.type==='checking');
  const credit=accounts().filter(a=>a.data.type==='credit');
  const currentCard=existing?accounts().find(a=>a.id===existing.data.toId):card;
  const source=h('select',{},...checking.map(a=>h('option',{value:a.id},a.data.name+' · '+fmtMoney(balance(a)))));
  source.value=existing?.data.fromId||checking[0]?.id||'';
  const dest=h('select',{},...credit.map(a=>h('option',{value:a.id},a.data.name)));
  dest.value=existing?.data.toId||currentCard.id;
  const dt=h('input',{type:'date',value:existing?.data.date||today()});
  const amount=h('input',{inputmode:'decimal',value:existing?.data.amount===undefined?'':String(existing.data.amount)});
  const description=h('input',{value:existing?.data.note||'',placeholder:'Facultatif'});
  const err=h('p',{class:'err'});
  return h('div',{},
   hint('Un seul remboursement diminue le solde du compte chèques ET le montant dû sur la carte. Ce virement interne ne compte pas comme une nouvelle dépense.'),
   field('Compte chèques à débiter',source),field('Carte à rembourser',dest),field('Date',dt),field('Montant ($)',amount),field('Description',description),err,
   h('div',{class:'btnrow'},
    existing&&button('Supprimer le remboursement',()=>fail(async()=>{await db.remove(existing.id);close();redraw();},err)),
    button('Enregistrer le remboursement',()=>fail(async()=>{
     if(!source.value||!dest.value)throw Error('Ajoute un compte chèques et une carte de crédit.');
     if(!dt.value||amount.value.trim()===''||num(amount.value)<=0)throw Error('Entre une date et un montant valide.');
     const data={fromId:source.value,toId:dest.value,date:dt.value,amount:num(amount.value),note:description.value.trim()};
     if(existing)await db.update(existing.id,data);else await db.add('bank_transfer',data);
     close();redraw();
    },err),true)));
 });
}

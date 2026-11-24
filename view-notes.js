import * as db from './db.js';
import { h, icon, row, empty, fmtDate, toast, errMsg, sheet, field } from './ui.js';

export const meta = { label: 'Notes', icon: 'notes' };

const RICH = 'RICH_HTML:';
const PREFIX_RE = /^(#{1,3} |- \[[ xX]\] |[-*] |\d+\. |> )/;
let query = '';

const FOLDER_ICONS = [
  'folder','folder-open','folders','archive','book','book-2','notebook','notes','file-text','files',
  'briefcase','heart','star','bulb','school','wallet','music','camera','photo',
  'palette','brush','pencil','calendar','clock','bell','bookmark','tag','home','building',
  'car','plane','map-pin','world','compass','mountain','sun','moon','cloud','leaf',
  'plant','flower','paw','gift','shopping-bag','device-laptop','device-mobile','code',
  'chart-bar','chart-line','calculator','coin','credit-card','pig-money','trophy','target',
  'flame','bolt','shield','lock','key','user','users','friends','coffee','tools','hammer',
  'settings','medical-cross','first-aid-kit','apple','chef-hat','ball-football','bike','run'
];
const FOLDER_COLORS = [
  {name:'Par défaut',value:''},{name:'Rouge',value:'#E76F73'},
  {name:'Orange',value:'#ECA36A'},{name:'Jaune',value:'#E5C76A'},
  {name:'Vert',value:'#80C99A'},{name:'Menthe',value:'#6DCDBF'},
  {name:'Bleu',value:'#80B5E8'},{name:'Indigo',value:'#9299ED'},
  {name:'Violet',value:'#BC97E5'},{name:'Rose',value:'#E99DC1'},
  {name:'Cuivre',value:'#C39A7A'},{name:'Gris',value:'#A5A8AE'}
];
const noteFolders = data => [...new Set([...(Array.isArray(data.folderIds)?data.folderIds:[]),data.folderId].filter(Boolean))];
const hasFolder = (note,id) => noteFolders(note.data).includes(id);
async function pruneEmptyFolder(id) {
  if(!id || db.all('note').some(n=>hasFolder(n,id)))return;
  for(const c of db.all('note_category').filter(c=>c.data.folderId===id))await db.remove(c.id);
  if(db.get(id)?.kind==='note_folder')await db.remove(id);
}
const sortUpdated = (a,b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || b.updated_at.localeCompare(a.updated_at);
const noteRow = n => {
  const raw = n.data.body || '';
  const first = raw.startsWith(RICH) ? (new DOMParser().parseFromString(raw.slice(RICH.length), 'text/html').body.textContent || '') : (raw.split('\n').find(l => l.trim()) || '');
  return row(n.data.title || 'Sans titre', first.replace(PREFIX_RE, '').slice(0,80) || fmtDate(n.updated_at.slice(0,10)),
    n.data.pinned ? h('span', {class:'pos'},icon('pin')) : null,
    () => { location.hash = '#/notes/' + n.id; });
};

function editFolder(existing = null, onCreated = null) {
  sheet(existing ? 'Modifier le dossier' : 'Nouveau dossier', close => {
    const title = h('input', { value: existing?.data.title || '', placeholder:'Nom du dossier' });
    let chosen = existing?.data.icon || 'folder';
    let chosenColor = existing?.data.color || '';
    const choices = h('div', {class:'notes-icon-picker'});
    const drawChoices = () => choices.replaceChildren(...FOLDER_ICONS.map(key =>
      h('button', {type:'button',class:'notes-icon-choice' + (chosen===key?' selected':''),
        'aria-label':key,onclick:()=>{chosen=key;drawChoices();}},icon(key))));
    drawChoices();
    const colors = h('div',{class:'notes-color-picker'});
    const drawColors = () => colors.replaceChildren(...FOLDER_COLORS.map(c=>
      h('button',{type:'button',class:'notes-color-choice'+(chosenColor===c.value?' selected':''),
        'aria-label':c.name,title:c.name,style:{backgroundColor:c.value||'var(--card)'},
        onclick:()=>{chosenColor=c.value;drawColors();}},
        c.value?null:icon('letter-a'))));
    drawColors();
    const save = async () => {
      const name=title.value.trim();
      if(!name){toast('Entre un nom de dossier.');return;}
      try {
        if(existing) await db.update(existing.id,{...existing.data,title:name,icon:chosen,color:chosenColor});
        else {
          const created = await db.add('note_folder',{title:name,icon:chosen,color:chosenColor});
          if (onCreated) await onCreated(created);
        }
        close();
      }catch(e){toast(errMsg(e));}
    };
    return h('div',{},field('Nom',title),h('p',{class:'notes-picker-label'},'Icône du dossier'),choices,
      h('p',{class:'notes-picker-label'},'Couleur de l’icône et du nom'),colors,
      h('div',{class:'btnrow'},h('button',{class:'btn primary',onclick:save},'Enregistrer'),
      existing ? h('button',{class:'btn danger',onclick:async()=>{
        if(!confirm('Supprimer ce dossier ? Les catégories et les notes seront conservées, sans dossier.'))return;
        try {
          for(const n of db.all('note').filter(n=>hasFolder(n,existing.id))) {
            const ids=noteFolders(n.data).filter(id=>id!==existing.id);
            await db.update(n.id,{...n.data,folderIds:ids,folderId:ids[0]||null,categoryId:null});
          }
          for(const c of db.all('note_category').filter(c=>c.data.folderId===existing.id)) await db.remove(c.id);
          await db.remove(existing.id);close();location.hash='#/notes';
        }catch(e){toast(errMsg(e));}
      }},'Supprimer') : null));
  });
}
let selectedFolderId = 'all';
export function render(ctx,param){
  if(param && !param.startsWith('folder-') && param!=='all')return editor(ctx,param);
  if(param?.startsWith('folder-'))selectedFolderId=param.slice(7);
  if(param==='all')selectedFolderId='all';
  ctx.setHead(meta.label,'');
  const body=h('div',{class:'notes-organizer'});
  const search=h('input',{class:'search',type:'search',placeholder:'Rechercher dans les notes',value:query,oninput:()=>{query=search.value;draw();}});
  ctx.main.append(search,body);
  const newNote=fid=>{location.hash='#/notes/new~'+(fid||'')+'~';};
  ctx.setFab(()=>newNote(selectedFolderId==='all'?null:selectedFolderId));
  function draw(){
    const folders=db.all('note_folder').sort((a,b)=>a.created_at.localeCompare(b.created_at));
    if(selectedFolderId!=='all'&&!folders.some(f=>f.id===selectedFolderId))selectedFolderId='all';
    const allNotes=db.all('note'),q=query.trim().toLowerCase();
    const notes=allNotes.filter(n=>!q||(n.data.title||'').toLowerCase().includes(q)||(n.data.body||'').toLowerCase().includes(q)).sort(sortUpdated);
    ctx.setHead('Notes',allNotes.length+' note'+(allNotes.length>1?'s':''));
    const strip=h('div',{class:'notes-folder-strip'},
      h('button',{class:'notes-folder-tile notes-folder-all'+(selectedFolderId==='all'?' selected':''),onclick:()=>{selectedFolderId='all';draw();}},icon('layout-grid'),h('span',{},'Tout')),
      ...folders.map(f=>h('div',{class:'notes-folder-tile'+(selectedFolderId===f.id?' selected':''),style:(selectedFolderId===f.id&&f.data.color)?{borderColor:f.data.color,boxShadow:'inset 0 0 0 1px '+f.data.color}:null},
        h('button',{class:'notes-folder-open',style:f.data.color?{color:f.data.color}:null,onclick:()=>{selectedFolderId=f.id;draw();}},icon(f.data.icon||'folder'),h('span',{},f.data.title)),
        h('button',{class:'notes-folder-edit','aria-label':'Modifier '+f.data.title,onclick:()=>editFolder(f)},icon('dots')))));
    const visible=(selectedFolderId==='all'?notes:notes.filter(n=>hasFolder(n,selectedFolderId))).sort(sortUpdated);
    body.replaceChildren(strip,...(visible.length?visible.map(noteRow):[empty('Aucune note','Touche + pour créer une note.')]));
  }
  ctx.onData(draw);draw();
}

function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(h('strong', {}, t.slice(2, -2)));
    else if (t[0] === '`') out.push(h('code', {}, t.slice(1, -1)));
    else out.push(h('em', {}, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMd(text, onToggle) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      i++;
      out.push(h('pre', {}, h('code', {}, code.join('\n'))));
      continue;
    }
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(ln))) out.push(h('h' + (m[1].length + 1), { class: 'md-h' }, inline(m[2])));
    else if ((m = /^- \[( |x)\] ?(.*)$/i.exec(ln))) {
      const idx = i;
      const done = m[1].toLowerCase() === 'x';
      out.push(h('label', { class: 'md-todo' + (done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: done, onchange: () => onToggle(idx) }), h('span', {}, inline(m[2]))));
    } else if ((m = /^[-*] (.*)$/.exec(ln))) out.push(h('div', { class: 'md-li' }, h('span', { class: 'dot' }, '•'), h('span', {}, inline(m[1]))));
    else if ((m = /^(\d+)\. (.*)$/.exec(ln))) out.push(h('div', { class: 'md-li' }, h('span', { class: 'dot' }, m[1] + '.'), h('span', {}, inline(m[2]))));
    else if ((m = /^> ?(.*)$/.exec(ln))) out.push(h('blockquote', {}, inline(m[1])));
    else if (/^---+$/.test(ln.trim())) out.push(h('hr'));
    else if (ln.trim() === '') out.push(h('div', { class: 'md-gap' }));
    else out.push(h('p', { class: 'md-p' }, inline(ln)));
    i++;
  }
  return out;
}

function editor(ctx, id) {
  const isNew=id==='new'||id.startsWith('new~');
  const [,newFolderId='']=id.split('~');
  let record = isNew ? null : db.get(id);
  if (!isNew && !record) { location.hash = '#/notes'; return; }
  const data = record ? { title: '', body: '', pinned: false, ...record.data } : { title: '', body: '', pinned: false, folderId:newFolderId||null, folderIds:newFolderId?[newFolderId]:[], categoryId:null };
  const backTo = '#/notes';
  let timer = null;
  let chain = Promise.resolve();
  let deleted = false;
  let keyboardFrame = 0;

  ctx.setHead('', '', { back: backTo });
  const status = h('span', { class: 'status' });
  const titleIn = h('input', {
    class: 'note-title', placeholder: 'Titre', value: data.title, enterkeyhint: 'next',
    oninput: () => { data.title = titleIn.value; changed(); },
  });
  const editable = h('div', {
    class: 'note-body rich-editor', contenteditable: 'true', role: 'textbox',
    'aria-label': 'Contenu de la note', 'aria-multiline': 'true',
    'data-placeholder': 'Écris ici…',
    oninput: () => { sync(); },
    onpaste: (e) => {
      e.preventDefault();
      const plain = e.clipboardData?.getData('text/plain') || '';
      document.execCommand('insertText', false, plain);
    },
  });

  // Conserver les anciennes notes Markdown en les convertissant à l'affichage.
  // Leur contenu n'est remplacé par du HTML que lors d'une modification.
  if (data.body.startsWith(RICH)) {
    const parsed = new DOMParser().parseFromString(data.body.slice(RICH.length), 'text/html');
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H2', 'H3', 'H4', 'CODE', 'PRE', 'HR', 'SPAN', 'INPUT', 'LABEL']);
    const clean = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (!allowed.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(child.tagName)) child.remove();
          else { clean(child); child.replaceWith(...child.childNodes); }
          continue;
        }
        if (child.tagName === 'INPUT') {
          if (child.getAttribute('type') !== 'checkbox') { child.remove(); continue; }
          const checked = child.hasAttribute('checked');
          for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
          child.type = 'checkbox';
          child.checked = checked;
          if (checked) child.setAttribute('checked', '');
          continue;
        }
        const safeTextSize = child.tagName === 'SPAN' && ['16', '17', '20', '24'].includes(child.dataset.textSize) ? child.dataset.textSize : '';
        const safeClass = child.tagName === 'UL' && child.classList.contains('check-list') ? 'check-list' : child.tagName === 'LI' && child.classList.contains('check-item') ? 'check-item' : child.tagName === 'LABEL' && child.classList.contains('md-todo') ? 'md-todo' : '';
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        if (safeClass) child.className = safeClass;
        if (safeTextSize) child.dataset.textSize = safeTextSize;
        clean(child);
      }
    };
    clean(parsed.body);
    editable.replaceChildren(...[...parsed.body.childNodes].map(n => document.importNode(n, true)));
  } else if (data.body) {
    editable.append(...renderMd(data.body, () => {}));
    // Les anciennes listes Markdown deviennent également cochables.
  }

  // Le curseur natif d'iOS suffit : aucun caractère flottant ni animation.
  let editingStarted = false;
  const hintFormat = { bold: null, italic: null, underline: null };
  const scheduleCaretHint = () => {};
  const resetHintFormat = () => { hintFormat.bold = null; hintFormat.italic = null; hintFormat.underline = null; };
  const toolbar = h('div', { class: 'toolbar note-keyboard-toolbar' });
  editable.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.toggleAttribute('checked', e.target.checked);
      sync();
    }
  });
  // Garder les listes actives même quand une ligne est vide.
  // Retour crée toujours un nouvel élément; effacer sur une ligne vide
  // retire seulement sa puce, son numéro ou sa case à cocher.
  editable.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertParagraph' && e.inputType !== 'deleteContentBackward') return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return;
    const node = selection.anchorNode;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const item = element?.closest('li');
    if (!item || !editable.contains(item)) return;
    const list = item.parentElement;
    if (!list || !['OL', 'UL'].includes(list.tagName)) return;
    const isCheck = list.classList.contains('check-list') || !!item.querySelector(':scope > input[type="checkbox"]');
    const content = [...item.childNodes].filter(n => !(n.nodeType === 1 && n.matches('input[type="checkbox"]')));
    const isEmpty = content.every(n => !(n.textContent || '').trim());
    const setCaret = (target, end = false) => {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(!end);
      selection.removeAllRanges(); selection.addRange(range);
    };
    if (e.inputType === 'deleteContentBackward') {
      if (!isEmpty) return;
      e.preventDefault();
      const previous = item.previousElementSibling;
      if (previous) {
        // Revenir à l'élément précédent, même s'il appartient à la même liste.
        item.remove();
        setCaret(previous, true);
      } else {
        // Première ligne : retirer son marqueur sans déplacer le curseur ailleurs.
        const paragraph = document.createElement('div');
        paragraph.append(document.createElement('br'));
        list.before(paragraph);
        item.remove();
        setCaret(paragraph);
      }
      if (!list.children.length) list.remove();
      sync();
      return;
    }
    e.preventDefault();
    const next = document.createElement('li');
    if (isCheck) {
      next.className = 'check-item';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.contentEditable = 'false';
      next.append(check, document.createTextNode(' '));
    } else next.append(document.createElement('br'));
    item.after(next);
    setCaret(next, true);
    sync();
  });

  const sync = () => {
    data.body = RICH + editable.innerHTML;
    changed();
  };
  function changed() {
    status.textContent = 'Modification…';
    clearTimeout(timer);
    timer = setTimeout(flush, 950);
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(persist);
    return chain;
  }
  async function persist() {
    if (deleted) return;
    if (!record && !data.title.trim() && !editable.textContent.trim()) { status.textContent = ''; return; }
    try {
      if (record) record = await db.update(record.id, { ...data });
      else {
        record = await db.add('note', { ...data });
        history.replaceState(null, '', '#/notes/' + record.id);
      }
      status.textContent = 'Enregistré';
      drawActions();
    } catch (e) { status.textContent = 'Non enregistré'; toast(errMsg(e)); }
  }

  // Garder la sélection du texte quand on touche les outils au-dessus du clavier.
  let savedRange = null;
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editable.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  // Lire les styles du texte réellement sélectionné, plutôt que ceux
  // du curseur (qui peuvent différer sur Safari iPhone).
  const selectedStyleActive = (key, selection = window.getSelection()) => {
    if (!selection?.rangeCount || selection.isCollapsed) return document.queryCommandState(key);
    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode : root, NodeFilter.SHOW_TEXT);
    const nodes = root.nodeType === Node.TEXT_NODE ? [root] : [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const selected = nodes.filter(node => node.textContent.trim() && range.intersectsNode(node));
    if (!selected.length) return document.queryCommandState(key);
    return selected.every(node => {
      const style = getComputedStyle(node.parentElement);
      if (key === 'bold') return style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
      if (key === 'italic') return style.fontStyle === 'italic' || style.fontStyle === 'oblique';
      if (key === 'underline') return style.textDecorationLine.includes('underline') || !!node.parentElement.closest('u');
      return false;
    });
  };
  const format = (command, value) => {
    editingStarted = true;
    const toggled = ['bold', 'italic', 'underline'].includes(command);
    editable.focus({ preventScroll: true });
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    // Capturer les trois styles indépendamment AVANT de changer l'un d'eux.
    // Safari peut perdre l'état des autres styles sur un curseur vide.
    const selection = window.getSelection();
    const hasSelectedText = !!selection && !selection.isCollapsed;
    const activeStyles = {};
    for (const key of ['bold', 'italic', 'underline'])
      activeStyles[key] = hasSelectedText
        ? selectedStyleActive(key, selection)
        : (hintFormat[key] ?? document.queryCommandState(key));
    document.execCommand(command, false, value);
    if (toggled && !hasSelectedText) {
      activeStyles[command] = !activeStyles[command];
      Object.assign(hintFormat, activeStyles);
    } else if (hasSelectedText) resetHintFormat();
    rememberSelection();
    sync();
    scheduleCaretHint();
  };
  const currentItem = () => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const item = element?.closest('li');
    return item && editable.contains(item) ? item : null;
  };
  const removeListMarker = (item) => {
    const list = item.parentElement;
    const before = [...list.children].slice(0, [...list.children].indexOf(item));
    const after = [...list.children].slice([...list.children].indexOf(item) + 1);
    const paragraph = document.createElement('div');
    const check = item.querySelector(':scope > input[type="checkbox"]');
    if (check) check.remove();
    paragraph.append(...[...item.childNodes]);
    if (!paragraph.childNodes.length) paragraph.append(document.createElement('br'));
    if (after.length) {
      const remainder = list.cloneNode(false);
      remainder.append(...after);
      list.after(remainder);
    }
    list.after(paragraph);
    item.remove();
    if (!before.length) list.remove();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
    rememberSelection(); sync(); scheduleCaretHint();
  };
  const replaceEmptyListItem = (item, kind) => {
    if (!item || item.textContent.trim()) return false;
    const parent = item.parentElement;
    if (!parent || !['OL', 'UL'].includes(parent.tagName)) return false;
    const wasCheckbox = parent.classList.contains('check-list') || !!item.querySelector(':scope > input[type="checkbox"]');
    if ((kind === 'CHECK' && wasCheckbox) || (kind !== 'CHECK' && !wasCheckbox && parent.tagName === kind)) return false;
    const siblings = [...parent.children];
    const index = siblings.indexOf(item);
    const nextItems = siblings.slice(index + 1);
    if (nextItems.length) {
      const after = parent.cloneNode(false);
      after.append(...nextItems);
      parent.after(after);
    }
    const newList = document.createElement(kind === 'CHECK' ? 'ul' : kind.toLowerCase());
    if (kind === 'CHECK') newList.className = 'check-list';
    const next = document.createElement('li');
    if (kind === 'CHECK') {
      next.className = 'check-item';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.contentEditable = 'false';
      next.append(check, document.createTextNode(' '));
    } else next.append(document.createElement('br'));
    newList.append(next);
    parent.after(newList);
    item.remove();
    if (!parent.children.length) parent.remove();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(next); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
    rememberSelection(); sync();
    return true;
  };
  const toggleList = (kind) => {
    editable.focus({ preventScroll: true });
    if (savedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(savedRange);
    }
    const item = currentItem();
    if (replaceEmptyListItem(item, kind)) return;
    if (item && item.parentElement.tagName === kind && !item.parentElement.classList.contains('check-list')) {
      removeListMarker(item);
    } else if (!item) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const element = range && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
      const block = element?.closest('p, div, h2, h3, h4, blockquote');
      if (range && block && block !== editable && editable.contains(block)) {
        // Convertir la ligne courante plutôt que d'ajouter une liste en dessous.
        const marker = document.createComment('note-list-cursor');
        const position = range.cloneRange();
        position.collapse(true);
        position.insertNode(marker);
        const list = document.createElement(kind.toLowerCase());
        const li = document.createElement('li');
        while (block.firstChild) li.append(block.firstChild);
        list.append(li);
        block.replaceWith(list);
        const cursor = document.createRange();
        cursor.setStartAfter(marker);
        cursor.collapse(true);
        marker.remove();
        selection.removeAllRanges();
        selection.addRange(cursor);
        rememberSelection();
        sync();
        scheduleCaretHint();
      } else format(kind === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
    } else format(kind === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
  };
  const insertCheckbox = () => {
    editable.focus({ preventScroll: true });
    if (savedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(savedRange);
    }
    const existing = currentItem();
    if (replaceEmptyListItem(existing, 'CHECK')) return;
    if (existing && (existing.parentElement.classList.contains('check-list') || existing.querySelector(':scope > input[type="checkbox"]'))) {
      removeListMarker(existing);
      return;
    }
    const selection = window.getSelection();
    const li = document.createElement('li'); li.className = 'check-item';
    const check = document.createElement('input'); check.type = 'checkbox'; check.contentEditable = 'false';
    li.append(check, document.createTextNode(' '));
    const list = document.createElement('ul'); list.className = 'check-list'; list.append(li);
    const range = selection.getRangeAt(0);
    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const block = element.closest('p, div, h2, h3, h4, blockquote');
    if (block && editable.contains(block) && block !== editable) {
      // Transformer la ligne actuelle en case à cocher, sans ajouter de ligne.
      // Conserver le texte et sa mise en forme, même si la ligne est déjà remplie.
      const marker = document.createComment('note-check-cursor');
      const position = range.cloneRange();
      position.collapse(true);
      position.insertNode(marker);
      while (block.firstChild) li.append(block.firstChild);
      // Retirer l'espace initial si la ligne contenait déjà du texte.
      if (li.textContent.trim()) {
        const initialSpace = check.nextSibling;
        if (initialSpace?.nodeType === Node.TEXT_NODE && initialSpace.textContent === ' ') initialSpace.remove();
      }
      block.replaceWith(list);
      const cursor = document.createRange();
      cursor.setStartAfter(marker);
      cursor.collapse(true);
      marker.remove();
      selection.removeAllRanges(); selection.addRange(cursor);
    } else {
      range.collapse(false);
      range.insertNode(list);
      const cursor = document.createRange();
      cursor.selectNodeContents(li); cursor.collapse(false);
      selection.removeAllRanges(); selection.addRange(cursor);
    }
    rememberSelection(); sync(); scheduleCaretHint();
    return;
  };
  const sizeMenu = h('div', { class: 'note-size-menu', hidden: true });
  const sizeChoices = [
    ['h2', 'Grand', '24 px'],
    ['h3', 'Moyen', '20 px'],
    ['h4', 'Petit titre', '17 px'],
    ['div', 'Normal', '16 px'],
  ];
  const closeSizeMenu = () => { sizeMenu.hidden = true; };
  const selectionTextSizes = (selection = window.getSelection()) => {
    if (!selection?.rangeCount || selection.isCollapsed) return [];
    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode : root, NodeFilter.SHOW_TEXT);
    const nodes = root.nodeType === Node.TEXT_NODE ? [root] : [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes.filter(node => node.textContent.trim() && range.intersectsNode(node))
      .map(node => Math.round(parseFloat(getComputedStyle(node.parentElement).fontSize) || 16));
  };
  let pendingTextSize = null;
  // La taille est appliquée aux prochains caractères, même au milieu d'une ligne.
  // Les caractères déjà écrits ne sont jamais reformatés.
  const applyTextSize = (tag) => {
    closeSizeMenu();
    editable.focus({ preventScroll: true });
    if (savedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    const chosenSize = { h2: '24', h3: '20', h4: '17', div: '16' }[tag];
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed && editable.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      // Sur une sélection, changer la taille du texte existant.
      // Sur un curseur simple, seule la prochaine saisie est concernée.
      const fragment = range.extractContents();
      const span = document.createElement('span');
      span.dataset.textSize = chosenSize;
      span.append(fragment);
      range.insertNode(span);
      const restored = document.createRange();
      restored.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(restored);
      rememberSelection();
      sync();
      updateToolStates();
      scheduleCaretHint();
      return;
    }
    pendingTextSize = chosenSize;
    rememberSelection();
    updateToolStates();
    scheduleCaretHint();
  };
  editable.addEventListener('beforeinput', (event) => {
    if (!pendingTextSize || event.inputType !== 'insertText' || !event.data || event.isComposing) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editable.contains(selection.anchorNode)) return;
    event.preventDefault();
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const span = document.createElement('span');
    span.dataset.textSize = pendingTextSize;
    const textNode = document.createTextNode(event.data);
    span.append(textNode);
    range.insertNode(span);
    const next = document.createRange();
    next.setStart(textNode, textNode.length);
    next.collapse(true);
    selection.removeAllRanges();
    selection.addRange(next);
    rememberSelection();
    sync();
    scheduleCaretHint();
  });
  sizeMenu.append(...sizeChoices.map(([tag, label, size]) =>
    h('button', {
      type: 'button', class: 'note-size-choice', 'data-size': ({h2:'24',h3:'20',h4:'17',div:'16'})[tag],
      onpointerdown: (e) => { rememberSelection(); e.preventDefault(); },
      onmousedown: (e) => e.preventDefault(),
      onclick: () => applyTextSize(tag),
    }, label + ' · ' + size)));
  const positionSizeMenu = () => {
    if (sizeMenu.hidden || !toolbar.isConnected) return;
    const headingButton = toolButtons.get('heading');
    if (!headingButton) return;
    const buttonRect = headingButton.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    const menuWidth = sizeMenu.offsetWidth || 164;
    const menuHeight = sizeMenu.offsetHeight;
    // Le body est fixé à l'écran dans cette PWA. Utiliser ses coordonnées
    // plutôt que celles du visualViewport, déplacé par le clavier iOS.
    const left = Math.max(8, Math.min(buttonRect.left - bodyRect.left, bodyRect.width - menuWidth - 8));
    const top = buttonRect.top - bodyRect.top - menuHeight - 8;
    sizeMenu.style.left = Math.round(left) + 'px';
    sizeMenu.style.top = Math.round(Math.max(4, top)) + 'px';
  };
  const toggleHeading = () => {
    rememberSelection();
    sizeMenu.hidden = !sizeMenu.hidden;
    if (!sizeMenu.hidden) {
      positionToolbar();
      positionSizeMenu();
      requestAnimationFrame(positionSizeMenu);
    }
  };
  const tools = [
    ['heading', 'Titre', toggleHeading],
    ['checkbox', 'Case à cocher', insertCheckbox],
    ['list', 'Liste à puces', () => toggleList('UL')],
    ['list-numbers', 'Liste numérotée', () => toggleList('OL')],
    ['bold', 'Gras', () => format('bold')],
    ['italic', 'Italique', () => format('italic')],
    ['quote', 'Citation', () => format('formatBlock', 'blockquote')],
    ['code', 'Code', () => format('formatBlock', 'pre')],
    ['minus', 'Séparateur', () => format('insertHorizontalRule')],
  ];
  const toolButtons = new Map();
  const updateToolStates = () => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element || !editable.contains(element)) {
      for (const button of toolButtons.values()) {
        button.classList.remove('is-active');
        button.setAttribute('aria-pressed', 'false');
      }
      return;
    }
    const item = element.closest('li');
    const list = item?.parentElement;
    const block = element.closest('h2, h3, h4, blockquote, pre, p, div, li');
    const hasSelectedText = !selection.isCollapsed;
    const states = {
      heading: hasSelectedText
        ? selectionTextSizes(selection).some(size => size !== 16)
        : (!!pendingTextSize && pendingTextSize !== '16') || ['H2', 'H3', 'H4'].includes(block?.tagName) || !!element.closest('span[data-text-size]:not([data-text-size="16"])'),
      checkbox: !!item && (list?.classList.contains('check-list') || !!item.querySelector(':scope > input[type="checkbox"]')),
      list: !!item && list?.tagName === 'UL' && !list.classList.contains('check-list'),
      'list-numbers': !!item && list?.tagName === 'OL',
      bold: hasSelectedText ? selectedStyleActive('bold', selection) : (hintFormat.bold ?? document.queryCommandState('bold')),
      italic: hasSelectedText ? selectedStyleActive('italic', selection) : (hintFormat.italic ?? document.queryCommandState('italic')),
      quote: block?.tagName === 'BLOCKQUOTE',
      code: block?.tagName === 'PRE',
      minus: false,
    };
    for (const choice of sizeMenu.querySelectorAll('.note-size-choice')) {
      const size = choice.dataset.size;
      const sizes = hasSelectedText ? selectionTextSizes(selection) : [];
      const active = hasSelectedText ? sizes.length > 0 && sizes.every(value => String(value) === size) : (pendingTextSize ? pendingTextSize === size : Math.round(parseFloat(getComputedStyle(element).fontSize)) === Number(size));
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
    }
    for (const [name, button] of toolButtons) {
      const active = !!states[name];
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  toolbar.append(...tools.map(([ic, label, fn]) => {
    const button = h('button', {
      type: 'button', 'aria-label': label, 'aria-pressed': 'false',
      onpointerdown: (e) => { rememberSelection(); e.preventDefault(); },
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { fn(); requestAnimationFrame(updateToolStates); },
    }, icon(ic));
    toolButtons.set(ic, button);
    return button;
  }));
  document.addEventListener('selectionchange', updateToolStates);
  editable.addEventListener('input', updateToolStates);
  editable.addEventListener('keyup', updateToolStates);
  editable.addEventListener('keyup', rememberSelection);
  editable.addEventListener('mouseup', rememberSelection);
  document.addEventListener('selectionchange', rememberSelection);

  // Synchronisation clavier iOS : fonctionne avec clavier ouvert OU fermé,
  // y compris quand l'application revient du mode arrière-plan.
  let keyboardRecoveryTimers = [];
  let keyboardPoll = 0;
  let lastKeyboardGeometry = '';
  let trackingUntil = 0;
  let tracking = false;
  const positionToolbar = () => {
    if (!toolbar.isConnected || document.hidden) return;
    const vp = window.visualViewport;
    const visibleBottom = vp ? vp.offsetTop + vp.height : window.innerHeight;
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    toolbar.classList.toggle('keyboard-visible', layoutHeight - visibleBottom > 100);
    const top = Math.max(0, visibleBottom - toolbar.offsetHeight);
    const nextTop = top + 'px';
    if (toolbar.style.top !== nextTop) toolbar.style.top = nextTop;
    positionSizeMenu();
  };
  const clearKeyboardRecovery = () => {
    cancelAnimationFrame(keyboardFrame);
    tracking = false;
    trackingUntil = 0;
    clearInterval(keyboardPoll);
    keyboardRecoveryTimers.forEach(clearTimeout);
    keyboardRecoveryTimers = [];
    keyboardPoll = 0;
  };
  const followKeyboard = () => {
    if (document.hidden || !toolbar.isConnected) return;
    trackingUntil = performance.now() + 900;
    // Ne pas annuler la boucle à chaque événement resize : cela retardait
    // le placement pendant les animations et le défilement du clavier.
    positionToolbar();
    if (!tracking) {
      tracking = true;
      const tick = now => {
        if (!toolbar.isConnected || document.hidden) { tracking = false; return; }
        positionToolbar();
        if (now < trackingUntil) keyboardFrame = requestAnimationFrame(tick);
        else tracking = false;
      };
      keyboardFrame = requestAnimationFrame(tick);
    }
    if (!keyboardPoll) {
      keyboardPoll = setInterval(() => {
        if (document.hidden || !toolbar.isConnected) return;
        const vp = window.visualViewport;
        const geometry = [vp?.height, vp?.offsetTop, window.innerHeight,
          document.documentElement.clientHeight].join(':');
        if (geometry !== lastKeyboardGeometry) {
          lastKeyboardGeometry = geometry;
          followKeyboard();
        }
      }, 100);
    }
  };
  const onResume = () => {
    if (document.hidden) {
      clearKeyboardRecovery();
      lastKeyboardGeometry = '';
      return;
    }
    // Restaurer les éléments si une ancienne reprise iOS les a détachés.
    if (!toolbar.isConnected) document.body.append(toolbar);
    if (!sizeMenu.isConnected) document.body.append(sizeMenu);
    lastKeyboardGeometry = '';
    followKeyboard();
    keyboardRecoveryTimers.forEach(clearTimeout);
    keyboardRecoveryTimers = [150, 400, 800, 1400, 2400, 3500].map(delay => setTimeout(followKeyboard, delay));
  };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('orientationchange', followKeyboard);
  window.visualViewport?.addEventListener('resize', followKeyboard);
  window.visualViewport?.addEventListener('scroll', positionToolbar);
  window.addEventListener('resize', followKeyboard);
  document.addEventListener('scroll', positionToolbar, true);
  toolbar.addEventListener('scroll', positionSizeMenu, { passive: true });
  editable.addEventListener('focus', followKeyboard);
  editable.addEventListener('blur', followKeyboard);
  titleIn.addEventListener('focus', followKeyboard);
  titleIn.addEventListener('blur', followKeyboard);

  async function addToFolder(folderId,close){
    const ids=[...new Set([...noteFolders(data),folderId])];
    data.folderIds=ids;data.folderId=ids[0]||null;data.categoryId=null;
    changed();await flush();close();toast('Note ajoutée au dossier.');
  }
  async function removeFromFolder(folderId,close){
    const ids=noteFolders(data).filter(id=>id!==folderId);
    data.folderIds=ids;data.folderId=ids[0]||null;data.categoryId=null;
    changed();await flush();
    await pruneEmptyFolder(folderId);
    close();toast('Note retirée du dossier.');
  }
  function openFolderPicker(){
    sheet('Ajouter à un dossier',close=>h('div',{class:'notes-folder-picker'},
      ...db.all('note_folder').filter(f=>!noteFolders(data).includes(f.id)).map(f=>
        h('button',{class:'notes-folder-picker-row',onclick:async()=>{
          try{await addToFolder(f.id,close);}catch(e){toast(errMsg(e));}
        }},icon(f.data.icon||'folder'),h('span',{},f.data.title),icon('chevron-right'))),
      h('button',{class:'notes-folder-picker-row',onclick:()=>editFolder(null,async created=>{
        await addToFolder(created.id,close);
      })},icon('folder-plus'),h('span',{},'Créer un nouveau dossier'),icon('plus'))));
  }
  function openFolderOptions(folder){
    sheet(folder.data.title,close=>h('div',{class:'notes-options'},
      h('button',{class:'notes-option-row',onclick:async()=>{
        try{await removeFromFolder(folder.id,close);}catch(e){toast(errMsg(e));}
      }},icon('folder-minus'),'Retirer la note du dossier')));
  }
  function openFolderMenu(){
    sheet('Ajouter au dossier',close=>h('div',{class:'notes-options'},
      h('button',{class:'notes-option-row',onclick:()=>{close();editFolder(null,async created=>{await addToFolder(created.id,()=>{});});}},
        icon('folder-plus'),'Ajouter nouveau dossier'),
      ...db.all('note_folder').filter(f=>noteFolders(data).includes(f.id)).map(f=>
        h('button',{class:'notes-option-row',onclick:()=>{close();openFolderOptions(f);}},
          icon(f.data.icon||'folder'),h('span',{style:f.data.color?{color:f.data.color}:null},f.data.title)))));
  }
  function drawActions(){
    ctx.setActions([h('button',{class:'icon-btn',type:'button','aria-label':'Options de la note',onclick:()=>{
      sheet('Options de la note',close=>h('div',{class:'notes-options'},
        h('button',{class:'notes-option-row',onclick:()=>{close();if(noteFolders(data).length)openFolderMenu();else editFolder(null,async created=>{await addToFolder(created.id,()=>{});});}},
          icon('folder-plus'),'Ajouter au dossier'),
        h('button',{class:'notes-option-row',onclick:()=>{
          data.pinned=!data.pinned;changed();flush();drawActions();close();
          toast(data.pinned?'Note épinglée':'Note désépinglée');
        }},icon('pin'),data.pinned?'Désépingler':'Épingler'),
        record?h('button',{class:'notes-option-row danger',onclick:async()=>{
          if(!confirm('Supprimer cette note ?'))return;
          try{deleted=true;clearTimeout(timer);await chain;const ids=noteFolders(data);await db.remove(record.id);for(const fid of ids)await pruneEmptyFolder(fid);close();location.hash=backTo;}
          catch(e){deleted=false;toast(errMsg(e));}
        }},icon('trash'),'Supprimer'):null));
    }},icon('dots'))]);
  }

  ctx.main.classList.add('note-editing-host');
  ctx.main.append(titleIn, editable, status);
  // Le clavier et la barre restent dans le repère écran : le glissement
  // interactif transforme #app, donc la barre ne doit pas être son enfant.
  document.body.append(toolbar);
  // Hors du conteneur défilant : iOS positionne ainsi le menu en coordonnées écran.
  document.body.append(sizeMenu);
  ctx.onSuspend(() => { if (timer) flush(); });
  ctx.onLeave(() => {
    closeSizeMenu();
    sizeMenu.remove();
    toolbar.remove();
    ctx.main.classList.remove('note-editing-host');
    if (timer) flush();
    clearKeyboardRecovery();
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('pageshow', onResume);
    window.removeEventListener('focus', onResume);
    window.visualViewport?.removeEventListener('resize', followKeyboard);
    window.visualViewport?.removeEventListener('scroll', positionToolbar);
    window.removeEventListener('resize', followKeyboard);
    window.removeEventListener('orientationchange', followKeyboard);
    document.removeEventListener('scroll', positionToolbar, true);
    document.removeEventListener('selectionchange', updateToolStates);
    document.removeEventListener('selectionchange', rememberSelection);
  });
  drawActions();
  followKeyboard();
  if (!record) setTimeout(() => titleIn.focus(), 50);
}

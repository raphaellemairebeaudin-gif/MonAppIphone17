import * as db from './db.js';
import { h, icon, row, empty, fmtDate, toast, errMsg, sheet, field } from './ui.js';

export const meta = { label: 'Notes', icon: 'notes' };

const RICH = 'RICH_HTML:';
const PREFIX_RE = /^(#{1,3} |- \[[ xX]\] |[-*] |\d+\. |> )/;
let query = '';

const FOLDER_ICONS = ['folder', 'book', 'briefcase', 'heart', 'star', 'bulb', 'school', 'dumbbell', 'wallet', 'music'];
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
    const choices = h('div', {class:'notes-icon-picker'});
    const drawChoices = () => choices.replaceChildren(...FOLDER_ICONS.map(key =>
      h('button', {type:'button',class:'notes-icon-choice' + (chosen===key?' selected':''),
        'aria-label':key,onclick:()=>{chosen=key;drawChoices();}},icon(key))));
    drawChoices();
    const save = async () => {
      const name=title.value.trim();
      if(!name){toast('Entre un nom de dossier.');return;}
      try {
        if(existing) await db.update(existing.id,{...existing.data,title:name,icon:chosen});
        else {
          const created = await db.add('note_folder',{title:name,icon:chosen});
          if (onCreated) await onCreated(created);
        }
        close();
      }catch(e){toast(errMsg(e));}
    };
    return h('div',{},field('Nom',title),h('p',{class:'notes-picker-label'},'Icône du dossier'),choices,
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
      ...folders.map(f=>h('div',{class:'notes-folder-tile'+(selectedFolderId===f.id?' selected':'')},
        h('button',{class:'notes-folder-open',onclick:()=>{selectedFolderId=f.id;draw();}},icon(f.data.icon||'folder'),h('span',{},f.data.title)),
        h('button',{class:'notes-folder-edit','aria-label':'Modifier '+f.data.title,onclick:()=>editFolder(f)},icon('dots')))));
    const visible=selectedFolderId==='all'?notes:notes.filter(n=>hasFolder(n,selectedFolderId));
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

  // Repère purement visuel : ne jamais modifier le DOM éditable ni la sélection.
  const caretHint = h('span', { class: 'note-caret-hint', 'aria-hidden': 'true', hidden: true }, 'A');
  let hintFrame = 0;
  let editingStarted = false;
  const hintFormat = { bold: null, italic: null, underline: null };
  const updateCaretHint = () => {
    caretHint.hidden = true;
    if (!editingStarted || document.activeElement !== editable) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed || !editable.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    let rect = range.getClientRects()[0];
    if (!rect?.height) rect = range.getBoundingClientRect();
    // Pour une ligne vide, utiliser la boîte de la ligne, sans insérer de noeud.
    const node = selection.anchorNode;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    // Un repère n'a sa place qu'en fin de saisie, jamais devant du texte
    // existant (même si des espaces séparent le curseur de la lettre).
    // Inspecter la suite du bloc courant sans modifier la sélection.
    const lineBlock = element?.closest('li, p, div, h2, h3, h4, blockquote, pre') || editable;
    try {
      const afterCaret = document.createRange();
      afterCaret.selectNodeContents(lineBlock);
      afterCaret.setStart(range.startContainer, range.startOffset);
      const remaining = afterCaret.toString();
      // Ne pas traverser un saut de ligne explicite.
      const sameLine = remaining.split(/[\r\n]/, 1)[0];
      if (/\p{L}|\p{N}/u.test(sameLine)) return;
    } catch (_) {
      // Certains placements de curseur Safari ne sont pas contenus dans
      // le bloc détecté : chercher la suite dans l'éditeur entier.
      const afterCaret = document.createRange();
      afterCaret.selectNodeContents(editable);
      afterCaret.setStart(range.startContainer, range.startOffset);
      const sameLine = afterCaret.toString().split(/[\r\n]/, 1)[0];
      if (/\p{L}|\p{N}/u.test(sameLine)) return;
    }
    if (!rect?.height) {
      const line = element.closest('li, p, div, h2, h3, h4') || editable;
      const bounds = line.getBoundingClientRect();
      const style = getComputedStyle(line);
      const left = bounds.left + (parseFloat(style.paddingLeft) || 0);
      rect = { left, top: bounds.top, height: parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 20 };
    }
    // Les éléments de liste vides ne fournissent pas toujours un rectangle
    // de curseur sur iOS : se caler sur le contenu du li, après son marqueur.
    const listItem = element?.closest('li');
    if (listItem && editable.contains(listItem) && (!rect?.height || rect.width > 20)) {
      const bounds = listItem.getBoundingClientRect();
      const itemStyle = getComputedStyle(listItem);
      const left = bounds.left + (parseFloat(itemStyle.paddingLeft) || 0);
      rect = { left, top: bounds.top, height: parseFloat(itemStyle.lineHeight) || parseFloat(itemStyle.fontSize) || 20 };
    }
    if (!rect?.height) return;
    const style = getComputedStyle(element);
    const bold = hintFormat.bold ?? document.queryCommandState('bold');
    const italic = hintFormat.italic ?? document.queryCommandState('italic');
    const underline = hintFormat.underline ?? document.queryCommandState('underline');
    // Afficher la dernière lettre située avant le curseur, ou A par défaut.
    // Ne jamais insérer ce caractère dans la note.
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(editable);
    beforeCaret.setEnd(range.startContainer, range.startOffset);
    const precedingText = beforeCaret.toString();
    const lastLine = precedingText.split(/[\r\n]/).pop() || '';
    const letters = lastLine.match(/\p{L}/gu);
    caretHint.textContent = letters?.length ? letters[letters.length - 1] : 'A';
    // Coordonnées dans le contenu de main, pas dans la fenêtre :
    // le repère défile avec la note sans se détacher de sa ligne.
    const hostRect = ctx.main.getBoundingClientRect();
    caretHint.style.left = Math.round(rect.left - hostRect.left + ctx.main.scrollLeft + 2) + 'px';
    const fontSize = parseFloat(style.fontSize) || 16;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
    const verticalInset = Math.max(0, (lineHeight - fontSize) / 2);
    // Remonter légèrement le repère pour aligner sa ligne de base sur le texte.
    caretHint.style.top = Math.round(rect.top - hostRect.top + ctx.main.scrollTop + verticalInset - 3) + 'px';
    caretHint.style.fontFamily = style.fontFamily;
    caretHint.style.fontSize = style.fontSize;
    caretHint.style.lineHeight = '1';
    caretHint.style.fontWeight = bold ? '700' : '400';
    caretHint.style.fontStyle = italic ? 'italic' : 'normal';
    caretHint.style.textDecoration = underline ? 'underline' : 'none';
    caretHint.hidden = false;
  };
  const scheduleCaretHint = () => {
    cancelAnimationFrame(hintFrame);
    hintFrame = requestAnimationFrame(updateCaretHint);
  };
  const resetHintFormat = () => { hintFormat.bold = null; hintFormat.italic = null; hintFormat.underline = null; };
  const beginEditing = () => { editingStarted = true; scheduleCaretHint(); };
  // La saisie, les espaces et les changements de ligne ne désactivent
  // jamais les options choisies explicitement par l'utilisateur.
  editable.addEventListener('pointerdown', beginEditing);
  editable.addEventListener('keydown', beginEditing);
  editable.addEventListener('input', beginEditing);
  editable.addEventListener('focus', scheduleCaretHint);
  editable.addEventListener('blur', () => { editingStarted = false; caretHint.hidden = true; });
  editable.addEventListener('keyup', scheduleCaretHint);
  editable.addEventListener('pointerup', scheduleCaretHint);
  // Au changement d'application, masquer le repère sans perdre sa position.
  // Au retour, recalculer sa place après la restauration du viewport iOS.
  const onAppVisibility = () => {
    cancelAnimationFrame(hintFrame);
    if (document.visibilityState !== 'visible') {
      caretHint.hidden = true;
      return;
    }
    if (editingStarted && document.activeElement === editable) {
      requestAnimationFrame(() => requestAnimationFrame(scheduleCaretHint));
    } else {
      caretHint.hidden = true;
    }
  };
  const onPageShow = () => {
    if (document.visibilityState === 'visible' && editingStarted && document.activeElement === editable)
      requestAnimationFrame(() => requestAnimationFrame(scheduleCaretHint));
  };
  document.addEventListener('visibilitychange', onAppVisibility);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('selectionchange', scheduleCaretHint);
  window.addEventListener('scroll', scheduleCaretHint, true);
  window.visualViewport?.addEventListener('scroll', scheduleCaretHint);
  window.visualViewport?.addEventListener('resize', scheduleCaretHint);
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
    timer = setTimeout(flush, 600);
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
  const toggleHeading = () => {
    rememberSelection();
    sizeMenu.hidden = !sizeMenu.hidden;
    positionSizeMenu();
  };
  const positionSizeMenu = () => {
    if (sizeMenu.hidden || !toolbar.isConnected) return;
    const headingButton = toolButtons.get('heading');
    if (!headingButton) return;
    const bounds = headingButton.getBoundingClientRect();
    // Ancrer le menu au bouton H, pas au contenu de la note.
    // Le bouton peut défiler horizontalement dans la barre d'outils.
    const viewport = window.visualViewport;
    const visibleLeft = viewport?.offsetLeft || 0;
    const visibleRight = visibleLeft + (viewport?.width || window.innerWidth);
    const width = sizeMenu.offsetWidth;
    const left = Math.max(visibleLeft + 8, Math.min(bounds.left + bounds.width / 2 - width / 2, visibleRight - width - 8));
    sizeMenu.style.left = Math.round(left) + 'px';
    sizeMenu.style.top = Math.round(bounds.top - sizeMenu.offsetHeight - 4) + 'px';
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

  const positionToolbar = () => {
    if (!toolbar.isConnected) return;
    const vp = window.visualViewport;
    const visibleBottom = vp ? vp.offsetTop + vp.height : window.innerHeight;
    const keyboardOpen = (document.activeElement === editable || document.activeElement === titleIn) && window.innerHeight - visibleBottom > 100;
    toolbar.classList.toggle('keyboard-visible', keyboardOpen);
    toolbar.style.top = Math.max(0, visibleBottom - toolbar.offsetHeight) + 'px';
    positionSizeMenu();
  };
  const followKeyboard = () => {
    cancelAnimationFrame(keyboardFrame);
    let frames = 0;
    const tick = () => {
      positionToolbar();
      if (++frames < 45) keyboardFrame = requestAnimationFrame(tick);
    };
    keyboardFrame = requestAnimationFrame(tick);
  };
  window.visualViewport?.addEventListener('resize', positionToolbar);
  window.visualViewport?.addEventListener('scroll', positionToolbar);
  window.addEventListener('resize', positionToolbar);
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
      h('button',{class:'notes-option-row',onclick:()=>{close();openFolderPicker();}},
        icon('folder-plus'),noteFolders(data).length?'Ajouter à un autre dossier':'Ajouter à un dossier'),
      ...db.all('note_folder').filter(f=>noteFolders(data).includes(f.id)).map(f=>
        h('button',{class:'notes-option-row',onclick:()=>{close();openFolderOptions(f);}},
          icon(f.data.icon||'folder'),f.data.title))));
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
  ctx.main.append(titleIn, editable, status, toolbar, sizeMenu, caretHint);
  ctx.onLeave(() => {
    closeSizeMenu();
    ctx.main.classList.remove('note-editing-host');
    if (timer) flush();
    cancelAnimationFrame(keyboardFrame);
    cancelAnimationFrame(hintFrame);
    document.removeEventListener('visibilitychange', onAppVisibility);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('selectionchange', scheduleCaretHint);
    window.removeEventListener('scroll', scheduleCaretHint, true);
    window.visualViewport?.removeEventListener('scroll', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', positionToolbar);
    window.visualViewport?.removeEventListener('scroll', positionToolbar);
    window.removeEventListener('resize', positionToolbar);
    document.removeEventListener('selectionchange', updateToolStates);
    document.removeEventListener('selectionchange', rememberSelection);
  });
  drawActions();
  followKeyboard();
  if (!record) setTimeout(() => titleIn.focus(), 50);
}

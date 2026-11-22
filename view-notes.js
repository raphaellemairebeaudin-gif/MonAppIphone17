import * as db from './db.js';
import { h, icon, row, empty, fmtDate, toast, errMsg } from './ui.js';

export const meta = { label: 'Notes', icon: 'notes' };

const RICH = 'RICH_HTML:';
const PREFIX_RE = /^(#{1,3} |- \[[ xX]\] |[-*] |\d+\. |> )/;
let query = '';

export function render(ctx, param) {
  if (param) return editor(ctx, param);
  ctx.setHead(meta.label, '');
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Rechercher dans les notes', value: query,
    oninput: () => { query = search.value; draw(); },
  });
  const body = h('div');
  ctx.main.append(search, body);
  ctx.setFab(() => { location.hash = '#/notes/new'; });

  function draw() {
    const q = query.trim().toLowerCase();
    const list = db.all('note')
      .filter((n) => !q || (n.data.title || '').toLowerCase().includes(q) || (n.data.body || '').toLowerCase().includes(q))
      .sort((a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || b.updated_at.localeCompare(a.updated_at));
    ctx.setHead(meta.label, db.all('note').length + ' note' + (db.all('note').length > 1 ? 's' : ''));
    if (!list.length) {
      body.replaceChildren(q ? empty('Aucun résultat', 'Essaie un autre mot.') : empty('Écris ta première note', 'Touche + pour commencer.'));
      return;
    }
    body.replaceChildren(...list.map((n) => {
      const raw = n.data.body || '';
      const first = raw.startsWith(RICH) ? (new DOMParser().parseFromString(raw.slice(RICH.length), 'text/html').body.textContent || '') : (raw.split('\n').find((l) => l.trim()) || '');
      return row(n.data.title || 'Sans titre', first.replace(PREFIX_RE, '').slice(0, 80) || fmtDate(n.updated_at.slice(0, 10)),
        n.data.pinned ? h('span', { class: 'pos' }, icon('pin')) : null,
        () => { location.hash = '#/notes/' + n.id; });
    }));
  }
  ctx.onData(draw);
  draw();
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
  let record = id === 'new' ? null : db.get(id);
  if (id !== 'new' && !record) { location.hash = '#/notes'; return; }
  const data = record ? { title: '', body: '', pinned: false, ...record.data } : { title: '', body: '', pinned: false };
  let timer = null;
  let chain = Promise.resolve();
  let deleted = false;
  let keyboardFrame = 0;

  ctx.setHead('', '', { back: '#/notes' });
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
        const safeClass = child.tagName === 'UL' && child.classList.contains('check-list') ? 'check-list' : child.tagName === 'LI' && child.classList.contains('check-item') ? 'check-item' : child.tagName === 'LABEL' && child.classList.contains('md-todo') ? 'md-todo' : '';
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        if (safeClass) child.className = safeClass;
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
    if (!rect?.height) {
      const line = element.closest('li, p, div, h2, h3, h4') || editable;
      const bounds = line.getBoundingClientRect();
      const style = getComputedStyle(line);
      const left = bounds.left + (parseFloat(style.paddingLeft) || 0);
      rect = { left, top: bounds.top, height: parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 20 };
    }
    if (!rect?.height) return;
    const style = getComputedStyle(element);
    const bold = document.queryCommandState('bold');
    const italic = document.queryCommandState('italic');
    const underline = document.queryCommandState('underline');
    caretHint.textContent = 'A';
    // Coordonnées dans le contenu de main, pas dans la fenêtre :
    // le repère défile avec la note sans se détacher de sa ligne.
    const hostRect = ctx.main.getBoundingClientRect();
    caretHint.style.left = Math.round(rect.left - hostRect.left + ctx.main.scrollLeft + 2) + 'px';
    caretHint.style.top = Math.round(rect.top - hostRect.top + ctx.main.scrollTop) + 'px';
    caretHint.style.fontFamily = style.fontFamily;
    caretHint.style.fontSize = style.fontSize;
    caretHint.style.lineHeight = style.lineHeight;
    caretHint.style.fontWeight = bold ? '700' : '400';
    caretHint.style.fontStyle = italic ? 'italic' : 'normal';
    caretHint.style.textDecoration = underline ? 'underline' : 'none';
    caretHint.hidden = false;
  };
  const scheduleCaretHint = () => {
    cancelAnimationFrame(hintFrame);
    hintFrame = requestAnimationFrame(updateCaretHint);
  };
  const beginEditing = () => { editingStarted = true; scheduleCaretHint(); };
  editable.addEventListener('pointerdown', beginEditing);
  editable.addEventListener('keydown', beginEditing);
  editable.addEventListener('input', beginEditing);
  editable.addEventListener('focus', scheduleCaretHint);
  editable.addEventListener('blur', () => { editingStarted = false; caretHint.hidden = true; });
  editable.addEventListener('keyup', scheduleCaretHint);
  editable.addEventListener('pointerup', scheduleCaretHint);
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
  const format = (command, value) => {
    editingStarted = true;
    editable.focus({ preventScroll: true });
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    document.execCommand(command, false, value);
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
    const block = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).closest('p, div, li');
    if (block && editable.contains(block) && block !== editable) block.after(list);
    else { range.collapse(false); range.insertNode(list); }
    const cursor = document.createRange(); cursor.selectNodeContents(li); cursor.collapse(false);
    selection.removeAllRanges(); selection.addRange(cursor);
    rememberSelection(); sync();
  };
  const tools = [
    ['heading', 'Titre', () => format('formatBlock', 'h2')],
    ['checkbox', 'Case à cocher', insertCheckbox],
    ['list', 'Liste à puces', () => toggleList('UL')],
    ['list-numbers', 'Liste numérotée', () => toggleList('OL')],
    ['bold', 'Gras', () => format('bold')],
    ['italic', 'Italique', () => format('italic')],
    ['quote', 'Citation', () => format('formatBlock', 'blockquote')],
    ['code', 'Code', () => format('formatBlock', 'pre')],
    ['minus', 'Séparateur', () => format('insertHorizontalRule')],
  ];
  toolbar.append(...tools.map(([ic, label, fn]) =>
    h('button', {
      type: 'button', 'aria-label': label,
      onpointerdown: (e) => { rememberSelection(); e.preventDefault(); },
      onmousedown: (e) => e.preventDefault(),
      onclick: fn,
    }, icon(ic))));
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
  editable.addEventListener('focus', followKeyboard);
  editable.addEventListener('blur', followKeyboard);
  titleIn.addEventListener('focus', followKeyboard);
  titleIn.addEventListener('blur', followKeyboard);

  function drawActions() {
    ctx.setActions([
      h('button', { class: 'icon-btn' + (data.pinned ? ' on' : ''), type: 'button', 'aria-label': 'Épingler', onclick: () => {
        data.pinned = !data.pinned; flush(); drawActions(); toast(data.pinned ? 'Note épinglée' : 'Note désépinglée');
      } }, icon('pin')),
      record && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Supprimer', onclick: async () => {
        if (!confirm('Supprimer cette note ?')) return;
        try { deleted = true; clearTimeout(timer); await chain; await db.remove(record.id); location.hash = '#/notes'; }
        catch (e) { deleted = false; toast(errMsg(e)); }
      } }, icon('trash')),
    ]);
  }

  ctx.main.classList.add('note-editing-host');
  ctx.main.append(titleIn, editable, status, toolbar, caretHint);
  ctx.onLeave(() => {
    ctx.main.classList.remove('note-editing-host');
    if (timer) flush();
    cancelAnimationFrame(keyboardFrame);
    cancelAnimationFrame(hintFrame);
    document.removeEventListener('selectionchange', scheduleCaretHint);
    window.removeEventListener('scroll', scheduleCaretHint, true);
    window.visualViewport?.removeEventListener('scroll', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', scheduleCaretHint);
    window.visualViewport?.removeEventListener('resize', positionToolbar);
    window.visualViewport?.removeEventListener('scroll', positionToolbar);
    window.removeEventListener('resize', positionToolbar);
    document.removeEventListener('selectionchange', rememberSelection);
  });
  drawActions();
  followKeyboard();
  if (!record) setTimeout(() => titleIn.focus(), 50);
}

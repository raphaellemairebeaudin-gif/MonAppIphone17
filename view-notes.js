import * as db from './db.js';
import { h, icon, row, empty, fmtDate, toast, errMsg } from './ui.js';

export const meta = { label: 'Notes', icon: 'notes' };

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
      const first = (n.data.body || '').split('\n').find((l) => l.trim()) || '';
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
  let row = id === 'new' ? null : db.get(id);
  if (id !== 'new' && !row) { location.hash = '#/notes'; return; }
  const data = row ? { title: '', body: '', pinned: false, ...row.data } : { title: '', body: '', pinned: false };
  let mode = row ? 'preview' : 'edit';
  let timer = null;
  let chain = Promise.resolve();
  let deleted = false;

  ctx.setHead('', '', { back: '#/notes' });
  const status = h('span', { class: 'status' });
  const titleIn = h('input', {
    class: 'note-title', placeholder: 'Titre', value: data.title, enterkeyhint: 'next',
    oninput: () => { data.title = titleIn.value; changed(); },
  });
  const ta = h('textarea', {
    class: 'note-body', placeholder: 'Écris ici…', value: data.body,
    oninput: () => { data.body = ta.value; autosize(); changed(); },
    onkeydown: (e) => {
      if (e.key !== 'Enter' || e.shiftKey || ta.selectionStart !== ta.selectionEnd) return;
      const v = ta.value, pos = ta.selectionStart;
      const ls = v.lastIndexOf('\n', pos - 1) + 1;
      const line = v.slice(ls, pos);
      const m = /^(- \[[ xX]\] |[-*] |(\d+)\. |> )/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (line.length === m[0].length) { ta.setRangeText('', ls, pos, 'end'); sync(); return; }
      let next = m[0];
      if (m[2]) next = (parseInt(m[2], 10) + 1) + '. ';
      else if (m[0].startsWith('- [')) next = '- [ ] ';
      ta.setRangeText('\n' + next, pos, pos, 'end');
      sync();
    },
  });
  const preview = h('div', { class: 'md' });
  const toolbar = h('div', { class: 'toolbar' });

  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, window.innerHeight * 0.5) + 'px'; };
  const sync = () => { data.body = ta.value; autosize(); changed(); };

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
    if (!row && !data.title.trim() && !data.body.trim()) { status.textContent = ''; return; }
    try {
      if (row) row = await db.update(row.id, { ...data });
      else {
        row = await db.add('note', { ...data });
        history.replaceState(null, '', '#/notes/' + row.id);
      }
      status.textContent = 'Enregistré';
      drawActions();
    } catch (e) { status.textContent = 'Non enregistré'; toast(errMsg(e)); }
  }

  function linePrefix(p) {
    ta.focus();
    const v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    const block = v.slice(ls, le).split('\n');
    const all = block.every((l) => l.startsWith(p));
    const nb = block.map((l) => (all ? l.slice(p.length) : p + l.replace(PREFIX_RE, '')));
    ta.setRangeText(nb.join('\n'), ls, le, 'end');
    sync();
  }
  function wrap(m) {
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(m + ta.value.slice(s, e) + m, s, e, 'end');
    if (s === e) ta.selectionStart = ta.selectionEnd = s + m.length;
    sync();
  }
  function insert(t) {
    ta.focus();
    ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
    sync();
  }

  const tools = [
    ['heading', 'Titre', () => linePrefix('# ')],
    ['checkbox', 'Case à cocher', () => linePrefix('- [ ] ')],
    ['list', 'Liste à puces', () => linePrefix('- ')],
    ['list-numbers', 'Liste numérotée', () => linePrefix('1. ')],
    ['bold', 'Gras', () => wrap('**')],
    ['italic', 'Italique', () => wrap('*')],
    ['quote', 'Citation', () => linePrefix('> ')],
    ['code', 'Code', () => wrap('`')],
    ['minus', 'Séparateur', () => insert('\n---\n')],
  ];
  toolbar.append(...tools.map(([ic, label, fn]) =>
    h('button', { type: 'button', 'aria-label': label, onmousedown: (e) => e.preventDefault(), onclick: fn }, icon(ic))));

  function drawPreview() {
    preview.replaceChildren(...renderMd(data.body, (idx) => {
      const lines = data.body.split('\n');
      lines[idx] = /\[ \]/.test(lines[idx]) ? lines[idx].replace('[ ]', '[x]') : lines[idx].replace(/\[[xX]\]/, '[ ]');
      data.body = lines.join('\n');
      ta.value = data.body;
      changed();
      drawPreview();
    }));
    if (!data.body.trim()) preview.append(h('p', { class: 'md-p', style: { color: 'var(--sec)' } }, 'Note vide. Touche le crayon pour écrire.'));
  }

  function drawMode() {
    const editing = mode === 'edit';
    ta.hidden = !editing;
    toolbar.hidden = !editing;
    preview.hidden = editing;
    if (editing) autosize(); else drawPreview();
    drawActions();
  }

  function drawActions() {
    ctx.setActions([
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': mode === 'edit' ? 'Aperçu' : 'Modifier', onclick: () => { mode = mode === 'edit' ? 'preview' : 'edit'; drawMode(); } },
        icon(mode === 'edit' ? 'eye' : 'pencil')),
      h('button', { class: 'icon-btn' + (data.pinned ? ' on' : ''), type: 'button', 'aria-label': 'Épingler', onclick: () => { data.pinned = !data.pinned; flush(); drawActions(); toast(data.pinned ? 'Note épinglée' : 'Note désépinglée'); } }, icon('pin')),
      row && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Supprimer', onclick: async () => {
        if (!confirm('Supprimer cette note ?')) return;
        try { deleted = true; await chain; await db.remove(row.id); location.hash = '#/notes'; } catch (e) { deleted = false; toast(errMsg(e)); }
      } }, icon('trash')),
    ]);
  }

  ctx.main.append(titleIn, toolbar, ta, preview, status);
  ctx.onLeave(() => { if (timer) flush(); });
  drawMode();
  if (!row) setTimeout(() => titleIn.focus(), 50);
}

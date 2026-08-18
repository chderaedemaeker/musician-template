/* ============================================================
   Musician-Template – CMS Admin (Simplified + Trilingual)
   ============================================================ */

// --------------- Git Gateway API (via Netlify Identity) ---------------
class GitGatewayAPI {
  constructor(tokenFn) {
    this._tokenFn = tokenFn; // async function; pass true to force a refresh
    // On localhost the Netlify services live on the deployed site
    this.base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'https://vdr-staging.netlify.app/.netlify/git/github'
      : '/.netlify/git/github';
    this.branch = 'master';
    this._refreshing = null; // single-flight token refresh
  }

  // Git Gateway signs commits with the site's GitHub connection, so the
  // real editor is recorded in the message itself
  _msg(message) {
    return this.author && this.author.email ? `${message}\n\nEdited by: ${this.author.email}` : message;
  }

  async _headers(forceRefresh) {
    const token = await this._tokenFn(forceRefresh);
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async _request(method, endpoint, body) {
    const url = `${this.base}${endpoint}`;
    // no-store: a cached GET would hand back a stale file sha, and every
    // save built on it fails with "does not match ..."
    const opts = { method, headers: await this._headers(), cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);
    let res = await fetch(url, opts);
    if (res.status === 401) {
      // Stale session (e.g. the tab sat open overnight): refresh the
      // token once — shared across parallel requests — and retry.
      if (!this._refreshing) {
        this._refreshing = this._headers(true).finally(() => { this._refreshing = null; });
      }
      try {
        opts.headers = await this._refreshing;
        res = await fetch(url, opts);
      } catch (e) {
        const err = new Error('Your login session has expired — please log out and log in again.');
        err.status = 401;
        throw err;
      }
      if (res.status === 401) {
        const err = new Error('Your login session has expired — please log out and log in again.');
        err.status = 401;
        throw err;
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.message || `Git Gateway ${res.status}`);
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getContents(path) {
    return this._request('GET', `/contents/${path}?ref=${this.branch}`);
  }

  async getFile(path) {
    const data = await this._request('GET', `/contents/${path}?ref=${this.branch}`);
    return {
      content: decodeBase64UTF8(data.content),
      sha: data.sha,
      path: data.path,
      size: data.size,
    };
  }

  async getFileInfo(path) {
    return this._request('GET', `/contents/${path}?ref=${this.branch}`);
  }

  async createOrUpdateFile(path, content, message, sha) {
    const body = { message: this._msg(message), content: encodeBase64UTF8(content), branch: this.branch };
    if (sha) body.sha = sha;
    if (this.author) { body.author = this.author; body.committer = this.author; }
    return this._request('PUT', `/contents/${path}`, body);
  }

  // Save with one retry: if the write fails because our sha is missing or
  // stale, look up the sha currently on the branch and try again.
  async saveFile(path, content, message, sha) {
    try {
      return await this.createOrUpdateFile(path, content, message, sha);
    } catch (e) {
      let freshSha;
      try { freshSha = (await this.getFileInfo(path)).sha; } catch (e2) { freshSha = undefined; }
      if (freshSha && freshSha !== sha) {
        return this.createOrUpdateFile(path, content, message, freshSha);
      }
      if (!freshSha && !sha) {
        // We never knew the file's sha AND we can't look it up now —
        // almost always a dropped connection or expired login session.
        throw new Error('Could not save — the connection or login session failed. Your changes are still in the form: reload the page, log in again, and press Save once more.');
      }
      if (/does not match/.test(e.message || '')) {
        // The branch moved between read and write — settle and try once more
        await new Promise(r => setTimeout(r, 900));
        const again = (await this.getFileInfo(path)).sha;
        return this.createOrUpdateFile(path, content, message, again);
      }
      throw e; // sha was correct — some other problem
    }
  }

  // Write several files as ONE commit — no per-file sha races when
  // saving a reordering or any other batch.
  async commitFiles(changes, message) {
    const branch = await this._request('GET', `/branches/${this.branch}`);
    const tree = await this._request('POST', '/git/trees', {
      base_tree: branch.commit.commit.tree.sha,
      tree: changes.map(c => ({ path: c.path, mode: '100644', type: 'blob', content: c.content })),
    });
    const commitBody = { message: this._msg(message), tree: tree.sha, parents: [branch.commit.sha] };
    if (this.author) { commitBody.author = this.author; commitBody.committer = this.author; }
    const commit = await this._request('POST', '/git/commits', commitBody);
    await this._request('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha });
    return commit;
  }

  async getBlob(sha) {
    const data = await this._request('GET', `/git/blobs/${sha}`);
    return decodeBase64UTF8(data.content);
  }

  async deleteFile(path, sha, message) {
    const body = { message: this._msg(message), sha, branch: this.branch };
    if (this.author) { body.author = this.author; body.committer = this.author; }
    return this._request('DELETE', `/contents/${path}`, body);
  }

  async uploadImage(path, base64content, message) {
    let sha;
    try {
      const existing = await this._request('GET', `/contents/${path}?ref=${this.branch}`);
      sha = existing.sha;
    } catch (e) { /* new file */ }
    const body = { message: this._msg(message), content: base64content, branch: this.branch };
    if (sha) body.sha = sha;
    if (this.author) { body.author = this.author; body.committer = this.author; }
    return this._request('PUT', `/contents/${path}`, body);
  }

  async getTree(path) {
    // Get the branch ref to find tree SHA
    const branch = await this._request('GET', `/branches/${this.branch}`);
    const treeSha = branch.commit.commit.tree.sha;
    // Get full tree recursively
    const tree = await this._request('GET', `/git/trees/${treeSha}?recursive=1`);
    // Filter to files in the given path
    const prefix = path.endsWith('/') ? path : path + '/';
    return tree.tree
      .filter(f => f.path.startsWith(prefix) && f.type === 'blob' && !f.path.substring(prefix.length).includes('/'))
      .map(f => ({ name: f.path.substring(prefix.length), path: f.path, sha: f.sha, size: f.size, type: 'file' }));
  }

  async verify() {
    return this._request('GET', `/contents/?ref=${this.branch}`);
  }
}

// --------------- Base64 helpers ---------------
function decodeBase64UTF8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeBase64UTF8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// --------------- Config Parser ---------------
class ConfigParser {
  constructor(yamlText) {
    this.raw = yamlText;
    this.config = jsyaml.load(yamlText);
  }
  getMediaFolder() { return this.config.media_folder || '_input/images'; }
  getAudioFolder() { return this.config.audio_folder || '_input/audio'; }
  getVideoFolder() { return this.config.video_folder || '_input/video'; }
  getLocales() { return this.config.i18n?.locales || ['en']; }
  getCollections() {
    return (this.config.collections || []).map(c => ({
      label: c.label, name: c.name, folder: c.folder,
      slug: c.slug || '{{slug}}', create: c.create !== false,
      i18n: c.i18n || false,
      i18nStructure: (typeof c.i18n === 'object' && c.i18n.structure) || (c.i18n === true ? 'multiple_folders' : null),
      fields: (c.fields || []).map(f => ({
        label: f.label, name: f.name, widget: f.widget || 'string',
        required: f.required !== false, i18n: f.i18n || false,
        default: f.default ?? '', format: f.format || '',
        autocomplete: f.autocomplete || false,
        hint: f.hint || '',
      })),
      summary: c.summary || '{{title}}', sort: c.sort || '',
    }));
  }
}

// --------------- Frontmatter ---------------
const FrontMatter = {
  parse(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { data: {}, body: text };
    const data = {};
    const unquote = v => {
      v = v.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1).replace(/\\"/g, '"');
      return v;
    };
    const lines = match[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A key with no value followed by "  - " lines is a list of objects
      const listKey = line.match(/^([A-Za-z0-9_]+):\s*$/);
      if (listKey && i + 1 < lines.length && lines[i + 1].trim().startsWith('- ')) {
        const arr = [];
        let cur = null;
        while (i + 1 < lines.length && /^\s+(-\s|[A-Za-z0-9_]+:)/.test(lines[i + 1])) {
          i++;
          let l = lines[i].trim();
          if (l.startsWith('- ')) { cur = {}; arr.push(cur); l = l.slice(2); }
          const ci = l.indexOf(':');
          if (ci !== -1 && cur) cur[l.slice(0, ci).trim()] = unquote(l.slice(ci + 1));
        }
        data[listKey[1]] = arr;
        continue;
      }
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      data[key] = unquote(line.slice(idx + 1));
    }
    return { data, body: match[2] };
  },
  serialize(data, body) {
    const quote = v => {
      const val = v == null ? '' : String(v);
      if (val === '' || val.includes(':') || val.includes('#') || val.includes('{') || val.includes('}') || val.includes('[') || val.includes(']'))
        return `"${val.replace(/"/g, '\\"')}"`;
      return val;
    };
    let out = '---\n';
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        const items = v.filter(item => item && Object.values(item).some(x => x && String(x).trim()));
        if (!items.length) continue;
        out += `${k}:\n`;
        for (const item of items) {
          Object.entries(item).forEach(([ik, iv], idx) => {
            out += (idx === 0 ? '  - ' : '    ') + `${ik}: ${quote(iv)}\n`;
          });
        }
        continue;
      }
      out += `${k}: ${quote(v)}\n`;
    }
    out += '---\n';
    if (body) out += body;
    return out;
  }
};

// --------------- Helpers ---------------
function slugify(text) {
  return text.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 60);
}

function generateFilename(title) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${slugify(title)}.md`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// File-type tests shared by the media library and the pickers
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif|heic|heif)$/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm)$/i;

// Photographer credits: public image path → name, read by the site build
const CREDITS_FILE_PATH = '_input/_data/image_credits.json';
// One spelling per filename — macOS writes accents decomposed (NFD),
// so keys and lookups both go through NFC before comparing
function normalizePathKey(s) {
  try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
  return s.normalize ? s.normalize('NFC') : s;
}

// A human title from a filename: "berio-sequenza_viii live.mp3" → "berio sequenza viii live"
function titleFromFilename(name) {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
}

// Map over items with at most `limit` calls in flight — firing hundreds of
// requests at once gets rate-limited by git-gateway.
async function pMap(items, fn, limit = 8) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// --------------- Toast ---------------
function showToast(type, msg, duration) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span><button class="toast-dismiss">&times;</button>`;
  container.appendChild(toast);
  const dismiss = () => { toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 300); };
  toast.querySelector('.toast-dismiss').addEventListener('click', dismiss);
  if (type !== 'saving') setTimeout(dismiss, duration || (type === 'error' ? 5000 : 3000));
  return toast;
}

let _savingToast = null;
function showStatus(type, msg) {
  if (_savingToast && _savingToast.parentNode) { try { _savingToast.classList.add('toast-out'); const t = _savingToast; setTimeout(() => { if (t.parentNode) t.remove(); }, 300); } catch(e) {} _savingToast = null; }
  const toast = showToast(type, msg);
  if (type === 'saving') _savingToast = toast;
}

// --------------- Modal ---------------
function showModal(title, message, opts) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('h3').textContent = title;
    const pEl = overlay.querySelector('p');
    if (opts && opts.html) pEl.innerHTML = opts.html;
    else pEl.textContent = message;
    const okBtn = overlay.querySelector('.modal-ok');
    okBtn.textContent = (opts && opts.okLabel) || 'Delete';
    okBtn.className = `btn ${(opts && opts.okClass) || 'btn-danger'} modal-ok`;
    overlay.classList.add('visible');
    const btnCancel = overlay.querySelector('.modal-cancel');
    function cleanup(val) { overlay.classList.remove('visible'); okBtn.removeEventListener('click', onOk); btnCancel.removeEventListener('click', onCancel); resolve(val); }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

// --------------- Markdown Renderer ---------------
function renderMarkdown(md) {
  if (!md) return '';
  let html = md;
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
  const preBlocks = [];
  html = html.replace(/<pre><code>[\s\S]*?<\/code><\/pre>/g, match => { preBlocks.push(match); return `%%PRE${preBlocks.length-1}%%`; });
  const lines = html.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const preMatch = line.match(/^%%PRE(\d+)%%$/);
    if (preMatch) { result.push(preBlocks[parseInt(preMatch[1])]); i++; continue; }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) { result.push('<hr>'); i++; continue; }
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) { result.push(`<h${hMatch[1].length}>${inlineMd(hMatch[2])}</h${hMatch[1].length}>`); i++; continue; }
    if (line.trimStart().startsWith('> ')) { const q = []; while (i < lines.length && lines[i].trimStart().startsWith('> ')) { q.push(lines[i].trimStart().slice(2)); i++; } result.push(`<blockquote><p>${inlineMd(q.join(' '))}</p></blockquote>`); continue; }
    if (/^\s*[-*+]\s+/.test(line)) { const items = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; } result.push('<ul>' + items.map(x => `<li>${inlineMd(x)}</li>`).join('') + '</ul>'); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const items = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; } result.push('<ol>' + items.map(x => `<li>${inlineMd(x)}</li>`).join('') + '</ol>'); continue; }
    if (line.trim() === '') { i++; continue; }
    const p = []; while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^#{1,6}\s/) && !lines[i].trimStart().startsWith('> ') && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim()) && !lines[i].match(/^%%PRE\d+%%$/)) { p.push(lines[i]); i++; }
    if (p.length) {
      // The site renders markdown with breaks:true — every newline inside
      // a paragraph is a visible line break. Mirror that here.
      result.push(`<p>${p.map(line => inlineMd(line.replace(/\s+$/, ''))).join('<br>')}</p>`);
    }
  }
  return result.join('\n');
}

// In the visual editor, a bare <audio> tag becomes a small widget with an
// editable title field, so the title is visible and changeable without
// touching HTML. The serializer turns it back into the plain tag.
function decorateRichAudio(rich) {
  rich.querySelectorAll('audio').forEach(a => {
    if (a.closest('.re-audio')) return;
    const src = a.getAttribute('src') || (a.querySelector('source') && a.querySelector('source').getAttribute('src')) || '';
    const title = a.getAttribute('data-title') || '';
    const box = document.createElement('div');
    box.className = 're-audio';
    box.contentEditable = 'false';
    box.setAttribute('data-src', src);
    box.innerHTML = `<div class="re-audio-head"><span class="re-audio-icon">&#9835;</span><input class="re-audio-title" placeholder="Title shown on the player" value="${esc(title)}" /></div>`;
    const player = document.createElement('audio');
    player.controls = true; player.preload = 'none'; player.src = src;
    box.appendChild(player);
    // An audio alone in its paragraph replaces the whole paragraph
    const p = a.parentElement;
    const target = (p && p.tagName === 'P' && p.textContent.trim() === '' && p.querySelectorAll('audio,img').length === 1) ? p : a;
    target.replaceWith(box);
    const inp = box.querySelector('.re-audio-title');
    // Mirror typed text into the attribute: the serializer works on clones,
    // and a clone only carries the attribute, not the live value
    inp.addEventListener('input', () => inp.setAttribute('value', inp.value));
  });
}

// --------------- HTML → Markdown (for the rich editor) ---------------
function htmlToMarkdown(root) {
  const audioMd = el => {
    let src, title;
    if (el.tagName === 'AUDIO') {
      src = el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src')) || '';
      title = el.getAttribute('data-title') || '';
    } else { // .re-audio widget
      const a = el.querySelector('audio');
      src = (a && a.getAttribute('src')) || el.getAttribute('data-src') || '';
      const inp = el.querySelector('.re-audio-title');
      title = inp ? inp.value.trim() : '';
    }
    return `<audio controls src="${src}"${title ? ` data-title="${title.replace(/"/g, '&quot;')}"` : ''}></audio>`;
  };
  const isAudioWidget = el => el.classList && el.classList.contains('re-audio');

  const inline = (node) => {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { out += child.nodeValue.replace(/ /g, ' ').replace(/\n/g, ' '); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const t = child.tagName;
      if (t === 'BR') out += '<br>';
      else if (t === 'STRONG' || t === 'B') { const s = inline(child); if (s.trim()) out += `**${s.trim()}**`; }
      else if (t === 'EM' || t === 'I') { const s = inline(child); if (s.trim()) out += `*${s.trim()}*`; }
      else if (t === 'A') out += `[${inline(child).trim() || child.getAttribute('href') || ''}](${child.getAttribute('href') || ''})`;
      else if (t === 'IMG') out += `![${child.getAttribute('alt') || ''}](${child.getAttribute('src') || ''})`;
      else if (t === 'AUDIO' || isAudioWidget(child)) out += audioMd(child);
      else if (t === 'IFRAME' || t === 'EMBED' || t === 'OBJECT' || t === 'VIDEO') out += child.outerHTML;
      else if (t === 'CODE') out += '`' + child.textContent + '`';
      else out += inline(child);
    }
    return out;
  };

  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR']);
  const blocks = [];
  // A single Enter is a literal <br>; two Enters in a row become a real
  // paragraph break. Stray breaks at a paragraph's edges are dropped.
  const pushParagraph = (md) => {
    md.split(/(?:\s*<br>\s*){2,}/).forEach(part => {
      const t = part.replace(/^(?:<br>|[ \n])+|(?:<br>|[ \n])+$/g, '');
      if (t) blocks.push(t);
    });
  };
  let run = [];
  const flushRun = () => {
    if (!run.length) return;
    const frag = document.createElement('div');
    run.forEach(n => frag.appendChild(n.cloneNode(true)));
    pushParagraph(inline(frag));
    run = [];
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && isAudioWidget(child)) {
        flushRun();
        blocks.push(audioMd(child));
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName)) {
        flushRun();
        const t = child.tagName;
        if (t === 'HR') { blocks.push('---'); continue; }
        if (t === 'PRE') { blocks.push('```\n' + child.textContent.replace(/\n$/, '') + '\n```'); continue; }
        if (/^H[1-6]$/.test(t)) { const s = inline(child).trim(); if (s) blocks.push('#'.repeat(parseInt(t[1], 10)) + ' ' + s); continue; }
        if (t === 'UL' || t === 'OL') {
          const items = [...child.children].filter(li => li.tagName === 'LI')
            .map((li, i) => (t === 'UL' ? '- ' : `${i + 1}. `) + inline(li).trim());
          if (items.length) blocks.push(items.join('\n'));
          continue;
        }
        if (t === 'BLOCKQUOTE') {
          const s = inline(child).trim();
          if (s) blocks.push(s.split('\n').map(l => '> ' + l.replace(/ +$/, '')).join('\n'));
          continue;
        }
        // A styled or embed-bearing DIV (e.g. a SoundCloud attribution block)
        // is preserved exactly as it is
        if (t === 'DIV' && (child.getAttribute('style') || child.querySelector('iframe,embed,object,video'))) {
          blocks.push(child.outerHTML);
          continue;
        }
        // P or DIV: a div holding further blocks recurses; otherwise it's a paragraph
        if ([...child.children].some(el => BLOCK.has(el.tagName))) { walk(child); continue; }
        pushParagraph(inline(child));
        continue;
      }
      run.push(child);
    }
    flushRun();
  };

  walk(root);
  return blocks.join('\n\n');
}

function inlineMd(text) {
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

// --------------- App ---------------
class App {
  constructor() {
    this.api = null;
    this.config = null;
    this.collections = [];
    this.el = document.getElementById('app');
    this._unsavedChanges = false;
    this._editorState = null;
    this._previewTimer = null;
    this._imageCache = null;
    this._identityUser = null;

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
      }
      if (e.key === 'Escape') {
        if (document.querySelector('.modal-overlay.visible') || document.querySelector('.image-lightbox.visible') || document.querySelector('.image-picker-overlay.visible')) return;
        const hash = location.hash || '#/';
        if (hash.includes('/edit/') || hash.includes('/new')) {
          const m = hash.match(/^#\/([a-z]+)\//);
          if (m) { if (this._unsavedChanges && !confirm('You have unsaved changes. Leave anyway?')) return; location.hash = `#/${m[1]}`; }
        } else if (hash !== '#/' && hash !== '#') location.hash = '#/';
      }
    });

    window.addEventListener('beforeunload', (e) => { if (this._unsavedChanges) { e.preventDefault(); e.returnValue = ''; } });
  }

  init() {
    window.addEventListener('hashchange', () => { this._unsavedChanges = false; this._editorState = null; this.route(); });

    // Netlify Identity event handlers
    if (window.netlifyIdentity) {
      if (window.netlifyIdentitySettings) netlifyIdentity.init(window.netlifyIdentitySettings);
      netlifyIdentity.on('login', (user) => {
        this._onIdentityLogin(user);
      });
      netlifyIdentity.on('logout', () => {
        this._onIdentityLogout();
      });

      // Check if already logged in
      const currentUser = netlifyIdentity.currentUser();
      if (currentUser) {
        this._onIdentityLogin(currentUser);
      } else {
        this.route();
      }
    } else {
      this.route();
    }
  }

  _onIdentityLogin(user) {
    this._identityUser = user;
    this.api = new GitGatewayAPI((force) => {
      // jwt() refreshes the token only when it has expired; jwt(true)
      // forces a refresh and is used exactly once when a request comes
      // back 401 (rate-limited if called for every request in parallel).
      return this._identityUser.jwt(force === true);
    });
    // Commits on GitHub carry who actually made the edit
    this.api.author = {
      name: (user.user_metadata && user.user_metadata.full_name) || user.email,
      email: user.email,
    };
    netlifyIdentity.close();
    this.loadConfig().then(() => this.route());
  }

  _onIdentityLogout() {
    this._identityUser = null;
    this.api = null;
    this.config = null;
    this.collections = [];
    location.hash = '#/login';
  }

  logout() {
    if (window.netlifyIdentity) {
      netlifyIdentity.logout();
    }
    this._identityUser = null;
    this.api = null;
    this.config = null;
    this.collections = [];
    location.hash = '#/login';
  }

  async loadConfig() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await this.api.getFile('_input/admin/config.yml');
        this.config = new ConfigParser(file.content);
        this.collections = this.config.getCollections();
        return;
      } catch (e) {
        console.error('Failed to load config:', e);
        if (e.status === 401) {
          showStatus('error', 'Your login session has expired — please log in again.');
          this.logout();
          return;
        }
        if (attempt === 0) continue; // one silent retry for network blips
        showStatus('error', 'Could not load the settings (connection problem?). Reload the page to try again.');
      }
    }
  }

  _markDirty() { this._unsavedChanges = true; const b = document.getElementById('save-btn'); if (b) b.classList.add('has-changes'); }
  _markClean() { this._unsavedChanges = false; const b = document.getElementById('save-btn'); if (b) b.classList.remove('has-changes'); }

  // ---- Router ----
  route() {
    const hash = location.hash || '#/';
    if (!this.api && !hash.startsWith('#/login')) { location.hash = '#/login'; return; }
    if (hash === '#/login') { if (this.api) { location.hash = '#/'; return; } return this.renderLogin(); }
    if (hash === '#/settings') return this.renderSettings();
    if (hash === '#/hero') return this.renderHero();
    if (hash === '#/' || hash === '#') return this.renderDashboard();
    if (hash === '#/media') return this.renderMedia();
    const colMatch = hash.match(/^#\/([a-z]+)$/);
    if (colMatch) return this.renderCollection(colMatch[1]);
    const newMatch = hash.match(/^#\/([a-z]+)\/new$/);
    if (newMatch) return this.renderEditor(newMatch[1], null);
    const editMatch = hash.match(/^#\/([a-z]+)\/edit\/(.+)$/);
    if (editMatch) return this.renderEditor(editMatch[1], decodeURIComponent(editMatch[2]));
    this.renderDashboard();
  }

  _topbar() {
    return `<div class="topbar">
      <a href="#/" class="topbar-brand">Content Manager</a>
      <div class="topbar-actions">
        <button class="btn btn-ghost btn-sm topbar-settings">Settings</button>
        <button class="btn btn-ghost btn-sm topbar-logout">Logout</button>
      </div>
    </div>`;
  }
  _bindTopbar() {
    const s = this.el.querySelector('.topbar-settings');
    const l = this.el.querySelector('.topbar-logout');
    if (s) s.addEventListener('click', () => { location.hash = '#/settings'; });
    if (l) l.addEventListener('click', () => this.logout());
  }

  // ---- Login ----
  renderLogin() {
    this.el.innerHTML = `
      <div class="login-wrapper">
        <div class="login-card">
          <h1>Content Manager</h1>
          <p class="subtitle">Sign in to manage your content.</p>
          <button id="login-btn" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:.75rem;">Sign In</button>
        </div>
      </div>`;
    document.getElementById('login-btn').addEventListener('click', () => {
      if (window.netlifyIdentity) {
        netlifyIdentity.open('login');
      } else {
        showStatus('error', 'Netlify Identity widget not loaded.');
      }
    });
  }

  // ---- Dashboard ----
  async renderDashboard() {
    if (!this.collections.length) {
      this.el.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading...</div>';
      await this.loadConfig();
      if (this.collections.length) return this.renderDashboard();
      this.el.innerHTML = '<div class="empty-state">Could not load collections.</div>';
      return;
    }
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><span>Dashboard</span></nav>
      <div class="dashboard-grid">
        ${this.collections.map(c => `
          <div class="card" data-col="${c.name}">
            <div class="card-label">${esc(c.label)}<span class="card-badge" id="badge-${c.name}" style="display:none;"></span></div>

          </div>
        `).join('')}
        <div class="card" id="media-card">
          <div class="card-label">Media</div>
          <div class="card-count">Images & files</div>
        </div>
        <div class="card" id="hero-card">
          <div class="card-label">Hero Image</div>
          <div class="card-count">Homepage photo</div>
        </div>
      </div>
      <div class="recent-edits">
        <h3>Latest changes</h3>
        <div id="recent-edits-list"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>
      </div>`;
    this.el.querySelectorAll('.card[data-col]').forEach(card => card.addEventListener('click', () => {
      // About is a single page — skip the list and open the editor directly
      location.hash = card.dataset.col === 'about' ? '#/about/edit/about.md' : `#/${card.dataset.col}`;
    }));
    document.getElementById('media-card').addEventListener('click', () => { location.hash = '#/media'; });
    document.getElementById('hero-card').addEventListener('click', () => { location.hash = '#/hero'; });
    this._bindTopbar();
    for (const col of this.collections) this._fetchEntryCount(col);
    this._loadRecentEdits();
  }

  // Who changed what, straight from the branch history — paged,
  // "Show more" appends the next page
  async _loadRecentEdits(page) {
    const el = document.getElementById('recent-edits-list');
    if (!el) return;
    const perPage = 14;
    page = page || 1;
    try {
      const commits = await this.api._request('GET', `/commits?per_page=${perPage}&page=${page}&sha=${this.api.branch}`);
      const rows = commits.map(c => {
        const full = c.commit.message || '';
        const msg = esc(full.split('\n')[0]);
        const a = c.commit.author || {};
        const stamped = full.match(/^Edited by: (.+)$/m);
        const who = esc((stamped && stamped[1]) || a.email || a.name || 'unknown');
        const when = a.date ? new Date(a.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="recent-edit-row">
          <span class="recent-edit-msg">${msg}</span>
          <span class="recent-edit-meta">${who}${when ? ' &middot; ' + when : ''}</span>
        </div>`;
      }).join('');
      const moreBtn = document.getElementById('recent-edits-more');
      if (moreBtn) moreBtn.remove();
      if (page === 1) el.innerHTML = rows || '<div class="empty-state">No changes yet.</div>';
      else el.insertAdjacentHTML('beforeend', rows);
      if (commits.length === perPage) {
        el.insertAdjacentHTML('beforeend', '<div class="recent-edits-more-wrap"><button type="button" class="btn btn-ghost btn-sm" id="recent-edits-more">Show more</button></div>');
        document.getElementById('recent-edits-more').addEventListener('click', () => this._loadRecentEdits(page + 1));
      }
    } catch (e) {
      if (page === 1) el.innerHTML = '<div class="empty-state">Could not load the history.</div>';
      else showStatus('error', 'Could not load more history.');
    }
  }

  async _fetchEntryCount(col) {
    try {
      const folder = (col.i18n || col.i18nStructure) ? col.folder + '/en' : col.folder;
      const contents = await this.api.getContents(folder);
      const count = contents.filter(f => f.name.endsWith('.md')).length;
      const badge = document.getElementById(`badge-${col.name}`);
      if (badge) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    } catch (e) {}
  }

  // ---- Settings ----
  renderSettings() {
    const user = this._identityUser;
    const email = user ? (user.email || user.user_metadata?.full_name || 'Unknown') : 'Not signed in';
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Settings</span></nav>
      <div class="settings-section">
        <h3>Account</h3>
        <p style="font-size:.9rem;color:var(--dark-grey);margin-bottom:1.5rem;">Signed in as <strong>${esc(email)}</strong></p>
        <button id="set-logout" class="btn btn-danger">Logout</button>
      </div>`;
    this._bindTopbar();
    document.getElementById('set-logout').addEventListener('click', () => this.logout());
  }

  // ---- Collection List ----
  async renderCollection(name) {
    const col = this.collections.find(c => c.name === name);
    if (!col) { location.hash = '#/'; return; }

    // Concerts get the Notion-style table view
    if (name === 'concerts') return this.renderConcertTable(col);

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>${esc(col.label)}</span></nav>
      <div class="list-header">
        <h2>${esc(col.label)}</h2>
        ${col.create ? `<button class="btn btn-primary btn-sm" id="new-entry-btn">+ New</button>` : ''}
      </div>
      <div class="collection-filter"><input type="text" id="collection-search" placeholder="Search..." /></div>
      <div id="bulk-bar" class="bulk-bar" style="display:none;"><span id="bulk-count">0</span><button class="btn btn-sm" id="bulk-delete-btn">Delete</button></div>
      <div id="entry-list" class="entry-list"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
    this._bindTopbar();
    const newBtn = document.getElementById('new-entry-btn');
    if (newBtn) newBtn.addEventListener('click', () => { location.hash = `#/${name}/new`; });

    try {
      const isI18n = !!(col.i18n || col.i18nStructure);
      const contents = await this.api.getContents(isI18n ? col.folder + '/en' : col.folder);
      const files = contents.filter(f => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
      const listEl = document.getElementById('entry-list');
      if (!files.length) { listEl.innerHTML = '<div class="empty-state">No entries yet.</div>'; return; }

      let entries = await pMap(files, async f => {
        try {
          const fd = await this.api.getFile(f.path);
          return { name: f.name, data: FrontMatter.parse(fd.content).data, path: f.path, sha: fd.sha };
        } catch { return { name: f.name, data: { title: f.name }, path: f.path, sha: null }; }
      });
      if (col.name === 'projects') {
        entries = entries.sort((a, b) => (a.data.order != null ? a.data.order : 9999) - (b.data.order != null ? b.data.order : 9999));
      }

      listEl.innerHTML = `<div class="entry-row" style="border-bottom:1px solid var(--warm-grey);cursor:default;padding:.5rem 0;">
          <div class="entry-row-left"><input type="checkbox" class="entry-checkbox" id="select-all-checkbox" /><span style="font-size:.65rem;color:var(--mid-grey);margin-left:.4rem;text-transform:uppercase;letter-spacing:.08em;">Select all</span></div>
        </div>` +
        entries.map(e => {
          const title = e.data.title || e.name;
          const date = e.data.date ? e.data.date.replace('T', ' ').substring(0, 16) : '';
          const status = e.data.status || '';
          const badgeHtml = status === 'draft'
            ? '<span class="entry-status-badge status-draft">Draft</span>'
            : status === 'archived'
            ? '<span class="entry-status-badge status-archived">Archived</span>'
            : '';
          const showThumb = ['projects', 'highlights'].includes(col.name);
          const thumbSrc = e.data.image ? (String(e.data.image).startsWith('/') ? e.data.image : '/images/' + e.data.image) : '';
          const thumbHtml = showThumb
            ? (thumbSrc
              ? `<img class="entry-thumb" src="${esc(thumbSrc)}" alt="" loading="lazy" onerror="this.classList.add('entry-thumb--empty');this.removeAttribute('src');" />`
              : '<span class="entry-thumb entry-thumb--empty"></span>')
            : '';
          return `<div class="entry-row" data-file="${esc(e.name)}" data-title="${esc(title)}" data-sha="${esc(e.sha||'')}" data-path="${esc(e.path)}">
            <div class="entry-row-left">
              ${col.name === 'projects' ? '<span class="drag-handle" title="Drag to reorder">&#8801;</span>' : ''}
              <input type="checkbox" class="entry-checkbox entry-select" data-file="${esc(e.name)}" />
              ${thumbHtml}
              <div style="min-width:0;"><div class="entry-title${status === 'archived' ? ' entry-title--archived' : ''}">${esc(title)}${badgeHtml}</div>${date ? `<div class="entry-meta">${esc(date)}</div>` : ''}</div>
            </div>
          </div>`;
        }).join('');

      listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
        row.addEventListener('click', e => { if (e.target.closest('.entry-checkbox') || e.target.closest('.drag-handle')) return; location.hash = `#/${name}/edit/${encodeURIComponent(row.dataset.file)}`; });
      });

      // Ensembles are hand-ordered: drag a row to move it, the site follows
      if (col.name === 'projects') this._enableEntryDragOrder(listEl, col);

      // Search
      document.getElementById('collection-search').addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
          row.style.display = (!q || (row.dataset.title||'').toLowerCase().includes(q) || (row.dataset.file||'').toLowerCase().includes(q)) ? '' : 'none';
        });
      });

      // Bulk
      this._bindBulkOps(listEl, entries, col, name);
    } catch (e) {
      document.getElementById('entry-list').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
    }
  }

  // ---- Notion-style Concert Table ----
  async renderConcertTable(col) {
    const columns = [
      { key: 'title', label: 'Title', width: 'fit-content(26rem)' },
      { key: 'date', label: 'Date', width: 'max-content', type: 'date' },
      { key: 'place', label: 'Place', width: 'fit-content(15rem)' },
      { key: 'composers', label: 'Composers', width: 'fit-content(15rem)' },
      { key: 'collaborators', label: 'Collaborators', width: 'minmax(10rem, auto)' },
    ];
    const colWidths = columns.map(c => c.width).join(' ');
    const gridCols = '0px 96px ' + colWidths;

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>${esc(col.label)}</span></nav>
      <div class="list-header">
        <h2>${esc(col.label)}</h2>
        <div style="display:flex;gap:.5rem;">
          <button class="btn btn-ghost btn-sm" id="select-mode-btn">Select</button>
          <button class="btn btn-primary btn-sm" id="new-row-btn">+ New</button>
        </div>
      </div>
      <div class="collection-filter" style="display:flex;gap:.75rem;align-items:center;">
        <input type="text" id="table-search" placeholder="Search concerts..." style="flex:1;" />
        <select id="table-limit" class="table-limit" title="How many concerts to load">
          <option value="30">Show 30</option>
          <option value="50">Show 50</option>
          <option value="100">Show 100</option>
          <option value="0">Show all</option>
        </select>
      </div>
      <div class="table-pills">
        <div class="pill-group" id="scope-pills" role="group" aria-label="Which concerts to show">
          <button type="button" class="table-pill" data-scope="all">All</button>
          <button type="button" class="table-pill active" data-scope="upcoming">Upcoming</button>
          <button type="button" class="table-pill" data-scope="archive">Archive</button>
        </div>
        <div class="pill-group" id="issue-pills" role="group" aria-label="Find incomplete concerts">
          <button type="button" class="table-pill table-pill--issue" data-issue="nohour" title="Concerts whose time is still 00:00 (month-only concerts don't count)">No hour</button>
          <button type="button" class="table-pill table-pill--issue" data-issue="nolink" title="Concerts without a tickets/info link">No link</button>
        </div>
      </div>
      <div id="bulk-bar" class="bulk-bar" style="display:none;"><span id="bulk-count">0</span><button class="btn btn-sm" id="bulk-delete-btn">Delete</button></div>
      <div class="notion-table-wrap">
        <div class="notion-table" id="notion-table" style="grid-template-columns: ${gridCols};">
          <div class="notion-th notion-th-check"><input type="checkbox" id="select-all-checkbox" class="entry-checkbox" /></div>
          <div class="notion-th"></div>
          ${columns.map(c => `<div class="notion-th" data-sort="${c.key}">${esc(c.label)}<span class="sort-icon"></span></div>`).join('')}
          <div id="notion-body"><div class="loading-state"><span class="spinner"></span> Loading concerts...</div></div>
        </div>
      </div>`;
    this._bindTopbar();

    const savedLimit = parseInt(localStorage.getItem('concertTableLimit') || '30', 10);
    this._concertTableState = { entries: [], files: [], loadedCount: 0, limit: savedLimit, col, columns, gridCols, sortKey: 'date', sortDir: 'desc', saveTimers: {}, scope: 'upcoming', filterNoHour: false, filterNoLink: false };
    const limitSel = document.getElementById('table-limit');
    limitSel.value = String(savedLimit);
    limitSel.addEventListener('change', () => {
      const n = parseInt(limitSel.value, 10);
      localStorage.setItem('concertTableLimit', String(n));
      this._concertTableState.limit = n;
      this._loadConcertRows();
    });

    try {
      // One tree request gives every file's path AND blob sha — the sha must
      // always be known, or saving a row fails with "sha wasn't supplied".
      const tree = await this.api.getTree(col.folder);
      // Filenames start with the date, so this is newest-first
      this._concertTableState.files = tree.filter(f => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
      const bodyEl = document.getElementById('notion-body');
      if (!this._concertTableState.files.length) { bodyEl.innerHTML = '<div class="empty-state">No concerts yet.</div>'; return; }

      await this._loadConcertRows();
      this._bindTableEvents();
      // The table opens on Upcoming — quietly fetch the rest so the view
      // is complete even when many concerts lie ahead
      const st = this._concertTableState;
      if (st.scope !== 'all' && st.loadedCount < st.files.length && !st._loadingAll) {
        st._loadingAll = true;
        const prevLimit = st.limit;
        st.limit = 0;
        this._loadConcertRows().then(() => {
          st.limit = prevLimit;
          st._loadingAll = false;
          this._applyConcertFilters();
        });
      }
    } catch (e) {
      document.getElementById('notion-body').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
    }
  }

  // Fetch only as many concert files as the limit asks for; already-loaded
  // rows are kept, so raising the limit only fetches the difference.
  async _loadConcertRows() {
    const state = this._concertTableState;
    const wanted = state.limit === 0 ? state.files.length : Math.min(state.limit, state.files.length);
    if (state.loadedCount < wanted) {
      const toLoad = state.files.slice(state.loadedCount, wanted);
      const bodyEl = document.getElementById('notion-body');
      if (!state.entries.length) bodyEl.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading...</div>';
      const fresh = await pMap(toLoad, async f => {
        try {
          const parsed = FrontMatter.parse(await this.api.getBlob(f.sha));
          return { name: f.name, data: parsed.data, body: parsed.body, path: f.path, sha: f.sha, dirty: false, loadFailed: false };
        } catch { return { name: f.name, data: { title: f.name }, body: '', path: f.path, sha: f.sha, dirty: false, loadFailed: true }; }
      });
      state.entries.push(...fresh);
      state.loadedCount = wanted;
    }
    state.visibleCount = wanted;
    this._renderTableRows();
    this._bindTableRowEvents();
  }

  _renderTableRows() {
    const state = this._concertTableState;
    const { columns, gridCols, sortKey, sortDir } = state;
    const entries = state.visibleCount ? state.entries.slice(0, state.visibleCount) : state.entries;

    const sorted = [...entries].sort((a, b) => {
      // Broken rows (no date) always float to the top, whatever the sort
      const aBad = !a.data.date ? 0 : 1;
      const bBad = !b.data.date ? 0 : 1;
      if (aBad !== bBad) return aBad - bBad;
      const va = (a.data[sortKey] || '').toLowerCase();
      const vb = (b.data[sortKey] || '').toLowerCase();
      if (!va && !vb) return 0;
      if (!va) return 1; // entries without a value always sort last
      if (!vb) return -1;
      if (sortKey === 'date') {
        // ISO date strings — plain string comparison, immune to locale collation
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    const bodyEl = document.getElementById('notion-body');
    bodyEl.innerHTML = sorted.map((entry, i) => {
      const idx = entries.indexOf(entry);
      const dateVal = entry.data.date ? entry.data.date.substring(0, 10) : '';
      const timeVal = entry.data.date ? entry.data.date.substring(11, 16) : '';
      return `<div class="notion-row${entry.dirty ? ' notion-row-dirty' : ''}${entry.loadFailed ? ' notion-row-loadfailed' : ''}${entry.data.status === 'archived' ? ' notion-row-archived' : ''}${!entry.data.date ? ' notion-row-nodate' : (String(entry.data.month_only) === 'true' || !/T(?!00:00)\d\d:\d\d/.test(entry.data.date) ? ' notion-row-notime' : '')}" data-idx="${idx}"${entry.loadFailed ? ' title="This row failed to load — its saved data is safe and will reappear after you edit and save, or reload the page."' : ''}>
        <div class="notion-cell notion-cell-check"><input type="checkbox" class="entry-checkbox entry-select" data-idx="${idx}" data-file="${esc(entry.name)}" /></div>
        <div class="notion-cell notion-cell-actions"><button class="notion-open-btn" data-file="${esc(entry.name)}" title="Open the full editor">Open</button><button class="notion-dup-btn" data-idx="${idx}" title="Duplicate this concert">&#x2398;</button></div>
        <div class="notion-cell notion-cell-title" data-field="title" data-idx="${idx}" contenteditable="true">${esc(entry.data.title || '')}</div>
        <div class="notion-cell notion-cell-date" data-field="date" data-idx="${idx}"><input type="date" class="notion-date-input" value="${esc(dateVal)}" data-idx="${idx}" /><input type="time" class="notion-time-input" value="${timeVal === '00:00' ? '' : esc(timeVal)}" data-idx="${idx}" title="Hour — leave empty for 00:00 (no hour shown on the site)" /></div>
        <div class="notion-cell" data-field="place" data-idx="${idx}" contenteditable="true">${esc(entry.data.place || '')}</div>
        <div class="notion-cell" data-field="composers" data-idx="${idx}" contenteditable="true">${esc(entry.data.composers || '')}</div>
        <div class="notion-cell" data-field="collaborators" data-idx="${idx}" contenteditable="true">${esc(entry.data.collaborators || '')}</div>
      </div>`;
    }).join('');

    // Update sort indicators
    document.querySelectorAll('.notion-th[data-sort]').forEach(th => {
      const icon = th.querySelector('.sort-icon');
      if (th.dataset.sort === sortKey) {
        icon.textContent = sortDir === 'asc' ? ' \u2191' : ' \u2193';
        th.classList.add('notion-th-active');
      } else {
        icon.textContent = '';
        th.classList.remove('notion-th-active');
      }
    });
  }

  _bindTableEvents() {
    const state = this._concertTableState;
    const bodyEl = document.getElementById('notion-body');
    const tableEl = document.getElementById('notion-table');

    // Sort by clicking headers
    tableEl.querySelectorAll('.notion-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (state.sortKey === th.dataset.sort) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = th.dataset.sort;
          state.sortDir = th.dataset.sort === 'date' ? 'desc' : 'asc';
        }
        this._renderTableRows();
        this._bindTableRowEvents();
      });
    });

    this._bindTableRowEvents();

    // Search and filters cover every concert — the first use fetches the
    // rest of the list once in the background
    const self = this;
    const ensureAllThenFilter = () => {
      if (state.loadedCount < state.files.length && !state._loadingAll) {
        state._loadingAll = true;
        const prevLimit = state.limit;
        state.limit = 0;
        self._loadConcertRows().then(() => {
          state.limit = prevLimit;
          state._loadingAll = false;
          self._applyConcertFilters();
        });
      }
      self._applyConcertFilters();
    };
    document.getElementById('table-search').addEventListener('input', ensureAllThenFilter);
    document.querySelectorAll('#scope-pills .table-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        state.scope = pill.dataset.scope;
        document.querySelectorAll('#scope-pills .table-pill').forEach(pl => pl.classList.toggle('active', pl === pill));
        ensureAllThenFilter();
      });
    });
    document.querySelectorAll('#issue-pills .table-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const on = pill.classList.toggle('active');
        if (pill.dataset.issue === 'nohour') state.filterNoHour = on;
        if (pill.dataset.issue === 'nolink') state.filterNoLink = on;
        ensureAllThenFilter();
      });
    });

    // Select all
    document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
      bodyEl.querySelectorAll('.entry-select').forEach(cb => {
        if (cb.closest('.notion-row').style.display !== 'none') cb.checked = e.target.checked;
      });
      this._updateBulkBar();
    });

    // Bulk delete
    document.getElementById('bulk-delete-btn').addEventListener('click', async () => {
      const checked = bodyEl.querySelectorAll('.entry-select:checked');
      if (!checked.length) return;
      const ok = await showModal('Delete', `Delete ${checked.length} concert${checked.length > 1 ? 's' : ''}? This cannot be undone.`);
      if (!ok) return;
      showStatus('saving', 'Deleting...');
      for (const cb of checked) {
        const idx = parseInt(cb.dataset.idx);
        const entry = state.entries[idx];
        try {
          if (entry.sha) await this.api.deleteFile(entry.path, entry.sha, `Delete ${entry.name}`);
          state.entries[idx] = null;
        } catch (e) { showStatus('error', `Failed: ${e.message}`); return; }
      }
      state.entries = state.entries.filter(e => e !== null);
      this._renderTableRows();
      this._bindTableRowEvents();
      document.getElementById('bulk-bar').style.display = 'none';
      document.getElementById('select-all-checkbox').checked = false;
      showStatus('saved', 'Deleted');
    });

    // Selection mode: checkboxes stay hidden until asked for
    const selectBtn = document.getElementById('select-mode-btn');
    selectBtn.addEventListener('click', () => {
      const wrap = document.querySelector('.notion-table-wrap');
      const selecting = wrap.classList.toggle('selecting');
      selectBtn.textContent = selecting ? 'Done' : 'Select';
      // the checkbox column only takes space while selecting
      const cols = (selecting ? '36px' : '0px') + ' 96px ' + state.columns.map(c => c.width).join(' ');
      document.getElementById('notion-table').style.gridTemplateColumns = cols;
      state.gridCols = cols;
      if (!selecting) {
        wrap.querySelectorAll('.entry-select, #select-all-checkbox').forEach(cb => { cb.checked = false; });
        document.getElementById('bulk-bar').style.display = 'none';
      }
    });

    // New row
    document.getElementById('new-row-btn').addEventListener('click', () => {
      location.hash = '#/concerts/new';
    });
  }

  _bindTableRowEvents() {
    const state = this._concertTableState;
    const bodyEl = document.getElementById('notion-body');

    // Inline editing — contenteditable cells
    const autocompleteFields = ['place', 'composers', 'collaborators'];
    bodyEl.querySelectorAll('.notion-cell[contenteditable]').forEach(cell => {
      const field = cell.dataset.field;
      const hasAC = autocompleteFields.includes(field);

      cell.addEventListener('focus', () => {
        cell.classList.add('notion-cell-editing');
        if (hasAC) {
          const suggestions = this._getConcertSuggestions(field);
          this._showAutocomplete(cell, suggestions, cell.textContent.trim());
        }
      });

      cell.addEventListener('input', () => {
        if (hasAC) {
          const suggestions = this._getConcertSuggestions(field);
          this._showAutocomplete(cell, suggestions, cell.textContent.trim());
        }
      });

      cell.addEventListener('blur', () => {
        cell.classList.remove('notion-cell-editing');
        setTimeout(() => this._hideAutocomplete(), 150);
        const idx = parseInt(cell.dataset.idx);
        const fieldName = cell.dataset.field;
        const newVal = cell.textContent.trim();
        const entry = state.entries[idx];
        if (entry && entry.data[fieldName] !== newVal) {
          entry.data[fieldName] = newVal;
          entry.dirty = true;
          (entry.editedFields || (entry.editedFields = new Set())).add(fieldName);
          cell.closest('.notion-row').classList.add('notion-row-dirty');
          this._debounceSaveRow(idx);
        }
      });

      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          cell.blur();
        }
        if (e.key === 'Escape') {
          const idx = parseInt(cell.dataset.idx);
          const fieldName = cell.dataset.field;
          cell.textContent = state.entries[idx].data[fieldName] || '';
          this._hideAutocomplete();
          cell.blur();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const row = cell.closest('.notion-row');
          const cells = [...row.querySelectorAll('[contenteditable], .notion-date-input, .notion-time-input')];
          const currentIdx = cells.indexOf(cell);
          const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
          if (nextIdx >= 0 && nextIdx < cells.length) {
            cell.blur();
            const next = cells[nextIdx];
            if (next.tagName === 'INPUT') next.focus();
            else { next.focus(); const sel = window.getSelection(); sel.selectAllChildren(next); sel.collapseToEnd(); }
          }
        }
      });

      // Paste as plain text
      cell.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    });

    // Date and time inputs — either edit recomposes the concert's datetime
    bodyEl.querySelectorAll('.notion-date-input, .notion-time-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const entry = state.entries[idx];
        if (!entry) return;
        const cell = input.closest('.notion-cell-date');
        const dateVal = cell.querySelector('.notion-date-input').value;
        const timeVal = cell.querySelector('.notion-time-input').value;
        entry.data.date = dateVal ? `${dateVal}T${timeVal || '00:00'}` : '';
        entry.dirty = true;
        (entry.editedFields || (entry.editedFields = new Set())).add('date');
        input.closest('.notion-row').classList.add('notion-row-dirty');
        this._debounceSaveRow(idx);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const row = input.closest('.notion-row');
          const cells = [...row.querySelectorAll('[contenteditable], .notion-date-input, .notion-time-input')];
          const currentIdx = cells.indexOf(input);
          const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
          if (nextIdx >= 0 && nextIdx < cells.length) {
            const next = cells[nextIdx];
            if (next.tagName === 'INPUT') next.focus();
            else { next.focus(); const sel = window.getSelection(); sel.selectAllChildren(next); sel.collapseToEnd(); }
          }
        }
      });
    });

    // Duplicate button
    bodyEl.querySelectorAll('.notion-dup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const entry = state.entries[idx];
        if (!entry) return;
        try {
          showStatus('saving', 'Duplicating...');
          if (entry.loadFailed) await this._reloadEntry(entry);
          const newData = { ...entry.data, title: (entry.data.title || '') + ' (copy)' };
          const now = new Date();
          const datePrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
          const slug = (newData.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          // Avoid colliding with an existing file — creating over an existing
          // path without its sha fails with "sha wasn't supplied".
          let newName = `${datePrefix}-${slug}.md`;
          for (let n = 2; state.entries.some(en => en && en.name === newName); n++) newName = `${datePrefix}-${slug}-${n}.md`;
          const newPath = state.col.folder + '/' + newName;
          if (!newData.layout) newData.layout = 'concert.html';
          const content = FrontMatter.serialize(newData, entry.body || '');
          const result = await this.api.createOrUpdateFile(newPath, content, `Duplicate concert: ${newData.title}`);
          state.entries.push({ name: newName, data: newData, body: entry.body || '', path: newPath, sha: result.content.sha, dirty: false });
          if (state.visibleCount) state.visibleCount++;
          state.loadedCount++;
          this._renderTableRows();
          this._bindTableRowEvents();
          showStatus('saved', 'Duplicated');
        } catch (err) { showStatus('error', `Duplicate failed: ${err.message}`); }
      });
    });

    // Open button
    bodyEl.querySelectorAll('.notion-open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = `#/concerts/edit/${encodeURIComponent(btn.dataset.file)}`;
      });
    });

    // Checkbox change
    bodyEl.querySelectorAll('.entry-select').forEach(cb => {
      cb.addEventListener('change', () => this._updateBulkBar());
    });

    // Sorting or loading re-rendered the rows — the active filters still apply
    this._applyConcertFilters();
  }

  // One place decides which concert rows are visible: search text,
  // All/Upcoming/Archive scope, and the incompleteness filters
  _applyConcertFilters() {
    const state = this._concertTableState;
    if (!state) return;
    const searchEl = document.getElementById('table-search');
    const q = searchEl ? searchEl.value.toLowerCase().trim() : '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    document.querySelectorAll('#notion-body .notion-row').forEach(row => {
      const entry = state.entries[parseInt(row.dataset.idx, 10)];
      if (!entry) return;
      let show = true;
      if (q) show = Object.values(entry.data).some(v => (v || '').toString().toLowerCase().includes(q));
      if (show && state.scope !== 'all') {
        const dstr = entry.data.date_end || entry.data.date;
        const d = dstr ? new Date(dstr) : null;
        const hasDate = d && !isNaN(d);
        if (state.scope === 'upcoming') show = hasDate && d >= today;
        else show = hasDate && d < today;
      }
      if (show && state.filterNoHour) {
        const dt = entry.data.date || '';
        const monthOnly = String(entry.data.month_only) === 'true';
        show = !dt || (!monthOnly && !/T(?!00:00)\d\d:\d\d/.test(dt));
      }
      if (show && state.filterNoLink) {
        show = !(entry.data.link || '').trim();
      }
      row.style.display = show ? '' : 'none';
    });
  }

  _updateBulkBar() {
    const bodyEl = document.getElementById('notion-body');
    const n = bodyEl.querySelectorAll('.entry-select:checked').length;
    const bulkBar = document.getElementById('bulk-bar');
    const bulkCount = document.getElementById('bulk-count');
    bulkBar.style.display = n > 0 ? 'flex' : 'none';
    bulkCount.textContent = `${n} selected`;
  }

  _debounceSaveRow(idx) {
    const state = this._concertTableState;
    if (state.saveTimers[idx]) clearTimeout(state.saveTimers[idx]);
    state.saveTimers[idx] = setTimeout(() => this._saveTableRow(idx), 1200);
  }

  // Re-fetch an entry whose initial load failed, keeping any fields the user
  // edited in the meantime. Without this, saving such a row would overwrite
  // the file with the blank placeholder data.
  async _reloadEntry(entry) {
    const file = await this.api.getFile(entry.path);
    const parsed = FrontMatter.parse(file.content);
    const edited = {};
    for (const f of entry.editedFields || []) edited[f] = entry.data[f];
    entry.data = { ...parsed.data, ...edited };
    entry.body = parsed.body;
    entry.sha = file.sha;
    entry.loadFailed = false;
  }

  async _saveTableRow(idx) {
    const state = this._concertTableState;
    const entry = state.entries[idx];
    if (!entry || !entry.dirty) return;

    const row = document.querySelector(`.notion-row[data-idx="${idx}"]`);
    if (row) row.classList.add('notion-row-saving');
    const wasLoadFailed = entry.loadFailed;

    try {
      if (entry.loadFailed) await this._reloadEntry(entry);
      const data = { ...entry.data };
      if (!data.layout) data.layout = 'concert.html';
      const content = FrontMatter.serialize(data, entry.body || '');
      const result = await this.api.saveFile(entry.path, content, `Update concert: ${data.title || entry.name}`, entry.sha || undefined);
      entry.sha = result.content.sha;
      entry.dirty = false;
      if (wasLoadFailed) {
        // The reload restored fields that were displayed blank — redraw.
        this._renderTableRows();
        this._bindTableRowEvents();
        showStatus('saved', 'Saved');
        return;
      }
      if (row) {
        row.classList.remove('notion-row-dirty', 'notion-row-saving');
        row.classList.add('notion-row-saved');
        setTimeout(() => row.classList.remove('notion-row-saved'), 1500);
      }
    } catch (e) {
      showStatus('error', `Save failed: ${e.message}`);
      if (row) row.classList.remove('notion-row-saving');
    }
  }

  _bindBulkOps(listEl, entries, col, colName) {
    const selectAll = document.getElementById('select-all-checkbox');
    const bulkBar = document.getElementById('bulk-bar');
    const bulkCount = document.getElementById('bulk-count');
    const update = () => {
      const n = listEl.querySelectorAll('.entry-select:checked').length;
      bulkBar.style.display = n > 0 ? 'flex' : 'none';
      bulkCount.textContent = `${n} selected`;
    };
    selectAll.addEventListener('change', () => {
      listEl.querySelectorAll('.entry-select').forEach(cb => { if (cb.closest('.entry-row').style.display !== 'none') cb.checked = selectAll.checked; });
      update();
    });
    listEl.addEventListener('change', e => { if (e.target.classList.contains('entry-select')) update(); });
    document.getElementById('bulk-delete-btn').addEventListener('click', async () => {
      const checked = listEl.querySelectorAll('.entry-select:checked');
      if (!checked.length) return;
      const ok = await showModal('Delete', `Delete ${checked.length} entries? This cannot be undone.`);
      if (!ok) return;
      showStatus('saving', 'Deleting...');
      const isI18n = !!(col.i18n || col.i18nStructure);
      const locales = isI18n ? this.config.getLocales() : ['en'];
      for (const cb of checked) {
        const fn = cb.dataset.file;
        try {
          if (isI18n) {
            for (const loc of locales) {
              try { const fi = await this.api.getFileInfo(`${col.folder}/${loc}/${fn}`); await this.api.deleteFile(`${col.folder}/${loc}/${fn}`, fi.sha, `Delete ${fn}`); } catch(e) {}
            }
          } else { const row = cb.closest('.entry-row'); if (row.dataset.sha) await this.api.deleteFile(row.dataset.path, row.dataset.sha, `Delete ${fn}`); }
          cb.closest('.entry-row').remove();
        } catch (e) { showStatus('error', `Failed: ${e.message}`); return; }
      }
      bulkBar.style.display = 'none'; selectAll.checked = false;
      showStatus('saved', 'Deleted');
    });
  }

  // ---- Editor ----
  async renderEditor(colName, filename) {
    const col = this.collections.find(c => c.name === colName);
    if (!col) { location.hash = '#/'; return; }
    const isNew = !filename;
    const isI18n = !!(col.i18n || col.i18nStructure);
    const locales = isI18n ? this.config.getLocales() : ['en'];
    const siteUrl = isNew ? null : this._siteUrlFor(col, filename);

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb">
        <a href="#/">Dashboard</a><span class="sep">/</span>
        <a href="#/${colName}">${esc(col.label)}</a><span class="sep">/</span>
        <span>${isNew ? 'New' : esc(filename)}</span>
      </nav>
      <div class="editor-header">
        <h2>${isNew ? `New ${esc(col.label.replace(/s$/, ''))}` : 'Edit'}</h2>
        <div class="editor-actions">
          ${siteUrl ? `<a class="btn btn-ghost" href="${siteUrl}" target="_blank" rel="noopener" title="Opens the live page — recent saves can take a minute to appear">View on site</a>` : ''}
          ${(!isNew && col.name === 'notes') ? '<button class="btn btn-ghost" id="newsletter-btn" title="Email this note to everyone subscribed to the newsletter">Send as newsletter</button>' : ''}
          <button class="btn btn-ghost" id="cancel-btn">Cancel edits</button>
          <button class="btn btn-primary" id="save-btn">Save</button>
          ${!isNew ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
        </div>
      </div>
      ${(!isNew && ['projects', 'highlights', 'concerts', 'notes'].includes(col.name)) ? `
        <div class="editor-status-bar" id="status-bar">
          <span>Status:</span>
          <span class="status-label status-online" id="status-label">Online</span>
          <button class="btn btn-ghost btn-sm" id="set-draft-btn">Set Draft</button>
          <button class="btn btn-ghost btn-sm" id="set-archived-btn">Archive</button>
          <button class="btn btn-ghost btn-sm" id="set-online-btn" style="display:none;">Publish</button>
        </div>` : ''}
      <div class="editor-split">
        <div id="editor-form"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>
        <div class="live-preview-panel" id="live-preview">
          <div class="live-preview-header">Preview
            ${isI18n ? `<span class="lp-langs">${locales.map(l => `<button type="button" class="lang-pill lp-lang${l === 'en' ? ' active' : ''}" data-preview-locale="${l}">${l.toUpperCase()}</button>`).join('')}</span>` : ''}
          </div>
          <div class="live-preview-content" id="live-preview-content">
            <div class="live-preview-empty">Start editing to see a preview</div>
          </div>
        </div>
      </div>`;
    this._bindTopbar();

    const state = { locales, data: {}, body: {}, sha: {}, filePath: {}, inherit: {}, activeLocale: locales[0], filename, isNew, col, trilingualMode: false };
    this._editorState = state;

    for (const loc of locales) {
      state.data[loc] = {}; state.body[loc] = ''; state.sha[loc] = null; state.filePath[loc] = '';
      for (const f of col.fields) { if (f.name !== 'body') state.data[loc][f.name] = f.default || ''; }
    }

    if (!isNew) {
      try {
        for (const loc of locales) {
          const path = isI18n ? `${col.folder}/${loc}/${filename}` : `${col.folder}/${filename}`;
          state.filePath[loc] = path;
          try {
            const file = await this.api.getFile(path);
            const parsed = FrontMatter.parse(file.content);
            state.data[loc] = { ...state.data[loc], ...parsed.data };
            state.body[loc] = parsed.body;
            state.sha[loc] = file.sha;
          } catch (e) {
            // A 404 means the locale file doesn't exist yet (fine — saving
            // creates it). Any other failure must abort: continuing without
            // the file's sha and content would overwrite it with defaults.
            if (!isI18n || e.status !== 404) throw e;
          }
        }
      } catch (e) {
        document.getElementById('editor-form').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
        return;
      }
    }

    // Which locale values are their own translations vs copies of English.
    // Parity-saved files load as fully inherited — exactly right.
    if (isI18n) {
      for (const loc of locales) {
        state.inherit[loc] = {};
        if (loc === 'en') continue;
        for (const f of col.fields) {
          const v = f.name === 'body' ? state.body[loc] : state.data[loc][f.name];
          const enV = f.name === 'body' ? state.body['en'] : state.data['en'][f.name];
          state.inherit[loc][f.name] = !v || v === enV;
        }
      }
    }

    this._renderEditorForm(state);

    // Preview language switcher
    document.querySelectorAll('.lp-lang').forEach(btn => {
      btn.addEventListener('click', () => {
        state.previewLocale = btn.dataset.previewLocale;
        document.querySelectorAll('.lp-lang').forEach(b => b.classList.toggle('active', b === btn));
        this._updateLivePreview(state);
      });
    });

    // Save
    document.getElementById('save-btn').addEventListener('click', () => this._saveEntry(state));

    // Newsletter (notes only)
    const nlBtn = document.getElementById('newsletter-btn');
    if (nlBtn) nlBtn.addEventListener('click', () => this._sendNewsletter(state));

    // Cancel — discard unsaved changes and go back to the list
    document.getElementById('cancel-btn').addEventListener('click', () => {
      if (this._unsavedChanges && !confirm('Discard your unsaved changes?')) return;
      this._markClean();
      location.hash = `#/${colName}`;
    });

    // Status bar (projects / highlights only)
    if (!isNew && ['projects', 'highlights', 'concerts', 'notes'].includes(col.name)) {
      const initialStatus = state.data[locales[0]].status || '';
      this._updateStatusBar(initialStatus);
      document.getElementById('set-draft-btn').addEventListener('click', () => this._setStatus(state, 'draft'));
      document.getElementById('set-archived-btn').addEventListener('click', () => this._setStatus(state, 'archived'));
      document.getElementById('set-online-btn').addEventListener('click', () => this._setStatus(state, ''));
    }

    // Delete
    const delBtn = document.getElementById('delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const ok = await showModal('Delete', `Delete "${filename}"? This cannot be undone.`);
        if (!ok) return;
        showStatus('saving', 'Deleting...');
        try {
          for (const loc of locales) { if (state.sha[loc]) await this.api.deleteFile(state.filePath[loc], state.sha[loc], `Delete ${filename} (${loc})`); }
          showStatus('saved', 'Deleted');
          this._markClean();
          location.hash = `#/${colName}`;
        } catch (e) { showStatus('error', e.message); }
      });
    }
  }

  // A field is worth translating when it's marked i18n in the config AND
  // holds prose. Everything else (image, date, flags, links) is universal:
  // one value shared by every language.
  _isTranslatable(field) {
    const proseWidgets = ['string', 'text', 'markdown'];
    const widget = field.widget || 'string';
    return !!field.i18n && proseWidgets.includes(widget);
  }

  _renderEditorForm(state) {
    const { col, locales } = state;
    const formEl = document.getElementById('editor-form');
    const isI18n = !!(col.i18n || col.i18nStructure);

    if (!isI18n) {
      if (col.name === 'concerts') {
        this._renderConcertForm(state, formEl);
        return;
      }
      // Other single-language collections (notes) keep the plain form
      const data = state.data[state.activeLocale];
      const body = state.body[state.activeLocale];
      let html = '';
      for (const field of col.fields) {
        if (field.name === 'body') continue;
        html += `<div class="form-group">
          ${this._renderLabel(field)}
          ${this._renderField(field, data[field.name] || '', state.activeLocale)}
        </div>`;
      }
      const bodyField = col.fields.find(f => f.name === 'body');
      if (bodyField) {
        html += `<div class="form-group">
          ${this._renderLabel(bodyField)}
          ${this._renderMarkdownEditor('body', body, state.activeLocale)}
        </div>`;
      }
      formEl.innerHTML = html;
      this._bindFormHandlers(formEl, state);
      this._fillConcertDataLists(formEl, state.col);
      this._updateLivePreview(state);
      return;
    }

    // Translated collections: one list of fields. Universal fields appear
    // once; translatable fields carry a per-field language switcher where
    // every language follows English until it gets its own text.
    let html = '<div class="cedit cedit--entry">';
    const orderedFields = col.fields.filter(f => f.name !== 'body');
    const bodyField = col.fields.find(f => f.name === 'body');
    const renderRow = (field) => {
      const isBody = field.name === 'body';
      const renderOne = (loc, value) => isBody
        ? this._renderMarkdownEditor('body', value, loc)
        : this._renderField(field, value, loc);

      if (!this._isTranslatable(field)) {
        const value = isBody ? state.body['en'] : (state.data['en'][field.name] || '');
        return `<div class="form-group">
          ${this._renderLabel(field)}<span class="field-universal-chip">same in every language</span>
          ${renderOne('en', value)}
        </div>`;
      }

      const pills = state.locales.map(loc => {
        const custom = loc !== 'en' && !state.inherit[loc][field.name];
        return `<button type="button" class="lang-pill${loc === 'en' ? ' active' : ''}${custom ? ' has-custom' : ''}" data-pill-field="${field.name}" data-pill-locale="${loc}">${loc.toUpperCase()}</button>`;
      }).join('');

      const inputs = state.locales.map(loc => {
        const value = isBody ? state.body[loc] : (state.data[loc][field.name] || '');
        const inherited = loc !== 'en' && state.inherit[loc][field.name];
        const shown = inherited ? (isBody ? state.body['en'] : (state.data['en'][field.name] || '')) : value;
        return `<div class="locale-input-wrap${inherited ? ' inherited' : ''}" data-wrap-field="${field.name}" data-wrap-locale="${loc}"${loc === 'en' ? '' : ' hidden'} ${inherited ? 'data-inherit="1"' : ''}>
          <span class="locale-tag" hidden>${loc.toUpperCase()}</span>
          ${renderOne(loc, shown)}
          ${loc === 'en' ? '' : `<div class="inherit-note"${inherited ? '' : ' hidden'}>Follows English — type to translate</div>
          <button type="button" class="inherit-reset"${inherited ? ' hidden' : ''} data-reset-field="${field.name}" data-reset-locale="${loc}">&#8617; back to English</button>`}
        </div>`;
      }).join('');

      const hero = field.name === 'title' ? ' form-group--hero' : '';
      return `<div class="form-group form-group--i18n${hero}" data-i18n-field="${field.name}">
        <div class="form-label-row">
          ${this._renderLabel(field)}
          <div class="field-langs">${pills}<button type="button" class="lang-expand" data-expand-field="${field.name}" title="Show all languages">&#8862;</button></div>
        </div>
        ${inputs}
      </div>`;
    };

    for (const field of orderedFields) html += renderRow(field);
    if (bodyField) html += renderRow(bodyField);
    html += '</div>';

    formEl.innerHTML = html;
    this._bindFormHandlers(formEl, state);
    this._bindI18nFieldControls(formEl, state);
    this._fillConcertDataLists(formEl, state.col);
    this._updateLivePreview(state);
  }

  // The concert editor mirrors how a calendar event is composed: what and
  // where first, then when, then the optional extras — grouped, quiet,
  // no labels where a placeholder says enough.
  _renderConcertForm(state, formEl) {
    const { col } = state;
    const loc = state.activeLocale;
    const data = state.data[loc];
    const byName = {};
    for (const f of col.fields) byName[f.name] = f;
    const used = new Set();
    const field = (name) => { used.add(name); return byName[name]; };
    const control = (name) => byName[name] ? this._renderField(byName[name], data[name] || '', loc) : '';
    const hintFor = (name) => {
      const f = byName[name];
      return f && f.hint ? `<button type="button" class="hint-toggle" aria-label="What is this?" title="${esc(f.hint)}">?</button><span class="field-hint" hidden>${esc(f.hint)}</span>` : '';
    };
    const row = (label, name, extraClass) => byName[name] ? `
      <div class="cedit-row${extraClass ? ' ' + extraClass : ''}">
        <span class="cedit-row-label">${label}${hintFor(name)}</span>
        <div class="cedit-row-control">${control(name)}</div>
      </div>` : '';

    field('title'); field('place'); field('date'); field('date_end'); field('month_only');
    field('composers'); field('collaborators'); field('link'); field('links'); field('featured');

    let html = `
      <div class="cedit">
        <input type="text" class="cedit-title" data-field="title" data-locale="${loc}" value="${esc(data.title || '')}" placeholder="Concert title" />
        <input type="text" class="cedit-place" data-field="place" data-locale="${loc}" value="${esc(data.place || '')}" placeholder="Location" list="ac-place-${loc}" autocomplete="off" />
        <datalist id="ac-place-${loc}"></datalist>

        <div class="cedit-card cedit-when">
          <input type="hidden" data-field="date" data-locale="${loc}" class="dtp2-hidden-start" value="${esc((data.date || '').substring(0, 16))}" />
          <input type="hidden" data-field="date_end" data-locale="${loc}" class="date-end-input dtp2-hidden-end" value="${esc((data.date_end || '').substring(0, 16))}" />
          <div class="cedit-row">
            <span class="cedit-row-label">Starts${hintFor('date')}</span>
            <div class="cedit-row-control dtp2-chips">
              <button type="button" class="dtp2-chip dtp2-start active">–</button>
              <input type="time" class="dtp2-time dtp2-start-time" value="${esc((data.date || '').substring(11, 16))}" />
            </div>
          </div>
          <div class="cedit-row">
            <span class="cedit-row-label">Ends${hintFor('date_end')}</span>
            <div class="cedit-row-control dtp2-chips">
              <label class="checkbox-row"><input type="checkbox" class="date-end-toggle dtp2-multi"${data.date_end ? ' checked' : ''} /> <span>several days</span></label>
              <span class="dtp2-endwrap"${data.date_end ? '' : ' hidden'}>
                <button type="button" class="dtp2-chip dtp2-end">–</button>
              </span>
            </div>
          </div>
          <div class="cedit-row cedit-row--stack cedit-cal-row">
            <div class="dtp2-cal"></div>
          </div>
          ${row('Month only', 'month_only')}
        </div>

        <div class="cedit-card">
          ${row('Composers', 'composers')}
          ${row('With', 'collaborators')}
        </div>

        <div class="cedit-card">
          ${row('Tickets', 'link')}
          ${row('Links', 'links', 'cedit-row--stack')}
        </div>

        <div class="cedit-card">
          ${row('Featured', 'featured')}
        </div>`;

    // Any field added to the config later still shows up
    for (const f of col.fields) {
      if (f.name === 'body' || used.has(f.name)) continue;
      html += `<div class="form-group">${this._renderLabel(f)}${this._renderField(f, data[f.name] || '', loc)}</div>`;
    }

    const bodyField = byName['body'];
    if (bodyField) {
      html += `
        <div class="cedit-notes">
          <span class="cedit-row-label">Notes${hintFor('body')}</span>
          ${this._renderMarkdownEditor('body', state.body[loc], loc)}
        </div>`;
    }
    html += '</div>';

    formEl.innerHTML = html;
    this._bindFormHandlers(formEl, state);
    this._bindWhenCard(formEl);
    this._fillConcertDataLists(formEl, state.col);
    this._updateLivePreview(state);
  }

  // One integrated when-picker: start, optional end (several days), and an
  // always-visible month grid. Picking fills the active chip; with several
  // days on, the range is shown on the calendar itself.
  _bindWhenCard(formEl) {
    const card = formEl.querySelector('.cedit-when');
    if (!card) return;
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const startHid = card.querySelector('.dtp2-hidden-start');
    const endHid = card.querySelector('.dtp2-hidden-end');
    const startChip = card.querySelector('.dtp2-start');
    const endChip = card.querySelector('.dtp2-end');
    const startTime = card.querySelector('.dtp2-start-time');
    const multi = card.querySelector('.dtp2-multi');
    const endWrap = card.querySelector('.dtp2-endwrap');
    const calEl = card.querySelector('.dtp2-cal');
    let active = 'start';
    let view = startHid.value && !isNaN(new Date(startHid.value)) ? new Date(startHid.value) : new Date();

    const pad = n => String(n).padStart(2, '0');
    const fmt = iso => {
      if (!iso) return 'Choose a date';
      const d = new Date(iso);
      return isNaN(d) ? 'Choose a date' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };
    const ping = el => el.dispatchEvent(new Event('input', { bubbles: true }));
    const syncChips = () => {
      startChip.textContent = fmt(startHid.value);
      if (endChip) endChip.textContent = fmt(endHid.value);
      startChip.classList.toggle('active', active === 'start');
      if (endChip) endChip.classList.toggle('active', active === 'end');
    };

    const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const renderCal = () => {
      const y = view.getFullYear(), m = view.getMonth();
      const start = startHid.value ? new Date(startHid.value) : null;
      const end = endHid.value ? new Date(endHid.value) : null;
      const today = new Date();
      const firstDay = (new Date(y, m, 1).getDay() + 6) % 7;
      const days = new Date(y, m + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < firstDay; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const cur = new Date(y, m, d);
        const k = dayKey(cur);
        const isStart = start && !isNaN(start) && dayKey(start) === k;
        const isEnd = end && !isNaN(end) && dayKey(end) === k;
        const inRange = start && end && !isNaN(start) && !isNaN(end) && cur > start && cur < end && !isStart && !isEnd;
        const isToday = dayKey(today) === k;
        cells += `<button type="button" class="dtp-day${isStart || isEnd ? ' sel' : ''}${inRange ? ' range' : ''}${isToday ? ' today' : ''}" data-d="${d}">${d}</button>`;
      }
      calEl.innerHTML = `
        <div class="dtp-cal-head">
          <button type="button" class="dtp-nav" data-nav="-1">&#8249;</button>
          <span class="dtp-cal-title">${MONTHS[m]} ${y}</span>
          <button type="button" class="dtp-nav" data-nav="1">&#8250;</button>
        </div>
        <div class="dtp-grid dtp-grid-head"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
        <div class="dtp-grid">${cells}</div>`;
      calEl.querySelectorAll('.dtp-nav').forEach(b => b.addEventListener('click', () => {
        view = new Date(view.getFullYear(), view.getMonth() + parseInt(b.dataset.nav, 10), 1);
        renderCal();
      }));
      calEl.querySelectorAll('.dtp-day').forEach(b => b.addEventListener('click', () => {
        const d = parseInt(b.dataset.d, 10);
        if (active === 'start' || !multi.checked) {
          startHid.value = `${y}-${pad(m + 1)}-${pad(d)}T` + (startTime.value || '00:00');
          ping(startHid);
          // with several days on, iOS-style flow: next tap picks the end
          if (multi.checked) active = 'end';
        } else {
          endHid.value = `${y}-${pad(m + 1)}-${pad(d)}T` + (startTime.value || '00:00');
          ping(endHid);
        }
        syncChips();
        renderCal();
      }));
    };

    startChip.addEventListener('click', () => { active = 'start'; syncChips(); });
    if (endChip) endChip.addEventListener('click', () => { active = 'end'; syncChips(); });
    startTime.addEventListener('input', () => {
      if (startHid.value) {
        startHid.value = startHid.value.substring(0, 10) + 'T' + (startTime.value || '00:00');
        ping(startHid);
      }
    });
    multi.addEventListener('change', () => {
      if (multi.checked) {
        endWrap.hidden = false;
        if (!endHid.value && startHid.value) {
          const d = new Date(startHid.value);
          d.setDate(d.getDate() + 1);
          endHid.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` + (startTime.value || '00:00');
          ping(endHid);
        }
        active = 'end';
      } else {
        endWrap.hidden = true;
        endHid.value = '';
        ping(endHid);
        active = 'start';
      }
      syncChips();
      renderCal();
    });

    syncChips();
    renderCal();
  }

  // iOS-style row reordering: grab the handle, drop, order is saved to
  // the English files (localized copies inherit it at build time).
  _enableEntryDragOrder(listEl, col) {
    let dragging = null;
    listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragging = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', async () => {
        row.classList.remove('dragging');
        dragging = null;
        await this._persistEntryOrder(listEl, col);
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragging || dragging === row) return;
        const rect = row.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        row.parentNode.insertBefore(dragging, before ? row : row.nextSibling);
      });
    });
  }

  async _persistEntryOrder(listEl, col) {
    if (this._orderSaving) { this._orderDirty = true; return; }
    this._orderSaving = true;
    showStatus('saving', 'Saving order...');
    try {
      do {
        this._orderDirty = false;
        const rows = Array.from(listEl.querySelectorAll('.entry-row[data-file]'));
        const changes = [];
        for (let i = 0; i < rows.length; i++) {
          const path = rows[i].dataset.path;
          const file = await this.api.getFile(path);
          const parsed = FrontMatter.parse(file.content);
          if (String(parsed.data.order) === String(i + 1)) continue;
          parsed.data.order = i + 1;
          changes.push({ path, content: FrontMatter.serialize(parsed.data, parsed.body) });
        }
        if (changes.length) {
          await this.api.commitFiles(changes, `Reorder ${col.label.toLowerCase()}`);
        }
      } while (this._orderDirty);
      showStatus('saved', 'Order saved');
    } catch (e) {
      showStatus('error', 'Could not save the order: ' + e.message);
    } finally {
      this._orderSaving = false;
    }
  }

  _bindI18nFieldControls(formEl, state) {
    const inputOf = (wrap) => wrap.querySelector('input[data-field], textarea[data-field], select[data-field]');

    // Language pills: show that locale's input (compact mode)
    formEl.querySelectorAll('.lang-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const group = pill.closest('.form-group--i18n');
        if (group.classList.contains('expanded')) return;
        group.querySelectorAll('.lang-pill').forEach(p => p.classList.toggle('active', p === pill));
        group.querySelectorAll('.locale-input-wrap').forEach(w => {
          w.hidden = w.dataset.wrapLocale !== pill.dataset.pillLocale;
        });
      });
    });

    // Expand: all languages stacked at once
    formEl.querySelectorAll('.lang-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.form-group--i18n');
        const expanded = group.classList.toggle('expanded');
        btn.innerHTML = expanded ? '&#8863;' : '&#8862;';
        group.querySelectorAll('.locale-input-wrap').forEach(w => {
          w.hidden = expanded ? false : w.dataset.wrapLocale !== group.querySelector('.lang-pill.active').dataset.pillLocale;
          w.querySelector('.locale-tag').hidden = !expanded;
        });
      });
    });

    // Typing in a translation makes it custom; English mirrors into
    // everything still inherited
    formEl.querySelectorAll('.locale-input-wrap').forEach(wrap => {
      const field = wrap.dataset.wrapField;
      const loc = wrap.dataset.wrapLocale;
      const input = inputOf(wrap);
      if (!input) return;
      input.addEventListener('input', () => {
        const group = wrap.closest('.form-group--i18n');
        if (loc === 'en') {
          group.querySelectorAll('.locale-input-wrap[data-inherit="1"]').forEach(w => {
            const sib = inputOf(w);
            if (sib) { sib.value = input.value; if (sib._syncRich) sib._syncRich(); }
          });
          return;
        }
        if (wrap.dataset.inherit === '1') {
          delete wrap.dataset.inherit;
          wrap.classList.remove('inherited');
          state.inherit[loc][field] = false;
          wrap.querySelector('.inherit-note').hidden = true;
          wrap.querySelector('.inherit-reset').hidden = false;
          group.querySelector(`.lang-pill[data-pill-locale="${loc}"]`).classList.add('has-custom');
        }
      });
    });

    // Back to English: re-inherit
    formEl.querySelectorAll('.inherit-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.resetField;
        const loc = btn.dataset.resetLocale;
        const group = btn.closest('.form-group--i18n');
        const wrap = group.querySelector(`.locale-input-wrap[data-wrap-locale="${loc}"]`);
        const enWrap = group.querySelector('.locale-input-wrap[data-wrap-locale="en"]');
        const input = inputOf(wrap);
        const enInput = inputOf(enWrap);
        if (input && enInput) { input.value = enInput.value; if (input._syncRich) input._syncRich(); }
        wrap.dataset.inherit = '1';
        wrap.classList.add('inherited');
        state.inherit[loc][field] = true;
        wrap.querySelector('.inherit-note').hidden = false;
        btn.hidden = true;
        group.querySelector(`.lang-pill[data-pill-locale="${loc}"]`).classList.remove('has-custom');
        this._markDirty();
      });
    });
  }

  async _ensureConcertEntries() {
    if (this._concertEntriesCache) return this._concertEntriesCache;
    const concertCol = this.collections.find(c => c.name === 'concerts');
    if (!concertCol) return [];
    try {
      const tree = await this.api.getTree(concertCol.folder);
      const files = tree.filter(f => f.name.endsWith('.md'));
      const entries = [];
      for (let i = 0; i < files.length; i += 8) {
        const batch = await Promise.all(files.slice(i, i + 8).map(async f => {
          try {
            const parsed = FrontMatter.parse(await this.api.getBlob(f.sha));
            return { name: f.name, data: parsed.data };
          } catch { return { name: f.name, data: {} }; }
        }));
        entries.push(...batch);
      }
      this._concertEntriesCache = entries;
      return entries;
    } catch { return []; }
  }

  _fillConcertDataLists(formEl, col) {
    if (col.name !== 'concerts') return;
    const acFields = ['place', 'composers', 'collaborators'];
    const fill = () => {
      formEl.querySelectorAll('datalist[id^="ac-"]').forEach(dl => {
        const fieldName = acFields.find(f => dl.id.startsWith(`ac-${f}-`));
        if (!fieldName) return;
        const suggestions = this._getConcertSuggestions(fieldName);
        dl.innerHTML = suggestions.map(s => `<option value="${esc(s)}"></option>`).join('');
      });
    };
    // If concert table data is already loaded, fill immediately; otherwise fetch in background
    if (this._concertTableState && this._concertTableState.entries && this._concertTableState.entries.length) {
      fill();
    } else {
      // Load concert list in background for datalist population
      const concertCol = this.collections.find(c => c.name === 'concerts');
      if (!concertCol) return;
      this.api.getContents(concertCol.folder).then(async contents => {
        const files = contents.filter(f => f.name.endsWith('.md'));
        const entries = await Promise.all(files.map(async f => {
          try { const fd = await this.api.getFile(f.path); return { name: f.name, data: FrontMatter.parse(fd.content).data }; }
          catch { return { name: f.name, data: {} }; }
        }));
        if (!this._concertTableState) this._concertTableState = { entries: [] };
        if (!this._concertTableState.entries.length) this._concertTableState.entries = entries;
        fill();
      }).catch(() => {});
    }
  }

  // Public page for an entry — used by the "View on site" button
  _siteUrlFor(col, filename) {
    if (!filename) return null;
    const base = filename.replace(/\.md$/, '');
    if (col.name === 'concerts') return `/en/concerts/${base}/`;
    if (col.name === 'notes') return `/en/notes/${base}/`;
    if (col.name === 'projects') return `/ensembles/en/${base}/`;
    if (col.name === 'highlights') return `/highlights/en/${base}/`;
    if (col.name === 'about') return `/en/about/`;
    return null;
  }

  _renderLabel(field) {
    const optional = field.required ? '' : ' <span class="optional">(optional)</span>';
    const hint = field.hint
      ? `<button type="button" class="hint-toggle" aria-label="What is this?" title="${esc(field.hint)}">?</button>
         <span class="field-hint" hidden>${esc(field.hint)}</span>`
      : '';
    return `<label class="form-label">${esc(field.label)}${optional}${hint}</label>`;
  }

  _renderField(field, value, locale) {
    const escaped = esc(value);
    const dataAttr = `data-field="${field.name}" data-locale="${locale}"`;

    switch (field.widget) {
      case 'links': {
        const items = Array.isArray(value) ? value : [];
        const rows = items.map((l, i) => `
          <div class="links-row">
            <input type="text" class="form-input link-label" value="${esc(l.label || '')}" placeholder="Name shown on the button, e.g. Website" />
            <input type="url" class="form-input link-url" value="${esc(l.url || '')}" placeholder="https://…" />
            <button type="button" class="btn btn-ghost btn-sm links-remove" aria-label="Remove link">&#215;</button>
          </div>`).join('');
        return `<div class="links-editor" data-links-field="${field.name}" data-locale="${locale}">
          <div class="links-rows">${rows}</div>
          <button type="button" class="btn btn-ghost btn-sm links-add">+ Add a link</button>
        </div>`;
      }

      case 'audiofile':
      case 'videofile': {
        const kind = field.widget === 'audiofile' ? 'audio' : 'video';
        const preview = value
          ? (kind === 'audio'
            ? `<audio controls preload="none" src="${escaped}" style="width:100%;margin-top:.5rem;height:32px;"></audio>`
            : `<video controls preload="metadata" src="${escaped}" style="max-width:100%;margin-top:.5rem;max-height:220px;"></video>`)
          : '';
        return `<div class="file-field" data-file-kind="${kind}">
          <input type="text" class="form-input file-path-input" ${dataAttr} value="${escaped}" placeholder="/${kind}/file" />
          <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap;">
            ${kind === 'audio' ? '<button type="button" class="btn btn-ghost btn-sm file-pick-btn">Pick from the site</button>' : ''}
            <button type="button" class="btn btn-ghost btn-sm file-upload-btn">Upload new</button>
            <button type="button" class="btn btn-ghost btn-sm file-clear-btn">Clear</button>
          </div>
          <div class="file-preview">${preview}</div>
        </div>`;
      }

      case 'images': {
        const items = Array.isArray(value) ? value : [];
        const rows = items.map(ph => {
          const p = ph.image || '';
          return `<div class="images-row">
            <img class="images-thumb" src="${p.startsWith('/') ? esc(p) : '/images/' + esc(p)}" onerror="this.style.visibility='hidden'" alt="" />
            <input type="text" class="form-input images-path" value="${esc(p)}" placeholder="/images/photo.jpg" />
            <button type="button" class="btn btn-ghost btn-sm images-pick">Pick</button>
            <button type="button" class="btn btn-ghost btn-sm images-remove" aria-label="Remove photo">&#215;</button>
          </div>`;
        }).join('');
        return `<div class="images-editor" data-images-field="${field.name}" data-locale="${locale}">
          <div class="images-rows">${rows}</div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm images-add-pick">+ Pick from the site</button>
            <button type="button" class="btn btn-ghost btn-sm images-add-upload">+ Upload new</button>
          </div>
        </div>`;
      }

      case 'datetime': {
        let dtVal = value;
        if (dtVal && dtVal.length > 16) dtVal = dtVal.substring(0, 16);
        const picker = (extraClass) => `<div class="dtp">
            <input type="hidden" class="${extraClass || ''}" ${dataAttr} value="${esc(dtVal)}" />
            <button type="button" class="dtp-date-btn">date</button>
            <input type="time" class="dtp-time" value="${esc(dtVal ? dtVal.substring(11, 16) : '')}" />
            <div class="dtp-cal" hidden></div>
          </div>`;
        if (field.name === 'date_end') {
          // Hidden behind a checkbox so nobody sets an end date by accident
          return `<div class="date-end-field">
            <label class="checkbox-row"><input type="checkbox" class="date-end-toggle"${dtVal ? ' checked' : ''} /> <span>This concert runs for several days</span></label>
            <div class="date-end-picker"${dtVal ? '' : ' hidden'}>${picker('date-end-input')}</div>
          </div>`;
        }
        return picker('');
      }

      case 'image':
        return `<div class="image-field image-dropzone" data-img-field="${field.name}" data-img-locale="${locale}">
          ${value ? `<img class="image-preview" src="${value.startsWith('/') ? value : '/images/' + value}" onerror="this.style.display='none'" />` : ''}
          <div class="image-controls">
            <p class="dropzone-text">${value ? 'Drop a new photo here to replace it' : 'Drop a photo here'} &mdash; or</p>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm image-upload-btn" data-img-field="${field.name}" data-img-locale="${locale}">Choose a file</button>
              <button type="button" class="btn btn-ghost btn-sm image-browse-btn" data-img-field="${field.name}" data-img-locale="${locale}">Pick from the site</button>
            </div>
            <input type="text" class="form-input image-path-input" ${dataAttr} value="${escaped}" placeholder="/images/photo.jpg" />
          </div>
        </div>`;

      case 'boolean': {
        const isOn = value === true || value === 'true';
        return `<select class="form-input" ${dataAttr}>
          <option value="false"${isOn ? '' : ' selected'}>No</option>
          <option value="true"${isOn ? ' selected' : ''}>Yes</option>
        </select>`;
      }

      case 'markdown':
        return this._renderMarkdownEditor(field.name, value, locale);

      default: {
        const listId = field.autocomplete ? `ac-${field.name}-${locale}` : '';
        const listAttr = listId ? ` list="${listId}"` : '';
        const datalist = listId ? `<datalist id="${listId}"></datalist>` : '';
        return `<input type="text" class="form-input" ${dataAttr} value="${escaped}"${listAttr} autocomplete="off" />${datalist}`;
      }
    }
  }

  _renderMarkdownEditor(fieldName, value, locale) {
    return `<div class="md-editor-wrap" data-md-editor="${fieldName}" data-locale="${locale}">
      <div class="md-toolbar">
        <button type="button" title="Bold" data-md-action="bold"><b>B</b></button>
        <button type="button" title="Italic" data-md-action="italic"><i>I</i></button>
        <button type="button" title="Heading" data-md-action="heading">H</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Link" data-md-action="link">Link</button>
        <button type="button" title="Insert an image" data-md-action="image">Image</button>
        <button type="button" title="Insert an audio file" data-md-action="audio">Audio</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="List" data-md-action="ul">List</button>
        <button type="button" title="Quote" data-md-action="quote">Quote</button>
        <span class="toolbar-sep toolbar-sep-text"></span>
        <button type="button" title="Preview" data-md-action="preview" class="md-text-only">Preview</button>
        <span class="toolbar-spring"></span>
        <button type="button" title="Switch between visual editing and raw text" data-md-action="mode" class="md-mode-btn">Text mode</button>
      </div>
      <div class="md-editor-body">
        <div class="rich-editor" contenteditable="true" data-rich-for="${fieldName}" data-rich-locale="${locale}">${renderMarkdown(value)}</div>
        <textarea class="md-textarea" data-field="${fieldName}" data-locale="${locale}">${esc(value)}</textarea>
      </div>
    </div>`;
  }

  // Calendar-style date picking, composed like iOS: a date chip that
  // expands an inline month grid, and a small time chip beside it.
  _bindDatePickers(formEl) {
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmt = (iso) => {
      if (!iso) return 'Choose a date';
      const d = new Date(iso);
      if (isNaN(d)) return 'Choose a date';
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };
    formEl.querySelectorAll('.dtp').forEach(dtp => {
      if (dtp.dataset.bound) return;
      dtp.dataset.bound = '1';
      const hidden = dtp.querySelector('input[type="hidden"]');
      const dateBtn = dtp.querySelector('.dtp-date-btn');
      const timeInp = dtp.querySelector('.dtp-time');
      const cal = dtp.querySelector('.dtp-cal');
      let view = hidden.value ? new Date(hidden.value) : new Date();
      if (isNaN(view)) view = new Date();

      const sync = () => {
        dateBtn.textContent = fmt(hidden.value);
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const setDate = (y, m, d) => {
        const pad = n => String(n).padStart(2, '0');
        const time = timeInp.value || '00:00';
        hidden.value = `${y}-${pad(m + 1)}-${pad(d)}T${time}`;
        sync();
      };

      const renderCal = () => {
        const y = view.getFullYear(), m = view.getMonth();
        const sel = hidden.value ? new Date(hidden.value) : null;
        const today = new Date();
        const firstDay = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
        const days = new Date(y, m + 1, 0).getDate();
        let cells = '';
        for (let i = 0; i < firstDay; i++) cells += '<span></span>';
        for (let d = 1; d <= days; d++) {
          const isSel = sel && !isNaN(sel) && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d;
          const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
          cells += `<button type="button" class="dtp-day${isSel ? ' sel' : ''}${isToday ? ' today' : ''}" data-d="${d}">${d}</button>`;
        }
        cal.innerHTML = `
          <div class="dtp-cal-head">
            <button type="button" class="dtp-nav" data-nav="-1">&#8249;</button>
            <span class="dtp-cal-title">${MONTHS[m]} ${y}</span>
            <button type="button" class="dtp-nav" data-nav="1">&#8250;</button>
          </div>
          <div class="dtp-grid dtp-grid-head"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
          <div class="dtp-grid">${cells}</div>`;
        cal.querySelectorAll('.dtp-nav').forEach(b => b.addEventListener('click', () => {
          view = new Date(view.getFullYear(), view.getMonth() + parseInt(b.dataset.nav, 10), 1);
          renderCal();
        }));
        cal.querySelectorAll('.dtp-day').forEach(b => b.addEventListener('click', () => {
          setDate(y, m, parseInt(b.dataset.d, 10));
          renderCal();
        }));
      };

      dateBtn.addEventListener('click', () => {
        cal.hidden = !cal.hidden;
        if (!cal.hidden) {
          view = hidden.value && !isNaN(new Date(hidden.value)) ? new Date(hidden.value) : new Date();
          renderCal();
        }
      });
      timeInp.addEventListener('input', () => {
        if (!hidden.value) {
          const t = new Date();
          setDate(t.getFullYear(), t.getMonth(), t.getDate());
        } else {
          hidden.value = hidden.value.substring(0, 10) + 'T' + (timeInp.value || '00:00');
          sync();
        }
      });
      dateBtn.textContent = fmt(hidden.value);
    });
  }

  _bindFormHandlers(formEl, state) {
    this._bindDatePickers(formEl);

    // Track changes + live preview
    formEl.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('input', () => {
      this._markDirty();
      clearTimeout(this._livePreviewTimer);
      this._livePreviewTimer = setTimeout(() => this._updateLivePreview(state), 200);
    }));

    // Image upload buttons
    formEl.querySelectorAll('.image-upload-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.addEventListener('change', () => this._handleImageUpload(input.files[0], btn.dataset.imgField, btn.dataset.imgLocale, state));
        input.click();
      });
    });

    // Image browse buttons (open picker)
    formEl.querySelectorAll('.image-browse-btn').forEach(btn => {
      btn.addEventListener('click', () => this._showImagePicker(btn.dataset.imgField, btn.dataset.imgLocale, state));
    });

    // Live preview of which concerts a project's match words pick up
    const matchInput = formEl.querySelector('input[data-field="match"]');
    if (matchInput && state.col.name === 'projects') {
      const preview = document.createElement('div');
      preview.className = 'match-preview';
      preview.textContent = 'Checking which concerts match…';
      matchInput.closest('.form-group').appendChild(preview);
      const update = () => {
        this._ensureConcertEntries().then(entries => {
          const titleInput = formEl.querySelector('input[data-field="title"]');
          const raw = matchInput.value.trim() || (titleInput ? titleInput.value : '');
          const words = raw.toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
          if (!words.length) { preview.textContent = 'Add match words to link concerts to this project.'; return; }
          const hits = entries.filter(e => {
            const hay = ((e.data.collaborators || '') + ' ' + (e.data.title || '')).toLowerCase();
            return words.some(w => hay.indexOf(w) !== -1);
          });
          if (!hits.length) {
            preview.textContent = 'No concerts match these words yet — check the spelling against the concerts\u2019 collaborators.';
            return;
          }
          const shown = hits.slice(0, 6).map(e => {
            const d = e.data.date ? String(e.data.date).substring(0, 10) : '';
            return (e.data.title || e.name) + (d ? ' (' + d + ')' : '');
          });
          preview.textContent = 'Linked to ' + hits.length + ' concert' + (hits.length > 1 ? 's' : '') + ': ' +
            shown.join(' · ') + (hits.length > 6 ? ' · …' : '');
        });
      };
      let matchTimer;
      matchInput.addEventListener('input', () => { clearTimeout(matchTimer); matchTimer = setTimeout(update, 400); });
      update();
    }

    // End-date checkbox: reveal the field only when it applies
    formEl.querySelectorAll('.date-end-field').forEach(wrap => {
      const toggle = wrap.querySelector('.date-end-toggle');
      const pickerWrap = wrap.querySelector('.date-end-picker');
      const input = wrap.querySelector('.date-end-input');
      toggle.addEventListener('change', () => {
        if (toggle.checked) {
          pickerWrap.hidden = false;
          if (!input.value) {
            const startEl = document.querySelector('input[data-field="date"]');
            if (startEl && startEl.value) {
              const d = new Date(startEl.value);
              d.setDate(d.getDate() + 1);
              const p = n => String(n).padStart(2, '0');
              input.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              const btn = wrap.querySelector('.dtp-date-btn');
              if (btn) btn.textContent = new Date(input.value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
              const t = wrap.querySelector('.dtp-time');
              if (t) t.value = input.value.substring(11, 16);
            }
          }
        } else {
          input.value = '';
          pickerWrap.hidden = true;
          const btn = wrap.querySelector('.dtp-date-btn');
          if (btn) btn.textContent = 'Choose a date';
        }
        this._markDirty();
      });
    });

    // Hint toggles — click the ? to show/hide the explanation
    formEl.querySelectorAll('.hint-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const hint = btn.parentElement.querySelector('.field-hint');
        if (hint) hint.hidden = !hint.hidden;
      });
    });

    // Links editor — add and remove rows
    formEl.querySelectorAll('.links-editor').forEach(editor => {
      const rowsEl = editor.querySelector('.links-rows');
      const addRow = () => {
        const row = document.createElement('div');
        row.className = 'links-row';
        row.innerHTML = '<input type="text" class="form-input link-label" placeholder="Name shown on the button, e.g. Website" />' +
          '<input type="url" class="form-input link-url" placeholder="https://…" />' +
          '<button type="button" class="btn btn-ghost btn-sm links-remove" aria-label="Remove link">&#215;</button>';
        rowsEl.appendChild(row);
        row.querySelector('.link-label').focus();
      };
      editor.querySelector('.links-add').addEventListener('click', () => { addRow(); this._markDirty(); });
      editor.addEventListener('click', e => {
        const rm = e.target.closest('.links-remove');
        if (rm) { rm.closest('.links-row').remove(); this._markDirty(); }
      });
      editor.addEventListener('input', () => this._markDirty());
    });

    // Single-file fields (audio / video)
    formEl.querySelectorAll('.file-field').forEach(fieldEl => {
      const kind = fieldEl.dataset.fileKind;
      const input = fieldEl.querySelector('.file-path-input');
      const previewEl = fieldEl.querySelector('.file-preview');
      const setVal = (path) => {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        previewEl.innerHTML = path
          ? (kind === 'audio'
            ? `<audio controls preload="none" src="${esc(path)}" style="width:100%;margin-top:.5rem;height:32px;"></audio>`
            : `<video controls preload="metadata" src="${esc(path)}" style="max-width:100%;margin-top:.5rem;max-height:220px;"></video>`)
          : '';
      };
      const pickBtn = fieldEl.querySelector('.file-pick-btn');
      if (pickBtn) pickBtn.addEventListener('click', () => this._pickAudioFile(setVal));
      fieldEl.querySelector('.file-upload-btn').addEventListener('click', () => this._uploadMediaFileFor(kind, setVal));
      fieldEl.querySelector('.file-clear-btn').addEventListener('click', () => setVal(''));
    });

    // Images editor (photo stacks) — add, pick, upload, remove rows
    formEl.querySelectorAll('.images-editor').forEach(editor => {
      const rowsEl = editor.querySelector('.images-rows');
      const addRow = (path) => {
        const row = document.createElement('div');
        row.className = 'images-row';
        row.innerHTML = `<img class="images-thumb" src="${path.startsWith('/') ? esc(path) : '/images/' + esc(path)}" onerror="this.style.visibility='hidden'" alt="" />
          <input type="text" class="form-input images-path" value="${esc(path)}" placeholder="/images/photo.jpg" />
          <button type="button" class="btn btn-ghost btn-sm images-pick">Pick</button>
          <button type="button" class="btn btn-ghost btn-sm images-remove" aria-label="Remove photo">&#215;</button>`;
        rowsEl.appendChild(row);
        this._markDirty();
      };
      editor.querySelector('.images-add-pick').addEventListener('click', () => this._pickImage(path => addRow(path)));
      editor.querySelector('.images-add-upload').addEventListener('click', () => this._uploadPickedImage(path => addRow(path)));
      editor.addEventListener('click', e => {
        const rm = e.target.closest('.images-remove');
        if (rm) { rm.closest('.images-row').remove(); this._markDirty(); return; }
        const pick = e.target.closest('.images-pick');
        if (pick) {
          const row = pick.closest('.images-row');
          this._pickImage(path => {
            row.querySelector('.images-path').value = path;
            const th = row.querySelector('.images-thumb');
            th.src = path; th.style.visibility = '';
            this._markDirty();
          });
        }
      });
      editor.addEventListener('input', e => {
        if (e.target.classList.contains('images-path')) {
          const th = e.target.closest('.images-row').querySelector('.images-thumb');
          th.src = e.target.value; th.style.visibility = '';
          this._markDirty();
        }
      });
    });

    // Image drop zones — drag a photo straight onto the field
    formEl.querySelectorAll('.image-dropzone').forEach(zone => {
      ['dragover', 'dragenter'].forEach(ev => zone.addEventListener(ev, e => {
        e.preventDefault();
        zone.classList.add('dropzone-active');
      }));
      ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
        e.preventDefault();
        zone.classList.remove('dropzone-active');
      }));
      zone.addEventListener('drop', e => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          this._handleImageUpload(file, zone.dataset.imgField, zone.dataset.imgLocale, state);
        }
      });
    });

    // Markdown editors — visual (rich) by default, raw text on demand
    formEl.querySelectorAll('[data-md-editor]').forEach(wrap => this._bindMdEditor(wrap));
  }

  _bindMdEditor(wrap) {
    const textarea = wrap.querySelector('.md-textarea');
    const rich = wrap.querySelector('.rich-editor');
    const toolbar = wrap.querySelector('.md-toolbar');
    const modeBtn = toolbar.querySelector('.md-mode-btn');
    const inTextMode = () => wrap.classList.contains('md-mode-text');

    const syncFromRich = () => {
      const md = htmlToMarkdown(rich);
      if (md === textarea.value) return;
      textarea.value = md;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const syncToRich = () => { rich.innerHTML = renderMarkdown(textarea.value); decorateRichAudio(rich); };
    // The language-inherit mirroring writes into the hidden textarea —
    // this hook keeps the visible editor in step
    textarea._syncRich = syncToRich;
    decorateRichAudio(rich);

    // Visual editing
    rich.addEventListener('input', () => syncFromRich());
    rich.addEventListener('blur', () => syncFromRich());
    rich.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('.re-audio')) return; // typing in an audio title
      // Enter is a line break (<br> on the site); an empty line starts a new
      // paragraph. Inserted by hand — execCommand('insertLineBreak') leaves an
      // invisible trailing <br> in some browsers, which looks like Enter did nothing.
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        // A <br> at the very end of a block doesn't render — pad it so the
        // caret visibly lands on the new line
        const next = br.nextSibling;
        if (!next || (next.nodeType === Node.TEXT_NODE && next.nodeValue === '')) {
          br.after(document.createElement('br'));
        }
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        syncFromRich();
      }
    });
    rich.addEventListener('paste', (e) => {
      if (e.target.closest && e.target.closest('.re-audio')) return; // pasting into an audio title
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // Raw text editing
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = textarea.selectionStart; textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(textarea.selectionEnd); textarea.selectionStart = textarea.selectionEnd = s + 2; this._markDirty(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); this._mdAction(textarea, 'bold'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); this._mdAction(textarea, 'italic'); }
    });
    textarea.addEventListener('input', () => { clearTimeout(this._previewTimer); this._previewTimer = setTimeout(() => this._updatePreview(wrap), 300); });

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-md-action]');
      if (!btn) return;
      const action = btn.dataset.mdAction;

      if (action === 'mode') {
        if (inTextMode()) {
          syncToRich();
          wrap.classList.remove('md-mode-text');
          modeBtn.textContent = 'Text mode';
          const preview = wrap.querySelector('.md-preview');
          if (preview) { preview.remove(); toolbar.querySelector('[data-md-action="preview"]').classList.remove('active'); }
        } else {
          syncFromRich();
          wrap.classList.add('md-mode-text');
          modeBtn.textContent = 'Visual mode';
        }
        return;
      }
      if (action === 'preview') { this._togglePreview(wrap, btn); return; }
      if (action === 'image' || action === 'audio') { this._showMediaPickerForEditor(wrap, action); return; }

      if (inTextMode()) { this._mdAction(textarea, action); textarea.focus(); return; }

      // Visual mode: real formatting on the selection
      rich.focus();
      if (action === 'bold') document.execCommand('bold');
      else if (action === 'italic') document.execCommand('italic');
      else if (action === 'heading') {
        const block = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, /h2/i.test(block) ? 'p' : 'h2');
      } else if (action === 'ul') document.execCommand('insertUnorderedList');
      else if (action === 'quote') {
        const block = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, /blockquote/i.test(block) ? 'p' : 'blockquote');
      } else if (action === 'link') {
        const url = prompt('Web address for the link (https://…)');
        if (url) {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) document.execCommand('createLink', false, url);
          else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
        }
      }
      syncFromRich();
    });
  }

  // Insert a snippet at the caret of a markdown editor, whichever mode it is in
  _insertIntoMdEditor(wrap, md, html) {
    const textarea = wrap.querySelector('.md-textarea');
    if (wrap.classList.contains('md-mode-text')) {
      const pos = textarea.selectionStart;
      textarea.value = textarea.value.substring(0, pos) + md + textarea.value.substring(textarea.selectionEnd);
      textarea.selectionStart = textarea.selectionEnd = pos + md.length;
      this._updatePreview(wrap);
    } else {
      const rich = wrap.querySelector('.rich-editor');
      rich.focus();
      document.execCommand('insertHTML', false, html);
      decorateRichAudio(rich);
      textarea.value = htmlToMarkdown(rich);
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _mdAction(textarea, action) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const sel = textarea.value.substring(start, end);
    let before = '', after = '', insert = '';
    const nl = (start > 0 && textarea.value[start - 1] !== '\n') ? '\n' : '';
    switch (action) {
      case 'bold': before = '**'; after = '**'; insert = sel || 'bold'; break;
      case 'italic': before = '*'; after = '*'; insert = sel || 'italic'; break;
      case 'heading': before = nl + '## '; insert = sel || 'Heading'; break;
      case 'link': before = '['; after = '](url)'; insert = sel || 'link text'; break;
      case 'ul': before = nl + '- '; insert = sel || 'item'; break;
      case 'quote': before = nl + '> '; insert = sel || 'quote'; break;
    }
    textarea.value = textarea.value.substring(0, start) + before + insert + after + textarea.value.substring(end);
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + insert.length;
    this._markDirty();
    this._updatePreview(textarea.closest('[data-md-editor]'));
  }

  _togglePreview(wrap, btn) {
    const body = wrap.querySelector('.md-editor-body');
    let preview = body.querySelector('.md-preview');
    if (preview) { preview.remove(); btn.classList.remove('active'); }
    else { preview = document.createElement('div'); preview.className = 'md-preview'; body.appendChild(preview); btn.classList.add('active'); this._updatePreview(wrap); }
  }

  _updatePreview(wrap) {
    if (!wrap) return;
    const preview = wrap.querySelector('.md-preview');
    if (!preview) return;
    const md = wrap.querySelector('.md-textarea').value;
    preview.innerHTML = md.trim() ? renderMarkdown(md) : '<div class="md-preview-empty">Nothing to preview</div>';
  }

  _updateLivePreview(state) {
    const el = document.getElementById('live-preview-content');
    if (!el) return;
    this._collectFormData(state);
    const loc = state.previewLocale || state.activeLocale || state.locales[0];
    let data = state.data[loc] || {};
    let body = state.body[loc] || '';
    // Translated collections: preview what the site will show — the
    // language's own text where translated, English everywhere else
    const isI18n = !!(state.col.i18n || state.col.i18nStructure);
    if (isI18n && loc !== 'en') {
      const eff = { ...state.data['en'] };
      for (const k of Object.keys(state.data[loc] || {})) {
        const inh = state.inherit[loc] && state.inherit[loc][k];
        if (!inh && state.data[loc][k]) eff[k] = state.data[loc][k];
      }
      data = eff;
      body = (state.inherit[loc] && state.inherit[loc]['body']) ? state.body['en'] : (state.body[loc] || state.body['en']);
    }
    const colName = state.col.name;

    let html = '<div class="lp-page">';

    if (colName === 'concerts') {
      // Concert detail preview
      if (data.date) {
        try {
          const d = new Date(data.date);
          const dateStr = d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          html += `<p class="lp-date">${esc(dateStr)}</p>`;
        } catch(e) {}
      }
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      const meta = [];
      if (data.place) meta.push(esc(data.place));
      if (data.composers) meta.push(`<em>${esc(data.composers)}</em>`);
      if (data.collaborators) meta.push(esc(data.collaborators));
      if (meta.length) html += `<div class="lp-meta">${meta.map(m => `<span>${m}</span>`).join('')}</div>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (Array.isArray(data.links) && data.links.length) html += `<div class="lp-actions">${data.links.filter(l => l.label || l.url).map(l => `<span class="lp-btn">${esc(l.label || 'Link')}</span>`).join(' ')}</div>`;
      if (data.link) html += `<a class="lp-btn" href="#">Tickets & Info</a>`;
    } else if (colName === 'highlights') {
      // Highlight detail preview
      if (data.link) {
        html += `<div class="lp-video"><div class="lp-video-placeholder">YouTube: ${esc(data.link)}</div></div>`;
      }
      if (data.image && !data.link && String(data.hide_image) !== 'true') {
        html += `<div class="lp-featured-image"><img src="${data.image.startsWith('/') ? data.image : '/images/' + data.image}" alt="${esc(data.title || '')}" onerror="this.parentElement.innerHTML='<div class=\\'lp-img-placeholder\\'>Image</div>'" /></div>`;
      }
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      const meta = [];
      if (data.type) meta.push(esc(data.type));
      if (data.place) meta.push(esc(data.place));
      if (data.collaborators) meta.push(esc(data.collaborators));
      if (data.date) {
        try {
          const d = new Date(data.date);
          meta.push(d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }));
        } catch(e) {}
      }
      if (meta.length) html += `<div class="lp-meta">${meta.map(m => `<span>${m}</span>`).join('')}</div>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (Array.isArray(data.links) && data.links.length) html += `<div class="lp-actions">${data.links.filter(l => l.label || l.url).map(l => `<span class="lp-btn">${esc(l.label || 'Link')}</span>`).join(' ')}</div>`;
    } else if (colName === 'projects') {
      // Project detail preview
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      if (data.collaborators) html += `<div class="lp-meta"><span>${esc(data.collaborators)}</span></div>`;
      if (data.image) {
        html += `<div class="lp-featured-image"><img src="${data.image.startsWith('/') ? data.image : '/images/' + data.image}" alt="${esc(data.title || '')}" onerror="this.parentElement.innerHTML='<div class=\\'lp-img-placeholder\\'>Image</div>'" /></div>`;
      }
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (Array.isArray(data.links) && data.links.length) html += `<div class="lp-actions">${data.links.filter(l => l.label || l.url).map(l => `<span class="lp-btn">${esc(l.label || 'Link')}</span>`).join(' ')}</div>`;
    } else if (colName === 'about') {
      // About preview
      html += `<h1 class="lp-title">${esc(data.title || 'About')}</h1>`;
      if (data.summaryabout) html += `<div class="lp-summary">${renderMarkdown(data.summaryabout)}</div>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (Array.isArray(data.links) && data.links.length) html += `<div class="lp-actions">${data.links.filter(l => l.label || l.url).map(l => `<span class="lp-btn">${esc(l.label || 'Link')}</span>`).join(' ')}</div>`;
    } else {
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (Array.isArray(data.links) && data.links.length) html += `<div class="lp-actions">${data.links.filter(l => l.label || l.url).map(l => `<span class="lp-btn">${esc(l.label || 'Link')}</span>`).join(' ')}</div>`;
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // Audio chooser for note audio fields
  async _pickAudioFile(cb) {
    await this._loadAudioCache();
    const files = this._audioCache;
    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    overlay.innerHTML = `<div class="image-picker">
      <h3>Choose an audio file</h3>
      <div class="audio-picker-list">
        ${files.length ? files.map(f => `<div class="audio-picker-item" data-name="${esc(f.name)}">
          <div class="audio-picker-item-main">
            <span class="audio-picker-icon">&#9835;</span>
            <span class="audio-picker-item-name">${esc(titleFromFilename(f.name))}</span>
            <button type="button" class="btn btn-primary btn-sm audio-picker-insert">Choose</button>
          </div>
          <audio controls preload="none" src="/audio/${esc(f.name)}"></audio>
        </div>`).join('') : '<div class="empty-state">No audio files yet.</div>'}
      </div>
      <div class="image-picker-actions"><button class="btn btn-ghost btn-sm" id="picker-cancel">Cancel</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('.audio-picker-insert').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.closest('.audio-picker-item').dataset.name;
        overlay.remove();
        cb(`/audio/${name}`);
      });
    });
    overlay.querySelector('#picker-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // Upload an audio or video file, call back with its public path
  _uploadMediaFileFor(kind, cb) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = kind === 'audio' ? 'audio/*' : 'video/*';
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      const file = input.files[0];
      showStatus('saving', 'Uploading...');
      try {
        const folder = kind === 'audio' ? this.config.getAudioFolder() : this.config.getVideoFolder();
        const reader = new FileReader();
        const b64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
        await this.api.uploadImage(`${folder}/${file.name}`, b64, `Upload ${file.name}`);
        if (kind === 'audio') this._audioCache = null;
        showStatus('saved', 'Uploaded');
        cb(`/${kind}/${file.name}`);
      } catch (e) { showStatus('error', e.message); }
    });
    input.click();
  }

  // iPhone photos arrive as HEIC, which most browsers cannot display —
  // convert them to JPEG before uploading. Tries the browser's own decoder
  // first (Safari), then a converter library, and only gives up loudly.
  async _prepareImageFile(file) {
    const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type || '');
    if (!isHeic) return file;
    const jpegName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg';
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width; canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
      if (blob) return new File([blob], jpegName, { type: 'image/jpeg' });
    } catch (e) { /* this browser can't decode HEIC natively */ }
    try {
      if (!window.heic2any) {
        await new Promise((res, rej) => {
          const sc = document.createElement('script');
          sc.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
          sc.onload = res; sc.onerror = rej;
          document.head.appendChild(sc);
        });
      }
      const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
      return new File([Array.isArray(blob) ? blob[0] : blob], jpegName, { type: 'image/jpeg' });
    } catch (e) {
      showToast('error', 'This iPhone photo (HEIC) could not be converted — it will not display for every visitor. Best export it as JPEG and upload that instead.');
      return file;
    }
  }

  // Generic image chooser: shows the site's images, calls back with the
  // chosen public path
  async _pickImage(cb) {
    await this._loadImageCache();
    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    overlay.innerHTML = `<div class="image-picker">
      <h3>Choose a photo</h3>
      <div class="media-filter" style="margin-bottom:1rem;"><input type="text" id="picker-search" placeholder="Search..." style="width:100%;padding:.5rem 0;border:none;border-bottom:1px solid var(--warm-grey);font-family:var(--font-serif);font-size:.9rem;color:var(--near-black);background:transparent;" /></div>
      <div class="image-picker-grid">
        ${this._imageCache.map(img => `<div class="image-picker-item" data-name="${esc(img.name)}">
          <img src="/images/${img.name}" alt="${esc(img.name)}" loading="lazy" />
          <div class="image-picker-item-name">${esc(img.name)}</div>
        </div>`).join('')}
      </div>
      <div class="image-picker-actions">
        <button class="btn btn-ghost btn-sm" id="picker-cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#picker-search').addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      overlay.querySelectorAll('.image-picker-item').forEach(item => {
        item.style.display = (!q || item.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });
    overlay.querySelectorAll('.image-picker-item').forEach(item => {
      item.addEventListener('click', () => { overlay.remove(); cb(`/images/${item.dataset.name}`); });
    });
    overlay.querySelector('#picker-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // Upload a new image, then call back with its public path
  _uploadPickedImage(cb) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      showStatus('saving', 'Uploading...');
      const file = await this._prepareImageFile(input.files[0]);
      try {
        const reader = new FileReader();
        const b64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
        await this.api.uploadImage(`${this.config.getMediaFolder()}/${file.name}`, b64, `Upload ${file.name}`);
        this._imageCache = null;
        showStatus('saved', 'Uploaded');
        cb(`/images/${file.name}`);
      } catch (e) { showStatus('error', e.message); }
    });
    input.click();
  }

  // ---- Image Picker (browse existing images) ----
  async _showImagePicker(fieldName, locale, state) {
    await this._loadImageCache();
    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    overlay.innerHTML = `<div class="image-picker">
      <h3>Choose an image</h3>
      <div class="media-filter" style="margin-bottom:1rem;"><input type="text" id="picker-search" placeholder="Search..." style="width:100%;padding:.5rem 0;border:none;border-bottom:1px solid var(--warm-grey);font-family:var(--font-serif);font-size:.9rem;color:var(--near-black);background:transparent;" /></div>
      <div class="image-picker-grid" id="picker-grid">
        ${this._imageCache.map(img => `<div class="image-picker-item" data-name="${esc(img.name)}" data-path="${esc(img.path)}">
          <img src="/images/${img.name}" alt="${esc(img.name)}" loading="lazy" />
          <div class="image-picker-item-name">${esc(img.name)}</div>
        </div>`).join('')}
      </div>
      <div class="image-picker-actions">
        <button class="btn btn-ghost btn-sm" id="picker-upload">Upload new</button>
        <button class="btn btn-ghost btn-sm" id="picker-cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    // Search
    overlay.querySelector('#picker-search').addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      overlay.querySelectorAll('.image-picker-item').forEach(item => {
        item.style.display = (!q || item.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    // Select image
    overlay.querySelectorAll('.image-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const publicPath = `/images/${item.dataset.name}`;
        const input = document.querySelector(`[data-field="${fieldName}"][data-locale="${locale}"]`);
        if (input) { input.value = publicPath; this._markDirty(); }
        // Update preview
        const container = input?.closest('.image-field');
        if (container) {
          const prev = container.querySelector('.image-preview, .image-placeholder');
          if (prev) { const img = document.createElement('img'); img.className = 'image-preview'; img.src = `/images/${item.dataset.name}`; prev.replaceWith(img); }
        }
        overlay.remove();
        showStatus('saved', `Selected: ${item.dataset.name}`);
        this._updateLivePreview(state);
      });
    });

    // Upload new from picker
    overlay.querySelector('#picker-upload').addEventListener('click', () => {
      overlay.remove();
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', () => this._handleImageUpload(input.files[0], fieldName, locale, state));
      input.click();
    });

    overlay.querySelector('#picker-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // Snippets inserted into a markdown editor for a media file.
  // Audio is raw HTML (markdown passes it through) so the site's player
  // enhancement picks it up; images are plain markdown.
  _mediaSnippets(kind, name) {
    if (kind === 'audio') {
      const src = `/audio/${name}`;
      const title = titleFromFilename(name);
      const tag = `<audio controls src="${src}" data-title="${esc(title)}"></audio>`;
      return { md: `\n${tag}\n`, html: tag };
    }
    const src = `/images/${name}`;
    return { md: `![${name}](${src})`, html: `<img src="${src}" alt="${esc(name)}" />` };
  }

  // Media picker for markdown editors — kind is 'image' or 'audio'
  async _showMediaPickerForEditor(wrap, kind) {
    const isAudio = kind === 'audio';
    if (isAudio) await this._loadAudioCache(); else await this._loadImageCache();
    const files = isAudio ? this._audioCache : this._imageCache;

    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    const itemsHtml = isAudio
      ? (files.length ? files.map(f => `<div class="audio-picker-item" data-name="${esc(f.name)}">
          <div class="audio-picker-item-main">
            <span class="audio-picker-icon">&#9835;</span>
            <span class="audio-picker-item-name">${esc(titleFromFilename(f.name))}</span>
            <button type="button" class="btn btn-primary btn-sm audio-picker-insert">Insert</button>
          </div>
          <audio controls preload="none" src="/audio/${esc(f.name)}"></audio>
        </div>`).join('') : '<div class="empty-state">No audio files yet — upload one below.</div>')
      : files.map(img => `<div class="image-picker-item" data-name="${esc(img.name)}" data-path="${esc(img.path)}">
          <img src="/images/${img.name}" alt="${esc(img.name)}" loading="lazy" />
          <div class="image-picker-item-name">${esc(img.name)}</div>
        </div>`).join('');
    overlay.innerHTML = `<div class="image-picker">
      <h3>${isAudio ? 'Insert an audio file' : 'Insert an image'}</h3>
      <div class="media-filter" style="margin-bottom:1rem;"><input type="text" id="picker-search" placeholder="Search..." style="width:100%;padding:.5rem 0;border:none;border-bottom:1px solid var(--warm-grey);font-family:var(--font-serif);font-size:.9rem;color:var(--near-black);background:transparent;" /></div>
      <div class="${isAudio ? 'audio-picker-list' : 'image-picker-grid'}" id="picker-grid">${itemsHtml}</div>
      <div class="image-picker-actions">
        <button class="btn btn-ghost btn-sm" id="picker-upload-new">Upload new</button>
        <button class="btn btn-ghost btn-sm" id="picker-cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const insert = (name) => {
      const { md, html } = this._mediaSnippets(kind, name);
      overlay.remove();
      this._insertIntoMdEditor(wrap, md, html);
    };

    overlay.querySelector('#picker-search').addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      overlay.querySelectorAll('.image-picker-item, .audio-picker-item').forEach(item => {
        item.style.display = (!q || item.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    overlay.querySelectorAll('.image-picker-item').forEach(item => {
      item.addEventListener('click', () => insert(item.dataset.name));
    });
    overlay.querySelectorAll('.audio-picker-insert').forEach(btn => {
      btn.addEventListener('click', () => insert(btn.closest('.audio-picker-item').dataset.name));
    });

    overlay.querySelector('#picker-upload-new').addEventListener('click', () => {
      overlay.remove();
      const input = document.createElement('input');
      input.type = 'file'; input.accept = isAudio ? 'audio/*' : 'image/*';
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        showStatus('saving', 'Uploading...');
        const file = isAudio ? input.files[0] : await this._prepareImageFile(input.files[0]);
        try {
          const folder = isAudio ? this.config.getAudioFolder() : this.config.getMediaFolder();
          const reader = new FileReader();
          const b64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
          await this.api.uploadImage(`${folder}/${file.name}`, b64, `Upload ${file.name}`);
          if (isAudio) this._audioCache = null; else this._imageCache = null;
          this._insertIntoMdEditor(wrap, this._mediaSnippets(kind, file.name).md, this._mediaSnippets(kind, file.name).html);
          showStatus('saved', 'Uploaded & inserted');
        } catch (e) { showStatus('error', e.message); }
      });
      input.click();
    });

    overlay.querySelector('#picker-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  async _loadImageCache() {
    if (this._imageCache) return;
    this._imageCache = await this._loadMediaFolder(this.config.getMediaFolder(), IMAGE_EXT_RE);
  }

  async _loadAudioCache() {
    if (this._audioCache) return;
    this._audioCache = await this._loadMediaFolder(this.config.getAudioFolder(), AUDIO_EXT_RE);
  }

  async _loadVideoCache() {
    if (this._videoCache) return;
    this._videoCache = await this._loadMediaFolder(this.config.getVideoFolder(), VIDEO_EXT_RE);
  }

  async _loadMediaFolder(folder, extRe) {
    try {
      const contents = await this.api.getContents(folder);
      return contents.filter(f => f.type === 'file' && extRe.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('getContents failed for', folder, '- trying tree API:', e.message);
      try {
        const files = await this.api.getTree(folder);
        return files.filter(f => extRe.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      } catch (e2) {
        // A folder that simply doesn't exist yet is not an error worth a toast
        if (e2.status === 404) return [];
        console.error('Both methods failed to load media:', e2);
        showToast('error', 'Could not load media: ' + e2.message);
        return [];
      }
    }
  }

  async _handleImageUpload(file, fieldName, locale, state) {
    if (!file) return;
    showStatus('saving', 'Uploading...');
    file = await this._prepareImageFile(file);
    try {
      const reader = new FileReader();
      const b64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
      await this.api.uploadImage(`${this.config.getMediaFolder()}/${file.name}`, b64, `Upload ${file.name}`);
      this._imageCache = null; // invalidate cache
      const publicPath = `/images/${file.name}`;
      const input = document.querySelector(`[data-field="${fieldName}"][data-locale="${locale}"]`);
      if (input) { input.value = publicPath; }
      const container = input?.closest('.image-field');
      if (container) {
        const prev = container.querySelector('.image-preview, .image-placeholder');
        if (prev) { const img = document.createElement('img'); img.className = 'image-preview'; img.src = URL.createObjectURL(file); prev.replaceWith(img); }
      }
      showStatus('saved', 'Uploaded');
      this._markDirty();
      if (this._editorState) this._updateLivePreview(this._editorState);
    } catch (e) { showStatus('error', e.message); }
  }

  _collectFormData(state) {
    const formEl = document.getElementById('editor-form');
    if (!formEl) return;

    const isI18n = !!(state.col.i18n || state.col.i18nStructure);
    const locs = isI18n ? state.locales : [state.activeLocale];
    for (const loc of locs) {
      formEl.querySelectorAll(`[data-locale="${loc}"][data-field]`).forEach(el => {
        if (el.dataset.field === 'body') state.body[loc] = el.value;
        else state.data[loc][el.dataset.field] = el.value;
      });
    }
    // Links editors serialize to arrays of {label, url}
    formEl.querySelectorAll('.links-editor').forEach(editor => {
      const loc = editor.dataset.locale;
      const name = editor.dataset.linksField;
      if (!state.data[loc]) return;
      state.data[loc][name] = Array.from(editor.querySelectorAll('.links-row')).map(row => ({
        label: row.querySelector('.link-label').value.trim(),
        url: row.querySelector('.link-url').value.trim(),
      })).filter(l => l.label || l.url);
    });
    // Images editors serialize to arrays of {image}
    formEl.querySelectorAll('.images-editor').forEach(editor => {
      const loc = editor.dataset.locale;
      const name = editor.dataset.imagesField;
      if (!state.data[loc]) return;
      state.data[loc][name] = Array.from(editor.querySelectorAll('.images-path'))
        .map(inp => ({ image: inp.value.trim() }))
        .filter(ph => ph.image);
    });
  }

  async _saveEntry(state) {
    this._collectFormData(state);
    const { col, locales, isNew } = state;
    const isI18n = !!(col.i18n || col.i18nStructure);
    let filename = state.filename;
    // Required fields need a value in at least the primary locale
    for (const f of col.fields) {
      if (!f.required || f.name === 'body') continue;
      const v = state.data[locales[0]][f.name];
      if (!v || !String(v).trim()) { showStatus('error', `${f.label} is required`); return; }
    }
    const endToggle = document.querySelector('.date-end-toggle');
    if (endToggle && endToggle.checked && !document.querySelector('.date-end-input').value) {
      showStatus('error', 'Fill in the end date completely (day and time), or untick "runs for several days"');
      return;
    }
    if (isNew) {
      filename = generateFilename(state.data[locales[0]].title);
      state.filename = filename;
    }
    if (isI18n) {
      // Inheritance: universal fields share the English value everywhere;
      // translatable fields follow English unless the language has its own
      // translation (tracked per field in state.inherit).
      for (const f of col.fields) {
        const translatable = this._isTranslatable(f);
        for (const loc of locales) {
          if (loc === 'en') continue;
          const follows = !translatable || (state.inherit[loc] && state.inherit[loc][f.name]);
          if (!follows) continue;
          if (f.name === 'body') state.body[loc] = state.body['en'];
          else state.data[loc][f.name] = state.data['en'][f.name];
        }
      }

      // Content parity: English is the hub. Fill empty English fields from
      // whichever locale has content, so nothing exists only in one language.
      for (const f of col.fields) {
        if (f.name === 'body' || state.data['en'][f.name]) continue;
        for (const l of locales) {
          if (state.data[l][f.name]) { state.data['en'][f.name] = state.data[l][f.name]; break; }
        }
      }
      if (!state.body['en']) {
        for (const l of locales) {
          if (state.body[l]) { state.body['en'] = state.body[l]; break; }
        }
      }
    }
    showStatus('saving', 'Saving...');
    try {
      for (const loc of locales) {
        const data = { ...state.data[loc] };
        if (isI18n) {
          if (!data.layout && col.name === 'projects') data.layout = 'project.html';
          if (!data.layout && col.name === 'highlights') data.layout = 'highlight.html';
          if (!data.layout && col.name === 'about') data.layout = 'about.html';
          if (!data.tags) data.tags = col.name;
          data.lang = loc;
          if (col.name === 'about') data.permalink = `${loc}/about/index.html`;
        } else {
          if (!data.layout) data.layout = col.name === 'notes' ? 'note.html' : 'concert.html';
        }
        if (isI18n && loc !== 'en') {
          // Any field still empty in this locale falls back to the English value
          for (const f of col.fields) { if (f.name !== 'body' && !data[f.name]) data[f.name] = state.data['en'][f.name] || ''; }
          if (!state.body[loc]) state.body[loc] = state.body['en'] || '';
        }
        const content = FrontMatter.serialize(data, state.body[loc] || '');
        const path = isI18n ? `${col.folder}/${loc}/${filename}` : `${col.folder}/${filename}`;
        const msg = isNew ? `Create ${col.label}: ${data.title || filename}` : `Update ${col.label}: ${data.title || filename}`;
        const result = await this.api.saveFile(path, content, msg, state.sha[loc] || undefined);
        state.sha[loc] = result.content.sha;
        state.filePath[loc] = path;
      }
      showStatus('saved', 'Saved');
      this._markClean();
      if (isNew) {
        history.replaceState(null, '', `#/${col.name}/edit/${encodeURIComponent(filename)}`);
        state.isNew = false;
      }
    } catch (e) { showStatus('error', 'Save failed: ' + e.message); }
  }

  // ---- Newsletter ----
  // Email the note to every newsletter subscriber, styled like the site.
  async _sendNewsletter(state) {
    this._collectFormData(state);
    if (this._unsavedChanges) { showStatus('error', 'Save the note first, then send it.'); return; }
    const data = state.data[state.activeLocale];
    const body = state.body[state.activeLocale] || '';
    const siteBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'https://vdr-staging.netlify.app' : location.origin;
    const noteUrl = siteBase + (this._siteUrlFor(state.col, state.filename) || '/en/notes/');
    const subject = data.title ? `${data.title} \u2014 a note from Veronique` : 'A note from Veronique';
    const html = this._newsletterHtml(data, body, noteUrl, siteBase);
    // Preview exactly what subscribers will receive before anything goes out
    const ok = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'image-picker-overlay visible';
      overlay.innerHTML = `<div class="image-picker newsletter-preview">
        <h3>Newsletter preview</h3>
        <p class="newsletter-preview-subject">Subject: <strong>${esc(subject)}</strong></p>
        <iframe class="newsletter-preview-frame" title="Newsletter preview"></iframe>
        <div class="image-picker-actions">
          <button class="btn btn-primary btn-sm" id="nl-send">Send to all subscribers</button>
          <button class="btn btn-ghost btn-sm" id="nl-cancel">Cancel</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('.newsletter-preview-frame').srcdoc = html;
      const done = val => { overlay.remove(); resolve(val); };
      overlay.querySelector('#nl-send').addEventListener('click', () => done(true));
      overlay.querySelector('#nl-cancel').addEventListener('click', () => done(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
    });
    if (!ok) return;
    showStatus('saving', 'Sending newsletter\u2026');
    try {
      const jwt = await this._identityUser.jwt();
      const res = await fetch(siteBase + '/.netlify/functions/newsletter', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, html, text: body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || ('Sending failed (' + res.status + ')'));
      showStatus('saved', out.sent ? `Newsletter sent to ${out.sent} subscriber${out.sent === 1 ? '' : 's'}` : (out.message || 'Nothing sent'));
    } catch (e) { showStatus('error', e.message); }
  }

  _newsletterHtml(data, bodyMd, noteUrl, siteBase) {
    const abs = h => h.replace(/(src|href)="\//g, `$1="${siteBase}/`);
    let bodyHtml = renderMarkdown(bodyMd || '');
    bodyHtml = bodyHtml.replace(/<audio[^>]*>([\s\S]*?)<\/audio>/g,
      `<a href="${noteUrl}" style="color:#33322f;">&#9654;&#xFE0E; Listen on the site</a>`);
    bodyHtml = abs(bodyHtml);
    const photos = Array.isArray(data.photos) ? data.photos.filter(p => p.image) : [];
    const photosHtml = photos.map(p => {
      const src = p.image.startsWith('/') ? p.image : '/images/' + p.image;
      return `<img src="${siteBase}${src}" width="520" style="width:100%;max-width:520px;height:auto;border:1px solid #33322f;display:block;margin:0 auto 16px;" alt="" />`;
    }).join('');
    const dateStr = data.date ? new Date(data.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f4f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f2;padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a847a;padding-bottom:20px;" align="center">${esc(dateStr)}${data.title ? ' &middot; ' + esc(data.title) : ''}</td></tr>
        <tr><td style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:22px;line-height:1.65;color:#4d4841;padding-bottom:26px;" align="center">${bodyHtml}</td></tr>
        ${photosHtml ? `<tr><td align="center" style="padding-bottom:14px;">${photosHtml}</td></tr>` : ''}
        <tr><td align="center" style="padding:10px 0 30px;">
          <a href="${noteUrl}" style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#f5f4f2;background:#33322f;text-decoration:none;padding:12px 26px;border-radius:999px;display:inline-block;">Read on the site</a>
        </td></tr>
        <tr><td style="border-top:1px solid #e8e6e1;padding-top:20px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8a847a;line-height:1.7;" align="center">
          You are receiving this because you subscribed to Veronique De Raedemaeker&#8217;s newsletter.<br/>Reply to this email to unsubscribe.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  }

  // ---- Status (draft / archived / online) ----
  _updateStatusBar(status) {
    const label = document.getElementById('status-label');
    const draftBtn = document.getElementById('set-draft-btn');
    const archiveBtn = document.getElementById('set-archived-btn');
    const publishBtn = document.getElementById('set-online-btn');
    if (!label) return;
    label.className = 'status-label';
    if (status === 'draft') {
      label.classList.add('status-draft'); label.textContent = 'Draft';
      draftBtn.style.display = 'none'; archiveBtn.style.display = ''; publishBtn.style.display = '';
    } else if (status === 'archived') {
      label.classList.add('status-archived'); label.textContent = 'Archived';
      draftBtn.style.display = ''; archiveBtn.style.display = 'none'; publishBtn.style.display = '';
    } else {
      label.classList.add('status-online'); label.textContent = 'Online';
      draftBtn.style.display = ''; archiveBtn.style.display = ''; publishBtn.style.display = 'none';
    }
  }

  async _setStatus(state, newStatus) {
    this._collectFormData(state);
    for (const loc of state.locales) {
      state.data[loc].status = newStatus || undefined;
      if (!newStatus) delete state.data[loc].status;
    }
    await this._saveEntry(state);
    this._updateStatusBar(newStatus);
  }

  // ---- Concert Autocomplete ----
  _getConcertSuggestions(field) {
    const state = this._concertTableState;
    if (!state || !state.entries) return [];
    const seen = new Set();
    for (const entry of state.entries) {
      const val = (entry.data[field] || '').trim();
      if (val) seen.add(val);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }

  _showAutocomplete(cell, suggestions, filter) {
    this._hideAutocomplete();
    const filtered = filter ? suggestions.filter(s => s.toLowerCase().includes(filter.toLowerCase()) && s.toLowerCase() !== filter.toLowerCase()) : suggestions;
    if (!filtered.length) return;

    const rect = cell.getBoundingClientRect();
    const drop = document.createElement('div');
    drop.className = 'autocomplete-dropdown';
    drop.id = 'autocomplete-dropdown';
    drop.style.top = (rect.bottom + window.scrollY) + 'px';
    drop.style.left = (rect.left + window.scrollX) + 'px';
    drop.style.width = Math.max(rect.width, 160) + 'px';
    drop.innerHTML = filtered.map(s => `<div class="autocomplete-item" data-value="${esc(s)}">${esc(s)}</div>`).join('');
    document.body.appendChild(drop);

    drop.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cell.textContent = item.dataset.value;
        this._hideAutocomplete();
        cell.dispatchEvent(new Event('blur'));
      });
    });
  }

  _hideAutocomplete() {
    const existing = document.getElementById('autocomplete-dropdown');
    if (existing) existing.remove();
  }

  // ---- Hero Image ----
  async renderHero() {
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Hero Image</span></nav>
      <div class="editor-header">
        <h2>Hero Image</h2>
        <div class="editor-actions">
          <button class="btn btn-primary" id="hero-save-btn">Save</button>
        </div>
      </div>
      <div id="hero-form"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
    this._bindTopbar();

    const siteDataPath = '_input/_data/site.json';
    let siteData = { hero_image: '/images/veronique20d.jpg' };
    let siteSha = null;

    try {
      const file = await this.api.getFile(siteDataPath);
      siteSha = file.sha;
      try { siteData = JSON.parse(file.content); } catch (e) {}
    } catch (e) { /* file doesn't exist yet, will be created on save */ }

    const currentImage = siteData.hero_image || '/images/veronique20d.jpg';

    document.getElementById('hero-form').innerHTML = `
      <div class="settings-section">
        <h3>Homepage hero photo</h3>
        <p style="font-size:.9rem;color:var(--dark-grey);margin-bottom:1.5rem;">This image appears full-screen at the top of every language version of the homepage.</p>
        <div class="image-field">
          <img id="hero-preview" class="image-preview" src="${esc(currentImage)}" style="max-height:320px;width:100%;object-fit:cover;border-radius:8px;margin-bottom:1rem;" onerror="this.style.display='none'" />
          <div class="image-controls">
            <input type="text" class="form-input" id="hero-image-path" value="${esc(currentImage)}" placeholder="/images/photo.jpg" />
            <div style="display:flex;gap:.25rem;margin-top:.5rem;">
              <button type="button" class="btn btn-ghost btn-sm" id="hero-browse-btn">Browse</button>
              <button type="button" class="btn btn-ghost btn-sm" id="hero-upload-btn">Upload</button>
            </div>
          </div>
        </div>
      </div>`;

    const pathInput = document.getElementById('hero-image-path');
    const preview = document.getElementById('hero-preview');

    pathInput.addEventListener('input', () => {
      preview.src = pathInput.value;
      preview.style.display = '';
    });

    document.getElementById('hero-browse-btn').addEventListener('click', async () => {
      await this._loadImageCache();
      const overlay = document.createElement('div');
      overlay.className = 'image-picker-overlay visible';
      overlay.innerHTML = `<div class="image-picker">
        <h3>Choose hero image</h3>
        <div class="media-filter" style="margin-bottom:1rem;"><input type="text" id="hero-picker-search" placeholder="Search..." style="width:100%;padding:.5rem 0;border:none;border-bottom:1px solid var(--warm-grey);font-family:var(--font-serif);font-size:.9rem;color:var(--near-black);background:transparent;" /></div>
        <div class="image-picker-grid">
          ${this._imageCache.map(img => `<div class="image-picker-item" data-name="${esc(img.name)}">
            <img src="/images/${esc(img.name)}" alt="${esc(img.name)}" loading="lazy" />
            <div class="image-picker-item-name">${esc(img.name)}</div>
          </div>`).join('')}
        </div>
        <div class="image-picker-actions">
          <button class="btn btn-ghost btn-sm" id="hero-picker-cancel">Cancel</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('#hero-picker-search').addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        overlay.querySelectorAll('.image-picker-item').forEach(item => {
          item.style.display = (!q || item.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
        });
      });

      overlay.querySelectorAll('.image-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          const path = `/images/${item.dataset.name}`;
          pathInput.value = path;
          preview.src = path;
          preview.style.display = '';
          overlay.remove();
        });
      });

      overlay.querySelector('#hero-picker-cancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    });

    document.getElementById('hero-upload-btn').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        const file = input.files[0];
        showStatus('saving', 'Uploading...');
        try {
          const reader = new FileReader();
          const b64 = await new Promise((res, rej) => { reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
          await this.api.uploadImage(`${this.config.getMediaFolder()}/${file.name}`, b64, `Upload ${file.name}`);
          this._imageCache = null;
          const path = `/images/${file.name}`;
          pathInput.value = path;
          preview.src = URL.createObjectURL(file);
          preview.style.display = '';
          showStatus('saved', 'Uploaded');
        } catch (e) { showStatus('error', e.message); }
      });
      input.click();
    });

    document.getElementById('hero-save-btn').addEventListener('click', async () => {
      const newPath = pathInput.value.trim();
      if (!newPath) { showStatus('error', 'Image path cannot be empty'); return; }
      siteData.hero_image = newPath;
      const content = JSON.stringify(siteData, null, 2) + '\n';
      showStatus('saving', 'Saving...');
      try {
        const result = await this.api.saveFile(siteDataPath, content, 'Update hero image', siteSha || undefined);
        siteSha = result.content.sha;
        showStatus('saved', 'Saved — site will rebuild');
      } catch (e) { showStatus('error', e.message); }
    });
  }

  // ---- Media Library ----
  async renderMedia() {
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Media</span></nav>
      <div class="list-header">
        <h2>Media</h2>
        <div class="media-actions"><button class="btn btn-primary btn-sm" id="upload-media-btn">Upload</button></div>
      </div>
      <div class="media-dropzone" id="media-dropzone">Drag & drop images, audio or video here</div>
      <div class="media-tabs" id="media-tabs">
        <button type="button" class="media-tab active" data-kind="all">All</button>
        <button type="button" class="media-tab" data-kind="image">Images</button>
        <button type="button" class="media-tab" data-kind="audio">Audio</button>
        <button type="button" class="media-tab" data-kind="video">Video</button>
      </div>
      <div class="media-filter"><input type="text" id="media-search" placeholder="Search media..." /></div>
      <div class="media-info" id="media-info"></div>
      <div class="media-grid" id="media-grid"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
    this._bindTopbar();

    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*,audio/*,video/*'; fileInput.multiple = true; fileInput.style.display = 'none';
    this.el.appendChild(fileInput);
    document.getElementById('upload-media-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files.length) this._uploadMediaFiles(fileInput.files); });

    const dropzone = document.getElementById('media-dropzone');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files.length) this._uploadMediaFiles(e.dataTransfer.files); });

    try {
      this._imageCache = null; this._audioCache = null; this._videoCache = null; this._imageCredits = null;
      await Promise.all([this._loadImageCache(), this._loadAudioCache(), this._loadVideoCache(), this._loadImageCredits()]);
      const images = this._imageCache;
      const audio = this._audioCache;
      const video = this._videoCache;
      const credits = this._imageCredits.data;

      const gridEl = document.getElementById('media-grid');
      const counts = [`${images.length} image${images.length !== 1 ? 's' : ''}`];
      if (audio.length) counts.push(`${audio.length} audio file${audio.length !== 1 ? 's' : ''}`);
      if (video.length) counts.push(`${video.length} video${video.length !== 1 ? 's' : ''}`);
      document.getElementById('media-info').textContent = counts.join(' · ');

      if (!images.length && !audio.length && !video.length) { gridEl.innerHTML = '<div class="empty-state">No media yet.</div>'; return; }

      const items = [
        ...video.map(f => ({ ...f, kind: 'video' })),
        ...audio.map(f => ({ ...f, kind: 'audio' })),
        ...images.map(f => ({ ...f, kind: 'image' })),
      ];

      gridEl.innerHTML = items.map(item => `<div class="media-item${item.kind === 'audio' ? ' media-item-audio' : ''}" data-name="${esc(item.name)}" data-kind="${item.kind}" data-sha="${item.sha}" data-path="${esc(item.path)}">
        <div class="media-thumb">${item.kind === 'audio'
          ? `<div class="media-audio-thumb"><span class="media-audio-icon">&#9835;</span><audio controls preload="none" src="/audio/${esc(item.name)}"></audio></div>`
          : item.kind === 'video'
          ? `<video controls preload="metadata" src="/video/${esc(item.name)}"></video>`
          : `<img src="/images/${item.name}" alt="${esc(item.name)}" loading="lazy" />`}</div>
        <div class="media-item-info">
          <div class="media-item-name" title="${esc(item.name)}">${esc(item.name)}</div>
          ${item.size ? `<div class="media-item-size">${formatFileSize(item.size)}</div>` : ''}
          <div class="media-item-date" title="When this file was uploaded">&nbsp;</div>
          ${item.kind === 'image' ? `<div class="media-item-credit" title="Photographer — shown under this photo everywhere on the site">${credits[normalizePathKey(`/images/${item.name}`)] ? '&copy; ' + esc(credits[normalizePathKey(`/images/${item.name}`)]) : '<span class="media-credit-empty">Add photographer</span>'}</div>` : ''}
          <div class="media-item-actions">
            <button class="btn btn-ghost btn-sm media-copy-btn">Copy</button>
            <button class="btn btn-danger btn-sm media-delete-btn">Delete</button>
          </div>
        </div>
      </div>`).join('');

      // Search + kind tabs filter together
      let mediaKind = 'all';
      const applyMediaFilter = () => {
        const q = document.getElementById('media-search').value.toLowerCase().trim();
        gridEl.querySelectorAll('.media-item').forEach(item => {
          const matchKind = mediaKind === 'all' || item.dataset.kind === mediaKind;
          const matchText = !q || item.dataset.name.toLowerCase().includes(q);
          item.classList.toggle('hidden', !(matchKind && matchText));
        });
      };
      document.getElementById('media-search').addEventListener('input', applyMediaFilter);
      document.querySelectorAll('#media-tabs .media-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          mediaKind = tab.dataset.kind;
          document.querySelectorAll('#media-tabs .media-tab').forEach(t => t.classList.toggle('active', t === tab));
          applyMediaFilter();
        });
      });

      // Upload dates arrive in the background, newest info first
      this._fillMediaDates(gridEl, items);

      // Copy
      gridEl.querySelectorAll('.media-copy-btn').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const item = btn.closest('.media-item');
        const p = item.dataset.kind === 'audio' ? `/audio/${item.dataset.name}` : item.dataset.kind === 'video' ? `/video/${item.dataset.name}` : `/images/${item.dataset.name}`;
        navigator.clipboard.writeText(p).then(() => showStatus('saved', `Copied: ${p}`));
      }));

      // Delete
      gridEl.querySelectorAll('.media-delete-btn').forEach(btn => btn.addEventListener('click', async e => {
        e.stopPropagation();
        const item = btn.closest('.media-item');
        const ok = await showModal('Delete', `Delete "${item.dataset.name}"?`);
        if (!ok) return;
        showStatus('saving', 'Deleting...');
        try {
          await this.api.deleteFile(item.dataset.path, item.dataset.sha, `Delete ${item.dataset.name}`);
          item.remove(); this._imageCache = null; this._audioCache = null; this._videoCache = null;
          showStatus('saved', 'Deleted');
        } catch (e) { showStatus('error', e.message); }
      }));

      // Click to preview (images — audio plays inline in its tile)
      gridEl.querySelectorAll('.media-item[data-kind="image"]').forEach(item => item.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        this._showLightbox(item.dataset.name, item.dataset.path);
      }));
    } catch (e) {
      document.getElementById('media-grid').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
    }
  }

  async _uploadMediaFiles(files) {
    const mediaFolder = this.config.getMediaFolder();
    const audioFolder = this.config.getAudioFolder();
    const videoFolder = this.config.getVideoFolder();
    let uploaded = 0;
    showStatus('saving', `Uploading 0/${files.length}...`);
    for (let file of files) {
      try {
        const isAudio = (file.type && file.type.startsWith('audio/')) || AUDIO_EXT_RE.test(file.name);
        const isVideo = (file.type && file.type.startsWith('video/')) || VIDEO_EXT_RE.test(file.name);
        const folder = isAudio ? audioFolder : isVideo ? videoFolder : mediaFolder;
        if (!isAudio && !isVideo) file = await this._prepareImageFile(file);
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
        await this.api.uploadImage(`${folder}/${file.name}`, b64, `Upload ${file.name}`);
        uploaded++;
        showStatus('saving', `Uploading ${uploaded}/${files.length}...`);
      } catch (e) { showStatus('error', `Failed: ${file.name}`); return; }
    }
    showStatus('saved', `Uploaded ${uploaded} file${uploaded !== 1 ? 's' : ''}`);
    this._imageCache = null; this._audioCache = null; this._videoCache = null;
    this.renderMedia();
  }

  // Each file's upload date, from its last commit — fetched lazily and cached
  async _fillMediaDates(gridEl, items) {
    this._mediaDateCache = this._mediaDateCache || {};
    await pMap(items, async item => {
      if (!(item.path in this._mediaDateCache)) {
        try {
          const commits = await this.api._request('GET', `/commits?path=${encodeURIComponent(item.path)}&per_page=1&sha=${this.api.branch}`);
          this._mediaDateCache[item.path] = (commits && commits[0] && commits[0].commit.author.date) || null;
        } catch (e) { this._mediaDateCache[item.path] = null; }
      }
      const d = this._mediaDateCache[item.path];
      if (!d || !gridEl.isConnected) return;
      const tile = gridEl.querySelector(`.media-item[data-path="${CSS.escape(item.path)}"] .media-item-date`);
      if (tile) tile.textContent = new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }, 6);
  }

  // ---- Photographer credits ----
  // One JSON file maps each image's public path to its photographer; the
  // site build prints the name under the photo everywhere it appears.
  async _loadImageCredits() {
    if (!this._imageCredits) {
      try {
        const f = await this.api.getFile(CREDITS_FILE_PATH);
        const raw = JSON.parse(f.content) || {};
        const data = {};
        for (const k of Object.keys(raw)) data[normalizePathKey(k)] = raw[k];
        this._imageCredits = { data, sha: f.sha };
      } catch (e) {
        this._imageCredits = { data: {}, sha: undefined };
      }
    }
    return this._imageCredits;
  }

  async _saveImageCredit(publicPath, name) {
    const store = await this._loadImageCredits();
    publicPath = normalizePathKey(publicPath);
    const trimmed = (name || '').trim();
    if (trimmed) store.data[publicPath] = trimmed;
    else delete store.data[publicPath];
    const message = trimmed
      ? `Set photographer for ${publicPath}: ${trimmed}`
      : `Remove photographer for ${publicPath}`;
    const res = await this.api.saveFile(CREDITS_FILE_PATH, JSON.stringify(store.data, null, 2) + '\n', message, store.sha);
    if (res && res.content && res.content.sha) store.sha = res.content.sha;
    return trimmed;
  }

  async _showLightbox(name, path) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox visible';
    const imgUrl = `/images/${name}`;
    const publicPath = normalizePathKey(`/images/${name}`);
    let credit = '';
    try { credit = (await this._loadImageCredits()).data[publicPath] || ''; } catch (e) { /* field starts empty */ }
    overlay.innerHTML = `<div class="lightbox-content">
      <img src="${imgUrl}" alt="${esc(name)}" />
      <div class="lightbox-info">
        <strong>${esc(name)}</strong>
        <code>/images/${esc(name)}</code>
        <div class="lightbox-credit">
          <label class="lightbox-credit-label" for="lightbox-credit-input">Photographer</label>
          <div class="lightbox-credit-row">
            <input type="text" class="form-input" id="lightbox-credit-input" value="${esc(credit)}" placeholder="Name of the photographer" />
            <button class="btn btn-primary btn-sm lightbox-credit-save">Save</button>
          </div>
          <div class="lightbox-credit-hint">Shown as &copy; Name on this photo everywhere it appears on the site. Leave empty for no credit.</div>
        </div>
        <div class="lightbox-actions">
          <button class="btn btn-primary btn-sm lightbox-copy">Copy Path</button>
          <button class="btn btn-ghost btn-sm lightbox-close">Close</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const creditInput = overlay.querySelector('#lightbox-credit-input');
    const saveCredit = async () => {
      showStatus('saving', 'Saving...');
      try {
        const saved = await this._saveImageCredit(publicPath, creditInput.value);
        // Reflect the change on the grid tile behind the lightbox
        const tile = document.querySelector(`.media-item[data-name="${CSS.escape(name)}"] .media-item-credit`);
        if (tile) tile.innerHTML = saved ? '&copy; ' + esc(saved) : '<span class="media-credit-empty">Add photographer</span>';
        showStatus('saved', 'Saved — site will rebuild');
      } catch (e) { showStatus('error', e.message); }
    };
    overlay.querySelector('.lightbox-credit-save').addEventListener('click', saveCredit);
    creditInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCredit(); } });
    overlay.querySelector('.lightbox-copy').addEventListener('click', () => navigator.clipboard.writeText(`/images/${name}`).then(() => showStatus('saved', 'Copied')));
    overlay.querySelector('.lightbox-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }
}

// --------------- Bootstrap ---------------
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});

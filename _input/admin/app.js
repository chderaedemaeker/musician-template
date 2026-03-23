/* ============================================================
   Musician-Template – CMS Admin (Simplified + Trilingual)
   ============================================================ */

// --------------- Git Gateway API (via Netlify Identity) ---------------
class GitGatewayAPI {
  constructor(tokenFn) {
    this._tokenFn = tokenFn; // async function that returns a fresh JWT
    this.base = '/.netlify/git/github';
    this.branch = 'master';
  }

  async _headers() {
    const token = await this._tokenFn();
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async _request(method, endpoint, body) {
    const url = `${this.base}${endpoint}`;
    const opts = { method, headers: await this._headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Git Gateway ${res.status}`);
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
    const body = { message, content: encodeBase64UTF8(content), branch: this.branch };
    if (sha) body.sha = sha;
    return this._request('PUT', `/contents/${path}`, body);
  }

  async deleteFile(path, sha, message) {
    return this._request('DELETE', `/contents/${path}`, {
      message, sha, branch: this.branch,
    });
  }

  async uploadImage(path, base64content, message) {
    let sha;
    try {
      const existing = await this._request('GET', `/contents/${path}?ref=${this.branch}`);
      sha = existing.sha;
    } catch (e) { /* new file */ }
    const body = { message, content: base64content, branch: this.branch };
    if (sha) body.sha = sha;
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
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      data[key] = val;
    }
    return { data, body: match[2] };
  },
  serialize(data, body) {
    let out = '---\n';
    for (const [k, v] of Object.entries(data)) {
      const val = v == null ? '' : String(v);
      if (val === '' || val.includes(':') || val.includes('#') || val.includes('{') || val.includes('}') || val.includes('[') || val.includes(']'))
        out += `${k}: "${val.replace(/"/g, '\\"')}"\n`;
      else out += `${k}: ${val}\n`;
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
    if (p.length) result.push(`<p>${inlineMd(p.join(' '))}</p>`);
  }
  return result.join('\n');
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
    this.api = new GitGatewayAPI(() => {
      return this._identityUser.jwt(true); // force refresh
    });
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
    try {
      const file = await this.api.getFile('_input/admin/config.yml');
      this.config = new ConfigParser(file.content);
      this.collections = this.config.getCollections();
    } catch (e) {
      console.error('Failed to load config:', e);
      showStatus('error', 'Could not load config.yml');
    }
  }

  _markDirty() { this._unsavedChanges = true; const b = document.getElementById('save-btn'); if (b) b.classList.add('has-changes'); }
  _markClean() { this._unsavedChanges = false; const b = document.getElementById('save-btn'); if (b) b.classList.remove('has-changes'); }

  // ---- Router ----
  route() {
    const hash = location.hash || '#/';
    if (!this.api && !hash.startsWith('#/login')) { location.hash = '#/login'; return; }
    if (hash === '#/login') return this.renderLogin();
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
            <div class="card-count">${c.i18n ? 'EN · NL · FR' : 'Single language'}</div>
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
      </div>`;
    this.el.querySelectorAll('.card[data-col]').forEach(card => card.addEventListener('click', () => { location.hash = `#/${card.dataset.col}`; }));
    document.getElementById('media-card').addEventListener('click', () => { location.hash = '#/media'; });
    document.getElementById('hero-card').addEventListener('click', () => { location.hash = '#/hero'; });
    this._bindTopbar();
    for (const col of this.collections) this._fetchEntryCount(col);
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
    const ts = this._getTranslationSettings();
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Settings</span></nav>
      <div class="settings-section">
        <h3>Account</h3>
        <p style="font-size:.9rem;color:var(--dark-grey);margin-bottom:1.5rem;">Signed in as <strong>${esc(email)}</strong></p>
        <button id="set-logout" class="btn btn-danger">Logout</button>
      </div>
      <div class="settings-section">
        <h3>Translation</h3>
        <p style="font-size:.9rem;color:var(--dark-grey);margin-bottom:1.5rem;">Configure a provider to enable the Translate button in the content editor. API keys are stored in your browser only.</p>
        <div class="form-group">
          <label class="form-label">Provider</label>
          <select class="form-input" id="trans-provider">
            <option value="" ${!ts.provider ? 'selected' : ''}>— disabled —</option>
            <option value="mymemory" ${ts.provider === 'mymemory' ? 'selected' : ''}>MyMemory (free, no key needed)</option>
            <option value="deepl" ${ts.provider === 'deepl' ? 'selected' : ''}>DeepL (API key required)</option>
            <option value="google" ${ts.provider === 'google' ? 'selected' : ''}>Google Translate (API key required)</option>
            <option value="libretranslate" ${ts.provider === 'libretranslate' ? 'selected' : ''}>LibreTranslate (open source)</option>
          </select>
        </div>
        <div class="form-group" id="trans-key-group" style="display:${ts.provider && ts.provider !== 'mymemory' ? '' : 'none'};">
          <label class="form-label">API Key</label>
          <input type="password" class="form-input" id="trans-api-key" value="${esc(ts.apiKey)}" placeholder="Paste your API key" autocomplete="off" />
        </div>
        <div class="form-group" id="trans-url-group" style="display:${ts.provider === 'libretranslate' ? '' : 'none'};">
          <label class="form-label">API URL</label>
          <input type="text" class="form-input" id="trans-api-url" value="${esc(ts.apiUrl)}" placeholder="https://libretranslate.com" />
        </div>
        <button class="btn btn-primary btn-sm" id="trans-save-btn">Save</button>
      </div>`;
    this._bindTopbar();
    document.getElementById('set-logout').addEventListener('click', () => this.logout());

    const providerSel = document.getElementById('trans-provider');
    const keyGroup = document.getElementById('trans-key-group');
    const urlGroup = document.getElementById('trans-url-group');
    providerSel.addEventListener('change', () => {
      keyGroup.style.display = (providerSel.value && providerSel.value !== 'mymemory') ? '' : 'none';
      urlGroup.style.display = providerSel.value === 'libretranslate' ? '' : 'none';
    });
    document.getElementById('trans-save-btn').addEventListener('click', () => {
      localStorage.setItem('cms_trans_provider', providerSel.value);
      localStorage.setItem('cms_trans_key', document.getElementById('trans-api-key').value);
      localStorage.setItem('cms_trans_url', document.getElementById('trans-api-url').value);
      showStatus('saved', 'Translation settings saved');
    });
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

      const entries = await Promise.all(files.map(async f => {
        try {
          const fd = await this.api.getFile(f.path);
          return { name: f.name, data: FrontMatter.parse(fd.content).data, path: f.path, sha: fd.sha };
        } catch { return { name: f.name, data: { title: f.name }, path: f.path, sha: null }; }
      }));

      listEl.innerHTML = `<div class="entry-row" style="border-bottom:1px solid var(--warm-grey);cursor:default;padding:.5rem 0;">
          <div class="entry-row-left"><input type="checkbox" class="entry-checkbox" id="select-all-checkbox" /><span style="font-size:.65rem;color:var(--mid-grey);margin-left:.4rem;text-transform:uppercase;letter-spacing:.08em;">Select all</span></div>
        </div>` +
        entries.map(e => {
          const title = e.data.title || e.name;
          const date = e.data.date ? e.data.date.replace('T', ' ').substring(0, 16) : '';
          return `<div class="entry-row" data-file="${esc(e.name)}" data-title="${esc(title)}" data-sha="${esc(e.sha||'')}" data-path="${esc(e.path)}">
            <div class="entry-row-left">
              <input type="checkbox" class="entry-checkbox entry-select" data-file="${esc(e.name)}" />
              <div style="min-width:0;"><div class="entry-title">${esc(title)}</div>${date ? `<div class="entry-meta">${esc(date)}</div>` : ''}</div>
            </div>
          </div>`;
        }).join('');

      listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
        row.addEventListener('click', e => { if (e.target.closest('.entry-checkbox')) return; location.hash = `#/${name}/edit/${encodeURIComponent(row.dataset.file)}`; });
      });

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
      { key: 'title', label: 'Title', width: 'minmax(200px, 2fr)' },
      { key: 'date', label: 'Date', width: 'minmax(140px, 1fr)', type: 'date' },
      { key: 'place', label: 'Place', width: 'minmax(140px, 1fr)' },
      { key: 'composers', label: 'Composers', width: 'minmax(120px, 1fr)' },
      { key: 'collaborators', label: 'Collaborators', width: 'minmax(120px, 1fr)' },
    ];
    const gridCols = '36px ' + columns.map(c => c.width).join(' ') + ' 70px';

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>${esc(col.label)}</span></nav>
      <div class="list-header">
        <h2>${esc(col.label)}</h2>
        <div style="display:flex;gap:.5rem;">
          <button class="btn btn-primary btn-sm" id="new-row-btn">+ New</button>
        </div>
      </div>
      <div class="collection-filter"><input type="text" id="table-search" placeholder="Search concerts..." /></div>
      <div id="bulk-bar" class="bulk-bar" style="display:none;"><span id="bulk-count">0</span><button class="btn btn-sm" id="bulk-delete-btn">Delete</button></div>
      <div class="notion-table-wrap">
        <div class="notion-table" id="notion-table" style="grid-template-columns: ${gridCols};">
          <div class="notion-th notion-th-check"><input type="checkbox" id="select-all-checkbox" class="entry-checkbox" /></div>
          ${columns.map(c => `<div class="notion-th" data-sort="${c.key}">${esc(c.label)}<span class="sort-icon"></span></div>`).join('')}
          <div class="notion-th"></div>
        </div>
        <div id="notion-body"><div class="loading-state"><span class="spinner"></span> Loading concerts...</div></div>
      </div>`;
    this._bindTopbar();

    this._concertTableState = { entries: [], col, columns, gridCols, sortKey: 'date', sortDir: 'desc', saveTimers: {} };

    try {
      const contents = await this.api.getContents(col.folder);
      const files = contents.filter(f => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
      const bodyEl = document.getElementById('notion-body');

      if (!files.length) { bodyEl.innerHTML = '<div class="empty-state">No concerts yet.</div>'; return; }

      const entries = await Promise.all(files.map(async f => {
        try {
          const fd = await this.api.getFile(f.path);
          const parsed = FrontMatter.parse(fd.content);
          return { name: f.name, data: parsed.data, body: parsed.body, path: f.path, sha: fd.sha, dirty: false };
        } catch { return { name: f.name, data: { title: f.name }, body: '', path: f.path, sha: null, dirty: false }; }
      }));

      this._concertTableState.entries = entries;
      this._renderTableRows();
      this._bindTableEvents();
    } catch (e) {
      document.getElementById('notion-body').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
    }
  }

  _renderTableRows() {
    const state = this._concertTableState;
    const { entries, columns, gridCols, sortKey, sortDir } = state;

    const sorted = [...entries].sort((a, b) => {
      const va = (a.data[sortKey] || '').toLowerCase();
      const vb = (b.data[sortKey] || '').toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    const bodyEl = document.getElementById('notion-body');
    bodyEl.innerHTML = sorted.map((entry, i) => {
      const idx = entries.indexOf(entry);
      const dateVal = entry.data.date ? entry.data.date.substring(0, 10) : '';
      return `<div class="notion-row${entry.dirty ? ' notion-row-dirty' : ''}" data-idx="${idx}" style="grid-template-columns: ${gridCols};">
        <div class="notion-cell notion-cell-check"><input type="checkbox" class="entry-checkbox entry-select" data-idx="${idx}" data-file="${esc(entry.name)}" /></div>
        <div class="notion-cell notion-cell-title" data-field="title" data-idx="${idx}" contenteditable="true">${esc(entry.data.title || '')}</div>
        <div class="notion-cell notion-cell-date" data-field="date" data-idx="${idx}"><input type="date" class="notion-date-input" value="${esc(dateVal)}" data-idx="${idx}" /></div>
        <div class="notion-cell" data-field="place" data-idx="${idx}" contenteditable="true">${esc(entry.data.place || '')}</div>
        <div class="notion-cell" data-field="composers" data-idx="${idx}" contenteditable="true">${esc(entry.data.composers || '')}</div>
        <div class="notion-cell" data-field="collaborators" data-idx="${idx}" contenteditable="true">${esc(entry.data.collaborators || '')}</div>
        <div class="notion-cell notion-cell-actions"><button class="notion-dup-btn" data-idx="${idx}" title="Duplicate">&#x2398;</button><button class="notion-open-btn" data-file="${esc(entry.name)}" title="Open full editor">&#8599;</button></div>
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

    // Search
    document.getElementById('table-search').addEventListener('input', function() {
      const q = this.value.toLowerCase().trim();
      bodyEl.querySelectorAll('.notion-row').forEach(row => {
        if (!q) { row.style.display = ''; return; }
        const idx = parseInt(row.dataset.idx);
        const entry = state.entries[idx];
        const match = Object.values(entry.data).some(v => (v || '').toString().toLowerCase().includes(q));
        row.style.display = match ? '' : 'none';
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

    // New row
    document.getElementById('new-row-btn').addEventListener('click', () => {
      location.hash = '#/concerts/new';
    });
  }

  _bindTableRowEvents() {
    const state = this._concertTableState;
    const bodyEl = document.getElementById('notion-body');

    // Inline editing — contenteditable cells
    bodyEl.querySelectorAll('.notion-cell[contenteditable]').forEach(cell => {
      cell.addEventListener('focus', () => { cell.classList.add('notion-cell-editing'); });

      cell.addEventListener('blur', () => {
        cell.classList.remove('notion-cell-editing');
        const idx = parseInt(cell.dataset.idx);
        const field = cell.dataset.field;
        const newVal = cell.textContent.trim();
        const entry = state.entries[idx];
        if (entry && entry.data[field] !== newVal) {
          entry.data[field] = newVal;
          entry.dirty = true;
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
          const field = cell.dataset.field;
          cell.textContent = state.entries[idx].data[field] || '';
          cell.blur();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const row = cell.closest('.notion-row');
          const cells = [...row.querySelectorAll('[contenteditable], .notion-date-input')];
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

    // Date inputs
    bodyEl.querySelectorAll('.notion-date-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const entry = state.entries[idx];
        if (entry) {
          entry.data.date = input.value ? input.value + 'T00:00:00' : '';
          entry.dirty = true;
          input.closest('.notion-row').classList.add('notion-row-dirty');
          this._debounceSaveRow(idx);
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const row = input.closest('.notion-row');
          const cells = [...row.querySelectorAll('[contenteditable], .notion-date-input')];
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
        const newData = { ...entry.data, title: (entry.data.title || '') + ' (copy)' };
        const now = new Date();
        const datePrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const slug = (newData.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const newName = `${datePrefix}-${slug}.md`;
        const newPath = state.col.folder + '/' + newName;
        if (!newData.layout) newData.layout = 'concert.html';
        const content = FrontMatter.serialize(newData, entry.body || '');
        try {
          showStatus('saving', 'Duplicating...');
          const result = await this.api.createOrUpdateFile(newPath, content, `Duplicate concert: ${newData.title}`);
          state.entries.push({ name: newName, data: newData, body: entry.body || '', path: newPath, sha: result.content.sha, dirty: false });
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

  async _saveTableRow(idx) {
    const state = this._concertTableState;
    const entry = state.entries[idx];
    if (!entry || !entry.dirty) return;

    const row = document.querySelector(`.notion-row[data-idx="${idx}"]`);
    if (row) row.classList.add('notion-row-saving');

    try {
      const data = { ...entry.data };
      if (!data.layout) data.layout = 'concert.html';
      const content = FrontMatter.serialize(data, entry.body || '');
      const result = await this.api.createOrUpdateFile(entry.path, content, `Update concert: ${data.title || entry.name}`, entry.sha || undefined);
      entry.sha = result.content.sha;
      entry.dirty = false;
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
          ${isI18n ? '<button class="btn btn-ghost btn-sm" id="translate-btn">Translate</button>' : ''}
          <button class="btn btn-primary" id="save-btn">Save</button>
          ${!isNew ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
        </div>
      </div>
      ${isI18n ? `
        <div class="trilingual-toggle">
          <label><input type="checkbox" id="trilingual-mode" /> Show all languages side by side</label>
        </div>
        <div class="i18n-tabs" id="i18n-tabs">
          ${locales.map(l => `<button class="i18n-tab ${l === locales[0] ? 'active' : ''}" data-locale="${l}">${l.toUpperCase()}</button>`).join('')}
        </div>
      ` : ''}
      <div class="editor-split">
        <div id="editor-form"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>
        <div class="live-preview-panel" id="live-preview">
          <div class="live-preview-header">Preview</div>
          <div class="live-preview-content" id="live-preview-content">
            <div class="live-preview-empty">Start editing to see a preview</div>
          </div>
        </div>
      </div>`;
    this._bindTopbar();

    const state = { locales, data: {}, body: {}, sha: {}, filePath: {}, activeLocale: locales[0], filename, isNew, col, trilingualMode: false };
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
          } catch (e) { if (!isI18n) throw e; }
        }
      } catch (e) {
        document.getElementById('editor-form').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
        return;
      }
    }

    this._renderEditorForm(state);

    // i18n tabs
    if (isI18n) {
      document.getElementById('i18n-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.i18n-tab');
        if (!tab || state.trilingualMode) return;
        this._collectFormData(state);
        state.activeLocale = tab.dataset.locale;
        document.querySelectorAll('.i18n-tab').forEach(t => t.classList.toggle('active', t === tab));
        this._renderEditorForm(state);
      });

      // Trilingual toggle
      const triToggle = document.getElementById('trilingual-mode');
      if (triToggle) {
        triToggle.addEventListener('change', () => {
          this._collectFormData(state);
          state.trilingualMode = triToggle.checked;
          document.getElementById('i18n-tabs').style.display = triToggle.checked ? 'none' : 'flex';
          this._renderEditorForm(state);
        });
      }
    }

    // Translate
    const transBtn = document.getElementById('translate-btn');
    if (transBtn) transBtn.addEventListener('click', () => this._showTranslateModal(state));

    // Save
    document.getElementById('save-btn').addEventListener('click', () => this._saveEntry(state));

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

  _renderEditorForm(state) {
    const { col, locales } = state;
    const formEl = document.getElementById('editor-form');

    if (state.trilingualMode) {
      this._renderTrilingualForm(state, formEl);
      return;
    }

    const data = state.data[state.activeLocale];
    const body = state.body[state.activeLocale];
    let html = '';

    for (const field of col.fields) {
      if (field.name === 'body') continue;
      const value = data[field.name] || '';
      html += `<div class="form-group">
        <label class="form-label">${esc(field.label)}${field.required ? '' : ' <span class="optional">(optional)</span>'}</label>
        ${this._renderField(field, value, state.activeLocale)}
      </div>`;
    }

    const bodyField = col.fields.find(f => f.name === 'body');
    if (bodyField) {
      html += `<div class="form-group">
        <label class="form-label">${esc(bodyField.label)}</label>
        ${this._renderMarkdownEditor('body', body, state.activeLocale)}
      </div>`;
    }

    formEl.innerHTML = html;
    this._bindFormHandlers(formEl, state);
    this._updateLivePreview(state);
  }

  _renderTrilingualForm(state, formEl) {
    const { col, locales } = state;
    let html = '<div class="trilingual-editor">';

    for (const loc of locales) {
      const data = state.data[loc];
      const body = state.body[loc];
      html += `<div class="trilingual-col" data-locale="${loc}">
        <div class="trilingual-col-header">${loc.toUpperCase()}</div>`;

      for (const field of col.fields) {
        if (field.name === 'body') continue;
        const value = data[field.name] || '';
        html += `<div class="form-group">
          <label class="form-label">${esc(field.label)}</label>
          ${this._renderField(field, value, loc)}
        </div>`;
      }

      const bodyField = col.fields.find(f => f.name === 'body');
      if (bodyField) {
        html += `<div class="form-group">
          <label class="form-label">Content</label>
          ${this._renderMarkdownEditor('body', body, loc)}
        </div>`;
      }

      html += '</div>';
    }

    html += '</div>';
    formEl.innerHTML = html;
    this._bindFormHandlers(formEl, state);
    this._updateLivePreview(state);
  }

  _renderField(field, value, locale) {
    const escaped = esc(value);
    const dataAttr = `data-field="${field.name}" data-locale="${locale}"`;

    switch (field.widget) {
      case 'datetime':
        let dtVal = value;
        if (dtVal && dtVal.length > 16) dtVal = dtVal.substring(0, 16);
        return `<input type="datetime-local" class="form-input" ${dataAttr} value="${esc(dtVal)}" />`;

      case 'image':
        return `<div class="image-field">
          ${value ? `<img class="image-preview" src="${value.startsWith('/') ? value : '/images/' + value}" onerror="this.style.display='none'" />` : '<div class="image-placeholder">No image</div>'}
          <div class="image-controls">
            <input type="text" class="form-input" ${dataAttr} value="${escaped}" placeholder="/images/photo.jpg" />
            <div style="display:flex;gap:.25rem;margin-top:.25rem;">
              <button type="button" class="btn btn-ghost btn-sm image-browse-btn" data-img-field="${field.name}" data-img-locale="${locale}">Browse</button>
              <button type="button" class="btn btn-ghost btn-sm image-upload-btn" data-img-field="${field.name}" data-img-locale="${locale}">Upload</button>
            </div>
          </div>
        </div>`;

      case 'markdown':
        return this._renderMarkdownEditor(field.name, value, locale);

      default:
        return `<input type="text" class="form-input" ${dataAttr} value="${escaped}" />`;
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
        <button type="button" title="Insert Image" data-md-action="image">Image</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="List" data-md-action="ul">List</button>
        <button type="button" title="Quote" data-md-action="quote">Quote</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Preview" data-md-action="preview">Preview</button>
      </div>
      <div class="md-editor-body">
        <textarea class="md-textarea" data-field="${fieldName}" data-locale="${locale}">${esc(value)}</textarea>
      </div>
    </div>`;
  }

  _bindFormHandlers(formEl, state) {
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

    // Markdown editors
    formEl.querySelectorAll('[data-md-editor]').forEach(wrap => {
      const textarea = wrap.querySelector('.md-textarea');
      const toolbar = wrap.querySelector('.md-toolbar');

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
        if (action === 'preview') { this._togglePreview(wrap, btn); return; }
        if (action === 'image') { this._showImagePickerForEditor(textarea, wrap); return; }
        this._mdAction(textarea, action);
        textarea.focus();
      });
    });
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
    const loc = state.activeLocale || state.locales[0];
    const data = state.data[loc] || {};
    const body = state.body[loc] || '';
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
      if (data.collaborators) meta.push(`With ${esc(data.collaborators)}`);
      if (meta.length) html += `<div class="lp-meta">${meta.map(m => `<span>${m}</span>`).join('')}</div>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
      if (data.link) html += `<a class="lp-btn" href="#">Tickets & Info</a>`;
    } else if (colName === 'highlights') {
      // Highlight detail preview
      if (data.link) {
        html += `<div class="lp-video"><div class="lp-video-placeholder">YouTube: ${esc(data.link)}</div></div>`;
      }
      if (data.image) {
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
    } else if (colName === 'projects') {
      // Project detail preview
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      if (data.collaborators) html += `<div class="lp-meta"><span>${esc(data.collaborators)}</span></div>`;
      if (data.image) {
        html += `<div class="lp-featured-image"><img src="${data.image.startsWith('/') ? data.image : '/images/' + data.image}" alt="${esc(data.title || '')}" onerror="this.parentElement.innerHTML='<div class=\\'lp-img-placeholder\\'>Image</div>'" /></div>`;
      }
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
    } else if (colName === 'about') {
      // About preview
      html += `<h1 class="lp-title">${esc(data.title || 'About')}</h1>`;
      if (data.summaryabout) html += `<div class="lp-summary">${renderMarkdown(data.summaryabout)}</div>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
    } else {
      html += `<h1 class="lp-title">${esc(data.title || 'Untitled')}</h1>`;
      if (body.trim()) html += `<div class="lp-body">${renderMarkdown(body)}</div>`;
    }

    html += '</div>';
    el.innerHTML = html;
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

  // Image picker for markdown editor (insert syntax)
  async _showImagePickerForEditor(textarea, wrap) {
    await this._loadImageCache();
    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    overlay.innerHTML = `<div class="image-picker">
      <h3>Insert an image</h3>
      <div class="media-filter" style="margin-bottom:1rem;"><input type="text" id="picker-search" placeholder="Search..." style="width:100%;padding:.5rem 0;border:none;border-bottom:1px solid var(--warm-grey);font-family:var(--font-serif);font-size:.9rem;color:var(--near-black);background:transparent;" /></div>
      <div class="image-picker-grid" id="picker-grid">
        ${this._imageCache.map(img => `<div class="image-picker-item" data-name="${esc(img.name)}" data-path="${esc(img.path)}">
          <img src="/images/${img.name}" alt="${esc(img.name)}" loading="lazy" />
          <div class="image-picker-item-name">${esc(img.name)}</div>
        </div>`).join('')}
      </div>
      <div class="image-picker-actions">
        <button class="btn btn-ghost btn-sm" id="picker-upload-new">Upload new</button>
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
      item.addEventListener('click', () => {
        const publicPath = `/images/${item.dataset.name}`;
        const md = `![${item.dataset.name}](${publicPath})`;
        const pos = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, pos) + md + textarea.value.substring(pos);
        textarea.selectionStart = textarea.selectionEnd = pos + md.length;
        this._markDirty();
        this._updatePreview(wrap);
        overlay.remove();
      });
    });

    overlay.querySelector('#picker-upload-new').addEventListener('click', () => {
      overlay.remove();
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
          const publicPath = `/images/${file.name}`;
          const md = `![${file.name}](${publicPath})`;
          const pos = textarea.selectionStart;
          textarea.value = textarea.value.substring(0, pos) + md + textarea.value.substring(pos);
          textarea.selectionStart = textarea.selectionEnd = pos + md.length;
          this._markDirty();
          this._updatePreview(wrap);
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
    const mediaFolder = this.config.getMediaFolder();
    try {
      const contents = await this.api.getContents(mediaFolder);
      this._imageCache = contents.filter(f => f.type === 'file' && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('getContents failed for', mediaFolder, '- trying tree API:', e.message);
      try {
        const files = await this.api.getTree(mediaFolder);
        this._imageCache = files.filter(f => /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      } catch (e2) {
        console.error('Both methods failed to load images:', e2);
        showToast('error', 'Could not load images: ' + e2.message);
        this._imageCache = [];
      }
    }
  }

  async _handleImageUpload(file, fieldName, locale, state) {
    if (!file) return;
    showStatus('saving', 'Uploading...');
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

    if (state.trilingualMode) {
      // Collect from all three columns
      for (const loc of state.locales) {
        formEl.querySelectorAll(`[data-locale="${loc}"][data-field]`).forEach(el => {
          if (el.dataset.field === 'body') state.body[loc] = el.value;
          else state.data[loc][el.dataset.field] = el.value;
        });
      }
    } else {
      const loc = state.activeLocale;
      formEl.querySelectorAll(`[data-locale="${loc}"][data-field]`).forEach(el => {
        if (el.dataset.field === 'body') state.body[loc] = el.value;
        else state.data[loc][el.dataset.field] = el.value;
      });
    }
  }

  async _saveEntry(state) {
    this._collectFormData(state);
    const { col, locales, isNew } = state;
    const isI18n = !!(col.i18n || col.i18nStructure);
    let filename = state.filename;
    if (isNew) {
      const title = state.data[locales[0]].title;
      if (!title) { showStatus('error', 'Title is required'); return; }
      filename = generateFilename(title);
      state.filename = filename;
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
          if (!data.layout) data.layout = 'concert.html';
        }
        if (isI18n && loc !== 'en') {
          for (const f of col.fields) { if (f.i18n === 'duplicate' && !data[f.name]) data[f.name] = state.data['en'][f.name] || ''; }
        }
        const content = FrontMatter.serialize(data, state.body[loc] || '');
        const path = isI18n ? `${col.folder}/${loc}/${filename}` : `${col.folder}/${filename}`;
        const msg = isNew ? `Create ${col.label}: ${data.title || filename}` : `Update ${col.label}: ${data.title || filename}`;
        const result = await this.api.createOrUpdateFile(path, content, msg, state.sha[loc] || undefined);
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

  // ---- Translation ----
  _getTranslationSettings() {
    return {
      provider: localStorage.getItem('cms_trans_provider') || '',
      apiKey: localStorage.getItem('cms_trans_key') || '',
      apiUrl: localStorage.getItem('cms_trans_url') || 'https://libretranslate.com',
    };
  }

  async _translateText(text, sourceLang, targetLang, settings) {
    if (!text || !text.trim()) return text;
    const { provider, apiKey, apiUrl } = settings;

    if (provider === 'mymemory') {
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`);
      if (!res.ok) throw new Error(`MyMemory error: ${res.status}`);
      const data = await res.json();
      if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'Translation failed');
      return data.responseData.translatedText;
    }

    if (provider === 'deepl') {
      const base = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const res = await fetch(`${base}/v2/translate`, {
        method: 'POST',
        headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [text], source_lang: sourceLang.toUpperCase(), target_lang: targetLang.toUpperCase() }),
      });
      if (!res.ok) throw new Error(`DeepL error: ${res.status}`);
      const data = await res.json();
      return data.translations[0].text;
    }

    if (provider === 'google') {
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' }),
      });
      if (!res.ok) throw new Error(`Google Translate error: ${res.status}`);
      const data = await res.json();
      return data.data.translations[0].translatedText;
    }

    if (provider === 'libretranslate') {
      const base = (apiUrl || 'https://libretranslate.com').replace(/\/$/, '');
      const body = { q: text, source: sourceLang, target: targetLang, format: 'text' };
      if (apiKey) body.api_key = apiKey;
      const res = await fetch(`${base}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`LibreTranslate error: ${res.status}`);
      const data = await res.json();
      return data.translatedText;
    }

    throw new Error('No translation provider configured');
  }

  async _doTranslate(state, sourceLang, targetLangs, overlay) {
    this._collectFormData(state);
    const settings = this._getTranslationSettings();
    const { col } = state;
    let translated = 0;
    let errors = 0;

    for (const targetLang of targetLangs) {
      if (targetLang === sourceLang) continue;
      for (const field of col.fields) {
        if (field.widget === 'image' || field.widget === 'datetime') continue;
        const isBody = field.name === 'body';
        const value = isBody ? state.body[sourceLang] : state.data[sourceLang][field.name];
        if (!value || !value.trim()) continue;
        try {
          const result = await this._translateText(value, sourceLang, targetLang, settings);
          if (isBody) state.body[targetLang] = result;
          else state.data[targetLang][field.name] = result;
          translated++;
        } catch (e) {
          errors++;
          console.error(`Translation failed for ${field.name} (${sourceLang}→${targetLang}):`, e);
        }
      }
    }

    overlay.remove();
    this._renderEditorForm(state);
    this._markDirty();
    if (errors > 0) showStatus('error', `Translated ${translated} fields, ${errors} failed — check console`);
    else showStatus('saved', `Translated ${translated} fields`);
  }

  _showTranslateModal(state) {
    const settings = this._getTranslationSettings();
    if (!settings.provider) {
      showStatus('error', 'No provider configured — go to Settings → Translation');
      return;
    }

    const { locales } = state;
    const overlay = document.createElement('div');
    overlay.className = 'image-picker-overlay visible';
    overlay.innerHTML = `<div class="image-picker" style="max-width:400px;">
      <h3 style="margin-bottom:1.25rem;">Translate Content</h3>
      <div class="form-group">
        <label class="form-label">Translate from</label>
        <select class="form-input" id="trans-modal-source">
          ${locales.map(l => `<option value="${l}" ${l === state.activeLocale ? 'selected' : ''}>${l.toUpperCase()}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Translate to</label>
        <div id="trans-modal-targets">
          ${locales.map(l => `<label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;font-size:.9rem;">
            <input type="checkbox" class="trans-target-cb" value="${l}" ${l !== state.activeLocale ? 'checked' : 'disabled'} />
            ${l.toUpperCase()}
          </label>`).join('')}
        </div>
      </div>
      <p style="font-size:.8rem;color:var(--dark-grey);margin-bottom:1.25rem;">Provider: <strong>${esc(settings.provider)}</strong>. Target language fields will be overwritten.</p>
      <div class="image-picker-actions">
        <button class="btn btn-primary btn-sm" id="trans-modal-run">Translate</button>
        <button class="btn btn-ghost btn-sm" id="trans-modal-cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#trans-modal-source').addEventListener('change', (e) => {
      overlay.querySelectorAll('.trans-target-cb').forEach(cb => {
        cb.disabled = cb.value === e.target.value;
        if (cb.value === e.target.value) cb.checked = false;
        else cb.checked = true;
      });
    });

    overlay.querySelector('#trans-modal-run').addEventListener('click', async () => {
      const sourceLang = overlay.querySelector('#trans-modal-source').value;
      const targetLangs = [...overlay.querySelectorAll('.trans-target-cb:checked')].map(cb => cb.value);
      if (!targetLangs.length) { showStatus('error', 'Select at least one target language'); return; }
      const runBtn = overlay.querySelector('#trans-modal-run');
      runBtn.disabled = true;
      runBtn.textContent = 'Translating…';
      try {
        await this._doTranslate(state, sourceLang, targetLangs, overlay);
      } catch (e) {
        showStatus('error', e.message);
        overlay.remove();
      }
    });

    overlay.querySelector('#trans-modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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
        const result = await this.api.createOrUpdateFile(siteDataPath, content, 'Update hero image', siteSha || undefined);
        siteSha = result.content.sha;
        showStatus('saved', 'Saved — site will rebuild');
      } catch (e) { showStatus('error', e.message); }
    });
  }

  // ---- Media Library ----
  async renderMedia() {
    const mediaFolder = this.config ? this.config.getMediaFolder() : '_input/images';
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Media</span></nav>
      <div class="list-header">
        <h2>Media</h2>
        <div class="media-actions"><button class="btn btn-primary btn-sm" id="upload-media-btn">Upload</button></div>
      </div>
      <div class="media-dropzone" id="media-dropzone">Drag & drop images here</div>
      <div class="media-filter"><input type="text" id="media-search" placeholder="Search images..." /></div>
      <div class="media-info" id="media-info"></div>
      <div class="media-grid" id="media-grid"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
    this._bindTopbar();

    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true; fileInput.style.display = 'none';
    this.el.appendChild(fileInput);
    document.getElementById('upload-media-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files.length) this._uploadMediaFiles(fileInput.files, mediaFolder); });

    const dropzone = document.getElementById('media-dropzone');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files.length) this._uploadMediaFiles(e.dataTransfer.files, mediaFolder); });

    try {
      let contents;
      try { contents = await this.api.getContents(mediaFolder); }
      catch (e) { contents = await this.api.getTree(mediaFolder); }
      const images = contents.filter(f => f.type === 'file' && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      this._imageCache = images;

      const gridEl = document.getElementById('media-grid');
      document.getElementById('media-info').textContent = `${images.length} images`;

      if (!images.length) { gridEl.innerHTML = '<div class="empty-state">No images yet.</div>'; return; }

      gridEl.innerHTML = images.map(img => `<div class="media-item" data-name="${esc(img.name)}" data-sha="${img.sha}" data-path="${esc(img.path)}">
        <div class="media-thumb"><img src="/images/${img.name}" alt="${esc(img.name)}" loading="lazy" /></div>
        <div class="media-item-info">
          <div class="media-item-name" title="${esc(img.name)}">${esc(img.name)}</div>
          ${img.size ? `<div class="media-item-size">${formatFileSize(img.size)}</div>` : ''}
          <div class="media-item-actions">
            <button class="btn btn-ghost btn-sm media-copy-btn">Copy</button>
            <button class="btn btn-danger btn-sm media-delete-btn">Delete</button>
          </div>
        </div>
      </div>`).join('');

      // Search
      document.getElementById('media-search').addEventListener('input', function() {
        const q = this.value.toLowerCase().trim();
        gridEl.querySelectorAll('.media-item').forEach(item => item.classList.toggle('hidden', q && !item.dataset.name.toLowerCase().includes(q)));
      });

      // Copy
      gridEl.querySelectorAll('.media-copy-btn').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const name = btn.closest('.media-item').dataset.name;
        navigator.clipboard.writeText(`/images/${name}`).then(() => showStatus('saved', `Copied: /images/${name}`));
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
          item.remove(); this._imageCache = null;
          showStatus('saved', 'Deleted');
        } catch (e) { showStatus('error', e.message); }
      }));

      // Click to preview
      gridEl.querySelectorAll('.media-item').forEach(item => item.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        this._showLightbox(item.dataset.name, item.dataset.path);
      }));
    } catch (e) {
      document.getElementById('media-grid').innerHTML = `<div class="empty-state" style="color:var(--danger);">${esc(e.message)}</div>`;
    }
  }

  async _uploadMediaFiles(files, mediaFolder) {
    let uploaded = 0;
    showStatus('saving', `Uploading 0/${files.length}...`);
    for (const file of files) {
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
        await this.api.uploadImage(`${mediaFolder}/${file.name}`, b64, `Upload ${file.name}`);
        uploaded++;
        showStatus('saving', `Uploading ${uploaded}/${files.length}...`);
      } catch (e) { showStatus('error', `Failed: ${file.name}`); return; }
    }
    showStatus('saved', `Uploaded ${uploaded} image${uploaded !== 1 ? 's' : ''}`);
    this._imageCache = null;
    this.renderMedia();
  }

  _showLightbox(name, path) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox visible';
    const imgUrl = `/images/${name}`;
    overlay.innerHTML = `<div class="lightbox-content">
      <img src="${imgUrl}" alt="${esc(name)}" />
      <div class="lightbox-info">
        <strong>${esc(name)}</strong>
        <code>/images/${esc(name)}</code>
        <div class="lightbox-actions">
          <button class="btn btn-primary btn-sm lightbox-copy">Copy Path</button>
          <button class="btn btn-ghost btn-sm lightbox-close">Close</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
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

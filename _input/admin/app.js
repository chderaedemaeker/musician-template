/* ============================================================
   Musician-Template – CMS Admin (Simplified + Trilingual)
   ============================================================ */

// --------------- GitHub API Wrapper ---------------
class GitHubAPI {
  constructor(token, owner, repo, branch = 'main') {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.base = 'https://api.github.com';
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async _request(method, endpoint, body) {
    const url = `${this.base}${endpoint}`;
    const opts = { method, headers: this._headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getContents(path) {
    return this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
  }

  async getFile(path) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
    return {
      content: decodeBase64UTF8(data.content),
      sha: data.sha,
      path: data.path,
      size: data.size,
    };
  }

  async getFileInfo(path) {
    return this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
  }

  async createOrUpdateFile(path, content, message, sha) {
    const body = { message, content: encodeBase64UTF8(content), branch: this.branch };
    if (sha) body.sha = sha;
    return this._request('PUT', `/repos/${this.owner}/${this.repo}/contents/${path}`, body);
  }

  async deleteFile(path, sha, message) {
    return this._request('DELETE', `/repos/${this.owner}/${this.repo}/contents/${path}`, {
      message, sha, branch: this.branch,
    });
  }

  async uploadImage(path, base64content, message) {
    let sha;
    try {
      const existing = await this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
      sha = existing.sha;
    } catch (e) { /* new file */ }
    const body = { message, content: base64content, branch: this.branch };
    if (sha) body.sha = sha;
    return this._request('PUT', `/repos/${this.owner}/${this.repo}/contents/${path}`, body);
  }

  async verify() {
    return this._request('GET', `/repos/${this.owner}/${this.repo}`);
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
  if (_savingToast) { try { _savingToast.classList.add('toast-out'); setTimeout(() => _savingToast.remove(), 300); } catch(e) {} _savingToast = null; }
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
    this.loadCredentials();
    if (this.api) this.loadConfig().then(() => this.route());
    else this.route();
  }

  loadCredentials() {
    const token = localStorage.getItem('cms_token');
    const owner = localStorage.getItem('cms_owner');
    const repo = localStorage.getItem('cms_repo');
    const branch = localStorage.getItem('cms_branch') || 'main';
    if (token && owner && repo) this.api = new GitHubAPI(token, owner, repo, branch);
  }

  saveCredentials(token, owner, repo, branch) {
    localStorage.setItem('cms_token', token);
    localStorage.setItem('cms_owner', owner);
    localStorage.setItem('cms_repo', repo);
    localStorage.setItem('cms_branch', branch || 'main');
    this.api = new GitHubAPI(token, owner, repo, branch || 'main');
  }

  logout() {
    ['cms_token','cms_owner','cms_repo','cms_branch'].forEach(k => localStorage.removeItem(k));
    this.api = null; this.config = null; this.collections = [];
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
    if (hash === '#/design') return this.renderDesign();
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
    const owner = localStorage.getItem('cms_owner') || '';
    const repo = localStorage.getItem('cms_repo') || '';
    const branch = localStorage.getItem('cms_branch') || 'main';
    this.el.innerHTML = `
      <div class="login-wrapper">
        <div class="login-card">
          <h1>Content Manager</h1>
          <p class="subtitle">Sign in with your GitHub credentials.</p>
          <div class="form-group">
            <label class="form-label">Token</label>
            <input id="login-token" type="password" class="form-input" placeholder="ghp_..." />
          </div>
          <div class="form-group">
            <label class="form-label">Owner</label>
            <input id="login-owner" type="text" class="form-input" placeholder="username" value="${esc(owner)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Repository</label>
            <input id="login-repo" type="text" class="form-input" placeholder="my-site" value="${esc(repo)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Branch</label>
            <input id="login-branch" type="text" class="form-input" placeholder="main" value="${esc(branch)}" />
          </div>
          <button id="login-btn" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:.75rem;">Sign In</button>
          <p id="login-error" style="color:var(--danger);font-size:.8rem;margin-top:.75rem;display:none;"></p>
        </div>
      </div>`;
    document.getElementById('login-btn').addEventListener('click', () => this._handleLogin());
    this.el.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') this._handleLogin(); }));
  }

  async _handleLogin() {
    const token = document.getElementById('login-token').value.trim();
    const owner = document.getElementById('login-owner').value.trim();
    const repo = document.getElementById('login-repo').value.trim();
    const branch = document.getElementById('login-branch').value.trim() || 'main';
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    if (!token || !owner || !repo) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Verifying...'; errEl.style.display = 'none';
    try {
      this.saveCredentials(token, owner, repo, branch);
      await this.api.verify();
      await this.loadConfig();
      location.hash = '#/';
    } catch (e) {
      errEl.textContent = 'Failed: ' + e.message; errEl.style.display = 'block'; this.api = null;
    } finally { btn.disabled = false; btn.textContent = 'Sign In'; }
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
        <div class="card" id="design-card">
          <div class="card-label">Design</div>
          <div class="card-count">Colors, fonts & layout</div>
        </div>
      </div>`;
    this.el.querySelectorAll('.card[data-col]').forEach(card => card.addEventListener('click', () => { location.hash = `#/${card.dataset.col}`; }));
    document.getElementById('media-card').addEventListener('click', () => { location.hash = '#/media'; });
    document.getElementById('design-card').addEventListener('click', () => { location.hash = '#/design'; });
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
    const owner = localStorage.getItem('cms_owner') || '';
    const repo = localStorage.getItem('cms_repo') || '';
    const branch = localStorage.getItem('cms_branch') || 'main';
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Settings</span></nav>
      <div class="settings-section">
        <h3>Repository</h3>
        <div class="form-group"><label class="form-label">Owner</label><input id="set-owner" type="text" class="form-input" value="${esc(owner)}" /></div>
        <div class="form-group"><label class="form-label">Repository</label><input id="set-repo" type="text" class="form-input" value="${esc(repo)}" /></div>
        <div class="form-group"><label class="form-label">Branch</label><input id="set-branch" type="text" class="form-input" value="${esc(branch)}" /></div>
        <div class="form-group"><label class="form-label">New Token (leave blank to keep)</label><input id="set-token" type="password" class="form-input" placeholder="ghp_..." /></div>
        <button id="set-save" class="btn btn-primary">Save</button>
      </div>
      <div class="settings-section">
        <h3>Account</h3>
        <button id="set-logout" class="btn btn-danger">Logout</button>
      </div>`;
    this._bindTopbar();
    document.getElementById('set-save').addEventListener('click', () => {
      const token = document.getElementById('set-token').value.trim() || localStorage.getItem('cms_token');
      this.saveCredentials(token, document.getElementById('set-owner').value.trim(), document.getElementById('set-repo').value.trim(), document.getElementById('set-branch').value.trim() || 'main');
      this.config = null; this.collections = [];
      this.loadConfig().then(() => showStatus('saved', 'Settings saved'));
    });
    document.getElementById('set-logout').addEventListener('click', () => this.logout());
  }

  // ---- Collection List ----
  async renderCollection(name) {
    const col = this.collections.find(c => c.name === name);
    if (!col) { location.hash = '#/'; return; }
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
      <div id="editor-form"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
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
          ${value ? `<img class="image-preview" src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/_input${value.startsWith('/') ? value : '/images/' + value}" onerror="this.style.display='none'" />` : '<div class="image-placeholder">No image</div>'}
          <div class="image-controls">
            <input type="text" class="form-input" ${dataAttr} value="${escaped}" placeholder="/images/photo.jpg" />
            <div style="display:flex;gap:.25rem;margin-top:.25rem;">
              <button type="button" class="btn btn-ghost btn-sm image-browse-btn" data-field="${field.name}" data-locale="${locale}">Browse</button>
              <button type="button" class="btn btn-ghost btn-sm image-upload-btn" data-field="${field.name}" data-locale="${locale}">Upload</button>
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
    // Track changes
    formEl.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('input', () => this._markDirty()));

    // Image upload buttons
    formEl.querySelectorAll('.image-upload-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.addEventListener('change', () => this._handleImageUpload(input.files[0], btn.dataset.field, btn.dataset.locale, state));
        input.click();
      });
    });

    // Image browse buttons (open picker)
    formEl.querySelectorAll('.image-browse-btn').forEach(btn => {
      btn.addEventListener('click', () => this._showImagePicker(btn.dataset.field, btn.dataset.locale, state));
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
          <img src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${img.path}" alt="${esc(img.name)}" loading="lazy" />
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
          if (prev) { const img = document.createElement('img'); img.className = 'image-preview'; img.src = `https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${item.dataset.path}`; prev.replaceWith(img); }
        }
        overlay.remove();
        showStatus('saved', `Selected: ${item.dataset.name}`);
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
          <img src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${img.path}" alt="${esc(img.name)}" loading="lazy" />
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
    try {
      const mediaFolder = this.config.getMediaFolder();
      const contents = await this.api.getContents(mediaFolder);
      this._imageCache = contents.filter(f => f.type === 'file' && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { this._imageCache = []; }
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

  // ---- Design Settings ----
  async renderDesign() {
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><a href="#/">Dashboard</a><span class="sep">/</span><span>Design</span></nav>
      <div class="editor-header">
        <h2>Design Settings</h2>
        <div class="editor-actions">
          <button class="btn btn-ghost btn-sm" id="design-reset">Reset to defaults</button>
          <button class="btn btn-primary" id="design-save">Save & Publish</button>
        </div>
      </div>
      <div id="design-form"><div class="loading-state"><span class="spinner"></span> Loading theme...</div></div>`;
    this._bindTopbar();

    // Load current theme.css
    let currentVars = {};
    let themeSha = null;
    try {
      const file = await this.api.getFile('_input/css/theme.css');
      themeSha = file.sha;
      currentVars = this._parseThemeCss(file.content);
    } catch (e) { /* no theme.css yet */ }

    const sections = this._getDesignSections();
    const formEl = document.getElementById('design-form');

    let html = '<div class="design-sections">';
    for (const section of sections) {
      html += `<div class="design-section">
        <div class="design-section-header">${esc(section.label)}</div>
        <div class="design-section-grid">`;
      for (const opt of section.options) {
        const val = currentVars[opt.variable] || opt.default;
        html += this._renderDesignOption(opt, val);
      }
      html += '</div></div>';
    }
    html += '</div>';

    // Live preview
    html += `<div class="design-preview-section">
      <div class="design-section-header">Preview</div>
      <div id="design-preview" class="design-preview">
        <div class="dp-nav">Artist Name <span style="font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;opacity:.5;">· Concerts · Projects · About</span></div>
        <div class="dp-hero"><div class="dp-hero-title">Artist Name</div><div class="dp-hero-sub">MUSICIAN · PERFORMER</div></div>
        <div class="dp-section"><div class="dp-section-label">UPCOMING CONCERTS</div></div>
        <div class="dp-card"><div class="dp-card-date">15 MARCH 2026</div><div class="dp-card-title">Concert Title</div><div class="dp-card-place">Venue, City</div></div>
        <div class="dp-body"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p></div>
        <div class="dp-btn">View All</div>
      </div>
    </div>`;

    formEl.innerHTML = html;

    // Bind color pickers & inputs
    formEl.querySelectorAll('.design-opt-input').forEach(input => {
      input.addEventListener('input', () => this._updateDesignPreview(sections));
    });
    formEl.querySelectorAll('.design-opt-color').forEach(picker => {
      picker.addEventListener('input', (e) => {
        const textInput = picker.parentElement.querySelector('.design-opt-input');
        if (textInput) textInput.value = e.target.value;
        this._updateDesignPreview(sections);
      });
    });
    formEl.querySelectorAll('.design-opt-select').forEach(sel => {
      sel.addEventListener('change', () => this._updateDesignPreview(sections));
    });

    // Initial preview
    this._updateDesignPreview(sections);

    // Save
    document.getElementById('design-save').addEventListener('click', async () => {
      const css = this._collectDesignCss(sections);
      showStatus('saving', 'Saving theme...');
      try {
        const result = await this.api.createOrUpdateFile('_input/css/theme.css', css, 'Update design settings', themeSha || undefined);
        themeSha = result.content.sha;
        showStatus('saved', 'Design saved — site will rebuild');
      } catch (e) { showStatus('error', e.message); }
    });

    // Reset
    document.getElementById('design-reset').addEventListener('click', () => {
      for (const section of sections) {
        for (const opt of section.options) {
          const input = formEl.querySelector(`[data-var="${opt.variable}"]`);
          if (input) input.value = opt.default;
          const picker = formEl.querySelector(`[data-var-picker="${opt.variable}"]`);
          if (picker) picker.value = opt.default;
        }
      }
      this._updateDesignPreview(sections);
      showStatus('info', 'Reset to defaults — save to publish');
    });
  }

  _getDesignSections() {
    return [
      {
        label: 'Colors',
        options: [
          { variable: '--white', label: 'Background', type: 'color', default: '#fdfdfc' },
          { variable: '--off-white', label: 'Surface / Cards', type: 'color', default: '#f5f4f0' },
          { variable: '--warm-grey', label: 'Borders', type: 'color', default: '#e8e6e1' },
          { variable: '--mid-grey', label: 'Muted Text', type: 'color', default: '#b5b0a8' },
          { variable: '--dark-grey', label: 'Secondary Text', type: 'color', default: '#6b665e' },
          { variable: '--charcoal', label: 'Body Text', type: 'color', default: '#3a3732' },
          { variable: '--near-black', label: 'Headings / Primary', type: 'color', default: '#1a1917' },
          { variable: '--pure-black', label: 'Darkest', type: 'color', default: '#0d0d0c' },
        ]
      },
      {
        label: 'Typography — Fonts',
        options: [
          { variable: '--font-serif', label: 'Heading Font', type: 'font', default: "'EB Garamond', Georgia, serif",
            choices: [
              "'EB Garamond', Georgia, serif",
              "'Playfair Display', Georgia, serif",
              "'Cormorant Garamond', Garamond, serif",
              "'Libre Baskerville', Baskerville, serif",
              "'Lora', Georgia, serif",
              "'DM Serif Display', Georgia, serif",
              "'Merriweather', Georgia, serif",
              "Georgia, 'Times New Roman', serif",
            ]
          },
          { variable: '--font-sans', label: 'UI / Label Font', type: 'font', default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            choices: [
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              "'Inter', sans-serif",
              "'DM Sans', sans-serif",
              "'Work Sans', sans-serif",
              "'Outfit', sans-serif",
              "'Plus Jakarta Sans', sans-serif",
              "'Manrope', sans-serif",
            ]
          },
        ]
      },
      {
        label: 'Typography — Sizes',
        options: [
          { variable: '--font-size-base', label: 'Base Font Size', type: 'size', default: '17px', choices: ['14px','15px','16px','17px','18px','19px','20px'] },
          { variable: '--hero-size', label: 'Hero Title', type: 'size', default: '5.5rem', choices: ['3rem','3.5rem','4rem','4.5rem','5rem','5.5rem','6rem','7rem','8rem'] },
          { variable: '--h1-size', label: 'Page Titles (H1)', type: 'size', default: '3.5rem', choices: ['2rem','2.5rem','3rem','3.5rem','4rem','4.5rem','5rem'] },
          { variable: '--h2-size', label: 'Section Titles (H2)', type: 'size', default: '2.2rem', choices: ['1.2rem','1.5rem','1.8rem','2rem','2.2rem','2.5rem','3rem'] },
          { variable: '--h3-size', label: 'Card Titles (H3)', type: 'size', default: '1.8rem', choices: ['1rem','1.2rem','1.4rem','1.6rem','1.8rem','2rem','2.2rem'] },
          { variable: '--body-size', label: 'Body Text', type: 'size', default: '1.05rem', choices: ['0.85rem','0.9rem','0.95rem','1rem','1.05rem','1.1rem','1.15rem','1.2rem'] },
          { variable: '--label-size', label: 'Labels / Small Text', type: 'size', default: '0.7rem', choices: ['0.55rem','0.6rem','0.65rem','0.7rem','0.75rem','0.8rem','0.85rem'] },
        ]
      },
      {
        label: 'Typography — Style',
        options: [
          { variable: '--heading-weight', label: 'Heading Weight', type: 'select', default: '400', choices: ['300','400','500','600','700'] },
          { variable: '--body-line-height', label: 'Body Line Height', type: 'select', default: '1.65', choices: ['1.4','1.5','1.55','1.6','1.65','1.7','1.75','1.8','1.9'] },
          { variable: '--letter-spacing-labels', label: 'Label Letter Spacing', type: 'size', default: '0.12em', choices: ['0.05em','0.08em','0.1em','0.12em','0.15em','0.2em','0.25em'] },
          { variable: '--heading-letter-spacing', label: 'Heading Letter Spacing', type: 'size', default: '-0.02em', choices: ['-0.05em','-0.04em','-0.03em','-0.02em','-0.01em','0em','0.01em','0.02em'] },
        ]
      },
      {
        label: 'Layout',
        options: [
          { variable: '--max-width', label: 'Max Page Width', type: 'size', default: '1400px', choices: ['960px','1100px','1200px','1400px','1600px','1800px'] },
          { variable: '--max-width-narrow', label: 'Content Width (articles)', type: 'size', default: '820px', choices: ['640px','720px','780px','820px','900px','960px'] },
          { variable: '--max-width-text', label: 'Text Width (body text)', type: 'size', default: '640px', choices: ['520px','560px','600px','640px','700px','760px'] },
        ]
      },
      {
        label: 'Spacing',
        options: [
          { variable: '--space-xs', label: 'Extra Small', type: 'size', default: '0.5rem', choices: ['0.25rem','0.5rem','0.75rem','1rem'] },
          { variable: '--space-sm', label: 'Small', type: 'size', default: '1rem', choices: ['0.5rem','0.75rem','1rem','1.25rem','1.5rem'] },
          { variable: '--space-md', label: 'Medium', type: 'size', default: '2rem', choices: ['1rem','1.5rem','2rem','2.5rem','3rem'] },
          { variable: '--space-lg', label: 'Large', type: 'size', default: '4rem', choices: ['2rem','3rem','4rem','5rem','6rem'] },
          { variable: '--space-xl', label: 'Extra Large', type: 'size', default: '6rem', choices: ['3rem','4rem','5rem','6rem','8rem','10rem'] },
          { variable: '--space-2xl', label: 'Hero Padding', type: 'size', default: '10rem', choices: ['4rem','6rem','8rem','10rem','12rem','14rem'] },
        ]
      },
      {
        label: 'Cards & Images',
        options: [
          { variable: '--card-ratio', label: 'Image Card Ratio', type: 'select', default: '4 / 5', choices: ['1 / 1','4 / 5','3 / 4','2 / 3','16 / 10','16 / 9'] },
          { variable: '--card-grid-min', label: 'Card Minimum Width', type: 'size', default: '360px', choices: ['240px','280px','320px','360px','400px','480px'] },
          { variable: '--card-gap', label: 'Card Gap', type: 'size', default: '2px', choices: ['0px','1px','2px','4px','8px','12px','16px','24px'] },
          { variable: '--card-filter', label: 'Image Filter', type: 'select', default: 'grayscale(30%)', choices: ['none','grayscale(10%)','grayscale(20%)','grayscale(30%)','grayscale(50%)','grayscale(100%)','sepia(20%)','sepia(40%)','brightness(0.9)','contrast(1.1)'] },
          { variable: '--card-hover-filter', label: 'Image Hover Filter', type: 'select', default: 'grayscale(0%)', choices: ['none','grayscale(0%)','grayscale(10%)','sepia(0%)','brightness(1)','contrast(1)'] },
          { variable: '--card-hover-scale', label: 'Image Hover Zoom', type: 'select', default: '1.05', choices: ['1','1.02','1.03','1.05','1.08','1.1'] },
        ]
      },
      {
        label: 'Navigation',
        options: [
          { variable: '--nav-height', label: 'Navbar Height', type: 'size', default: '72px', choices: ['56px','64px','72px','80px','88px'] },
          { variable: '--nav-bg', label: 'Navbar Background', type: 'color', default: '#fdfdfc' },
          { variable: '--nav-border', label: 'Navbar Border', type: 'color', default: '#e8e6e1' },
        ]
      },
      {
        label: 'Buttons',
        options: [
          { variable: '--btn-padding-v', label: 'Button Padding (vertical)', type: 'size', default: '12px', choices: ['8px','10px','12px','14px','16px'] },
          { variable: '--btn-padding-h', label: 'Button Padding (horizontal)', type: 'size', default: '32px', choices: ['16px','20px','24px','28px','32px','40px'] },
          { variable: '--btn-font-size', label: 'Button Font Size', type: 'size', default: '0.65rem', choices: ['0.55rem','0.6rem','0.65rem','0.7rem','0.75rem','0.8rem'] },
          { variable: '--btn-letter-spacing', label: 'Button Letter Spacing', type: 'size', default: '0.15em', choices: ['0.05em','0.08em','0.1em','0.12em','0.15em','0.2em'] },
          { variable: '--btn-border-width', label: 'Button Border Width', type: 'size', default: '1px', choices: ['0px','1px','2px'] },
        ]
      },
      {
        label: 'Effects',
        options: [
          { variable: '--transition', label: 'Transition Speed', type: 'select', default: '0.3s cubic-bezier(0.25, 0.1, 0.25, 1)', choices: ['0.15s ease','0.2s ease','0.3s cubic-bezier(0.25, 0.1, 0.25, 1)','0.4s ease','0.5s ease','none'] },
          { variable: '--overlay-gradient', label: 'Image Card Overlay', type: 'select', default: 'rgba(13, 13, 12, 0.75)', choices: ['rgba(13,13,12,0.75)','rgba(13,13,12,0.6)','rgba(13,13,12,0.5)','rgba(13,13,12,0.85)','rgba(0,0,0,0.5)','rgba(0,0,0,0.7)'] },
        ]
      },
    ];
  }

  _renderDesignOption(opt, value) {
    const id = opt.variable.replace(/[^a-z0-9]/g, '');
    if (opt.type === 'color') {
      return `<div class="design-opt">
        <label class="design-opt-label">${esc(opt.label)}</label>
        <div class="design-opt-row">
          <input type="color" class="design-opt-color" data-var-picker="${opt.variable}" value="${esc(value)}" />
          <input type="text" class="design-opt-input" data-var="${opt.variable}" value="${esc(value)}" />
        </div>
      </div>`;
    }
    if (opt.type === 'font' || opt.type === 'select') {
      const choices = opt.choices || [];
      return `<div class="design-opt">
        <label class="design-opt-label">${esc(opt.label)}</label>
        <select class="design-opt-select design-opt-input" data-var="${opt.variable}">
          ${choices.map(c => `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(opt.type === 'font' ? c.split("'")[1] || c.split(',')[0].trim() : c)}</option>`).join('')}
        </select>
      </div>`;
    }
    if (opt.type === 'size') {
      const choices = opt.choices || [];
      return `<div class="design-opt">
        <label class="design-opt-label">${esc(opt.label)}</label>
        <select class="design-opt-select design-opt-input" data-var="${opt.variable}">
          ${choices.map(c => `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>`;
    }
    return '';
  }

  _parseThemeCss(css) {
    const vars = {};
    const regex = /--([\w-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = regex.exec(css)) !== null) {
      vars['--' + m[1]] = m[2].trim();
    }
    return vars;
  }

  _collectDesignCss(sections) {
    let css = '/* Theme overrides — managed by CMS Design Settings */\n';

    // Collect Google Fonts imports
    const fontVar = document.querySelector('[data-var="--font-serif"]');
    const fontSansVar = document.querySelector('[data-var="--font-sans"]');
    const googleFonts = new Set();
    if (fontVar) {
      const match = fontVar.value.match(/'([^']+)'/);
      if (match && match[1] !== 'Georgia' && match[1] !== 'Times New Roman' && match[1] !== 'Segoe UI') {
        googleFonts.add(match[1].replace(/ /g, '+'));
      }
    }
    if (fontSansVar) {
      const match = fontSansVar.value.match(/'([^']+)'/);
      if (match && match[1] !== 'Segoe UI') {
        googleFonts.add(match[1].replace(/ /g, '+'));
      }
    }
    for (const font of googleFonts) {
      css += `@import url('https://fonts.googleapis.com/css2?family=${font}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap');\n`;
    }

    css += '\n:root {\n';
    let hasVars = false;
    for (const section of sections) {
      for (const opt of section.options) {
        const input = document.querySelector(`[data-var="${opt.variable}"]`);
        if (input) {
          const val = input.value;
          if (val !== opt.default) {
            css += `  ${opt.variable}: ${val};\n`;
            hasVars = true;
          }
        }
      }
    }
    if (!hasVars) css += '  /* Using defaults */\n';
    css += '}\n';

    // Add mapped CSS overrides for variables that don't directly map to existing CSS vars
    const mappedCss = this._collectMappedCss(sections);
    if (mappedCss) css += '\n' + mappedCss;

    return css;
  }

  _collectMappedCss(sections) {
    let css = '';
    const getVal = (varName) => {
      const el = document.querySelector(`[data-var="${varName}"]`);
      return el ? el.value : null;
    };

    const fontSize = getVal('--font-size-base');
    if (fontSize && fontSize !== '17px') css += `html { font-size: ${fontSize}; }\n`;

    const heroSize = getVal('--hero-size');
    if (heroSize && heroSize !== '5.5rem') css += `.hero h1 { font-size: ${heroSize}; }\n`;

    const h1Size = getVal('--h1-size');
    if (h1Size && h1Size !== '3.5rem') css += `.concert-detail h1, .detail-page h1, .about-page h1, .contact-page h1 { font-size: ${h1Size}; }\n`;

    const h2Size = getVal('--h2-size');
    if (h2Size && h2Size !== '2.2rem') css += `.divider-block h2, .feature-block h2 { font-size: ${h2Size}; }\n`;

    const h3Size = getVal('--h3-size');
    if (h3Size && h3Size !== '1.8rem') css += `.image-card-overlay h3 { font-size: ${h3Size}; }\n.concert-card h3 { font-size: ${h3Size}; }\n`;

    const bodySize = getVal('--body-size');
    if (bodySize && bodySize !== '1.05rem') css += `.detail-page .content p, .about-page .content p { font-size: ${bodySize}; }\n`;

    const labelSize = getVal('--label-size');
    if (labelSize && labelSize !== '0.7rem') css += `.section-title, .nav-links a { font-size: ${labelSize}; }\n`;

    const headingWeight = getVal('--heading-weight');
    if (headingWeight && headingWeight !== '400') css += `h1, h2, h3, h4, h5, h6 { font-weight: ${headingWeight}; }\n`;

    const bodyLH = getVal('--body-line-height');
    if (bodyLH && bodyLH !== '1.65') css += `body { line-height: ${bodyLH}; }\n`;

    const letterLabels = getVal('--letter-spacing-labels');
    if (letterLabels && letterLabels !== '0.12em') css += `.section-title, .nav-links a, .btn { letter-spacing: ${letterLabels}; }\n`;

    const letterHeadings = getVal('--heading-letter-spacing');
    if (letterHeadings && letterHeadings !== '-0.02em') css += `h1, h2, h3 { letter-spacing: ${letterHeadings}; }\n`;

    const cardRatio = getVal('--card-ratio');
    if (cardRatio && cardRatio !== '4 / 5') css += `.image-card { aspect-ratio: ${cardRatio}; }\n`;

    const cardMin = getVal('--card-grid-min');
    if (cardMin && cardMin !== '360px') css += `.card-grid { grid-template-columns: repeat(auto-fill, minmax(${cardMin}, 1fr)); }\n`;

    const cardGap = getVal('--card-gap');
    if (cardGap && cardGap !== '2px') css += `.card-grid { gap: ${cardGap}; }\n`;

    const cardFilter = getVal('--card-filter');
    if (cardFilter && cardFilter !== 'grayscale(30%)') css += `.image-card-bg { filter: ${cardFilter}; }\n`;

    const cardHoverFilter = getVal('--card-hover-filter');
    if (cardHoverFilter && cardHoverFilter !== 'grayscale(0%)') css += `.image-card:hover .image-card-bg { filter: ${cardHoverFilter}; }\n`;

    const cardHoverScale = getVal('--card-hover-scale');
    if (cardHoverScale && cardHoverScale !== '1.05') css += `.image-card:hover .image-card-bg { transform: scale(${cardHoverScale}); }\n`;

    const navHeight = getVal('--nav-height');
    if (navHeight && navHeight !== '72px') css += `.nav-inner { height: ${navHeight}; }\n.mobile-nav { top: ${navHeight}; }\n`;

    const navBg = getVal('--nav-bg');
    if (navBg && navBg !== '#fdfdfc') css += `.nav { background-color: ${navBg}; }\n`;

    const navBorder = getVal('--nav-border');
    if (navBorder && navBorder !== '#e8e6e1') css += `.nav { border-bottom-color: ${navBorder}; }\n`;

    const btnPV = getVal('--btn-padding-v');
    const btnPH = getVal('--btn-padding-h');
    if ((btnPV && btnPV !== '12px') || (btnPH && btnPH !== '32px')) css += `.btn { padding: ${btnPV || '12px'} ${btnPH || '32px'}; }\n`;

    const btnFS = getVal('--btn-font-size');
    if (btnFS && btnFS !== '0.65rem') css += `.btn { font-size: ${btnFS}; }\n`;

    const btnLS = getVal('--btn-letter-spacing');
    if (btnLS && btnLS !== '0.15em') css += `.btn { letter-spacing: ${btnLS}; }\n`;

    const btnBW = getVal('--btn-border-width');
    if (btnBW && btnBW !== '1px') css += `.btn { border-width: ${btnBW}; }\n`;

    const overlay = getVal('--overlay-gradient');
    if (overlay && overlay !== 'rgba(13, 13, 12, 0.75)') css += `.image-card-overlay { background: linear-gradient(to top, ${overlay} 0%, transparent 100%); }\n`;

    return css;
  }

  _updateDesignPreview(sections) {
    const preview = document.getElementById('design-preview');
    if (!preview) return;

    const getVal = (varName) => {
      const el = document.querySelector(`[data-var="${varName}"]`);
      return el ? el.value : null;
    };

    const bg = getVal('--white') || '#fdfdfc';
    const offWhite = getVal('--off-white') || '#f5f4f0';
    const warmGrey = getVal('--warm-grey') || '#e8e6e1';
    const midGrey = getVal('--mid-grey') || '#b5b0a8';
    const darkGrey = getVal('--dark-grey') || '#6b665e';
    const charcoal = getVal('--charcoal') || '#3a3732';
    const nearBlack = getVal('--near-black') || '#1a1917';
    const fontSerif = getVal('--font-serif') || "'EB Garamond', Georgia, serif";
    const heroSize = getVal('--hero-size') || '5.5rem';
    const headingWeight = getVal('--heading-weight') || '400';
    const labelSize = getVal('--label-size') || '0.7rem';
    const bodySize = getVal('--body-size') || '1.05rem';

    // Load font if needed
    const fontMatch = fontSerif.match(/'([^']+)'/);
    if (fontMatch) {
      const fontName = fontMatch[1].replace(/ /g, '+');
      if (!document.querySelector(`link[href*="${fontName}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontName}:wght@400;500;600;700&display=swap`;
        document.head.appendChild(link);
      }
    }

    preview.style.background = bg;
    preview.style.color = nearBlack;
    preview.style.fontFamily = fontSerif;

    const nav = preview.querySelector('.dp-nav');
    if (nav) { nav.style.borderBottomColor = warmGrey; nav.style.color = nearBlack; nav.style.fontFamily = fontSerif; }

    const heroTitle = preview.querySelector('.dp-hero-title');
    if (heroTitle) { heroTitle.style.fontFamily = fontSerif; heroTitle.style.fontWeight = headingWeight; heroTitle.style.color = nearBlack; heroTitle.style.fontSize = `calc(${heroSize} * 0.4)`; }

    const heroSub = preview.querySelector('.dp-hero-sub');
    if (heroSub) { heroSub.style.color = midGrey; heroSub.style.fontSize = labelSize; }

    const sectionLabel = preview.querySelector('.dp-section-label');
    if (sectionLabel) { sectionLabel.style.color = darkGrey; sectionLabel.style.borderBottomColor = warmGrey; sectionLabel.style.fontSize = labelSize; }

    const card = preview.querySelector('.dp-card');
    if (card) { card.style.background = offWhite; }
    const cardDate = preview.querySelector('.dp-card-date');
    if (cardDate) { cardDate.style.color = darkGrey; cardDate.style.fontSize = labelSize; }
    const cardTitle = preview.querySelector('.dp-card-title');
    if (cardTitle) { cardTitle.style.fontFamily = fontSerif; cardTitle.style.fontWeight = headingWeight; cardTitle.style.color = nearBlack; }
    const cardPlace = preview.querySelector('.dp-card-place');
    if (cardPlace) { cardPlace.style.color = darkGrey; }

    const body = preview.querySelector('.dp-body p');
    if (body) { body.style.color = charcoal; body.style.fontSize = bodySize; body.style.fontFamily = fontSerif; }

    const btn = preview.querySelector('.dp-btn');
    if (btn) { btn.style.borderColor = nearBlack; btn.style.color = nearBlack; }
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
      const contents = await this.api.getContents(mediaFolder);
      const images = contents.filter(f => f.type === 'file' && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      this._imageCache = images;

      const gridEl = document.getElementById('media-grid');
      document.getElementById('media-info').textContent = `${images.length} images`;

      if (!images.length) { gridEl.innerHTML = '<div class="empty-state">No images yet.</div>'; return; }

      gridEl.innerHTML = images.map(img => `<div class="media-item" data-name="${esc(img.name)}" data-sha="${img.sha}" data-path="${esc(img.path)}">
        <div class="media-thumb"><img src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${img.path}" alt="${esc(img.name)}" loading="lazy" /></div>
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
    const imgUrl = `https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${path}`;
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

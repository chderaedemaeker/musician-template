/* ============================================================
   Musician-Template – Lightweight CMS Admin
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

  /** List files in a directory */
  async getContents(path) {
    return this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
  }

  /** Get a single file (decoded) */
  async getFile(path) {
    const data = await this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
    return {
      content: decodeBase64UTF8(data.content),
      sha: data.sha,
      path: data.path,
    };
  }

  /** Create or update a file */
  async createOrUpdateFile(path, content, message, sha) {
    const body = {
      message,
      content: encodeBase64UTF8(content),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    return this._request('PUT', `/repos/${this.owner}/${this.repo}/contents/${path}`, body);
  }

  /** Delete a file */
  async deleteFile(path, sha, message) {
    return this._request('DELETE', `/repos/${this.owner}/${this.repo}/contents/${path}`, {
      message,
      sha,
      branch: this.branch,
    });
  }

  /** Upload an image (base64 encoded content without the data-uri prefix) */
  async uploadImage(path, base64content, message) {
    // Check if file exists to get sha
    let sha;
    try {
      const existing = await this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
      sha = existing.sha;
    } catch (e) { /* new file */ }
    const body = { message, content: base64content, branch: this.branch };
    if (sha) body.sha = sha;
    return this._request('PUT', `/repos/${this.owner}/${this.repo}/contents/${path}`, body);
  }

  /** Verify token works */
  async verify() {
    return this._request('GET', `/repos/${this.owner}/${this.repo}`);
  }
}

// --------------- Base64 helpers (UTF-8 safe) ---------------
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

  getMediaFolder() {
    return this.config.media_folder || '_input/images';
  }

  getLocales() {
    return this.config.i18n?.locales || ['en'];
  }

  getCollections() {
    return (this.config.collections || []).map(c => ({
      label: c.label,
      name: c.name,
      folder: c.folder,
      slug: c.slug || '{{slug}}',
      create: c.create !== false,
      i18n: c.i18n || false,
      i18nStructure: (typeof c.i18n === 'object' && c.i18n.structure) || (c.i18n === true ? 'multiple_folders' : null),
      fields: (c.fields || []).map(f => ({
        label: f.label,
        name: f.name,
        widget: f.widget || 'string',
        required: f.required !== false,
        i18n: f.i18n || false,
        default: f.default ?? '',
        format: f.format || '',
      })),
      summary: c.summary || '{{title}}',
      sort: c.sort || '',
    }));
  }
}

// --------------- Markdown Frontmatter Parser ---------------
const FrontMatter = {
  parse(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { data: {}, body: text };
    const data = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
    return { data, body: match[2] };
  },

  serialize(data, body) {
    let out = '---\n';
    for (const [k, v] of Object.entries(data)) {
      const val = v == null ? '' : String(v);
      // Quote values that contain colons, special chars, or are empty
      if (val === '' || val.includes(':') || val.includes('#') || val.includes('{') || val.includes('}') || val.includes('[') || val.includes(']')) {
        out += `${k}: "${val.replace(/"/g, '\\"')}"\n`;
      } else {
        out += `${k}: ${val}\n`;
      }
    }
    out += '---\n';
    if (body) out += body;
    return out;
  }
};

// --------------- Slugify ---------------
function slugify(text) {
  return text.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 60);
}

function generateFilename(title) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}-${slugify(title)}.md`;
}

// --------------- Status bar ---------------
let statusTimer;
function showStatus(type, msg) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar ${type} visible`;
  clearTimeout(statusTimer);
  if (type !== 'saving') {
    statusTimer = setTimeout(() => bar.classList.remove('visible'), 3000);
  }
}

// --------------- Modal helper ---------------
function showModal(title, message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('h3').textContent = title;
    overlay.querySelector('p').textContent = message;
    overlay.classList.add('visible');
    const btnOk = overlay.querySelector('.modal-ok');
    const btnCancel = overlay.querySelector('.modal-cancel');
    function cleanup(val) {
      overlay.classList.remove('visible');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

// --------------- Escape HTML ---------------
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// --------------- App ---------------
class App {
  constructor() {
    this.api = null;
    this.config = null;
    this.collections = [];
    this.el = document.getElementById('app');
  }

  init() {
    window.addEventListener('hashchange', () => this.route());
    this.loadCredentials();
    if (this.api) {
      this.loadConfig().then(() => this.route());
    } else {
      this.route();
    }
  }

  loadCredentials() {
    const token = localStorage.getItem('cms_token');
    const owner = localStorage.getItem('cms_owner');
    const repo = localStorage.getItem('cms_repo');
    const branch = localStorage.getItem('cms_branch') || 'main';
    if (token && owner && repo) {
      this.api = new GitHubAPI(token, owner, repo, branch);
    }
  }

  saveCredentials(token, owner, repo, branch) {
    localStorage.setItem('cms_token', token);
    localStorage.setItem('cms_owner', owner);
    localStorage.setItem('cms_repo', repo);
    localStorage.setItem('cms_branch', branch || 'main');
    this.api = new GitHubAPI(token, owner, repo, branch || 'main');
  }

  logout() {
    localStorage.removeItem('cms_token');
    localStorage.removeItem('cms_owner');
    localStorage.removeItem('cms_repo');
    localStorage.removeItem('cms_branch');
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
      showStatus('error', 'Failed to load config.yml from repo');
    }
  }

  // ---- Router ----
  route() {
    const hash = location.hash || '#/';
    if (!this.api && !hash.startsWith('#/login')) {
      location.hash = '#/login';
      return;
    }
    if (hash === '#/login') return this.renderLogin();
    if (hash === '#/settings') return this.renderSettings();
    if (hash === '#/' || hash === '#') return this.renderDashboard();
    if (hash === '#/media') return this.renderMedia();

    // #/concerts, #/projects, etc.
    const collectionMatch = hash.match(/^#\/([a-z]+)$/);
    if (collectionMatch) return this.renderCollection(collectionMatch[1]);

    // #/concerts/new
    const newMatch = hash.match(/^#\/([a-z]+)\/new$/);
    if (newMatch) return this.renderEditor(newMatch[1], null);

    // #/concerts/edit/filename.md
    const editMatch = hash.match(/^#\/([a-z]+)\/edit\/(.+)$/);
    if (editMatch) return this.renderEditor(editMatch[1], decodeURIComponent(editMatch[2]));

    this.renderDashboard();
  }

  // ---- Render: Login ----
  renderLogin() {
    const owner = localStorage.getItem('cms_owner') || '';
    const repo = localStorage.getItem('cms_repo') || '';
    const branch = localStorage.getItem('cms_branch') || 'main';
    this.el.innerHTML = `
      <div class="login-wrapper">
        <div class="login-card">
          <h1>Content Manager</h1>
          <p class="subtitle">Sign in with your GitHub credentials to manage your site content.</p>
          <div class="form-group">
            <label class="form-label">GitHub Personal Access Token</label>
            <input id="login-token" type="password" class="form-input" placeholder="ghp_..." />
          </div>
          <div class="form-group">
            <label class="form-label">Repository Owner</label>
            <input id="login-owner" type="text" class="form-input" placeholder="username" value="${esc(owner)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Repository Name</label>
            <input id="login-repo" type="text" class="form-input" placeholder="musician-template" value="${esc(repo)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Branch</label>
            <input id="login-branch" type="text" class="form-input" placeholder="main" value="${esc(branch)}" />
          </div>
          <button id="login-btn" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:.5rem;">Sign In</button>
          <p id="login-error" style="color:var(--c-danger);font-size:.85rem;margin-top:.75rem;display:none;"></p>
        </div>
      </div>`;
    document.getElementById('login-btn').addEventListener('click', () => this._handleLogin());
    // Enter key support
    this.el.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') this._handleLogin(); });
    });
  }

  async _handleLogin() {
    const token = document.getElementById('login-token').value.trim();
    const owner = document.getElementById('login-owner').value.trim();
    const repo = document.getElementById('login-repo').value.trim();
    const branch = document.getElementById('login-branch').value.trim() || 'main';
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!token || !owner || !repo) {
      errEl.textContent = 'All fields are required.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying...';
    errEl.style.display = 'none';

    try {
      this.saveCredentials(token, owner, repo, branch);
      await this.api.verify();
      await this.loadConfig();
      location.hash = '#/';
    } catch (e) {
      errEl.textContent = 'Authentication failed: ' + e.message;
      errEl.style.display = 'block';
      this.api = null;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  // ---- Render: Dashboard ----
  renderDashboard() {
    if (!this.collections.length) {
      this.el.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading configuration...</div>';
      this.loadConfig().then(() => {
        if (this.collections.length) this.renderDashboard();
        else {
          this.el.innerHTML = '<div class="empty-state">Could not load collections. Check settings.</div>';
        }
      });
      return;
    }

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><span>Dashboard</span></nav>
      <h2 style="margin-bottom:1rem;">Collections</h2>
      <div class="dashboard-grid">
        ${this.collections.map(c => `
          <div class="card" data-col="${c.name}">
            <div class="card-label">${esc(c.label)}</div>
            <div class="card-count">${c.i18n ? 'i18n (en, nl, fr)' : 'Single language'}</div>
          </div>
        `).join('')}
        <div class="card" id="media-card">
          <div class="card-label">Media</div>
          <div class="card-count">Images &amp; files</div>
        </div>
      </div>`;
    this.el.querySelectorAll('.card[data-col]').forEach(card => {
      card.addEventListener('click', () => { location.hash = `#/${card.dataset.col}`; });
    });
    document.getElementById('media-card').addEventListener('click', () => { location.hash = '#/media'; });
    this._bindTopbar();
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

  // ---- Render: Settings ----
  renderSettings() {
    const owner = localStorage.getItem('cms_owner') || '';
    const repo = localStorage.getItem('cms_repo') || '';
    const branch = localStorage.getItem('cms_branch') || 'main';
    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb">
        <a href="#/">Dashboard</a><span class="sep">/</span><span>Settings</span>
      </nav>
      <div class="settings-section">
        <h3>Repository Configuration</h3>
        <div class="form-group">
          <label class="form-label">Owner</label>
          <input id="set-owner" type="text" class="form-input" value="${esc(owner)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Repository</label>
          <input id="set-repo" type="text" class="form-input" value="${esc(repo)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Branch</label>
          <input id="set-branch" type="text" class="form-input" value="${esc(branch)}" />
        </div>
        <div class="form-group">
          <label class="form-label">New Token (leave blank to keep current)</label>
          <input id="set-token" type="password" class="form-input" placeholder="ghp_..." />
        </div>
        <button id="set-save" class="btn btn-primary">Save Settings</button>
      </div>
      <div class="settings-section">
        <h3>Danger Zone</h3>
        <button id="set-logout" class="btn btn-danger">Logout &amp; Clear Credentials</button>
      </div>`;
    this._bindTopbar();
    document.getElementById('set-save').addEventListener('click', () => {
      const token = document.getElementById('set-token').value.trim() || localStorage.getItem('cms_token');
      const owner = document.getElementById('set-owner').value.trim();
      const repo = document.getElementById('set-repo').value.trim();
      const branch = document.getElementById('set-branch').value.trim() || 'main';
      this.saveCredentials(token, owner, repo, branch);
      this.config = null;
      this.collections = [];
      this.loadConfig().then(() => {
        showStatus('saved', 'Settings saved');
      });
    });
    document.getElementById('set-logout').addEventListener('click', () => this.logout());
  }

  // ---- Render: Collection List ----
  async renderCollection(name) {
    const col = this.collections.find(c => c.name === name);
    if (!col) { location.hash = '#/'; return; }

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb">
        <a href="#/">Dashboard</a><span class="sep">/</span><span>${esc(col.label)}</span>
      </nav>
      <div class="list-header">
        <h2>${esc(col.label)}</h2>
        ${col.create ? `<button class="btn btn-primary btn-sm" id="new-entry-btn">+ New</button>` : ''}
      </div>
      <div id="entry-list" class="entry-list"><div class="loading-state"><span class="spinner"></span> Loading entries...</div></div>`;
    this._bindTopbar();

    const newBtn = document.getElementById('new-entry-btn');
    if (newBtn) newBtn.addEventListener('click', () => { location.hash = `#/${name}/new`; });

    try {
      let files = [];
      if (col.i18n || col.i18nStructure) {
        // i18n: entries are in locale subfolders. List from 'en' subfolder as canonical.
        const contents = await this.api.getContents(col.folder + '/en');
        files = contents.filter(f => f.name.endsWith('.md'));
      } else {
        const contents = await this.api.getContents(col.folder);
        files = contents.filter(f => f.name.endsWith('.md'));
      }

      // Sort by filename descending (filenames start with date)
      files.sort((a, b) => b.name.localeCompare(a.name));

      const listEl = document.getElementById('entry-list');
      if (!files.length) {
        listEl.innerHTML = '<div class="empty-state">No entries yet. Create one!</div>';
        return;
      }

      // Fetch file contents for display info
      const entries = await Promise.all(files.map(async f => {
        try {
          const fileData = await this.api.getFile(f.path);
          const parsed = FrontMatter.parse(fileData.content);
          return { name: f.name, data: parsed.data, path: f.path };
        } catch {
          return { name: f.name, data: { title: f.name }, path: f.path };
        }
      }));

      listEl.innerHTML = entries.map(e => {
        const title = e.data.title || e.name;
        const date = e.data.date || '';
        const place = e.data.place || '';
        let meta = date ? date.replace('T', ' ').substring(0, 16) : '';
        if (place) meta += (meta ? ' — ' : '') + place;
        return `<div class="entry-row" data-file="${esc(e.name)}">
          <div>
            <div class="entry-title">${esc(title)}</div>
            ${meta ? `<div class="entry-meta">${esc(meta)}</div>` : ''}
          </div>
          <div class="entry-meta">${esc(e.name)}</div>
        </div>`;
      }).join('');

      listEl.querySelectorAll('.entry-row').forEach(row => {
        row.addEventListener('click', () => {
          location.hash = `#/${name}/edit/${encodeURIComponent(row.dataset.file)}`;
        });
      });
    } catch (e) {
      document.getElementById('entry-list').innerHTML = `<div class="empty-state" style="color:var(--c-danger);">Error: ${esc(e.message)}</div>`;
    }
  }

  // ---- Render: Editor ----
  async renderEditor(colName, filename) {
    const col = this.collections.find(c => c.name === colName);
    if (!col) { location.hash = '#/'; return; }

    const isNew = !filename;
    const isI18n = !!(col.i18n || col.i18nStructure);
    const locales = isI18n ? this.config.getLocales() : ['en'];
    const activeLocale = locales[0]; // start with 'en'

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb">
        <a href="#/">Dashboard</a><span class="sep">/</span>
        <a href="#/${colName}">${esc(col.label)}</a><span class="sep">/</span>
        <span>${isNew ? 'New' : esc(filename)}</span>
      </nav>
      <div class="editor-header">
        <h2>${isNew ? `New ${esc(col.label.replace(/s$/, ''))}` : 'Edit Entry'}</h2>
        <div class="editor-actions">
          <button class="btn btn-primary" id="save-btn">Save</button>
          ${!isNew ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
        </div>
      </div>
      ${isI18n ? `<div class="i18n-tabs" id="i18n-tabs">
        ${locales.map(l => `<button class="i18n-tab ${l === activeLocale ? 'active' : ''}" data-locale="${l}">${l.toUpperCase()}</button>`).join('')}
      </div>` : ''}
      <div id="editor-form"><div class="loading-state"><span class="spinner"></span> Loading...</div></div>`;
    this._bindTopbar();

    // State: per-locale data
    const state = {
      locales,
      data: {},      // locale -> { frontmatter fields }
      body: {},      // locale -> body text
      sha: {},       // locale -> sha (for existing files)
      filePath: {},  // locale -> full path
      activeLocale: activeLocale,
      filename,
      isNew,
      col,
    };

    // Initialize empty state for each locale
    for (const loc of locales) {
      state.data[loc] = {};
      state.body[loc] = '';
      state.sha[loc] = null;
      state.filePath[loc] = '';

      // Fill defaults
      for (const field of col.fields) {
        if (field.name === 'body') continue;
        state.data[loc][field.name] = field.default || '';
      }
    }

    // Load existing data
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
            // Locale file may not exist yet for i18n
            if (!isI18n) throw e;
            console.warn(`No ${loc} version for ${filename}`);
          }
        }
      } catch (e) {
        document.getElementById('editor-form').innerHTML = `<div class="empty-state" style="color:var(--c-danger);">Error loading: ${esc(e.message)}</div>`;
        return;
      }
    }

    // Render form
    this._renderEditorForm(state);

    // i18n tab switching
    if (isI18n) {
      document.getElementById('i18n-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.i18n-tab');
        if (!tab) return;
        // Save current form data before switching
        this._collectFormData(state);
        state.activeLocale = tab.dataset.locale;
        document.querySelectorAll('.i18n-tab').forEach(t => t.classList.toggle('active', t === tab));
        this._renderEditorForm(state);
      });
    }

    // Save
    document.getElementById('save-btn').addEventListener('click', () => this._saveEntry(state));

    // Delete
    const delBtn = document.getElementById('delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const ok = await showModal('Delete Entry', `Are you sure you want to delete "${filename}"? This cannot be undone.`);
        if (!ok) return;
        try {
          showStatus('saving', 'Deleting...');
          for (const loc of locales) {
            if (state.sha[loc]) {
              await this.api.deleteFile(state.filePath[loc], state.sha[loc], `Delete ${filename} (${loc})`);
            }
          }
          showStatus('saved', 'Deleted');
          location.hash = `#/${colName}`;
        } catch (e) {
          showStatus('error', 'Delete failed: ' + e.message);
        }
      });
    }
  }

  _renderEditorForm(state) {
    const { col, activeLocale } = state;
    const data = state.data[activeLocale];
    const body = state.body[activeLocale];
    const formEl = document.getElementById('editor-form');

    let html = '';
    for (const field of col.fields) {
      if (field.name === 'body') continue;
      const value = data[field.name] || '';
      const reqLabel = field.required ? '' : ' <span class="optional">(optional)</span>';
      html += `<div class="form-group">
        <label class="form-label">${esc(field.label)}${reqLabel}</label>
        ${this._renderField(field, value)}
      </div>`;
    }

    // Body field (markdown)
    const bodyField = col.fields.find(f => f.name === 'body');
    if (bodyField) {
      const reqLabel = bodyField.required ? '' : ' <span class="optional">(optional)</span>';
      html += `<div class="form-group">
        <label class="form-label">${esc(bodyField.label)}${reqLabel}</label>
        <textarea class="form-textarea body-field" data-field="body">${esc(body)}</textarea>
      </div>`;
    }

    formEl.innerHTML = html;

    // Bind image uploads
    formEl.querySelectorAll('.image-upload-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fieldName = btn.dataset.field;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => this._handleImageUpload(input.files[0], fieldName, state));
        input.click();
      });
    });
  }

  _renderField(field, value) {
    const escaped = esc(value);
    switch (field.widget) {
      case 'datetime':
        // Convert to datetime-local format
        let dtVal = value;
        if (dtVal && dtVal.length > 16) dtVal = dtVal.substring(0, 16);
        return `<input type="datetime-local" class="form-input" data-field="${field.name}" value="${esc(dtVal)}" ${field.required ? 'required' : ''} />`;

      case 'image':
        const imgSrc = value ? `/images/${value.replace(/^.*\/images\//, '').replace(/^\/?images\//, '')}` : '';
        return `<div class="image-field">
          ${value ? `<img class="image-preview" src="${esc(imgSrc)}" onerror="this.style.display='none'" />` : '<div class="image-placeholder">No image</div>'}
          <div class="image-controls">
            <input type="text" class="form-input" data-field="${field.name}" value="${escaped}" placeholder="/images/filename.jpg" />
            <button type="button" class="btn btn-ghost btn-sm image-upload-btn" data-field="${field.name}">Upload Image</button>
          </div>
        </div>`;

      case 'markdown':
        return `<textarea class="form-textarea" data-field="${field.name}">${escaped}</textarea>`;

      default: // string
        return `<input type="text" class="form-input" data-field="${field.name}" value="${escaped}" ${field.required ? 'required' : ''} />`;
    }
  }

  async _handleImageUpload(file, fieldName, state) {
    if (!file) return;
    showStatus('saving', 'Uploading image...');
    try {
      const reader = new FileReader();
      const b64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mediaFolder = this.config.getMediaFolder();
      const imagePath = `${mediaFolder}/${file.name}`;
      await this.api.uploadImage(imagePath, b64, `Upload image ${file.name}`);

      // Update field value
      const input = document.querySelector(`[data-field="${fieldName}"]`);
      if (input) {
        const publicPath = `/images/${file.name}`;
        input.value = publicPath;
        // Update state
        state.data[state.activeLocale][fieldName] = publicPath;
      }

      // Update preview
      const previewContainer = input.closest('.image-field');
      if (previewContainer) {
        const preview = previewContainer.querySelector('.image-preview, .image-placeholder');
        if (preview) {
          const img = document.createElement('img');
          img.className = 'image-preview';
          img.src = URL.createObjectURL(file);
          preview.replaceWith(img);
        }
      }

      showStatus('saved', 'Image uploaded');
    } catch (e) {
      showStatus('error', 'Upload failed: ' + e.message);
    }
  }

  _collectFormData(state) {
    const loc = state.activeLocale;
    const formEl = document.getElementById('editor-form');
    if (!formEl) return;

    formEl.querySelectorAll('[data-field]').forEach(el => {
      const name = el.dataset.field;
      if (name === 'body') {
        state.body[loc] = el.value;
      } else {
        state.data[loc][name] = el.value;
      }
    });
  }

  async _saveEntry(state) {
    // Collect current form data
    this._collectFormData(state);

    const { col, locales, isNew } = state;
    const isI18n = !!(col.i18n || col.i18nStructure);

    // Determine filename
    let filename = state.filename;
    if (isNew) {
      const title = state.data[locales[0]].title;
      if (!title) {
        showStatus('error', 'Title is required');
        return;
      }
      filename = generateFilename(title);
      state.filename = filename;
    }

    showStatus('saving', 'Saving...');

    try {
      for (const loc of locales) {
        const data = { ...state.data[loc] };

        // Build frontmatter: include extra fields like layout, tags, lang for i18n collections
        if (isI18n) {
          if (!data.layout && col.name === 'projects') data.layout = 'project.html';
          if (!data.layout && col.name === 'highlights') data.layout = 'highlight.html';
          if (!data.layout && col.name === 'about') data.layout = 'about.html';
          if (!data.tags) data.tags = col.name;
          data.lang = loc;
          if (col.name === 'about') {
            data.permalink = `${loc}/about/index.html`;
          }
        } else {
          // Concerts
          if (!data.layout) data.layout = 'concert.html';
        }

        // For i18n, propagate 'duplicate' fields from 'en' to other locales if empty
        if (isI18n && loc !== 'en') {
          for (const field of col.fields) {
            if (field.i18n === 'duplicate' || field.i18n === true) {
              // For 'duplicate', always copy from en; for 'true', keep locale-specific value
            }
            if (field.i18n === 'duplicate' && !data[field.name]) {
              data[field.name] = state.data['en'][field.name] || '';
            }
          }
        }

        // Remove empty optional fields to keep files clean, but keep them if they existed before
        const body = state.body[loc] || '';
        const content = FrontMatter.serialize(data, body);

        const path = isI18n ? `${col.folder}/${loc}/${filename}` : `${col.folder}/${filename}`;
        const sha = state.sha[loc] || undefined;
        const msg = isNew ? `Create ${col.label}: ${data.title || filename}` : `Update ${col.label}: ${data.title || filename}`;

        const result = await this.api.createOrUpdateFile(path, content, msg, sha);
        state.sha[loc] = result.content.sha;
        state.filePath[loc] = path;
      }

      showStatus('saved', 'Saved successfully');

      // If was new, update URL to edit mode
      if (isNew) {
        history.replaceState(null, '', `#/${col.name}/edit/${encodeURIComponent(filename)}`);
        state.isNew = false;
        // Update breadcrumb
        const breadcrumb = this.el.querySelector('.breadcrumb');
        if (breadcrumb) {
          breadcrumb.innerHTML = `
            <a href="#/">Dashboard</a><span class="sep">/</span>
            <a href="#/${col.name}">${esc(col.label)}</a><span class="sep">/</span>
            <span>${esc(filename)}</span>`;
        }
        // Update header
        const header = this.el.querySelector('.editor-header h2');
        if (header) header.textContent = 'Edit Entry';
        // Add delete button if missing
        const actions = this.el.querySelector('.editor-actions');
        if (actions && !document.getElementById('delete-btn')) {
          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-danger';
          delBtn.id = 'delete-btn';
          delBtn.textContent = 'Delete';
          actions.appendChild(delBtn);
          delBtn.addEventListener('click', async () => {
            const ok = await showModal('Delete Entry', `Are you sure you want to delete "${filename}"? This cannot be undone.`);
            if (!ok) return;
            try {
              showStatus('saving', 'Deleting...');
              for (const loc of locales) {
                if (state.sha[loc]) {
                  await this.api.deleteFile(state.filePath[loc], state.sha[loc], `Delete ${filename} (${loc})`);
                }
              }
              showStatus('saved', 'Deleted');
              location.hash = `#/${col.name}`;
            } catch (e) {
              showStatus('error', 'Delete failed: ' + e.message);
            }
          });
        }
      }
    } catch (e) {
      showStatus('error', 'Save failed: ' + e.message);
    }
  }
}

  // ---- Render: Media Library ----
  async renderMedia() {
    const mediaFolder = this.config ? this.config.getMediaFolder() : '_input/images';

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb">
        <a href="#/">Dashboard</a><span class="sep">/</span><span>Media</span>
      </nav>
      <div class="list-header">
        <h2>Media Library</h2>
        <div class="media-actions">
          <button class="btn btn-primary btn-sm" id="upload-media-btn">Upload Images</button>
        </div>
      </div>
      <div class="media-dropzone" id="media-dropzone">
        <p>Drag &amp; drop images here or click "Upload Images"</p>
      </div>
      <div class="media-info" id="media-info"></div>
      <div class="media-grid" id="media-grid">
        <div class="loading-state"><span class="spinner"></span> Loading media...</div>
      </div>`;
    this._bindTopbar();

    // Hidden file input for multi-upload
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    this.el.appendChild(fileInput);

    document.getElementById('upload-media-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) this._uploadMediaFiles(fileInput.files, mediaFolder);
    });

    // Drag & drop
    const dropzone = document.getElementById('media-dropzone');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) this._uploadMediaFiles(e.dataTransfer.files, mediaFolder);
    });

    // Load existing images
    try {
      const contents = await this.api.getContents(mediaFolder);
      const images = contents.filter(f =>
        f.type === 'file' && /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(f.name)
      );

      const gridEl = document.getElementById('media-grid');
      const infoEl = document.getElementById('media-info');
      infoEl.textContent = `${images.length} image${images.length !== 1 ? 's' : ''} in ${mediaFolder}`;

      if (!images.length) {
        gridEl.innerHTML = '<div class="empty-state">No images yet. Upload some!</div>';
        return;
      }

      // Sort alphabetically
      images.sort((a, b) => a.name.localeCompare(b.name));

      gridEl.innerHTML = images.map(img => {
        const publicPath = `/images/${img.name}`;
        return `<div class="media-item" data-name="${esc(img.name)}" data-sha="${img.sha}" data-path="${esc(img.path)}">
          <div class="media-thumb">
            <img src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${img.path}" alt="${esc(img.name)}" loading="lazy" />
          </div>
          <div class="media-item-info">
            <div class="media-item-name" title="${esc(img.name)}">${esc(img.name)}</div>
            <div class="media-item-actions">
              <button class="btn btn-ghost btn-sm media-copy-btn" title="Copy path">Copy Path</button>
              <button class="btn btn-danger btn-sm media-delete-btn" title="Delete">Delete</button>
            </div>
          </div>
        </div>`;
      }).join('');

      // Copy path buttons
      gridEl.querySelectorAll('.media-copy-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const item = btn.closest('.media-item');
          const name = item.dataset.name;
          const publicPath = `/images/${name}`;
          navigator.clipboard.writeText(publicPath).then(() => {
            showStatus('saved', `Copied: ${publicPath}`);
          }).catch(() => {
            // Fallback
            prompt('Copy this path:', publicPath);
          });
        });
      });

      // Delete buttons
      gridEl.querySelectorAll('.media-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const item = btn.closest('.media-item');
          const name = item.dataset.name;
          const sha = item.dataset.sha;
          const path = item.dataset.path;
          const ok = await showModal('Delete Image', `Are you sure you want to delete "${name}"? This cannot be undone.`);
          if (!ok) return;
          try {
            showStatus('saving', 'Deleting...');
            await this.api.deleteFile(path, sha, `Delete image ${name}`);
            item.remove();
            const remaining = gridEl.querySelectorAll('.media-item').length;
            infoEl.textContent = `${remaining} image${remaining !== 1 ? 's' : ''} in ${mediaFolder}`;
            showStatus('saved', `Deleted ${name}`);
          } catch (err) {
            showStatus('error', 'Delete failed: ' + err.message);
          }
        });
      });

      // Click to preview
      gridEl.querySelectorAll('.media-item').forEach(item => {
        item.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          const name = item.dataset.name;
          const imgUrl = `https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${item.dataset.path}`;
          this._showImagePreview(imgUrl, name, `/images/${name}`);
        });
      });

    } catch (e) {
      document.getElementById('media-grid').innerHTML = `<div class="empty-state" style="color:var(--c-danger);">Error loading media: ${esc(e.message)}</div>`;
    }
  }

  async _uploadMediaFiles(files, mediaFolder) {
    const total = files.length;
    let uploaded = 0;
    showStatus('saving', `Uploading 0/${total}...`);

    for (const file of files) {
      try {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const path = `${mediaFolder}/${file.name}`;
        await this.api.uploadImage(path, b64, `Upload ${file.name}`);
        uploaded++;
        showStatus('saving', `Uploading ${uploaded}/${total}...`);
      } catch (e) {
        showStatus('error', `Failed to upload ${file.name}: ${e.message}`);
        return;
      }
    }

    showStatus('saved', `Uploaded ${uploaded} image${uploaded !== 1 ? 's' : ''}`);
    // Refresh the media view
    this.renderMedia();
  }

  _showImagePreview(imgUrl, name, publicPath) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox visible';
    overlay.innerHTML = `
      <div class="lightbox-content">
        <img src="${imgUrl}" alt="${esc(name)}" />
        <div class="lightbox-info">
          <strong>${esc(name)}</strong>
          <code>${esc(publicPath)}</code>
          <div class="lightbox-actions">
            <button class="btn btn-primary btn-sm lightbox-copy">Copy Path</button>
            <button class="btn btn-ghost btn-sm lightbox-close">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.lightbox-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(publicPath).then(() => showStatus('saved', `Copied: ${publicPath}`));
    });
    overlay.querySelector('.lightbox-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
    });
  }
}

// --------------- Bootstrap ---------------
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});

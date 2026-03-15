/* ============================================================
   Musician-Template – Lightweight CMS Admin (Phase 2)
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
      size: data.size,
    };
  }

  /** Get raw file info (without decoding, includes size) */
  async getFileInfo(path) {
    return this._request('GET', `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`);
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

  /** Get commits for a path (for activity/history) */
  async getCommits(path, perPage = 1) {
    return this._request('GET', `/repos/${this.owner}/${this.repo}/commits?path=${encodeURIComponent(path)}&sha=${this.branch}&per_page=${perPage}`);
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

// --------------- Toast Notifications ---------------
function showToast(type, msg, duration) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span><button class="toast-dismiss">&times;</button>`;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-dismiss').addEventListener('click', dismiss);

  if (type !== 'saving') {
    const ms = duration || (type === 'error' ? 5000 : 3000);
    setTimeout(dismiss, ms);
  }

  return toast;
}

// Replace old showStatus with toast-based version
let _savingToast = null;
function showStatus(type, msg) {
  // Remove previous saving toast
  if (_savingToast) {
    try { _savingToast.classList.add('toast-out'); setTimeout(() => _savingToast.remove(), 300); } catch(e) {}
    _savingToast = null;
  }
  const toast = showToast(type, msg);
  if (type === 'saving') _savingToast = toast;
}

// --------------- Escape HTML ---------------
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// --------------- Modal helper ---------------
function showModal(title, message, opts) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('h3').textContent = title;
    const pEl = overlay.querySelector('p');
    if (opts && opts.html) {
      pEl.innerHTML = opts.html;
    } else {
      pEl.textContent = message;
    }
    const okBtn = overlay.querySelector('.modal-ok');
    if (opts && opts.okLabel) okBtn.textContent = opts.okLabel;
    else okBtn.textContent = 'Delete';
    if (opts && opts.okClass) { okBtn.className = `btn ${opts.okClass} modal-ok`; }
    else { okBtn.className = 'btn btn-danger modal-ok'; }

    overlay.classList.add('visible');
    const btnCancel = overlay.querySelector('.modal-cancel');
    function cleanup(val) {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

// --------------- Simple Markdown to HTML Renderer ---------------
function renderMarkdown(md) {
  if (!md) return '';
  let html = md;

  // Code blocks (``` ... ```) - must be processed first
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
  });

  // Split into blocks (separate by blank lines), but protect <pre> blocks
  const preBlocks = [];
  html = html.replace(/<pre><code>[\s\S]*?<\/code><\/pre>/g, match => {
    preBlocks.push(match);
    return `%%PRE_BLOCK_${preBlocks.length - 1}%%`;
  });

  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for pre block placeholder
    const preMatch = line.match(/^%%PRE_BLOCK_(\d+)%%$/);
    if (preMatch) {
      result.push(preBlocks[parseInt(preMatch[1])]);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      result.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      result.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      result.push(`<blockquote><p>${inlineMarkdown(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      result.push('<ul>' + items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      result.push('<ol>' + items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('') + '</ol>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph - collect consecutive non-empty lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].trimStart().startsWith('> ') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim()) &&
      !lines[i].match(/^%%PRE_BLOCK_\d+%%$/)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      result.push(`<p>${inlineMarkdown(paraLines.join(' '))}</p>`);
    }
  }

  return result.join('\n');
}

function inlineMarkdown(text) {
  // Images: ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

// --------------- Format file size ---------------
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    this._previewVisible = false;
    this._previewTimer = null;
    this._entryCountCache = {};

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+S / Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
      }
      // Escape to go back
      if (e.key === 'Escape') {
        // Don't go back if a modal or lightbox is open
        if (document.querySelector('.modal-overlay.visible') || document.querySelector('.image-lightbox.visible')) return;
        const hash = location.hash || '#/';
        if (hash.includes('/edit/') || hash.includes('/new')) {
          const colMatch = hash.match(/^#\/([a-z]+)\//);
          if (colMatch) {
            if (this._unsavedChanges) {
              if (!confirm('You have unsaved changes. Leave anyway?')) return;
            }
            location.hash = `#/${colMatch[1]}`;
          }
        } else if (hash !== '#/' && hash !== '#') {
          location.hash = '#/';
        }
      }
    });

    // Unsaved changes warning
    window.addEventListener('beforeunload', (e) => {
      if (this._unsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  init() {
    window.addEventListener('hashchange', () => {
      this._unsavedChanges = false;
      this._editorState = null;
      this.route();
    });
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
    this._entryCountCache = {};
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

  // ---- Mark unsaved changes ----
  _markDirty() {
    this._unsavedChanges = true;
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.classList.add('has-changes');
  }

  _markClean() {
    this._unsavedChanges = false;
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.classList.remove('has-changes');
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

    const collectionMatch = hash.match(/^#\/([a-z]+)$/);
    if (collectionMatch) return this.renderCollection(collectionMatch[1]);

    const newMatch = hash.match(/^#\/([a-z]+)\/new$/);
    if (newMatch) return this.renderEditor(newMatch[1], null);

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
  async renderDashboard() {
    if (!this.collections.length) {
      this.el.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading configuration...</div>';
      await this.loadConfig();
      if (this.collections.length) return this.renderDashboard();
      this.el.innerHTML = '<div class="empty-state">Could not load collections. Check settings.</div>';
      return;
    }

    this.el.innerHTML = `
      ${this._topbar()}
      <nav class="breadcrumb"><span>Dashboard</span></nav>
      <h2 style="margin-bottom:1rem;">Collections</h2>
      <div class="dashboard-grid">
        ${this.collections.map(c => `
          <div class="card" data-col="${c.name}">
            <div class="card-label">${esc(c.label)}<span class="card-badge" id="badge-${c.name}" style="display:none;"></span></div>
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

    // Fetch entry counts for each collection
    for (const col of this.collections) {
      this._fetchEntryCount(col);
    }
  }

  async _fetchEntryCount(col) {
    try {
      const isI18n = !!(col.i18n || col.i18nStructure);
      const folder = isI18n ? col.folder + '/en' : col.folder;
      const contents = await this.api.getContents(folder);
      const count = contents.filter(f => f.name.endsWith('.md')).length;
      this._entryCountCache[col.name] = count;
      const badge = document.getElementById(`badge-${col.name}`);
      if (badge) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
      }
    } catch (e) {
      // folder may not exist
    }
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
      <div class="collection-filter">
        <input type="text" id="collection-search" placeholder="Filter entries by title..." />
      </div>
      <div id="bulk-bar" class="bulk-bar" style="display:none;">
        <span id="bulk-count">0 selected</span>
        <button class="btn btn-sm" id="bulk-delete-btn">Delete Selected</button>
      </div>
      <div id="entry-list" class="entry-list"><div class="loading-state"><span class="spinner"></span> Loading entries...</div></div>`;
    this._bindTopbar();

    const newBtn = document.getElementById('new-entry-btn');
    if (newBtn) newBtn.addEventListener('click', () => { location.hash = `#/${name}/new`; });

    try {
      let files = [];
      if (col.i18n || col.i18nStructure) {
        const contents = await this.api.getContents(col.folder + '/en');
        files = contents.filter(f => f.name.endsWith('.md'));
      } else {
        const contents = await this.api.getContents(col.folder);
        files = contents.filter(f => f.name.endsWith('.md'));
      }

      files.sort((a, b) => b.name.localeCompare(a.name));

      const listEl = document.getElementById('entry-list');
      if (!files.length) {
        listEl.innerHTML = '<div class="empty-state">No entries yet. Create one!</div>';
        return;
      }

      // Fetch file contents for display
      const entries = await Promise.all(files.map(async f => {
        try {
          const fileData = await this.api.getFile(f.path);
          const parsed = FrontMatter.parse(fileData.content);
          return { name: f.name, data: parsed.data, path: f.path, sha: fileData.sha };
        } catch {
          return { name: f.name, data: { title: f.name }, path: f.path, sha: null };
        }
      }));

      // Render entries with checkboxes
      listEl.innerHTML = `
        <div class="entry-row" style="background:var(--c-bg);border-color:transparent;cursor:default;padding:.5rem 1.1rem;">
          <div class="entry-row-left">
            <input type="checkbox" class="entry-checkbox" id="select-all-checkbox" title="Select all" />
            <span style="font-size:.8rem;color:var(--c-text-secondary);margin-left:.25rem;">Select all</span>
          </div>
        </div>
      ` + entries.map(e => {
        const title = e.data.title || e.name;
        const date = e.data.date || '';
        const place = e.data.place || '';
        let meta = date ? date.replace('T', ' ').substring(0, 16) : '';
        if (place) meta += (meta ? ' — ' : '') + place;
        return `<div class="entry-row" data-file="${esc(e.name)}" data-title="${esc(title)}" data-sha="${esc(e.sha || '')}" data-path="${esc(e.path)}">
          <div class="entry-row-left">
            <input type="checkbox" class="entry-checkbox entry-select" data-file="${esc(e.name)}" />
            <div style="min-width:0;">
              <div class="entry-title">${esc(title)}</div>
              ${meta ? `<div class="entry-meta">${esc(meta)}</div>` : ''}
            </div>
          </div>
          <div class="entry-row-right">
            <div class="entry-meta">${esc(e.name)}</div>
          </div>
        </div>`;
      }).join('');

      // Click to edit (but not on checkbox)
      listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.entry-checkbox')) return;
          location.hash = `#/${name}/edit/${encodeURIComponent(row.dataset.file)}`;
        });
      });

      // Search/filter
      const searchInput = document.getElementById('collection-search');
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        listEl.querySelectorAll('.entry-row[data-file]').forEach(row => {
          const title = (row.dataset.title || '').toLowerCase();
          const file = (row.dataset.file || '').toLowerCase();
          row.style.display = (!q || title.includes(q) || file.includes(q)) ? '' : 'none';
        });
      });

      // Bulk operations
      this._bindBulkOps(listEl, entries, col, name);

      // Fetch last commit info for each entry (Activity/History)
      this._fetchEntryCommitInfo(entries, listEl, col);

    } catch (e) {
      document.getElementById('entry-list').innerHTML = `<div class="empty-state" style="color:var(--c-danger);">Error: ${esc(e.message)}</div>`;
    }
  }

  _bindBulkOps(listEl, entries, col, colName) {
    const selectAllCb = document.getElementById('select-all-checkbox');
    const bulkBar = document.getElementById('bulk-bar');
    const bulkCount = document.getElementById('bulk-count');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

    const updateBulkBar = () => {
      const checked = listEl.querySelectorAll('.entry-select:checked');
      if (checked.length > 0) {
        bulkBar.style.display = 'flex';
        bulkCount.textContent = `${checked.length} selected`;
      } else {
        bulkBar.style.display = 'none';
      }
    };

    selectAllCb.addEventListener('change', () => {
      const allCbs = listEl.querySelectorAll('.entry-select');
      allCbs.forEach(cb => {
        // Only select visible entries
        const row = cb.closest('.entry-row');
        if (row.style.display !== 'none') cb.checked = selectAllCb.checked;
      });
      updateBulkBar();
    });

    listEl.addEventListener('change', (e) => {
      if (e.target.classList.contains('entry-select')) {
        updateBulkBar();
        // Update select-all state
        const allCbs = listEl.querySelectorAll('.entry-select');
        const allChecked = [...allCbs].every(cb => cb.checked);
        selectAllCb.checked = allChecked;
      }
    });

    bulkDeleteBtn.addEventListener('click', async () => {
      const checked = listEl.querySelectorAll('.entry-select:checked');
      const count = checked.length;
      if (!count) return;

      const ok = await showModal(
        'Delete Selected Entries',
        `Are you sure you want to delete ${count} ${count === 1 ? 'entry' : 'entries'}? This cannot be undone.`
      );
      if (!ok) return;

      showStatus('saving', `Deleting ${count} entries...`);
      const isI18n = !!(col.i18n || col.i18nStructure);
      const locales = isI18n ? this.config.getLocales() : ['en'];
      let deleted = 0;

      for (const cb of checked) {
        const fileName = cb.dataset.file;
        const row = cb.closest('.entry-row');
        try {
          if (isI18n) {
            for (const loc of locales) {
              const path = `${col.folder}/${loc}/${fileName}`;
              try {
                const fileInfo = await this.api.getFileInfo(path);
                await this.api.deleteFile(path, fileInfo.sha, `Delete ${fileName} (${loc})`);
              } catch (e) { /* locale file may not exist */ }
            }
          } else {
            const sha = row.dataset.sha;
            const path = row.dataset.path;
            if (sha && path) {
              await this.api.deleteFile(path, sha, `Delete ${fileName}`);
            }
          }
          row.remove();
          deleted++;
          showStatus('saving', `Deleting ${deleted}/${count}...`);
        } catch (e) {
          showStatus('error', `Failed to delete ${fileName}: ${e.message}`);
          return;
        }
      }

      bulkBar.style.display = 'none';
      selectAllCb.checked = false;
      showStatus('saved', `Deleted ${deleted} ${deleted === 1 ? 'entry' : 'entries'}`);
    });
  }

  async _fetchEntryCommitInfo(entries, listEl, col) {
    // Fetch last commit for each entry (fire-and-forget, non-blocking)
    for (const entry of entries) {
      try {
        const commits = await this.api.getCommits(entry.path, 1);
        if (commits && commits.length > 0) {
          const commit = commits[0];
          const msg = commit.commit.message.split('\n')[0];
          const date = new Date(commit.commit.committer.date);
          const ago = this._timeAgo(date);
          const row = listEl.querySelector(`.entry-row[data-file="${CSS.escape(entry.name)}"]`);
          if (row) {
            const rightDiv = row.querySelector('.entry-row-right');
            if (rightDiv) {
              const commitInfo = document.createElement('div');
              commitInfo.className = 'entry-meta';
              commitInfo.title = msg;
              commitInfo.textContent = ago;
              commitInfo.style.maxWidth = '120px';
              commitInfo.style.overflow = 'hidden';
              commitInfo.style.textOverflow = 'ellipsis';
              commitInfo.style.whiteSpace = 'nowrap';
              rightDiv.insertBefore(commitInfo, rightDiv.firstChild);
            }
          }
        }
      } catch (e) {
        // Silently fail - commit info is not critical
      }
    }
  }

  _timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  // ---- Render: Editor ----
  async renderEditor(colName, filename) {
    const col = this.collections.find(c => c.name === colName);
    if (!col) { location.hash = '#/'; return; }

    const isNew = !filename;
    const isI18n = !!(col.i18n || col.i18nStructure);
    const locales = isI18n ? this.config.getLocales() : ['en'];
    const activeLocale = locales[0];

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

    // State
    const state = {
      locales,
      data: {},
      body: {},
      sha: {},
      filePath: {},
      activeLocale: activeLocale,
      filename,
      isNew,
      col,
    };
    this._editorState = state;

    for (const loc of locales) {
      state.data[loc] = {};
      state.body[loc] = '';
      state.sha[loc] = null;
      state.filePath[loc] = '';
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
            if (!isI18n) throw e;
            console.warn(`No ${loc} version for ${filename}`);
          }
        }
      } catch (e) {
        document.getElementById('editor-form').innerHTML = `<div class="empty-state" style="color:var(--c-danger);">Error loading: ${esc(e.message)}</div>`;
        return;
      }
    }

    this._renderEditorForm(state);

    // i18n tab switching
    if (isI18n) {
      document.getElementById('i18n-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.i18n-tab');
        if (!tab) return;
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
          this._markClean();
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

    // Body field (markdown) with rich editor
    const bodyField = col.fields.find(f => f.name === 'body');
    if (bodyField) {
      const reqLabel = bodyField.required ? '' : ' <span class="optional">(optional)</span>';
      html += `<div class="form-group">
        <label class="form-label">${esc(bodyField.label)}${reqLabel}</label>
        ${this._renderMarkdownEditor('body', body)}
      </div>`;
    }

    formEl.innerHTML = html;

    // Bind change tracking for unsaved changes
    formEl.querySelectorAll('input, textarea, select').forEach(el => {
      el.addEventListener('input', () => this._markDirty());
    });

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

    // Bind markdown editor toolbar and preview
    this._bindMarkdownEditors(formEl);
  }

  _renderMarkdownEditor(fieldName, value) {
    const escaped = esc(value);
    return `<div class="md-editor-wrap" data-md-editor="${fieldName}">
      <div class="md-toolbar">
        <button type="button" title="Bold (Ctrl+B)" data-md-action="bold"><b>B</b></button>
        <button type="button" title="Italic (Ctrl+I)" data-md-action="italic"><i>I</i></button>
        <button type="button" title="Heading" data-md-action="heading">H</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Link" data-md-action="link">[]</button>
        <button type="button" title="Image" data-md-action="image">Img</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Unordered List" data-md-action="ul">&#8226;</button>
        <button type="button" title="Ordered List" data-md-action="ol">1.</button>
        <button type="button" title="Blockquote" data-md-action="quote">&gt;</button>
        <button type="button" title="Code Block" data-md-action="code">&lt;/&gt;</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Toggle Preview" data-md-action="preview" class="md-preview-toggle">Preview</button>
      </div>
      <div class="md-editor-body">
        <textarea class="md-textarea" data-field="${fieldName}">${escaped}</textarea>
      </div>
    </div>`;
  }

  _bindMarkdownEditors(formEl) {
    formEl.querySelectorAll('[data-md-editor]').forEach(wrap => {
      const textarea = wrap.querySelector('.md-textarea');
      const toolbar = wrap.querySelector('.md-toolbar');
      const editorBody = wrap.querySelector('.md-editor-body');

      // Tab key inserts 2 spaces
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
          this._markDirty();
          this._updatePreview(wrap);
        }
        // Ctrl+B for bold
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
          e.preventDefault();
          this._mdAction(textarea, 'bold');
        }
        // Ctrl+I for italic
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          e.preventDefault();
          this._mdAction(textarea, 'italic');
        }
      });

      // Live preview updates
      textarea.addEventListener('input', () => {
        this._updatePreviewDebounced(wrap);
      });

      // Toolbar buttons
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-md-action]');
        if (!btn) return;
        const action = btn.dataset.mdAction;

        if (action === 'preview') {
          this._togglePreview(wrap, btn);
          return;
        }

        this._mdAction(textarea, action);
        textarea.focus();
      });
    });
  }

  _mdAction(textarea, action) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    let before = '', after = '', insert = '';

    switch (action) {
      case 'bold':
        before = '**'; after = '**';
        insert = selected || 'bold text';
        break;
      case 'italic':
        before = '*'; after = '*';
        insert = selected || 'italic text';
        break;
      case 'heading':
        before = '## '; after = '';
        insert = selected || 'Heading';
        // If at start of line or line start, just prepend
        if (start > 0 && textarea.value[start - 1] !== '\n') {
          before = '\n## ';
        }
        break;
      case 'link':
        if (selected) {
          before = '['; after = '](url)';
          insert = selected;
        } else {
          before = '['; after = '](url)';
          insert = 'link text';
        }
        break;
      case 'image':
        before = '!['; after = '](url)';
        insert = selected || 'alt text';
        break;
      case 'ul':
        before = '- '; after = '';
        insert = selected || 'list item';
        if (start > 0 && textarea.value[start - 1] !== '\n') before = '\n- ';
        break;
      case 'ol':
        before = '1. '; after = '';
        insert = selected || 'list item';
        if (start > 0 && textarea.value[start - 1] !== '\n') before = '\n1. ';
        break;
      case 'quote':
        before = '> '; after = '';
        insert = selected || 'quote text';
        if (start > 0 && textarea.value[start - 1] !== '\n') before = '\n> ';
        break;
      case 'code':
        before = '```\n'; after = '\n```';
        insert = selected || 'code';
        if (start > 0 && textarea.value[start - 1] !== '\n') before = '\n```\n';
        break;
    }

    const newText = before + insert + after;
    textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);

    // Place cursor after the inserted text (select the inserted word for easy replacement)
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + insert.length;
    textarea.selectionStart = cursorStart;
    textarea.selectionEnd = cursorEnd;

    this._markDirty();
    this._updatePreview(textarea.closest('[data-md-editor]'));
  }

  _togglePreview(wrap, btn) {
    const editorBody = wrap.querySelector('.md-editor-body');
    let preview = editorBody.querySelector('.md-preview');

    if (preview) {
      preview.remove();
      btn.classList.remove('active');
      this._previewVisible = false;
    } else {
      preview = document.createElement('div');
      preview.className = 'md-preview';
      editorBody.appendChild(preview);
      btn.classList.add('active');
      this._previewVisible = true;
      this._updatePreview(wrap);
    }
  }

  _updatePreviewDebounced(wrap) {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._updatePreview(wrap), 300);
  }

  _updatePreview(wrap) {
    if (!wrap) return;
    const preview = wrap.querySelector('.md-preview');
    if (!preview) return;
    const textarea = wrap.querySelector('.md-textarea');
    const md = textarea.value;
    if (!md.trim()) {
      preview.innerHTML = '<div class="md-preview-empty">Nothing to preview</div>';
      return;
    }
    preview.innerHTML = renderMarkdown(md);
  }

  _renderField(field, value) {
    const escaped = esc(value);
    switch (field.widget) {
      case 'datetime':
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
        return this._renderMarkdownEditor(field.name, value);

      default:
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

      const input = document.querySelector(`[data-field="${fieldName}"]`);
      if (input) {
        const publicPath = `/images/${file.name}`;
        input.value = publicPath;
        state.data[state.activeLocale][fieldName] = publicPath;
      }

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
      this._markDirty();
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
    this._collectFormData(state);

    const { col, locales, isNew } = state;
    const isI18n = !!(col.i18n || col.i18nStructure);

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
          if (!data.layout) data.layout = 'concert.html';
        }

        if (isI18n && loc !== 'en') {
          for (const field of col.fields) {
            if (field.i18n === 'duplicate' && !data[field.name]) {
              data[field.name] = state.data['en'][field.name] || '';
            }
          }
        }

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
      this._markClean();

      if (isNew) {
        history.replaceState(null, '', `#/${col.name}/edit/${encodeURIComponent(filename)}`);
        state.isNew = false;
        const breadcrumb = this.el.querySelector('.breadcrumb');
        if (breadcrumb) {
          breadcrumb.innerHTML = `
            <a href="#/">Dashboard</a><span class="sep">/</span>
            <a href="#/${col.name}">${esc(col.label)}</a><span class="sep">/</span>
            <span>${esc(filename)}</span>`;
        }
        const header = this.el.querySelector('.editor-header h2');
        if (header) header.textContent = 'Edit Entry';
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
              this._markClean();
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
      <div class="media-filter">
        <input type="text" id="media-search" placeholder="Filter images by filename..." />
      </div>
      <div class="media-info" id="media-info"></div>
      <div class="media-grid" id="media-grid">
        <div class="loading-state"><span class="spinner"></span> Loading media...</div>
      </div>`;
    this._bindTopbar();

    // Hidden file input
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

      images.sort((a, b) => a.name.localeCompare(b.name));

      gridEl.innerHTML = images.map(img => {
        const sizeStr = img.size ? formatFileSize(img.size) : '';
        return `<div class="media-item" data-name="${esc(img.name)}" data-sha="${img.sha}" data-path="${esc(img.path)}" data-size="${img.size || 0}">
          <div class="media-thumb">
            <img src="https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${img.path}" alt="${esc(img.name)}" loading="lazy" />
          </div>
          <div class="media-item-info">
            <div class="media-item-name" title="${esc(img.name)}">${esc(img.name)}</div>
            ${sizeStr ? `<div class="media-item-size">${sizeStr}</div>` : ''}
            <div class="media-item-actions">
              <button class="btn btn-ghost btn-sm media-copy-btn" title="Copy path">Copy</button>
              <button class="btn btn-ghost btn-sm media-rename-btn" title="Rename">Rename</button>
              <button class="btn btn-danger btn-sm media-delete-btn" title="Delete">Delete</button>
            </div>
          </div>
        </div>`;
      }).join('');

      // Media search/filter
      const searchInput = document.getElementById('media-search');
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        gridEl.querySelectorAll('.media-item').forEach(item => {
          const name = (item.dataset.name || '').toLowerCase();
          item.classList.toggle('hidden', q && !name.includes(q));
        });
      });

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
            prompt('Copy this path:', publicPath);
          });
        });
      });

      // Rename buttons
      gridEl.querySelectorAll('.media-rename-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const item = btn.closest('.media-item');
          const oldName = item.dataset.name;
          const oldPath = item.dataset.path;
          const oldSha = item.dataset.sha;

          // Get the extension
          const ext = oldName.includes('.') ? '.' + oldName.split('.').pop() : '';
          const baseName = oldName.replace(ext, '');

          const newName = prompt('Enter new filename:', baseName);
          if (!newName || newName === baseName) return;

          const fullNewName = newName + ext;
          const newPath = oldPath.replace(oldName, fullNewName);

          try {
            showStatus('saving', 'Renaming...');
            // Get file content
            const fileData = await this.api.getFileInfo(oldPath);
            // Create new file with same content
            await this.api.uploadImage(newPath, fileData.content.replace(/\n/g, ''), `Rename ${oldName} to ${fullNewName}`);
            // Delete old file
            await this.api.deleteFile(oldPath, oldSha, `Rename ${oldName} to ${fullNewName} (delete old)`);
            showStatus('saved', `Renamed to ${fullNewName}`);
            // Refresh
            this.renderMedia();
          } catch (err) {
            showStatus('error', 'Rename failed: ' + err.message);
          }
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
            const remaining = gridEl.querySelectorAll('.media-item:not(.hidden)').length;
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
          const size = parseInt(item.dataset.size || '0');
          const imgUrl = `https://raw.githubusercontent.com/${this.api.owner}/${this.api.repo}/${this.api.branch}/${item.dataset.path}`;
          this._showImagePreview(imgUrl, name, `/images/${name}`, size);
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
    this.renderMedia();
  }

  _showImagePreview(imgUrl, name, publicPath, fileSize) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox visible';
    const sizeStr = fileSize ? formatFileSize(fileSize) : '';
    overlay.innerHTML = `
      <div class="lightbox-content">
        <img src="${imgUrl}" alt="${esc(name)}" id="lightbox-img" />
        <div class="lightbox-info">
          <strong>${esc(name)}</strong>
          <code>${esc(publicPath)}</code>
          ${sizeStr ? `<div class="lightbox-dimensions">Size: ${sizeStr}<span id="lightbox-dims"></span></div>` : '<div class="lightbox-dimensions"><span id="lightbox-dims"></span></div>'}
          <div class="lightbox-actions">
            <button class="btn btn-primary btn-sm lightbox-copy">Copy Path</button>
            <button class="btn btn-primary btn-sm lightbox-insert">Insert into Editor</button>
            <button class="btn btn-ghost btn-sm lightbox-close">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Get image dimensions once loaded
    const imgEl = overlay.querySelector('#lightbox-img');
    imgEl.addEventListener('load', () => {
      const dimsEl = overlay.querySelector('#lightbox-dims');
      if (dimsEl && imgEl.naturalWidth) {
        dimsEl.textContent = ` | Dimensions: ${imgEl.naturalWidth} x ${imgEl.naturalHeight}px`;
      }
    });

    overlay.querySelector('.lightbox-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(publicPath).then(() => showStatus('saved', `Copied: ${publicPath}`));
    });

    overlay.querySelector('.lightbox-insert').addEventListener('click', () => {
      const mdSyntax = `![${name}](${publicPath})`;
      // Try to insert into the active markdown editor
      const activeTextarea = document.querySelector('.md-textarea');
      if (activeTextarea) {
        const start = activeTextarea.selectionStart;
        activeTextarea.value = activeTextarea.value.substring(0, start) + mdSyntax + activeTextarea.value.substring(start);
        activeTextarea.selectionStart = activeTextarea.selectionEnd = start + mdSyntax.length;
        showStatus('saved', 'Inserted image markdown');
      } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(mdSyntax).then(() => showStatus('saved', `Copied: ${mdSyntax}`));
      }
      overlay.remove();
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

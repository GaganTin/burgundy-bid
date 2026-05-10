import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

class EntityStore {
  constructor(name) {
    this.name = name;
    this.items = new Map();
  }
  list(_sort = undefined, limit = 100) {
    return Promise.resolve(Array.from(this.items.values()).slice(0, limit));
  }
  filter(query = {}, _sort = undefined, limit = 100) {
    const results = Array.from(this.items.values()).filter(item => {
      for (const k of Object.keys(query)) {
        if (String(item[k]) !== String(query[k])) return false;
      }
      return true;
    });
    return Promise.resolve(results.slice(0, limit));
  }
  async create(data) {
    const id = data.id || makeId();
    const record = { id, created_date: new Date().toISOString(), ...data };
    this.items.set(id, record);
    return Promise.resolve(record);
  }
  async bulkCreate(records = []) {
    const created = [];
    for (const r of records) created.push(await this.create(r));
    return Promise.resolve(created);
  }
  async update(id, data) {
    if (!this.items.has(id)) throw new Error('Not found');
    const existing = this.items.get(id);
    const updated = { ...existing, ...data, updated_date: new Date().toISOString() };
    this.items.set(id, updated);
    return Promise.resolve(updated);
  }
  async delete(id) {
    this.items.delete(id);
    return Promise.resolve(true);
  }
}

class RemoteEntityStore {
  constructor(name, baseUrl) {
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }
  async list(_sort = undefined, limit = 100) {
    const url = new URL(`${this.baseUrl}/entities/${this.name}`);
    url.searchParams.set('limit', String(limit));
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('app_access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      try { const txt = await res.text(); console.error('Entity list failed', this.name, res.status, txt); } catch(e){}
      return [];
    }
    return res.json();
  }
  async filter(query = {}, _sort = undefined, limit = 100) {
    const token = localStorage.getItem('app_access_token');
    // If no auth token present, allow public read path for demo data
    const basePath = token ? `${this.baseUrl}/entities/${this.name}` : `${this.baseUrl}/public/entities/${this.name}`;
    const url = new URL(basePath);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('limit', String(limit));
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      try { const txt = await res.text(); console.error('Entity filter failed', this.name, res.status, txt); } catch(e){}
      return [];
    }
    return res.json();
  }
  async create(data) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('app_access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl}/entities/${this.name}`, {
      method: 'POST', headers, body: JSON.stringify(data)
    });
    return res.json();
  }
  async bulkCreate(records = []) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('app_access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl}/entities/${this.name}/bulk`, {
      method: 'POST', headers, body: JSON.stringify(records)
    });
    return res.json();
  }
  async update(id, data) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('app_access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl}/entities/${this.name}/${id}`, {
      method: 'PUT', headers, body: JSON.stringify(data)
    });
    return res.json();
  }
  async delete(id) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('app_access_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.baseUrl}/entities/${this.name}/${id}`, { method: 'DELETE', headers });
    return res.json();
  }
}

function createClient(opts = {}) {
  const stores = new Map();
  function getStore(name) {
    if (!stores.has(name)) stores.set(name, new EntityStore(name));
    return stores.get(name);
  }

  // simple in-memory upload store for files
  const uploadStore = new Map();

  // detect Vite env var for API base URL, fall back to app param or localhost:3001 in dev
  let API_BASE = null;
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) API_BASE = import.meta.env.VITE_API_BASE_URL;
  } catch (e) {}
  if (!API_BASE && typeof appBaseUrl === 'string' && appBaseUrl) API_BASE = appBaseUrl;
  // If still not set and running in browser on localhost, default to local API port
  if (!API_BASE && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    API_BASE = 'http://localhost:3001';
  }

  function getStoreFor(name) {
    if (API_BASE) return new RemoteEntityStore(name, API_BASE);
    return getStore(name);
  }

  const base = {
    appId: opts.appId || appId,
    // Expose the resolved API base URL so pages can use it for fetch calls and SSE.
    appBaseUrl: opts.appBaseUrl || appBaseUrl || API_BASE || '',
    functionsVersion: opts.functionsVersion || functionsVersion,
    auth: {
      isAuthenticated() {
        const t = localStorage.getItem('app_access_token');
        return Promise.resolve(Boolean(t));
      },
      async _tryRefresh() {
        const refreshToken = localStorage.getItem('app_refresh_token');
        if (!API_BASE || !refreshToken) return false;
        try {
          const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) {
            localStorage.removeItem('app_access_token');
            localStorage.removeItem('app_refresh_token');
            localStorage.removeItem('app_current_user');
            return false;
          }
          const data = await res.json();
          localStorage.setItem('app_access_token', data.token);
          localStorage.setItem('app_refresh_token', data.refreshToken);
          if (data.user) localStorage.setItem('app_current_user', JSON.stringify(data.user));
          return true;
        } catch {
          return false;
        }
      },
      async me() {
        const API = API_BASE;
        let token = localStorage.getItem('app_access_token');
        if (API && token) {
          let res = await fetch(`${API}/auth/me`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
          if (res.status === 401) {
            const refreshed = await base.auth._tryRefresh();
            if (refreshed) {
              token = localStorage.getItem('app_access_token');
              res = await fetch(`${API}/auth/me`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
            }
          }
          if (!res.ok) {
            try { const txt = await res.text(); console.error('auth.me failed', res.status, txt); } catch(e){}
            // 403 = account deleted — purge stale tokens so we don't keep retrying
            if (res.status === 403) {
              localStorage.removeItem('app_access_token');
              localStorage.removeItem('app_refresh_token');
              localStorage.removeItem('app_current_user');
            }
            return null;
          }
          const user = await res.json();
          localStorage.setItem('app_current_user', JSON.stringify(user));
          return user;
        }
        const raw = localStorage.getItem('app_current_user');
        return raw ? JSON.parse(raw) : null;
      },
      async updateMe(data) {
        const API = API_BASE;
        const token = localStorage.getItem('app_access_token');
        if (API && token) {
          const res = await fetch(`${API}/auth/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (!res.ok) {
              const txt = await res.text();
              throw new Error(`updateMe failed: ${res.status} ${txt}`);
            }
          const user = await res.json();
          localStorage.setItem('app_current_user', JSON.stringify(user));
          return user;
        }
        const cur = JSON.parse(localStorage.getItem('app_current_user') || '{}');
        const next = { ...cur, ...data };
        localStorage.setItem('app_current_user', JSON.stringify(next));
        return Promise.resolve(next);
      },
      async changePassword(current_password, new_password) {
        const API = API_BASE;
        const token = localStorage.getItem('app_access_token');
        if (!API || !token) return Promise.reject(new Error('API not configured'));
        const res = await fetch(`${API}/auth/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ current_password, new_password }) });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Password change failed');
        }
        return res.json();
      },
      async deleteAccount() {
        const API = API_BASE;
        const token = localStorage.getItem('app_access_token');
        if (!API || !token) return Promise.reject(new Error('API not configured'));
        const res = await fetch(`${API}/auth/me`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Delete account failed');
        }
        // clear local storage
        localStorage.removeItem('app_access_token');
        localStorage.removeItem('app_refresh_token');
        localStorage.removeItem('app_current_user');
        return res.json();
      },
      redirectToLogin(nextUrl) {
        if (nextUrl) window.location.href = nextUrl;
        else console.warn('redirectToLogin called - no URL provided');
      },
      logout(redirectUrl) {
        localStorage.removeItem('app_access_token');
        localStorage.removeItem('app_refresh_token');
        localStorage.removeItem('app_current_user');
        if (redirectUrl) window.location.href = redirectUrl;
        return Promise.resolve(true);
      }
    },
    entities: new Proxy({}, {
      get(_, entityName) {
        return getStoreFor(entityName);
      }
    }),
    integrations: {
      Core: {
        InvokeLLM(payload) {
          return Promise.resolve({ result: `mocked LLM response for ${payload?.prompt || 'none'}` });
        },
        async UploadFile({ file }) {
          const id = makeId();
          const reader = new FileReader();
          return await new Promise((res) => {
            reader.onload = () => {
              const dataUrl = reader.result;
              uploadStore.set(id, { name: file.name, dataUrl });
              res({ file_url: `localupload://${id}` });
            };
            reader.onerror = () => res({ error: 'failed' });
            reader.readAsDataURL(file);
          });
        },
        async ExtractDataFromUploadedFile({ file_url, json_schema = {} }) {
          try {
            if (!file_url?.startsWith('localupload://')) return { status: 'error', message: 'unknown file_url' };
            const id = file_url.replace('localupload://', '');
            const entry = uploadStore.get(id);
            if (!entry) return { status: 'error', message: 'file not found' };
            // Try to parse CSV/TSV from the DataURL
            const dataUrl = entry.dataUrl;
            const commaIndex = dataUrl.indexOf(',');
            const b64 = dataUrl.slice(commaIndex + 1);
            const raw = atob(b64);
            // naive CSV parsing: split lines, split by comma or tab
            const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const sep = lines[0].includes('\t') ? '\t' : ',';
            const headers = lines[0].split(sep).map(h => h.toLowerCase());
            const items = lines.slice(1).map(line => {
              const cols = line.split(sep);
              const obj = {};
              headers.forEach((h, i) => obj[h] = cols[i] || '');
              return obj;
            });
            return { status: 'success', output: { wines: items } };
          } catch (err) {
            return { status: 'error', message: String(err) };
          }
        }
      }
    },
    subscription: {
      async usage() {
        if (!API_BASE) return null;
        const token = localStorage.getItem('app_access_token');
        if (!token) return null;
        const res = await fetch(`${API_BASE}/subscription/usage`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        return res.json();
      },
      async createCheckoutSession(plan, billing = 'monthly') {
        if (!API_BASE) throw new Error('API not configured');
        const token = localStorage.getItem('app_access_token');
        const res = await fetch(`${API_BASE}/stripe/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ plan, billing }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Checkout failed');
        return data; // { url }
      },
      async verifySession(sessionId) {
        if (!API_BASE) throw new Error('API not configured');
        const token = localStorage.getItem('app_access_token');
        const res = await fetch(`${API_BASE}/stripe/verify-session?session_id=${sessionId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        return data;
      },
      async openBillingPortal() {
        if (!API_BASE) throw new Error('API not configured');
        const token = localStorage.getItem('app_access_token');
        const res = await fetch(`${API_BASE}/stripe/billing-portal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Billing portal failed');
        return data; // { url }
      },
    },
    appLogs: {
      logUserInApp(pageName) {
        console.info('logUserInApp:', pageName);
        return Promise.resolve(true);
      }
    }
  };

  return base;
}

export const client = createClient({ appId, token, functionsVersion, appBaseUrl });

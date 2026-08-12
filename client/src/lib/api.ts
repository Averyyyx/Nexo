// Определяем API URL - если мы в Electron, используем localhost
export const API_BASE = (() => {
  // Проверяем, запущены ли мы в Electron через user agent
  const isElectron = typeof navigator !== 'undefined' && 
                       navigator.userAgent.toLowerCase().indexOf('electron') > -1;
  
  if (isElectron) {
    return 'http://127.0.0.1:4000';
  }
  
  return import.meta.env.VITE_API_BASE || 'http://localhost:4000';
})();

const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

async function requestCsrfToken() {
  const response = await fetch(`${API_BASE}/api/security/csrf-token`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Не удалось получить CSRF токен');
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload?.token) {
    throw new Error('Некорректный ответ CSRF сервера');
  }
  csrfToken = payload.token;
  return csrfToken;
}

export async function ensureCsrfToken(force = false) {
  if (!force && csrfToken) {
    return csrfToken;
  }
  if (!csrfPromise || force) {
    csrfPromise = requestCsrfToken().finally(() => {
      csrfPromise = null;
    });
  }
  return csrfPromise;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (!SAFE_METHODS.has(method)) {
    const token = await ensureCsrfToken();
    headers.set(CSRF_HEADER, token);
  }

  const absoluteUrl = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const response = await fetch(absoluteUrl, {
    ...init,
    method,
    headers,
    credentials: init.credentials ?? 'include'
  });

  const refreshed = response.headers.get(CSRF_HEADER);
  if (refreshed) {
    csrfToken = refreshed;
  }

  if (!response.ok && response.status === 403) {
    clearCsrfToken();
  }

  return response;
}


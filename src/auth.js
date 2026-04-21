import { API_BASE } from './config';

const AUTH_KEY = 'mri_auth';

export function login(user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function getUser() {
  const data = localStorage.getItem(AUTH_KEY);
  return data ? JSON.parse(data) : null;
}

export function getToken() {
  const user = getUser();
  return user ? user.token : null;
}

export function isAuthenticated() {
  return !!getUser();
}

export function hasRole(role) {
  const user = getUser();
  return user ? user.role === role : false;
}

export async function authenticatedFetch(url, options = {}) {
  const token = getToken();
  console.log('authenticatedFetch - token:', token ? 'present' : 'missing', token ? token.substring(0, 20) + '...' : '');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  console.log('authenticatedFetch - headers:', JSON.stringify(headers, null, 2));
  console.log('authenticatedFetch - URL:', url);
  return fetch(url, { ...options, headers });
}

export async function logoutBackend() {
  const token = getToken();
  if (token) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (e) {
      console.error('Logout error:', e);
    }
  }
  logout();
}


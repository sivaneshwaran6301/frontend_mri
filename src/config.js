export const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
export const API_BASE = isLocal ? 'http://localhost:8000' : 'https://YOUR-APP.onrender.com';

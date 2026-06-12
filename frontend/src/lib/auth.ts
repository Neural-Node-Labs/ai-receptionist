/**
 * Frontend auth utilities.
 *
 * Token storage strategy:
 *   - accessToken: memory only (not localStorage — XSS-safe)
 *   - refreshToken: httpOnly cookie set by backend (not readable by JS)
 *
 * Auto-refresh: access token is silently refreshed 60s before expiry.
 */

import { PublicUser } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── In-memory token store ────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _tokenExpiresAt: number | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _currentUser: PublicUser | null = null;

type AuthListener = (user: PublicUser | null) => void;
const _listeners = new Set<AuthListener>();

export function subscribeAuth(cb: AuthListener): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function notify(user: PublicUser | null) {
  _currentUser = user;
  for (const cb of _listeners) cb(user);
}

// ─── Token management ─────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return _accessToken;
}

function scheduleRefresh(expiresInSeconds: number) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // Refresh 60s before expiry, minimum 10s
  const refreshInMs = Math.max((expiresInSeconds - 60) * 1000, 10_000);
  _refreshTimer = setTimeout(async () => {
    const ok = await silentRefresh();
    if (!ok) clearAuth();
  }, refreshInMs);
}

function setSession(accessToken: string, expiresIn: number, user: PublicUser) {
  _accessToken    = accessToken;
  _tokenExpiresAt = Date.now() + expiresIn * 1000;
  notify(user);
  scheduleRefresh(expiresIn);
}

export function clearAuth() {
  _accessToken    = null;
  _tokenExpiresAt = null;
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  notify(null);
}

// ─── API calls ────────────────────────────────────────────────────────────────

export interface LoginResult {
  success: boolean;
  error?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method:      'POST',
      credentials: 'include',   // receive httpOnly cookie
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ username, password }),
    });

    if (res.status === 429) {
      return { success: false, error: 'Too many attempts. Please wait a minute.' };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { success: false, error: body.error || 'Login failed' };
    }

    const data = await res.json() as { accessToken: string; expiresIn: number; user: PublicUser };
    setSession(data.accessToken, data.expiresIn, data.user);
    return { success: true };
  } catch {
    return { success: false, error: 'Network error — could not reach server' };
  }
}

export async function silentRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method:      'POST',
      credentials: 'include',   // send httpOnly cookie, receive new one
    });

    // 401 = no valid session (expected on first load, or after logout)
    // Do NOT clear state here — caller decides what to do
    if (res.status === 401) return false;

    if (!res.ok) {
      console.error('[auth] refresh failed with status', res.status);
      return false;
    }

    const data = await res.json() as { accessToken: string; expiresIn: number; user: PublicUser };
    setSession(data.accessToken, data.expiresIn, data.user);
    return true;
  } catch (err) {
    console.error('[auth] refresh network error', err);
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method:      'POST',
      credentials: 'include',
      headers: _accessToken ? { Authorization: `Bearer ${_accessToken}` } : {},
    });
  } catch { /* ignore network errors on logout */ }
  clearAuth();
}

/**
 * Called on app mount — try to restore session from httpOnly refresh cookie.
 * Returns the user if a valid session was found, null otherwise.
 * This is a silent check; a 401 is expected when not logged in.
 */
export async function restoreSession(): Promise<PublicUser | null> {
  const ok = await silentRefresh();
  return ok ? _currentUser : null;
}

export function getCurrentUser(): PublicUser | null {
  return _currentUser;
}

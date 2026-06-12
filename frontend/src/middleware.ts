/**
 * Next.js middleware — route guard.
 *
 * Route access policy:
 *   /           — PUBLIC (chat page, anyone can use)
 *   /login      — PUBLIC
 *   /admin      — ADMIN only (redirect to /login if no session)
 *   /admin/*    — ADMIN only
 *
 * The 'rft' cookie presence is used as a lightweight session indicator.
 * Actual JWT verification happens on the backend for every API call.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_PATHS   = ['/admin'];
const ALWAYS_PUBLIC = ['/login', '/_next', '/favicon', '/robots', '/api'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Static files, Next internals, API routes — always pass through
  if (
    ALWAYS_PUBLIC.some((p) => pathname.startsWith(p)) ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const isAdminPath = ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (isAdminPath) {
    const hasSession = req.cookies.has('rft');
    if (!hasSession) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // All other paths (including /) are public
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

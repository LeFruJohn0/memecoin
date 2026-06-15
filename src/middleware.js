import { NextResponse } from 'next/server';

export function middleware(request) {
  const password = process.env.ACCESS_PASSWORD;
  
  // If no password is configured, bypass authentication entirely
  if (!password || password.trim() === '') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Paths that are ALWAYS public:
  // - Helius webhook receiver (needs to accept incoming trades from the cloud)
  // - Auth API route (where password submissions are verified)
  // - Login page itself
  // - Next.js internal static assets and public files (images, icons)
  if (
    pathname === '/api/webhook' ||
    pathname.startsWith('/api/auth') ||
    pathname === '/login' ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for presence of the auth cookie
  const authToken = request.cookies.get('auth_token')?.value;

  // If the cookie does not match the configured password, redirect to login
  if (authToken !== password) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

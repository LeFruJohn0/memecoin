import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { password } = await req.json();
    const correctPassword = process.env.ACCESS_PASSWORD;

    if (!correctPassword) {
      return NextResponse.json({ success: true, message: 'Authentication is not configured.' });
    }

    if (password === correctPassword) {
      const response = NextResponse.json({ success: true });
      
      // Set an HTTP-only secure cookie
      response.cookies.set('auth_token', password, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/'
      });
      
      return response;
    }

    return NextResponse.json(
      { success: false, error: 'Incorrect dashboard password.' }, 
      { status: 401 }
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  // Clear the cookie
  response.cookies.set('auth_token', '', { maxAge: 0, path: '/' });
  return response;
}

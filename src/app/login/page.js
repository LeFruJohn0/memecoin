"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, ShieldAlert } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (data.success) {
        // Redirect to homepage and force refresh
        router.push('/');
        router.refresh();
      } else {
        setError(data.error || 'Incorrect password.');
      }
    } catch (err) {
      setError('Connection failed. Please verify the server is running.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/40 border border-slate-800 backdrop-blur-md rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -top-20 -left-20 h-40 w-40 rounded-full bg-green-500/10 blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-20 -right-20 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none"></div>

        <div className="flex flex-col items-center space-y-3 mb-8">
          <div className="h-12 w-12 rounded-xl bg-green-950/40 border border-green-800/50 flex items-center justify-center text-green-400">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent">
            COPY-TRADER PORTAL
          </h1>
          <p className="text-xs text-slate-400 text-center">
            This dashboard is private. Please enter your access password to unlock.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-950/30 border border-red-800/80 text-red-300 p-3.5 rounded-xl flex items-start space-x-2.5 text-xs">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Dashboard Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 text-slate-100 placeholder-slate-700 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-green-500 to-cyan-500 hover:from-green-600 hover:to-cyan-600 text-slate-950 font-bold py-3 rounded-xl transition-all text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-green-500/10"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
            ) : (
              <span>Unlock Dashboard</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

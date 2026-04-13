import { useState } from 'react';
import { signIn, signUp, signOut, useSession } from './auth/client';
import { ReportsPage } from './reports/ReportsPage';
import './App.css';

type AuthMode = 'login' | 'register';

function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await signUp.email({ email, password, name });
        if (res.error) throw new Error(res.error.message ?? 'Sign up failed');
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message ?? 'Sign in failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 320,
        margin: '0 auto',
      }}
    >
      <h2>{mode === 'register' ? 'Create account' : 'Sign in'}</h2>
      {mode === 'register' && (
        <input
          type='text'
          placeholder='Name'
          value={name}
          onChange={e => setName(e.target.value)}
          required
          autoComplete='name'
        />
      )}
      <input
        type='email'
        placeholder='Email'
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        autoComplete='email'
      />
      <input
        type='password'
        placeholder='Password'
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
      />
      <button type='submit' disabled={busy}>
        {busy ? '…' : mode === 'register' ? 'Register' : 'Sign in'}
      </button>
      {error && <p style={{ color: 'tomato' }}>{error}</p>}
      <button
        type='button'
        onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
      >
        {mode === 'register'
          ? 'Have an account? Sign in'
          : 'No account? Register'}
      </button>
    </form>
  )
}

function UserView({ user }: { user: { email: string; name: string } }) {
  const handleLogout = () => signOut();
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Welcome, {user.name}</h1>
          <p style={{ margin: 0 }}>
            Signed in as <code>{user.email}</code>
          </p>
        </div>
        <button onClick={handleLogout}>Log out</button>
      </header>
      <hr style={{ margin: '1.5rem 0' }} />
      <ReportsPage />
    </div>
  );
}

function App() {
  const { data: session, isPending } = useSession();

  if (isPending) return <p style={{ textAlign: 'center' }}>Loading…</p>;

  return (
    <main style={{ padding: '4rem 1rem' }}>
      {session?.user ? <UserView user={session.user} /> : <AuthForm />}
    </main>
  );
}

export default App;

import { useState } from 'react'

import { signIn, signUp, signOut, useSession } from './auth/client'
import { ReportsPage } from './reports/ReportsPage'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AuthMode = 'login' | 'register'

function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') {
        const res = await signUp.email({ email, password, name })
        if (res.error) throw new Error(res.error.message ?? 'Sign up failed')
      } else {
        const res = await signIn.email({ email, password })
        if (res.error) throw new Error(res.error.message ?? 'Sign in failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className='mx-auto w-full max-w-sm'>
      <CardHeader>
        <CardTitle>
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </CardTitle>
        <CardDescription>
          {mode === 'register'
            ? 'Register to start generating reports.'
            : 'Use your email and password.'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className='flex flex-col gap-4 mb-4'>
          {mode === 'register' && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='auth-name'>Name</Label>
              <Input
                id='auth-name'
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete='name'
                required
              />
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label htmlFor='auth-email'>Email</Label>
            <Input
              id='auth-email'
              type='email'
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete='email'
              required
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='auth-password'>Password</Label>
            <Input
              id='auth-password'
              type='password'
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={
                mode === 'register' ? 'new-password' : 'current-password'
              }
              minLength={8}
              required
            />
          </div>
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </CardContent>
        <CardFooter className='flex flex-col gap-2'>
          <Button type='submit' disabled={busy} className='w-full'>
            {busy ? 'Working…' : mode === 'register' ? 'Register' : 'Sign in'}
          </Button>
          <Button
            type='button'
            variant='ghost'
            className='w-full'
            onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
          >
            {mode === 'register'
              ? 'Have an account? Sign in'
              : 'No account? Register'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function UserView({ user }: { user: { email: string; name: string } }) {
  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-6'>
      <header className='flex items-center justify-between gap-4'>
        <div className='flex flex-col'>
          <h1 className='text-2xl font-semibold tracking-tight'>
            Welcome, {user.name}
          </h1>
          <p className='text-sm text-muted-foreground'>
            Signed in as <span className='font-mono'>{user.email}</span>
          </p>
        </div>
        <Button variant='outline' onClick={() => signOut()}>
          Log out
        </Button>
      </header>
      <ReportsPage />
    </div>
  )
}

function App() {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return (
      <main className='flex min-h-screen items-center justify-center p-6'>
        <p className='text-muted-foreground'>Loading…</p>
      </main>
    )
  }

  return (
    <main className='min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8'>
      {session?.user ? <UserView user={session.user} /> : <AuthForm />}
    </main>
  )
}

export default App

import { useEffect, useState } from 'react'
import './App.css'

type Health = { status: string }

function App() {
  const [health, setHealth] = useState<string>('loading…')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <main>
      <h1>Secrethon 2026</h1>
      <p>
        API status: <code>{health}</code>
      </p>
    </main>
  )
}

export default App

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CliRunner } from './CliRunner'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('cli') ? <CliRunner /> : <App />}
  </StrictMode>
)

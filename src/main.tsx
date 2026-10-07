import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@kodyuno/kodyuno.css'
import IdePage from './app/IdePage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="kyuno-root h-[100dvh] w-screen overflow-hidden">
      <IdePage />
    </div>
  </StrictMode>,
)

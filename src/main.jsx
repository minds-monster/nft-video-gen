import './services/mindsProxy'  // must run before any Minds API call; see file header
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted webfonts. These are imported here rather than @import-ed from index.css so
// Vite resolves and fingerprints them through the normal asset pipeline. Both ship
// `font-display: swap`, so type paints in the fallback first and swaps — never invisible.
// Anton is latin-only and single-weight; see the font-synthesis note in index.css.
import '@fontsource/anton/latin-400.css'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

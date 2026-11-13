import './polyfills'
import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.tsx'
import type { PrerenderData } from './prerenderData'
import './index.css'

const rootElement = document.getElementById('root')!
const dataElement = document.getElementById('__PRERENDER_DATA__')
let initialData: PrerenderData | undefined
if (dataElement?.textContent) {
  try {
    initialData = JSON.parse(dataElement.textContent) as PrerenderData
  } catch (error) {
    console.error('Could not read prerendered page data:', error)
  }
}
const app = (
  <React.StrictMode>
    <App initialData={initialData} />
  </React.StrictMode>
)

if (rootElement.hasChildNodes()) {
  hydrateRoot(rootElement, app)
} else {
  createRoot(rootElement).render(app)
}

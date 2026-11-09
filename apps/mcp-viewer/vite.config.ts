import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained HTML file: the server hands it to the host as a resource,
// so nothing beside it can be fetched.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  // The polyfill carries a fetch() this page never needs.
  build: { modulePreload: { polyfill: false } }
})

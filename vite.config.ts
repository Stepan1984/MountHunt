import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Custom domain (mounthunt.ru) serves at site root on GitHub Pages.
// Override with VITE_BASE=/MountHunt/ if you need the project-pages path again.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
})

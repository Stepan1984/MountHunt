import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages project site: https://<user>.github.io/MountHunt/
const repoBase = '/MountHunt/'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? repoBase,
})

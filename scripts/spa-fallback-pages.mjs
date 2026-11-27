#!/usr/bin/env node
/**
 * GitHub Pages returns HTTP 404 for unknown paths even when 404.html is the SPA shell.
 * Copy index.html into real directories for known client routes so they get HTTP 200.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const indexHtml = join(dist, 'index.html')
const resortsPath = join(root, 'public', 'data', 'resorts.json')

const staticRoutes = ['about', 'contacts', 'privacy', 'news']

function writeRoute(relDir) {
  const dir = join(dist, relDir)
  mkdirSync(dir, { recursive: true })
  copyFileSync(indexHtml, join(dir, 'index.html'))
}

copyFileSync(indexHtml, join(dist, '404.html'))

for (const route of staticRoutes) {
  writeRoute(route)
}

const resorts = JSON.parse(readFileSync(resortsPath, 'utf8'))
if (!Array.isArray(resorts)) {
  console.error('resorts.json must be an array')
  process.exit(1)
}

for (const resort of resorts) {
  if (resort?.id) writeRoute(join('resort', String(resort.id)))
}

console.log(
  `SPA fallbacks: 404.html + ${staticRoutes.length} static + ${resorts.length} resort routes`,
)

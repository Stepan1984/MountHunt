#!/usr/bin/env node
/**
 * Standalone Krasnoe card-tags enrich from public/data/important.json.
 *
 * Offline/CI: deterministic rules (no API key).
 * Real LLM: set MOUNTHUNT_LLM_API_KEY or OPENAI_API_KEY.
 *
 * Usage:
 *   npm run scrape:card-tags
 *   npm run scrape:card-tags -- --dry-run
 *   CARD_TAGS_MODE=fixture npm run scrape:card-tags
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enrichCardTags } from './scrape/lib/card-tags.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const importantPath = join(outDir, 'important.json')
const cardTagsPath = join(outDir, 'card-tags.json')
const metaPath = join(outDir, 'meta.json')

function parseArgs(argv) {
  const args = { dryRun: false }
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true
  }
  return args
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(outDir, { recursive: true })
  const important = readJson(importantPath, [])
  const previous = readJson(cardTagsPath, { resorts: {} })
  const cardTags = await enrichCardTags(important, { previous })

  if (args.dryRun) {
    console.log('[dry-run]', JSON.stringify(cardTags, null, 2))
    return
  }

  writeJson(cardTagsPath, cardTags)
  const meta = readJson(metaPath, {})
  writeJson(metaPath, { ...meta, cardTagsUpdatedAt: cardTags.updatedAt })
  console.log(
    `Записано ${cardTagsPath} · mode=${cardTags.mode} · krasnoe=${cardTags.resorts?.['krasnoe-ozero']?.length ?? 0}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

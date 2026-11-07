#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildExport } from './lib.mjs'

const [inputPath, outputPath, sourceRevision, snapshotAt] = process.argv.slice(2)
if (!inputPath || !outputPath || !sourceRevision || !snapshotAt) {
  console.error('usage: export-cli.mjs SNAPSHOT.json OUTPUT_DIR SOURCE_REVISION SNAPSHOT_ISO_TIME')
  process.exit(2)
}
const snapshot = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
const exported = buildExport(snapshot, { source_revision: sourceRevision, snapshot_at: snapshotAt })
mkdirSync(resolve(outputPath), { recursive: true })
for (const [name, content] of Object.entries(exported.files)) writeFileSync(resolve(outputPath, name), content, { flag: 'wx' })
writeFileSync(resolve(outputPath, 'manifest.json'), exported.manifest_json, { flag: 'wx' })
console.log(exported.manifest.export_root)

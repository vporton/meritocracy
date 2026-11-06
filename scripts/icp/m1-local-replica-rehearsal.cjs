#!/usr/bin/env node
'use strict';

// M1-only, disposable rehearsal. It never reads DATABASE_URL, an env file, or
// any production configuration. All source writers are synthetic controls.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { canonicalRow } = require('./canonical-migration-vectors.cjs');

const image = 'postgres:16-alpine';
const container = `meritocracy-m1-${crypto.randomUUID()}`;
const password = crypto.randomBytes(24).toString('hex');
const report = path.join(os.tmpdir(), `meritocracy-m1-rehearsal-${crypto.randomUUID()}.json`);
let started = false;

function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function connect(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const client = new Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
    try { await client.connect(); return client; } catch (error) { await client.end().catch(() => {}); await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('disposable PostgreSQL did not become ready');
}

async function main() {
  if (process.env.M1_REHEARSAL_APPROVED !== 'yes') throw new Error('M1_REHEARSAL_APPROVED=yes is required');
  if (process.env.DATABASE_URL) throw new Error('DATABASE_URL must be unset: this runner accepts no source connection');
  docker('run', '--rm', '-d', '--name', container, '--label', 'meritocracy.m1.disposable=true', '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', image);
  started = true;
  const port = Number(docker('port', container, '5432/tcp').match(/:(\d+)$/m)?.[1]);
  assert(Number.isInteger(port) && port > 0, 'Docker did not expose a loopback PostgreSQL port');
  const db = await connect(port);
  try {
    await db.query('CREATE TABLE writer_control (name text PRIMARY KEY, state text NOT NULL CHECK (state IN (\'RUNNING\', \'STOPPED\'))); CREATE TABLE source_rows (id bigint PRIMARY KEY, display_name text NOT NULL, session_token text NOT NULL)');
    await db.query("INSERT INTO writer_control(name,state) VALUES ('legacy-api','RUNNING'),('legacy-cron','RUNNING'),('legacy-payment-sender','RUNNING')");
    await db.query("INSERT INTO source_rows(id,display_name,session_token) VALUES (42,'Alice','never-exported-synthetic-token')");

    // Drain protocol: the controlled in-flight write is rolled back, then all
    // explicitly inventoried writers are stopped before the snapshot begins.
    await db.query('BEGIN');
    await db.query("UPDATE source_rows SET display_name='Would-be write' WHERE id=42");
    await db.query('ROLLBACK');
    await db.query("UPDATE writer_control SET state='STOPPED'");
    const active = await db.query("SELECT name FROM writer_control WHERE state <> 'STOPPED'");
    assert.equal(active.rowCount, 0, 'writer freeze incomplete');

    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = await db.query('SELECT id, display_name FROM source_rows ORDER BY id');
    const snapshot = await db.query('SELECT txid_current_snapshot() AS snapshot');
    await db.query('COMMIT');
    const encoded = rows.rows.map((source) => canonicalRow({ table: 'source_rows', pk: { id: { $int: String(source.id) } }, row: { displayName: source.display_name, id: { $int: String(source.id) } } }));
    const sourceBytes = encoded.map((row) => JSON.stringify(row)).join('\n');
    assert(!sourceBytes.includes('token'), 'redaction failed');

    // A local staging/import model mirrors the M1 receipt rule: same key and
    // hash is a no-op; divergent bytes are a conflict; abort leaves legacy as
    // sole writer authority and does not activate ICP writes.
    const staged = new Map();
    const importChunk = (key, bytes) => {
      const hash = digest(bytes);
      const prior = staged.get(key);
      if (prior && prior !== hash) throw new Error('conflicting import receipt');
      staged.set(key, hash);
      return hash;
    };
    const chunkHash = importChunk('m1/source_rows/0', sourceBytes);
    assert.equal(importChunk('m1/source_rows/0', sourceBytes), chunkHash, 'identical import is not idempotent');
    assert.throws(() => importChunk('m1/source_rows/0', `${sourceBytes}!`), /conflicting/);
    staged.clear(); // abort before activation; no target writer ever became active
    await db.query("UPDATE writer_control SET state='STOPPED'");
    await db.query("UPDATE writer_control SET state='RUNNING' WHERE name='legacy-api'");
    const authority = await db.query("SELECT name FROM writer_control WHERE state='RUNNING'");
    assert.deepEqual(authority.rows.map((row) => row.name), ['legacy-api']);

    const evidence = {
      format: 'meritocracy-m1-local-replica-rehearsal-v1', image, rowCount: rows.rowCount,
      sourceHash: digest(sourceBytes), snapshotCaptured: Boolean(snapshot.rows[0].snapshot),
      writersStoppedBeforeSnapshot: 3, rollbackWriterAuthority: 'legacy-api',
      targetWritesActivated: false, secretValuesExported: false, receiptHash: chunkHash,
    };
    fs.writeFileSync(report, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`M1 local-replica rehearsal passed; restricted report: ${report}\n`);
  } finally { await db.end(); }
}

main().finally(() => { if (started) { try { docker('rm', '-f', container); } catch (_) {} } }).catch((error) => { process.stderr.write(`M1 rehearsal failed: ${error.message}\n`); process.exitCode = 1; });

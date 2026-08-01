#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const readJson = (relativePath) => JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8'));
const fail = (message) => {
  process.stderr.write(`dependency inventory: ${message}\n`);
  process.exitCode = 1;
};

const lockBytes = readFileSync(join(repositoryRoot, 'package-lock.json'));
const lock = JSON.parse(lockBytes.toString('utf8'));
const inventory = readJson('docs/icp/DEPENDENCY_INVENTORY.json');
const lockHash = createHash('sha256').update(lockBytes).digest('hex');

if (lock.lockfileVersion !== 3) fail(`expected npm lockfile version 3, got ${lock.lockfileVersion}`);
if (inventory.lockfile.sha256 !== lockHash) fail('package-lock.json hash differs from the reviewed inventory');
if (inventory.lockfile.packageEntries !== Object.keys(lock.packages).length) {
  fail('package-lock.json package-entry count differs from the reviewed inventory');
}

function resolvedVersion(packageName, workspace) {
  let current = workspace;
  while (true) {
    const packagePath = current ? `${current}/node_modules/${packageName}` : `node_modules/${packageName}`;
    const version = lock.packages[packagePath]?.version;
    if (version) return version;
    if (!current) return undefined;
    current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
  }
}

for (const workspace of ['', 'backend', 'frontend']) {
  const manifest = readJson(workspace ? `${workspace}/package.json` : 'package.json');
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [packageName, declaredVersion] of Object.entries(manifest[section] ?? {})) {
      const resolved = resolvedVersion(packageName, workspace);
      if (!resolved) fail(`${workspace || 'root'} ${packageName} is absent from package-lock.json`);
      if (declaredVersion !== resolved) {
        fail(`${workspace || 'root'} ${packageName} must be pinned to ${resolved}, found ${declaredVersion}`);
      }
    }
  }
}

const dockerfile = readFileSync(join(repositoryRoot, 'Dockerfile'), 'utf8');
if (!dockerfile.includes('RUN npm ci')) fail('Dockerfile must install the reviewed lockfile with npm ci');

if (inventory.highOrCritical.status !== 'BLOCKED_SHIPMENT') {
  fail('high/critical findings must block shipment until an accepted remediation is recorded');
}
const expectedFindingCount = inventory.highOrCritical.high + inventory.highOrCritical.critical;
if (inventory.highOrCritical.advisories.length !== expectedFindingCount) {
  fail('each high/critical advisory must have an individual recorded disposition');
}
for (const advisory of inventory.highOrCritical.advisories) {
  for (const field of ['package', 'severity', 'reachability', 'owner', 'containment', 'decision']) {
    if (!advisory[field]) fail(`advisory record is missing ${field}`);
  }
  if (!['high', 'critical'].includes(advisory.severity)) {
    fail(`${advisory.package} has an invalid high/critical advisory severity`);
  }
}

process.stdout.write(
  `Verified ${inventory.lockfile.packageEntries} lockfile entries and pinned workspace manifests. ` +
  `Shipment remains blocked by ${inventory.highOrCritical.high} high and ${inventory.highOrCritical.critical} critical findings.\n`,
);

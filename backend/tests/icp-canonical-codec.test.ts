import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applicationLogicalId,
  canonicalHash,
  canonicalJson,
  isSha256,
  sourceRecord,
  type CanonicalValue,
} from '../scripts/icp-canonical-codec.ts';
import vectors from '../../test/canonical-v1-vectors.json' with { type: 'json' };

type Vector = {
  name: string;
  value: CanonicalValue;
  canonicalJson: string;
  hash: string;
};

describe('M1 canonical migration vectors', () => {
  it('reproduces the committed byte and SHA-256 vectors', () => {
    for (const vector of vectors.values as Vector[]) {
      assert.equal(canonicalJson(vector.value), vector.canonicalJson, vector.name);
      assert.equal(canonicalHash(vector.value), vector.hash, vector.name);
      assert.equal(isSha256(vector.hash), true, vector.name);
    }
  });

  it('maps each source table and primary key to a stable application logical ID', () => {
    const record = sourceRecord({
      table: 'users',
      pk: { '$int': '42' },
      row: { name: 'Ada', onboarded: true },
    });
    assert.equal(record.sourceRowHash, vectors.sourceRecord.sourceRowHash);
    assert.equal(canonicalJson(record), vectors.sourceRecord.canonicalJson);
    assert.equal(applicationLogicalId(record.table, record.pk), vectors.sourceRecord.logicalId);
    assert.notEqual(applicationLogicalId('users', { '$int': '43' }), vectors.sourceRecord.logicalId);
  });

  it('rejects ambiguous JavaScript numbers, malformed tags, and unknown tags', () => {
    assert.throws(() => canonicalJson({ amount: 1 } as unknown as CanonicalValue), /numbers/);
    assert.throws(() => canonicalJson({ '$int': '01' }), /normalized/);
    assert.throws(() => canonicalJson({ '$f64': '3FF0000000000000' }), /lowercase/);
    assert.throws(() => canonicalJson({ '$unknown': 'x' }), /unknown/);
    assert.throws(() => canonicalJson(new Date() as unknown as CanonicalValue), /plain JSON records/);
  });
});

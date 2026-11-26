/*
 * Backend logic tests (runnable without any Cloudflare resource):
 *   - the /sync merge rules (READER-DESIGN §8.2)
 *   - the capability-key code format (§7)
 * Run:  ./node_modules/.bin/tsc -p worker/test/tsconfig.json
 *       node worker/test/backend-tests.cjs
 */
const path = require('path');
const assert = require('assert');

const { mergeRecords, shouldUpsert } = require(path.join(__dirname, 'dist', 'src', 'merge'));
const ck = require(path.join(__dirname, '..', '..', 'dist-smoke', 'lib', 'capabilityKey'));

// --- 1. Only-one-side → take it -------------------------------------------
const oneSided = mergeRecords(
  [{ id: 'a', updatedAt: 100 }],
  [{ id: 'b', updatedAt: 50 }],
);
assert.ok(oneSided.winners.has('a') && oneSided.winners.has('b'));
assert.equal(oneSided.conflicts.length, 0);
console.log('✓ both sides land when ids do not collide');

// --- 2. Newer wins, either direction ---------------------------------------
const newerRemote = mergeRecords([{ id: 'x', updatedAt: 100, v: 1 }], [{ id: 'x', updatedAt: 200, v: 2 }]);
assert.equal(newerRemote.winners.get('x').v, 2);
assert.ok(newerRemote.changedIds.has('x'));
const newerLocal = mergeRecords([{ id: 'x', updatedAt: 300, v: 3 }], [{ id: 'x', updatedAt: 200, v: 2 }]);
assert.equal(newerLocal.winners.get('x').v, 3);
assert.ok(!newerLocal.changedIds.has('x'));
console.log('✓ last-writer-wins by updatedAt in both directions');

// --- 3. Tombstone beats older live row: deletes propagate ------------------
const tombstone = { id: 'q1', updatedAt: 500, deletedAt: 500 };
const liveStale = { id: 'q1', updatedAt: 400 };
assert.equal(mergeRecords([liveStale], [tombstone]).winners.get('q1').deletedAt, 500);
assert.equal(mergeRecords([tombstone], [liveStale]).winners.get('q1').deletedAt, 500);
console.log('✓ tombstone survives both directions — deletes never resurrect');

// --- 4. Same-millisecond tie keeps both bodies and surfaces the conflict ---
const local1 = { id: 'e1', updatedAt: 700, text: 'from phone' };
const remote1 = { id: 'e1', updatedAt: 700, text: 'from laptop' };
const tie = mergeRecords([local1], [remote1]);
assert.equal(tie.winners.get('e1').text, 'from phone', 'local edit wins the tie');
assert.equal(tie.conflicts.length, 1, 'tie is surfaced, not discarded');
assert.equal(tie.conflicts[0].loser.text, 'from laptop');
console.log('✓ identical-ms edits keep both bodies and surface a conflict');

// --- 5. Server-side upsert guard -------------------------------------------
assert.equal(shouldUpsert(100, 200), true, 'strictly newer upserts');
assert.equal(shouldUpsert(200, 200), false, 'equal timestamps do not upsert');
assert.equal(shouldUpsert(300, 200), false, 'older pushes never overwrite');
console.log('✓ SQL upsert guard mirrored in code');

// --- 6. Capability codes: format, checksum, and round trip -----------------
(async () => {
  const identity = await ck.createIdentity();
  assert.match(identity.code, /^([0-9A-Z]{6}-){8}[0-9A-Z]$/, 'code is eight 6-char blocks plus a check block');
  assert.ok(ck.isCodeWellFormed(identity.code), 'generated code passes its own checksum');
  assert.ok(identity.key.length >= 40, 'key is sha-256 sized');

  const reopened = await ck.identityFromCode(identity.code);
  assert.equal(reopened.key, identity.key, 'the same code derives the same key on another device');

  const lowercase = await ck.identityFromCode(identity.code.toLowerCase());
  assert.equal(lowercase.key, identity.key, 'case-insensitive entry');
  const spaced = await ck.identityFromCode(identity.code.replace(/-/g, ' '));
  assert.equal(spaced.key, identity.key, 'separator-agnostic entry');

  const blocks = identity.code.split('-');
  const check = blocks[blocks.length - 1];
  const flipped = blocks.slice(0, 8).concat(check === '0' ? '1' : '0').join('-');
  assert.ok(!ck.isCodeWellFormed(flipped), 'a wrong check block is rejected');
  await assert.rejects(() => ck.identityFromCode(flipped), /mistyped/, 'wrong code throws with a helpful message');
  console.log('✓ link codes round-trip, normalize, and reject typos');

  console.log('\nAll backend logic tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

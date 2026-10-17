// The database-password helper must change only the DATABASE_URL line and encode awkward characters.
// Run: node --test tests/set-db-password.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { insertPassword } from '../scripts/set-db-password.mjs';

const BASE = 'postgres://tsdbadmin@db.example.test:32908/tsdb?sslmode=require';
const FILE = `GEMINI_API_KEY=abc\nDATABASE_URL=${BASE}\nAUTH_ENABLED=0\n`;

test('puts the password right after the user name and leaves every other line alone', () => {
  const r = insertPassword(FILE, 'secret1');
  assert.equal(r.changed, true);
  assert.equal(r.text, FILE.replace('tsdbadmin@', 'tsdbadmin:secret1@'));
});

test('encodes characters that would break the address', () => {
  const r = insertPassword(FILE, 'p@ss/w?rd#1:%');
  assert.equal(r.changed, true);
  const line = r.text.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  const url = new URL(line.slice('DATABASE_URL='.length));
  assert.equal(decodeURIComponent(url.password), 'p@ss/w?rd#1:%');
  assert.equal(url.hostname, 'db.example.test');
  assert.equal(url.port, '32908');
  assert.equal(url.pathname, '/tsdb');
  assert.equal(url.search, '?sslmode=require');
});

test('replaces an old password instead of adding a second one', () => {
  const once = insertPassword(FILE, 'old').text;
  const twice = insertPassword(once, 'new').text;
  assert.equal(twice, FILE.replace('tsdbadmin@', 'tsdbadmin:new@'));
});

test('keeps quotes and Windows line endings', () => {
  const text = `DATABASE_URL="${BASE}"\r\nOTHER=1\r\n`;
  const r = insertPassword(text, 'pw');
  assert.equal(r.text, `DATABASE_URL="postgres://tsdbadmin:pw@db.example.test:32908/tsdb?sslmode=require"\r\nOTHER=1\r\n`);
});

test('says why it did nothing, and changes nothing', () => {
  for (const [text, pw, word] of [
    ['OTHER=1\n', 'x', 'no DATABASE_URL'],
    ['DATABASE_URL=not an address\n', 'x', 'not a web-style'],
    ['DATABASE_URL=mysql://u@h/db\n', 'x', 'postgres://'],
    ['DATABASE_URL=postgres://host:1/db\n', 'x', 'no user name'],
    [FILE, '', 'No password'],
  ]) {
    const r = insertPassword(text, pw);
    assert.equal(r.changed, false);
    assert.equal(r.text, text);
    assert.ok(r.reason.includes(word), `${r.reason} should mention ${word}`);
  }
});

test('the message never contains the password', () => {
  const r = insertPassword('DATABASE_URL=nope\n', 'topsecretvalue');
  assert.ok(!r.reason.includes('topsecretvalue'));
});

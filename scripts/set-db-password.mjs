#!/usr/bin/env node
// Puts the database password into DATABASE_URL in server/.env, so nobody has to edit the line by hand.
// Run it yourself in a terminal (never through Claude):  node scripts/set-db-password.mjs
// It asks for the password with the typing hidden, changes only the DATABASE_URL line, and never prints
// the password or the address.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', '.env');

/**
 * `text` is the whole .env file. Returns { text, changed, reason }.
 * Only the DATABASE_URL line changes: the password goes right after the user name, percent-encoded.
 */
export function insertPassword(text, password) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (index < 0) return { text, changed: false, reason: 'There is no DATABASE_URL line in server/.env. Add the connection string from Tiger Data first.' };
  const eq = lines[index].indexOf('=');
  let value = lines[index].slice(eq + 1).trim();
  const quote = /^["']/.test(value) && value.at(-1) === value[0] ? value[0] : '';
  if (quote) value = value.slice(1, -1);
  let url;
  try {
    url = new URL(value);
  } catch {
    return { text, changed: false, reason: 'The DATABASE_URL line is not a web-style address. It should start with postgres:// and look like postgres://USER@HOST:PORT/DBNAME?sslmode=require.' };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return { text, changed: false, reason: 'DATABASE_URL should start with postgres://.' };
  if (!url.username) return { text, changed: false, reason: 'The DATABASE_URL line has no user name after postgres://.' };
  if (!password) return { text, changed: false, reason: 'No password was typed.' };
  url.password = encodeURIComponent(password); // the URL class leaves "%" alone, so encode it ourselves
  lines[index] = `${lines[index].slice(0, eq + 1)}${quote}${url.toString()}${quote}`;
  return { text: lines.join(text.includes('\r\n') ? '\r\n' : '\n'), changed: true, reason: '' };
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Run this in a normal terminal window, not through a pipe.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let typed = '';
    const done = (fn, value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      fn(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(resolve, typed);
        if (ch === '\u0003') return done(reject, new Error('Cancelled. Nothing was changed.'));
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  let text;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    console.log('There is no server/.env file yet. Make it first: Copy-Item .env.example server\\.env');
    return 1;
  }
  console.log('Type or paste the database password. Nothing shows while you type. Press Enter when done.');
  const password = (await askHidden('Password: ')).trim();
  const result = insertPassword(text, password);
  if (!result.changed) {
    console.log(`Nothing was changed. ${result.reason}`);
    return 1;
  }
  writeFileSync(ENV_FILE, result.text);
  console.log('Done: the password is now in the DATABASE_URL line of server/.env (not shown here).');
  console.log('Close the .env tab in your editor if it is open, then tell the main laptop it is done.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (err) => { console.log(err.message); process.exit(1); });
}

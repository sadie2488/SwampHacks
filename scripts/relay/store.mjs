// Tiny JSON key-value store for the relay's state (questions, rate limit, inbox). Files live in scratch/relay (git-ignored).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  path(name) {
    return join(this.dir, `${name}.json`);
  }
  read(name, fallback = null) {
    try {
      return existsSync(this.path(name)) ? JSON.parse(readFileSync(this.path(name), 'utf8')) : fallback;
    } catch {
      return fallback;
    }
  }
  write(name, value) {
    mkdirSync(join(this.path(name), '..'), { recursive: true });
    const tmp = `${this.path(name)}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, this.path(name)); // never leaves a half-written file behind
  }
  remove(name) {
    rmSync(this.path(name), { force: true });
  }
  list(prefix) {
    const dir = join(this.dir, prefix);
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `${prefix}/${f.slice(0, -5)}`).sort() : [];
  }
}

export class MemoryStore {
  constructor() {
    this.data = new Map();
  }
  read(name, fallback = null) {
    return this.data.has(name) ? structuredClone(this.data.get(name)) : fallback;
  }
  write(name, value) {
    this.data.set(name, structuredClone(value));
  }
  remove(name) {
    this.data.delete(name);
  }
  list(prefix) {
    return [...this.data.keys()].filter((k) => k.startsWith(`${prefix}/`)).sort();
  }
}

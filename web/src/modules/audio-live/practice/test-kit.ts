// Helpers for the tests in this folder: the demo song, and a small checker that validates a Feedback against the real
// contracts/feedback.schema.json (only the schema keywords that file uses; ajv is not a dependency of web/).
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SongAnalysis } from '@/contracts';
import { melodyOf } from './melody';

export const song = twinkle as unknown as SongAnalysis;
export const expectedTwinkle = melodyOf(song);

interface Schema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  format?: string;
}

const feedbackSchema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../contracts/feedback.schema.json', import.meta.url)), 'utf8')) as Schema;

function check(value: unknown, schema: Schema, path: string, problems: string[]): void {
  if (schema.const !== undefined && value !== schema.const) problems.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') problems.push(`${path}: must be a string`);
      else if (schema.format === 'date-time' && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(value)) problems.push(`${path}: not a date-time`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') problems.push(`${path}: must be true or false`);
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${path}: must be a number`);
      else {
        if (schema.type === 'integer' && !Number.isInteger(value)) problems.push(`${path}: must be a whole number`);
        if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: below ${schema.minimum}`);
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) problems.push(`${path}: must be above ${schema.exclusiveMinimum}`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) problems.push(`${path}: must be a list`);
      else {
        if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: too short`);
        if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path}: too long`);
        if (schema.items) value.forEach((v, i) => check(v, schema.items!, `${path}[${i}]`, problems));
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) problems.push(`${path}: must be an object`);
      else {
        for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key}: missing`);
        for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in value) check((value as Record<string, unknown>)[key], sub, `${path}.${key}`, problems);
      }
      break;
  }
}

/** Everything wrong with this Feedback according to contracts/feedback.schema.json (an empty list means valid). */
export function feedbackProblems(fb: unknown): string[] {
  const problems: string[] = [];
  check(fb, feedbackSchema, 'feedback', problems);
  return problems;
}

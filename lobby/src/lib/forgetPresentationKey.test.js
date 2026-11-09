import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgetPresentationKey, PRESENTATION_KEY_DB } from './forgetPresentationKey.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('the archived presentation\'s saved key (2026-11-09)', () => {
  it('deletes exactly the presentation key database and nothing else', () => {
    const asked = [];
    forgetPresentationKey({ deleteDatabase: (name) => asked.push(name) });
    expect(asked).toEqual(['awanaPresentationKey']);
    expect(PRESENTATION_KEY_DB).toBe('awanaPresentationKey');
  });

  it('is the same name the presentation page stored it under', () => {
    const app = readFileSync(resolve(here, '../../../site/presentation/app.js'), 'utf8');
    expect(app).toContain(`indexedDB.open('${PRESENTATION_KEY_DB}'`);
  });

  it('never throws: no IndexedDB, or one that refuses', () => {
    expect(() => forgetPresentationKey(undefined)).not.toThrow();
    expect(() => forgetPresentationKey({ deleteDatabase: () => { throw new Error('blocked'); } })).not.toThrow();
  });

  it('runs once at the lobby page\'s start', () => {
    const main = readFileSync(resolve(here, '../main.jsx'), 'utf8');
    expect(main).toMatch(/import \{ forgetPresentationKey \} from '\.\/lib\/forgetPresentationKey\.js';/);
    expect(main).toMatch(/\nforgetPresentationKey\(\);\n/);
  });
});

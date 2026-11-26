// @ts-check
// Backwards Night (owner 2026-11-23; rules shared/backwards.js): is tonight a
// backwards night? Mode `auto` (the church calendar's event says "backwards")
// / `on` / `off`, storage `theme:backwards`, /settings → Tonight →
// "Backwards Night". GET /v1/theme answers every screen; PUT changes the mode
// and rings `changed {what: 'theme', backwards}` so screens switch at once.
// The desk's roster and the TwoTimTwo-page jobs carry it to the name tags
// (`awanaBackwards` on the /print body). routes.md 10.22.

import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { DOORBELL_EVENT, frameText } from './live.js';
import { localTime } from './watcher.js';
import { BACKWARDS_MODES, calendarSaysBackwards } from '../../shared/backwards.js';

export class Theme {
  /** @param {{ storage: any, now: () => number }} deps */
  constructor({ storage, now }) {
    this.storage = storage;
    this.now = now;
    this.doc = new Doc(storage, 'theme:backwards', () => ({ mode: 'auto', at: null, by: null, date: null }));
    /** @type {{ date: string, says: boolean, at: number }|null} */
    this.cal = null;
  }

  get mode() {
    const d = this.doc.data;
    const m = d && d.mode;
    if (!BACKWARDS_MODES.includes(m)) return 'auto';
    // On lasts for the Eastern day it was set (IP-20261125-05); an On with no date, or from an earlier day, is Automatic.
    if (m === 'on' && !(d.date && d.date === localTime(this.now()).date)) return 'auto';
    return m;
  }

  async prepare() {
    await this.doc.load();
    const today = localTime(this.now()).date;
    if (!this.cal || this.cal.date !== today || this.now() - this.cal.at > 10 * 60 * 1000) {
      let feed;
      try { feed = await this.storage.get('calendar'); } catch { feed = null; }
      this.cal = { date: today, says: calendarSaysBackwards(feed, today), at: this.now() };
    }
  }

  /** Is it Backwards Night (sync; after prepare())? */
  backwards() {
    const m = this.mode;
    if (m === 'on') return true;
    if (m === 'off') return false;
    return !!this.cal && this.cal.date === localTime(this.now()).date && this.cal.says;
  }

  view() {
    return {
      backwards: this.backwards(),
      mode: this.mode,
      calendarSaysBackwards: !!this.cal && this.cal.says,
      changedAt: this.doc.data ? this.doc.data.at : null,
      changedBy: this.doc.data ? this.doc.data.by : null,
    };
  }

  /** @param {unknown} mode @param {any} by */
  async setMode(mode, by) {
    await this.doc.load();
    if (typeof mode !== 'string' || !BACKWARDS_MODES.includes(mode)) return null;
    const d = this.doc.data;
    d.mode = mode;
    d.date = mode === 'on' ? localTime(this.now()).date : null;
    d.at = new Date(this.now()).toISOString();
    d.by = by && typeof by.name === 'string' ? { name: by.name.slice(0, 60) } : null;
    await this.doc.save();
    return this.view();
  }
}

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountTheme(registry, core) {
  registry.add('GET', '/v1/theme', 'session', async () => {
    await core.theme.prepare();
    return json(core.theme.view());
  });
  registry.add('PUT', '/v1/theme', 'session', async ({ body, request }) => {
    const b = await body();
    await core.theme.prepare();
    const name = request.headers.get('X-Device-Name');
    const v = await core.theme.setMode(b && b.mode, { name: name ? String(name) : null });
    if (!v) return fail('Mode must be auto, on or off.', 400, { reason: 'bad-mode' });
    core.broadcast(frameText(DOORBELL_EVENT, { what: 'theme', backwards: v.backwards }));
    return json(v);
  });
}

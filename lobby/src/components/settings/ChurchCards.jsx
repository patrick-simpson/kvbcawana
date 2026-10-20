import { useEffect, useId, useRef, useState } from 'react';
import { useSync } from '../../hooks/useSync.js';
import { loadSyncSession } from '../../lib/syncService.js';
import { CHURCH_SPEC, churchValue, PAUSED_WORDS, UNSEEDED_WORDS } from '../../lib/churchClient.js';
import { CLUB_TABLE } from '../../../../shared/clubs.js';
import {
  NAME_SIZE_MAX, NAME_SIZE_MIN, PICKUP_CLUBS, cleanScheduleRows, formToTemplate, pickupTicked, probePrintServer, callPrintServer,
  TEMPLATE_FIELDS, templateClubLabel, templateToForm, validStartTime, withTemplate,
} from '../../lib/printServer.js';
import { churchNight } from '../../../../shared/cloud-crypto.js';
import { fetchNightRows, historyUnlocked, unlockHistory } from '../../lib/historyCrypto.js';
import { customRecord, leaderRecord, oneOffRecord, reprintRecord, sendToolJob } from '../../lib/toolJobs.js';
import { BarfBagsField, FriendsListField, PanelCard, Toggle } from './fields.jsx';
import '../../styles/laptop.css';
import '../../styles/settings-overhaul.css';

// The Printing section's church-wide cards (docs/SETTINGS-OVERHAUL.md 2.5):
// the laptop's labels, schedule, pickup list and BARF Night, edited from any
// device through the Worker's church document (routes.md 10.3), plus the tools
// that start a print job from anywhere (a reprint, a name tag) sealed in the
// browser (toolJobs.js). Each C card saves on change (toggles) or on Save
// (typed fields, the schedule, the templates) against the revision it shows;
// a stale 409 puts the newer document in and keeps what was typed.
//
// Every limit below (lengths, row counts, ranges) is read from the ONE church
// settings table, shared/churchSettings.js CHURCH_SPEC, which the Worker and
// the print station clean with too; PRINTING_FIELDS says which card holds
// each of its keys (churchCards.test.jsx pins it to CHURCH_KEYS).

/**
 * Where each church setting (CHURCH_KEYS, routes.md 10.3) is edited on the
 * page: every key once. `seasonTheme` is the one Season select in Slides &
 * look (lib/season.js writes it with the screens' own theme).
 * `enableDrivenCheckin` is listed but shown nowhere: it switched the Chrome
 * extension's own TwoTimTwo check-ins, and the extension is gone (KVBC Awana
 * 10.0.0). The key stays in the shared table (three apps read it) and nothing
 * acts on it.
 */
export const PRINTING_FIELDS = Object.freeze({
  labelFooter: 'Labels',
  firstTimerInverted: 'Labels',
  trophyBand: 'Labels',
  connectCard: 'Labels',
  connectCardAutoFirstTimer: 'Labels',
  connectCardGreeting: 'Labels',
  enableDrivenCheckin: '(not shown: retired with the extension)',
  labelTemplates: 'Each club’s label',
  schedule: 'Club night schedule',
  lateGraceMin: 'Club night schedule',
  pickupClubs: 'Pickup list',
  barfNights: 'BARF Night',
  leaders: 'Name tags and labels',
  seasonTheme: 'Slides & look → Season',
});

const SPEC = /** @type {any} */ (CHURCH_SPEC);
/** The template clubs: `default` plus every club key (shared/clubs.js). */
const TEMPLATE_CLUBS = CLUB_TABLE.map((c) => c.key);
/** A leader chip is shown while printed within this many days (the print server's LEADER_ACTIVE_DAYS). */
export const LEADER_ACTIVE_DAYS = 270;

/** One line of feedback under a control, announced politely. */
function Note({ note }) {
  if (!note) return null;
  return <span className={`hint laptop-note${note.bad ? ' hint--warn' : ''}`} role="status">{note.text}</span>;
}

/** Saves a set of keys and words the answer. @returns {(changes: Record<string, any>) => Promise<{text: string, bad?: boolean, stale?: any}>} */
function useSaver(church) {
  return async (changes) => {
    const r = await church.save(changes);
    if (r.ok) return { text: 'Saved.' };
    // `stale`: the newer document, for a card whose draft is a whole list that must be rebuilt over it.
    return { bad: true, text: r.message, ...(r.kind === 'stale' ? { stale: r.doc } : {}) };
  };
}

/** The card's draft of a typed value: the document's until the person types, theirs after (kept across a stale reload). */
function useDraft(docValue) {
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  return { value: draft ?? docValue, dirty: draft !== null, set: setDraft, clear: () => setDraft(null) };
}

/** Before the seed, or while paused: the C cards read-only, with the one way forward. */
export function ChurchGate({ church }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (church.state === 'ready') return null;
  if (church.state === 'loading') {
    return (
      <PanelCard title="Printing settings" tab="var(--brand-blue)">
        <p className="hint" role="status">{church.error || 'Reading the printing settings…'}</p>
        {church.error && <button type="button" className="ghost small" onClick={church.reload}>Try again</button>}
      </PanelCard>
    );
  }
  if (church.state === 'paused') {
    return (
      <PanelCard title="Printing settings" tab="var(--brand-blue)">
        <p className="hint hint--warn" role="status">{PAUSED_WORDS} The cards below are read-only.</p>
      </PanelCard>
    );
  }
  const start = async () => {
    if (!window.confirm('Start the printing settings from the defaults instead of waiting for the check-in laptop?\n\nThe laptop will then follow these. Anything it had set (the footer, the schedule, the pickup clubs) is replaced by what you save here.')) return;
    setBusy(true);
    const r = await church.seedFromDefaults();
    setBusy(false);
    setNote(r.ok ? '' : r.message);
  };
  return (
    <PanelCard title="Printing settings" tab="var(--brand-blue)">
      <p className="hint hint--warn" role="status">{UNSEEDED_WORDS} The cards below are read-only until then.</p>
      <button type="button" className="ghost section-jump" onClick={start} disabled={busy}>Start from defaults instead</button>
      {note && <span className="hint hint--warn" role="status">{note}</span>}
    </PanelCard>
  );
}

/** Labels: footer, visitor palette, trophy band, connect card. */
export function LabelsCard({ church }) {
  const id = useId();
  const readOnly = church.state !== 'ready';
  const save = useSaver(church);
  const [note, setNote] = useState(/** @type {any} */ (null));
  const footer = useDraft(churchValue(church.doc, 'labelFooter'));
  const greeting = useDraft(churchValue(church.doc, 'connectCardGreeting'));
  // The draft is let go only once the save landed: after a stale 409 the typing stays, over the newer document.
  const apply = async (changes, after) => { const r = await save(changes); setNote(r); if (!r.bad) after?.(); };
  const toggle = (key, title, hint) => (
    <Toggle
      title={title} hint={hint} disabled={readOnly} checked={Boolean(churchValue(church.doc, key))}
      onChange={(e) => apply({ [key]: e.target.checked })}
    />
  );
  return (
    <PanelCard title="Labels" tab="var(--brand-tnt)">
      <div className="field">
        <label htmlFor={`${id}-footer`}>Label footer</label>
        <input
          id={`${id}-footer`} type="text" maxLength={SPEC.labelFooter.max} value={footer.value} disabled={readOnly}
          placeholder="KVBC Awana · Wednesdays 6:15–8:00pm"
          onChange={(e) => footer.set(e.target.value)}
          onBlur={() => footer.dirty && apply({ labelFooter: footer.value.trim() }, footer.clear)}
        />
        <span className="hint">One line along the bottom of every name tag.</span>
      </div>
      {toggle('firstTimerInverted', 'Visitor labels use the black palette')}
      {toggle('trophyBand', 'Band the next label of a child who finished a handbook')}
      {toggle('connectCard', 'Print a connect card for visitors', 'A second label with a welcome for first-time families.')}
      {toggle('connectCardAutoFirstTimer', 'Print it automatically on a first-ever check-in')}
      <div className="field">
        <label htmlFor={`${id}-greeting`}>Connect card greeting</label>
        <input
          id={`${id}-greeting`} type="text" maxLength={SPEC.connectCardGreeting.max} value={greeting.value} disabled={readOnly}
          placeholder="We’re so glad you’re here!"
          onChange={(e) => greeting.set(e.target.value)}
          onBlur={() => greeting.dirty && apply({ connectCardGreeting: greeting.value.trim() }, greeting.clear)}
        />
      </div>
      <Note note={note} />
    </PanelCard>
  );
}

/** Each club's label: six toggles and a name size cap per club, saved with the layouts. */
export function ClubLabelCard({ church }) {
  const id = useId();
  const readOnly = church.state !== 'ready';
  const save = useSaver(church);
  const docTemplates = churchValue(church.doc, 'labelTemplates') || {};
  const draft = useDraft(docTemplates);
  const [club, setClub] = useState('default');
  const [note, setNote] = useState(/** @type {any} */ (null));
  // The clubs this card's draft changed: after a stale 409 only these are laid over the newer document.
  const changedClubs = useRef(/** @type {Set<string>} */ (new Set()));
  const [preview, setPreview] = useState(/** @type {{ url?: string, text?: string } | null} */ (null));
  const all = draft.value;
  const form = templateToForm(all[club]);

  const edit = (patch) => {
    const t = formToTemplate({ ...form, ...patch });
    draft.set(withTemplate(all, club, Object.keys(t).length ? { version: 1, ...t } : {}));
    changedClubs.current.add(club);
    setNote(null);
  };
  const saveAll = async () => {
    const hasAny = Object.keys(all).length > 0;
    const r = await save({ labelTemplates: hasAny ? all : null });
    setNote(r);
    if (!r.bad) { draft.clear(); changedClubs.current.clear(); }
    else if (r.stale) {
      // Someone else's layouts are in the newer document: keep THEIRS, with only the clubs edited here on top.
      let merged = churchValue(r.stale, 'labelTemplates') || {};
      for (const k of changedClubs.current) merged = withTemplate(merged, k, all[k] || {});
      draft.set(merged);
    }
  };
  const showPreview = async () => {
    setPreview({ text: 'Looking for the check-in laptop…' });
    const probe = await probePrintServer();
    if (!probe.found) { setPreview({ text: 'Preview on the check-in laptop: open this page there to see the label.' }); return; }
    const q = new URLSearchParams({ firstName: 'Maya', template: JSON.stringify(all[club] || {}) });
    if (club !== 'default') q.set('clubName', club);
    const r = await callPrintServer(`/preview?${q}`, { session: loadSyncSession(), raw: true });
    if (r.ok) setPreview({ url: URL.createObjectURL(r.data) });
    else setPreview({ text: r.error });
  };
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  return (
    <PanelCard title="Each club’s label" tab="var(--brand-orange)">
      <div className="field">
        <label htmlFor={`${id}-club`}>Club</label>
        <select id={`${id}-club`} value={club} onChange={(e) => { setClub(e.target.value); setPreview(null); }}>
          <option value="default">Default (all clubs)</option>
          {TEMPLATE_CLUBS.map((k) => <option key={k} value={k}>{templateClubLabel(k)}</option>)}
        </select>
      </div>
      {TEMPLATE_FIELDS.map(([f, label]) => (
        <Toggle key={f} title={label} checked={form[f]} disabled={readOnly} onChange={(e) => edit({ [f]: e.target.checked })} />
      ))}
      <div className="field">
        <label htmlFor={`${id}-size`}>Name size cap: {form.nameMaxPt >= NAME_SIZE_MAX ? 'none' : `${form.nameMaxPt} pt`}</label>
        <input
          id={`${id}-size`} type="range" min={NAME_SIZE_MIN} max={NAME_SIZE_MAX} value={form.nameMaxPt} disabled={readOnly}
          onChange={(e) => edit({ nameMaxPt: Number(e.target.value) })}
        />
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={saveAll} disabled={readOnly || !draft.dirty}>Save label layouts</button>
        <button type="button" className="ghost" disabled={readOnly} onClick={() => edit({ ...templateToForm({}) })}>Reset this club</button>
        <button type="button" className="ghost" onClick={showPreview}>Show a preview</button>
      </div>
      <Note note={note} />
      {preview?.url && <img className="laptop-label" src={preview.url} alt="Label preview for Maya" width="384" />}
      {preview?.text && <p className="hint" role="status">{preview.text}</p>}
    </PanelCard>
  );
}

/** Club night: the schedule rows and the late grace. */
export function ClubNightCard({ church }) {
  const id = useId();
  const readOnly = church.state !== 'ready';
  const save = useSaver(church);
  const rows = useDraft(churchValue(church.doc, 'schedule') || []);
  const late = useDraft(String(churchValue(church.doc, 'lateGraceMin') ?? 10));
  const [note, setNote] = useState(/** @type {any} */ (null));
  const setRow = (i, patch) => rows.set(rows.value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const saveSchedule = async () => {
    const clean = cleanScheduleRows(rows.value);
    if (clean.some((r) => !validStartTime(r.startTime))) { setNote({ bad: true, text: 'A start time reads like 6:30.' }); return; }
    const rule = SPEC.lateGraceMin;
    const grace = Math.max(rule.min, Math.min(rule.max, Math.round(Number(late.value) || 0)));
    const r = await save({ schedule: clean, lateGraceMin: grace });
    setNote(r.bad ? r : { text: 'Schedule saved.' });
    if (!r.bad) { rows.clear(); late.clear(); }
    else if (r.stale) {
      // The rows are one list: resaving ours would overwrite the other device's edit. Show theirs and ask again.
      rows.clear(); late.clear();
      setNote({ bad: true, text: 'Reloaded — someone else changed the schedule. Apply your change again.' });
    }
  };
  return (
    <PanelCard title="Club night schedule" tab="var(--brand-journey)">
      <p className="hint">
        One row per slot of the night. A child who checks in late is sent to their club’s slot that started last:
        “Go to: Games, Fellowship Hall”. With no rows the church’s 2026-27 schedule is used.
      </p>
      <div className="laptop-schedule" role="group" aria-label="Club schedule">
        {rows.value.map((r, i) => (
          <div className="laptop-schedule__row" key={i}>
            <input type="text" aria-label={`Row ${i + 1} club`} placeholder="Sparks" value={r.club || ''} disabled={readOnly} maxLength={SPEC.schedule.club} onChange={(e) => setRow(i, { club: e.target.value })} />
            <input type="text" aria-label={`Row ${i + 1} starts`} placeholder="6:30" value={r.startTime || ''} disabled={readOnly} maxLength={5} onChange={(e) => setRow(i, { startTime: e.target.value })} />
            <input type="text" aria-label={`Row ${i + 1} activity`} placeholder="Games" value={r.location || ''} disabled={readOnly} maxLength={SPEC.schedule.location} onChange={(e) => setRow(i, { location: e.target.value })} />
            <input type="text" aria-label={`Row ${i + 1} place`} placeholder="Fellowship Hall" value={r.room || ''} disabled={readOnly} maxLength={SPEC.schedule.room} onChange={(e) => setRow(i, { room: e.target.value })} />
            <button type="button" className="ghost" aria-label={`Remove row ${i + 1}`} disabled={readOnly} onClick={() => rows.set(rows.value.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div className="laptop-actions">
          <button type="button" className="ghost" disabled={readOnly || rows.value.length >= SPEC.schedule.maxRows} onClick={() => rows.set([...rows.value, { club: '', startTime: '', location: '', room: '' }])}>Add a slot</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-late`}>Late grace (minutes)</label>
        <input id={`${id}-late`} type="number" min={SPEC.lateGraceMin.min} max={SPEC.lateGraceMin.max} value={late.value} disabled={readOnly} onChange={(e) => late.set(e.target.value)} />
        <span className="hint">How long after a club starts a check-in still counts as on time.</span>
      </div>
      <div className="laptop-actions">
        <button type="button" className="primary" onClick={saveSchedule} disabled={readOnly || !(rows.dirty || late.dirty)}>Save schedule</button>
      </div>
      <Note note={note} />
    </PanelCard>
  );
}

/** Pickup list: six club boxes. */
export function PickupListCard({ church }) {
  const readOnly = church.state !== 'ready';
  const save = useSaver(church);
  const [note, setNote] = useState(/** @type {any} */ (null));
  const ticked = pickupTicked(churchValue(church.doc, 'pickupClubs'));
  const toggle = async (club, on) => {
    const next = PICKUP_CLUBS.filter((c) => (c === club ? on : ticked.includes(c)));
    const r = await save({ pickupClubs: next });
    setNote(r.bad ? r : { text: 'Saved. The pickup list follows it within a minute.' });
  };
  return (
    <PanelCard title="Pickup list" tab="var(--brand-cubbies)">
      <p className="hint">Clubs whose children appear on the lobby’s still-here list at pickup.</p>
      <div className="laptop-clubs" role="group" aria-label="Clubs on the pickup list">
        {PICKUP_CLUBS.map((c) => (
          <label key={c} className="laptop-club">
            <input type="checkbox" checked={ticked.includes(c)} disabled={readOnly} onChange={(e) => toggle(c, e.target.checked)} />
            {c}
          </label>
        ))}
      </div>
      <Note note={note} />
    </PanelCard>
  );
}

/** BARF Night: the nights, tonight's list and the bag labels. */
export function BarfNightCard({ church }) {
  const id = useId();
  const readOnly = church.state !== 'ready';
  const save = useSaver(church);
  const [note, setNote] = useState(/** @type {any} */ (null));
  const [date, setDate] = useState('');
  const nights = churchValue(church.doc, 'barfNights') || [];
  const write = async (next) => {
    const r = await save({ barfNights: next.length ? next : null });
    setNote(r.bad ? r : { text: 'Saved.' });
  };
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setNote({ bad: true, text: 'Pick a date.' }); return; }
    if (nights.includes(date)) { setNote({ bad: true, text: 'That night is already on the list.' }); return; }
    if (nights.length >= SPEC.barfNights.max) { setNote({ bad: true, text: `That is as many nights as the list holds (${SPEC.barfNights.max}).` }); return; }
    write([...nights, date].sort());
    setDate('');
  };
  return (
    <PanelCard title="BARF Night" tab="var(--brand-sparks)">
      <p className="hint">The nights BARF Night runs. Tonight’s list and the bag labels work on those nights.</p>
      {nights.length > 0 && (
        <ul className="barf-nights">
          {nights.map((n) => (
            <li key={n}>
              <span>{n}</span>
              <button type="button" className="ghost small" disabled={readOnly} aria-label={`Remove ${n}`} onClick={() => write(nights.filter((x) => x !== n))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor={`${id}-date`}>Add a night</label>
        <div className="display-key-row">
          <input id={`${id}-date`} type="date" value={date} disabled={readOnly} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="ghost" disabled={readOnly || !date} onClick={add}>Add</button>
        </div>
      </div>
      <Note note={note} />
      <FriendsListField />
      <BarfBagsField />
    </PanelCard>
  );
}

/** A child on tonight's list, from an opened history row. */
function reprintable(rows) {
  const seen = new Set();
  const out = [];
  for (const r of [...rows].reverse()) {
    if (!['checkin', 'visitor', 'import-checkin', 'reprint'].includes(r.kind)) continue;
    const rec = r.record || {};
    const first = typeof rec.first === 'string' ? rec.first : '';
    if (!first) continue;
    const last = typeof rec.last === 'string' ? rec.last : '';
    const key = `${rec.clubberId || ''}|${first}|${last}|${rec.club || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, first, last, club: typeof rec.club === 'string' ? rec.club : '', clubberId: rec.clubberId ? String(rec.clubberId) : null, ts: Number(rec.ts) || 0 });
  }
  return out.slice(0, 30);
}

/** Tonight's prints: the rows that reached the history (opened with the passphrase), a Reprint on each. */
export function TonightsPrintsCard() {
  const { signedIn, url } = useSync();
  const session = loadSyncSession();
  const [unlocked, setUnlocked] = useState(historyUnlocked());
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(/** @type {any} */ (null));
  const [note, setNote] = useState(/** @type {any} */ (null));
  const [sending, setSending] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!unlocked || !signedIn || !url) return undefined;
    let live = true;
    fetchNightRows(url, session, churchNight(Date.now())).then((res) => {
      if (!live) return;
      if (res.ok) setState({ people: reprintable(res.rows) });
      else setNote({ bad: true, text: res.message });
    });
    return () => { live = false; };
  }, [unlocked, signedIn, url, session, round]);

  const open = async () => {
    setBusy(true);
    const res = await unlockHistory(url, session, pass);
    setBusy(false);
    setPass('');
    if (res.ok) { setNote(null); setUnlocked(true); } else setNote({ bad: true, text: res.message });
  };
  const reprint = async (p) => {
    if (!window.confirm(`Reprint ${p.first}’s label?`)) return;
    setSending(p.key);
    setNote(null);
    const r = await sendToolJob(reprintRecord({ name: `${p.first} ${p.last}`.trim(), clubberId: p.clubberId }), { historyRow: { first: p.first, last: p.last, club: p.club } });
    setSending('');
    setNote(r.ok ? { text: `Sent ${p.first}’s label to the printer.${r.history === 'failed' ? ' (It could not be added to the history.)' : ''}` } : { bad: true, text: r.message });
    if (r.ok) setRound((n) => n + 1);
  };

  return (
    <PanelCard title="Tonight’s prints" tab="var(--brand-sun)">
      {!signedIn && <p className="hint">Sign in under Account &amp; app to see tonight’s prints.</p>}
      {signedIn && !unlocked && (
        <form className="hist-unlock" onSubmit={(e) => { e.preventDefault(); if (pass.trim() && !busy) open(); }}>
          <div className="field">
            <label htmlFor="prints-pass">Passphrase</label>
            <input id="prints-pass" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
            <span className="hint">Children’s names are sealed. The passphrase opens them in this browser only; it is never sent for this, and never saved.</span>
          </div>
          <button type="submit" className="ghost section-jump" disabled={busy || !pass.trim()}>{busy ? 'Opening…' : 'Open the names'}</button>
        </form>
      )}
      {unlocked && !state && !note && <p className="hint" role="status">Opening…</p>}
      {state && state.people.length === 0 && <p className="hint">Nothing has printed through the service tonight yet.</p>}
      {state && state.people.length > 0 && (
        <ul className="laptop-history">
          {state.people.map((p) => (
            <li key={p.key}>
              <span className="laptop-history__who"><strong>{p.first} {p.last}</strong></span>
              <span className="hint">{p.club}</span>
              <button type="button" className="ghost" disabled={sending !== ''} aria-label={`Reprint ${p.first}`} onClick={() => reprint(p)}>
                {sending === p.key ? 'Sending…' : 'Reprint'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Note note={note} />
    </PanelCard>
  );
}

/**
 * The remembered leaders worth a chip: printed within LEADER_ACTIVE_DAYS,
 * newest first (the 270-day filter is a reader's rule, routes.md 10.3).
 * @param {any} list @param {number} [now]
 */
export function activeLeaders(list, now = Date.now()) {
  const cutoff = now - LEADER_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return (Array.isArray(list) ? list : [])
    .filter((l) => l && (l.firstName || l.lastName) && Number(l.lastPrintedAt) >= cutoff)
    .sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
}

const leaderName = (l) => `${l.firstName || ''} ${l.lastName || ''}`.trim();
const leaderKeyOf = (l) => leaderName(l).toLowerCase().replace(/\s+/g, ' ');

/** Name tags and labels, from anywhere: a leader tag, a one-off tag, a custom label. */
export function NameTagsCard({ church }) {
  const id = useId();
  const { signedIn } = useSync();
  const [name, setName] = useState('');
  const [leaderClub, setLeaderClub] = useState('');
  const [first, setFirst] = useState('');
  const [oneOffClub, setOneOffClub] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState(/** @type {Record<string, any>} */ ({}));
  const say = (k, v) => setNotes((n) => ({ ...n, [k]: v }));
  const chips = activeLeaders(church ? churchValue(church.doc, 'leaders') : []);
  const canForget = church?.state === 'ready';

  // Forget = a church edit of the WHOLE list against the revision shown; a
  // stale 409 re-reads (useChurch puts the newer list in) and tries once more.
  const forget = async (l) => {
    const who = leaderName(l);
    if (!window.confirm(`Forget ${who}? Their chip goes away on every device; their next tag brings it back.`)) return;
    const key = leaderKeyOf(l);
    say('leader', null);
    for (let tries = 0; tries < 2; tries += 1) {
      let gone = false;
      const r = await church.save((settings) => {
        const list = Array.isArray(settings.leaders) ? settings.leaders : [];
        const next = list.filter((x) => leaderKeyOf(x) !== key);
        gone = next.length === list.length;
        return gone ? null : { leaders: next };
      });
      if (gone) { say('leader', { text: `${who} is already forgotten.` }); return; }
      if (r.ok) { say('leader', { text: `Forgot ${who}.` }); return; }
      if (r.kind !== 'stale') { say('leader', { bad: true, text: r.message }); return; }
    }
    say('leader', { bad: true, text: 'Someone else changed the leaders a moment ago; check and try again.' });
  };
  const pick = (l) => {
    setName(leaderName(l));
    setLeaderClub(PICKUP_CLUBS.includes(l.clubName) ? l.clubName : '');
  };

  const run = async (kind, record, done, okText) => {
    setBusy(kind);
    say(kind, null);
    const r = await sendToolJob(record);
    setBusy('');
    if (r.ok) { say(kind, { text: r.existing ? 'That one was already on its way.' : okText }); done(); } else say(kind, { bad: true, text: r.message });
  };
  const leader = () => {
    const who = name.trim();
    if (!who) return say('leader', { bad: true, text: 'Type the leader’s name first.' });
    if (!window.confirm(`Print a leader tag for ${who}?`)) return null;
    return run('leader', leaderRecord({ name: who, clubName: leaderClub }), () => setName(''), `Sent ${who}’s tag to the printer.`);
  };
  const oneOff = () => {
    const f = first.replace(/\s+/g, ' ').trim();
    if (!f) return say('oneoff', { bad: true, text: 'Type the child’s first name first.' });
    if (!oneOffClub) return say('oneoff', { bad: true, text: 'Pick the child’s club.' });
    if (!window.confirm(`Print a one-off tag for ${f}?`)) return null;
    return run('oneoff', oneOffRecord({ firstName: f, clubName: oneOffClub }), () => setFirst(''), `Sent ${f}’s tag: welcomed on the screens, not counted.`);
  };
  const custom = () => {
    const t = text.trim();
    if (!t) return say('custom', { bad: true, text: 'Type the label text first.' });
    if (!window.confirm(`Print a label that says “${t}”?`)) return null;
    return run('custom', customRecord(t), () => setText(''), 'Sent to the printer.');
  };

  if (!signedIn) {
    return <PanelCard title="Name tags and labels" tab="var(--brand-orange)"><p className="hint">Sign in under Account &amp; app to print name tags from here.</p></PanelCard>;
  }
  return (
    <PanelCard title="Name tags and labels" tab="var(--brand-orange)">
      <h4 className="settings-subhead">Leader name tag</h4>
      <p className="hint">For adult volunteers: the name, a LEADER pill and the club. Never counted toward tonight.</p>
      {chips.length > 0 && (
        <div className="leader-chips" role="list" aria-label="Remembered leaders">
          {chips.map((l) => (
            <span role="listitem" className="leader-chip" key={leaderKeyOf(l)}>
              <button type="button" className="ghost small" onClick={() => pick(l)}>{leaderName(l)}{l.clubName ? ` · ${l.clubName}` : ''}</button>
              <button type="button" className="ghost small" disabled={!canForget} aria-label={`Forget ${leaderName(l)}`} onClick={() => forget(l)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-lname`}>Leader’s name</label>
        <input id={`${id}-lname`} type="text" maxLength={SPEC.leaders.name} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-lclub`}>Leader’s club</label>
        <select id={`${id}-lclub`} value={leaderClub} onChange={(e) => setLeaderClub(e.target.value)}>
          <option value="">No club</option>
          {PICKUP_CLUBS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="laptop-actions"><button type="button" className="primary" disabled={busy !== ''} onClick={leader} title={busy !== '' ? 'Printing...' : undefined}>Print leader tag</button></div>
      <Note note={notes.leader} />

      <h4 className="settings-subhead">One-off name tag</h4>
      <p className="hint">For a lost tag, or a child who isn’t checking in tonight. It welcomes them on the screens and doesn’t count toward tonight.</p>
      <div className="field">
        <label htmlFor={`${id}-ofirst`}>Child’s first name</label>
        <input id={`${id}-ofirst`} type="text" maxLength={40} autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-oclub`}>Child’s club</label>
        <select id={`${id}-oclub`} value={oneOffClub} onChange={(e) => setOneOffClub(e.target.value)}>
          <option value="">Pick a club</option>
          {PICKUP_CLUBS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="laptop-actions"><button type="button" className="primary" disabled={busy !== ''} onClick={oneOff} title={busy !== '' ? 'Printing...' : undefined}>Print tag</button></div>
      <Note note={notes.oneoff} />

      <h4 className="settings-subhead">Custom label</h4>
      <p className="hint">One line of text, auto-sized, on an otherwise blank label. Not a check-in: nothing is counted and nothing reaches the lobby screens.</p>
      <div className="field">
        <label htmlFor={`${id}-text`}>Label text</label>
        <input id={`${id}-text`} type="text" maxLength={60} autoComplete="off" value={text} placeholder="VOLUNTEER, KITCHEN, Room 4 Helper…" onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="laptop-actions"><button type="button" className="primary" disabled={busy !== ''} onClick={custom} title={busy !== '' ? 'Printing...' : undefined}>Print custom label</button></div>
      <Note note={notes.custom} />
    </PanelCard>
  );
}


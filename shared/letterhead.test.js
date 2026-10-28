import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLetter, letterHtml, eventOf, linkify, issueLabel, escapeHtml, LETTERHEAD_SVGS, FIT, MAX_TEXT, PLAN_WORDS, PLAN_NOW } from './letterhead.js';

const SAMPLE = readFileSync(resolve(__dirname, '..', 'scripts', 'letterhead', 'test', 'november.txt'), 'utf8');
const SVGS = Object.fromEntries(Object.keys(LETTERHEAD_SVGS).map((k) => [k, `<svg id="${k}"><title>t</title></svg>`]));

describe('parseLetter: the November sample', () => {
  const l = parseLetter(SAMPLE);
  it('title, lead, five reminders, a heading, three events, a callout, the signature', () => {
    expect(l.title).toBe('November Update');
    expect(l.parts.map((p) => p.kind)).toEqual(['lead', 'item', 'item', 'item', 'item', 'item', 'heading', 'event', 'event', 'event', 'note']);
    expect(l.parts[6]).toEqual({ kind: 'heading', text: 'Upcoming Events' });
    expect(l.parts[7]).toMatchObject({ kind: 'event', month: 'NOV', day: '4' });
    expect(l.parts[8]).toMatchObject({ kind: 'event', month: 'NOV', day: '18' });
    expect(l.parts[9]).toEqual({ kind: 'event', month: 'NOV', day: '25', text: 'No club for Thanksgiving Break.' });
    expect(l.signature).toEqual(['Patrick Simpson', 'Awana Ministry Director', 'awana@kvbchurch.org  |  290-0341']);
  });
});

describe('parseLetter: the format', () => {
  it('empty text = nothing', () => {
    expect(parseLetter('')).toEqual({ title: '', parts: [], signature: [] });
  });
  it('"## " forces a heading; "- " lines are reminders; lines of one paragraph join', () => {
    const l = parseLetter('Hello\n\nLead line one\ncontinues here.\n\n## Notes!\n- one thing.\n- two things.');
    expect(l.parts).toEqual([
      { kind: 'lead', text: 'Lead line one continues here.' },
      { kind: 'heading', text: 'Notes!' },
      { kind: 'item', text: 'one thing.' },
      { kind: 'item', text: 'two things.' },
    ]);
  });
  it('a paragraph with no events above it in its section stays a reminder, not a callout', () => {
    const l = parseLetter('T\n\nLead.\n\nMore News\n\nSomething happened.');
    expect(l.parts.at(-1)).toEqual({ kind: 'item', text: 'Something happened.' });
  });
  it('a closing paragraph is never taken for a signature', () => {
    const l = parseLetter('T\n\nLead.\n\nThanks for all you do. See you Wednesday!');
    expect(l.signature).toEqual([]);
    expect(l.parts.at(-1).kind).toBe('item');
  });
  it('text past MAX_TEXT is cut', () => {
    const l = parseLetter(`T\n\n${'a'.repeat(MAX_TEXT * 2)}.`);
    expect(l.parts[0].text.length).toBeLessThan(MAX_TEXT);
  });
});

describe('events, links, the chip', () => {
  it('m/d and month-word dates, with -, –, — or :', () => {
    expect(eventOf('11/4 - Parents night!')).toEqual({ month: 'NOV', day: '4', text: 'Parents night!' });
    expect(eventOf('12/23/2026 — No club')).toMatchObject({ month: 'DEC', day: '23' });
    expect(eventOf('Nov. 18: Prayer')).toMatchObject({ month: 'NOV', day: '18', text: 'Prayer' });
    expect(eventOf('December 3rd – Store')).toMatchObject({ month: 'DEC', day: '3' });
    expect(eventOf('13/4 - not a month')).toBeNull();
    expect(eventOf('Notes 4 - not a month')).toBeNull();
    expect(eventOf('We meet at 6:45 - come early')).toBeNull();
  });
  it('links print without https://, punctuation stays outside, and everything is escaped', () => {
    expect(linkify('See https://kvbchurch.org/alerts.')).toBe('See <a href="https://kvbchurch.org/alerts">kvbchurch.org/alerts</a>.');
    expect(linkify('Mail awana@kvbchurch.org now')).toBe('Mail <a href="mailto:awana@kvbchurch.org">awana@kvbchurch.org</a> now');
    expect(linkify('<b>T&T</b>')).toBe('&lt;b&gt;T&amp;T&lt;/b&gt;');
    expect(escapeHtml('"x"')).toBe('&quot;x&quot;');
  });
  it('the chip: the title\'s month, else the date\'s; a January letter written in December is next year\'s', () => {
    expect(issueLabel('November Update', new Date(2026, 9, 28))).toBe('NOV 2026');
    expect(issueLabel('Club News', new Date(2026, 9, 28))).toBe('OCT 2026');
    expect(issueLabel('January Update', new Date(2026, 11, 20))).toBe('JAN 2027');
    expect(issueLabel('Maybe Later', new Date(2026, 9, 28))).toBe('OCT 2026');
  });
});

describe('letterHtml', () => {
  const html = letterHtml(parseLetter(SAMPLE), { kitUrl: '/kit/', svgs: SVGS, date: new Date(2026, 9, 28) });
  it('draws from the kit it is given, with the church logo and no SVG titles', () => {
    expect(html).toContain('href="/kit/tokens.css"');
    expect(html).toContain('href="/kit/fonts.css"');
    expect(html).toContain('<svg id="logo">');
    expect(html).not.toContain('<title>t</title>');
    expect(LETTERHEAD_SVGS.logo).toBe('logos/kvbc-awana-two-line-ink.svg');
  });
  it('Letter, no margins, the fit script with FIT\'s numbers', () => {
    expect(html).toContain('@page{size:Letter;margin:0}');
    expect(html).toContain(`let pt = ${FIT.startPt};`);
    expect(html).toContain(`pt > ${FIT.minPt}`);
  });
  it('the catalog\'s text page: no corner tab (owner), ONE colour family, caps headline, plain bullets, no tiles', () => {
    expect(html).not.toMatch(/class="tab|Awana News/i);
    expect(html).toMatch(/h1\{[^}]*text-transform:uppercase/);
    expect(html).not.toMatch(/--brand-(puggles|cubbies|sparks|tnt|trek|journey)/);
    expect(html).not.toMatch(/class="item" style=|class="date"|class="stripe"|class="chip"/);
    expect(html).toContain('<b class="when">NOV 25</b>');
  });
  it('the five words in order, this year\'s as the one hot pill, never called a plan', () => {
    expect(PLAN_WORDS).toEqual(['Belong', 'Believe', 'Become', 'Protect', 'Grow']);
    expect(PLAN_NOW).toBe('Believe');
    const row = html.match(/<div class="plan">([\s\S]*?)<\/div>/)[1];
    expect([...row.matchAll(/<b[^>]*>([^<]+)/g)].map((m) => m[1])).toEqual(PLAN_WORDS);
    expect(row.match(/class="now"/g)).toHaveLength(1);
    expect(row).toContain('<b class="now">Believe<span class="swash">');
    expect(html).not.toMatch(/ministry plan|5-year|five-year/i);
    expect(html).not.toMatch(/Wednesdays at|<div class="line">/);
    const next = letterHtml(parseLetter(SAMPLE), { kitUrl: '', svgs: SVGS, planNow: 'Become' });
    expect(next).toContain('<b class="now">Become<span class="swash">');
  });
  it('flat: no gradient, no blur, no drop shadows on a text page', () => {
    expect(html).not.toMatch(/gradient|blur\(|filter:/);
    expect(html).not.toMatch(/box-shadow|text-shadow/);
  });
  it('a letter\'s own text can never become markup', () => {
    const evil = letterHtml(parseLetter('<script>x</script>\n\n<img src=x onerror=y>.'), { kitUrl: '', svgs: SVGS });
    expect(evil).not.toContain('<script>x');
    expect(evil).not.toContain('<img');
  });
});

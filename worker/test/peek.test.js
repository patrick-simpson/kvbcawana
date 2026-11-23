import { describe, expect, it } from 'vitest';
import { mask, pageShapeOf } from '../src/peek.js';

const PAGE = `<html><head><title>KVBC - Shekels</title></head><body>
<nav><a href="/meeting/shekels?club_id=3">Shekels</a></nav>
<h2>Record Shekels</h2>
<form action="/meeting/saveShekels?cal=412" method="post">
  <select name="club_id"><option>Sparks</option><option>T&amp;T</option></select>
  <select name="clubber_id"><option>Ava Stone</option><option>Ben Lee</option></select>
  <table><thead><tr><th>Clubber</th><th>Balance</th><th>Add</th></tr></thead>
  <tbody><tr><td>Ava Stone</td><td>7</td><td><input name="shekels[12345]" value="3"></td></tr>
  <tr><td>Ben Lee</td><td>12</td><td><input name="shekels[67890]" value=""></td></tr></tbody></table>
  <input type="hidden" name="calendar_id" value="412">
  <button type="submit">Save</button>
</form>
<script>$.post('/meeting/ajaxShekel/' + id, {amount: 2});</script>
</body></html>`;

describe('the look-only peek', () => {
  it('tells the form, never a name, a balance, a value or a clubber id', () => {
    const shape = pageShapeOf(PAGE);
    const text = JSON.stringify(shape);
    for (const secret of ['Ava', 'Stone', 'Ben', '12345', '67890', '412', '"7"', '"3"']) expect(text).not.toContain(secret);
    const f = shape.forms[0];
    expect(f).toMatchObject({ action: '/meeting/saveShekels', method: 'post', buttons: ['Save'] });
    expect(f.fields).toContainEqual({ name: 'shekels[#]', tag: 'input', type: 'text', count: 2 });
    expect(f.fields.find((x) => x.name === 'club_id').words).toEqual(['Sparks', 'T&T']);
    expect(f.fields.find((x) => x.name === 'clubber_id').words).toBeUndefined();   // a list of children: count only
    expect(shape.tables[0]).toEqual({ headers: ['Clubber', 'Balance', 'Add'], rows: 2 });
    expect(shape.scriptPaths).toEqual(['/meeting/ajaxShekel/']);
    expect(shape.headings).toEqual(['Record Shekels']);
  });
  it('masks digits', () => { expect(mask('shekels[123]')).toBe('shekels[#]'); });
});

describe('the script around a path', () => {
  it('masks numbers and drops quoted words that could be a name', async () => {
    const { scriptBit } = await import('../src/peek.js');
    const out = scriptBit(`$.ajax({url: '/meeting/formClubberShekels', data: {id: 12345, who: 'Ava Stone', first: 'Ava', type: 'POST'}})`);
    expect(out).toContain('/meeting/formClubberShekels');
    expect(out).toContain('id: #');
    expect(out).not.toContain('Ava');
    expect(out).not.toContain('12345');
  });
});

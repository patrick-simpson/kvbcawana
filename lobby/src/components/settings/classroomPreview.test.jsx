import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The settings page's "Downstairs classroom" card (owner 2026-10-18): a look
// on the classroom TV for a minute (worker/src/routes.md 10.13 `preview`), and
// what the TV said about it.

const world = vi.hoisted(() => ({ calls: /** @type {any[]} */ ([]), state: /** @type {any} */ ({ now: null }) }));
vi.mock('../../lib/workerClient.js', () => ({
  call: async (path, opts = {}) => {
    world.calls.push([opts.method || 'GET', path, opts.body]);
    if (path === '/v1/classroom/remote/state') return { ok: true, status: 200, body: world.state, message: '' };
    return { ok: true, status: 200, body: { ok: true }, message: '' };
  },
}));

const { ClassroomPreviewCard, CLASSROOM_ANSWER_MS, classroomPreviewWords } = await import('./screens.jsx');

afterEach(() => { cleanup(); world.calls = []; world.state = { now: null }; });

describe('the classroom preview', () => {
  it('words: asking, showing, no answer', () => {
    const asked = { look: 'cubbies' };
    expect(classroomPreviewWords(null, null, 0)).toBe('');
    expect(classroomPreviewWords(asked, { now: null }, 1000)).toMatch(/^Asking the classroom TV to show the cubbies card/);
    expect(classroomPreviewWords(asked, { now: { preview: 'cubbies' } }, 1000)).toBe('The classroom TV is showing the cubbies card for a minute.');
    expect(classroomPreviewWords(asked, { now: null }, CLASSROOM_ANSWER_MS + 1)).toMatch(/has not answered/);
  });

  it('a button asks the service for that look, then reads what the TV says; Back to schedule ends it', async () => {
    render(<ClassroomPreviewCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Sparks card' }));
    await waitFor(() => expect(world.calls).toContainEqual(['POST', '/v1/classroom/remote', { action: 'preview', data: { look: 'sparks' } }]));
    world.state = { now: { view: 'sparks', preview: 'sparks' } };
    await waitFor(() => expect(screen.getByText('The classroom TV is showing the sparks card for a minute.')).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Back to schedule' }));
    await waitFor(() => expect(world.calls).toContainEqual(['POST', '/v1/classroom/remote', { action: 'preview-end' }]));
    expect(screen.getByRole('link', { name: 'Sparks remote' }).getAttribute('href')).toBe('/classroom/remote/');
  });
});

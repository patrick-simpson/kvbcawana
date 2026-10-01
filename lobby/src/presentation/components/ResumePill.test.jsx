import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CHURCH } from '../church.config.js';
import { ResumePill } from './ResumePill.jsx';

const NOW = new Date('2026-09-15T18:30:00');
const inSec = (s) => new Date(NOW.getTime() + s * 1000);

describe('ResumePill', () => {
  afterEach(cleanup);

  it('shows in the final warning seconds, and marks itself as a bottom overlay the setup note yields to', () => {
    const { container } = render(<ResumePill now={NOW} resumeAt={inSec(CHURCH.watchdog.warningSec - 1)} onStay={() => {}} />);
    const pill = container.querySelector('[data-resume-pill]');
    expect(pill).not.toBeNull();
    expect(pill.hasAttribute('data-pj-bottom-overlay')).toBe(true);
    expect(pill.textContent).toMatch(/Back to schedule in/i);
  });

  it('is not there before the warning window (and so does not hide the note)', () => {
    const { container } = render(<ResumePill now={NOW} resumeAt={inSec(CHURCH.watchdog.warningSec + 30)} onStay={() => {}} />);
    expect(container.querySelector('[data-pj-bottom-overlay]')).toBeNull();
    cleanup();
    const none = render(<ResumePill now={NOW} resumeAt={null} onStay={() => {}} />);
    expect(none.container.querySelector('[data-pj-bottom-overlay]')).toBeNull();
  });
});

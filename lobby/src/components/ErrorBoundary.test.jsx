import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.jsx';

afterEach(cleanup);

function Bomb({ armed }) {
  if (armed) throw new Error('boom');
  return <span>ok</span>;
}

describe('ErrorBoundary', () => {
  it('fences a crash with a null fallback and reports it once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const { container } = render(<ErrorBoundary label="x" eventKey={1} onError={onError}><Bomb armed /></ErrorBoundary>);
    expect(container.innerHTML).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('retries when eventKey changes, not before', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(<ErrorBoundary eventKey={1}><Bomb armed /></ErrorBoundary>);
    rerender(<ErrorBoundary eventKey={1}><Bomb armed={false} /></ErrorBoundary>);
    expect(container.innerHTML).toBe('');
    rerender(<ErrorBoundary eventKey={2}><Bomb armed={false} /></ErrorBoundary>);
    expect(container.textContent).toBe('ok');
  });

  it('reports each retry that crashes again (a persistent fault never ages out)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const { rerender } = render(<ErrorBoundary eventKey={1} onError={onError}><Bomb armed /></ErrorBoundary>);
    rerender(<ErrorBoundary eventKey={2} onError={onError}><Bomb armed /></ErrorBoundary>);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

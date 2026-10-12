import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { lazyPanel } from './lazyPanel.jsx';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import { preloadOperatorPanels } from '../components/operatorPanels.jsx';

afterEach(cleanup);

const Hello = ({ name }) => <p data-testid="panel">Hello {name}</p>;
const opening = <p data-testid="opening">Opening…</p>;

describe('lazyPanel: operator code on demand', () => {
  it('a preloaded panel renders in the same commit, never its loading card', async () => {
    const Panel = lazyPanel(async () => ({ default: Hello }));
    await Panel.preload();
    const { getByTestId, queryByTestId } = render(<Panel name="Sam" fallback={opening} />);
    expect(queryByTestId('opening')).toBeNull();
    expect(getByTestId('panel').textContent).toBe('Hello Sam');
  });

  it('a cold panel shows its loading card, then the panel, which keeps its state from then on', async () => {
    let land;
    function Counter() {
      const [n, setN] = useState(0);
      return <button type="button" data-testid="panel" onClick={() => setN(n + 1)}>{n}</button>;
    }
    const Panel = lazyPanel(() => new Promise((resolve) => { land = () => resolve({ default: Counter }); }));
    const view = render(<Panel fallback={opening} />);
    expect(view.getByTestId('opening')).toBeTruthy();
    await act(async () => { land(); });
    const button = view.getByTestId('panel');
    await act(async () => { button.click(); });
    view.rerender(<Panel fallback={opening} />);
    expect(view.getByTestId('panel').textContent).toBe('1');
    expect(view.queryByTestId('opening')).toBeNull();
  });

  it('asks for the chunk once, however often it is preloaded or rendered', async () => {
    const load = vi.fn(async () => ({ default: Hello }));
    const Panel = lazyPanel(load);
    await Promise.all([Panel.preload(), Panel.preload()]);
    render(<><Panel name="A" /><Panel name="B" /></>);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed load closes the panel through its ErrorBoundary, without retrying by itself; the next open tries again', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: Hello });
    const Panel = lazyPanel(load);
    const onError = vi.fn();
    const first = render(<ErrorBoundary label="t" onError={onError}><Panel name="X" fallback={opening} /></ErrorBoundary>);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(first.queryByTestId('panel')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(<Panel name="Y" fallback={opening} />);
    expect((await second.findByTestId('panel')).textContent).toBe('Hello Y');
    expect(load).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('the real operator panels load as modules', async () => {
    await expect(preloadOperatorPanels()).resolves.toHaveLength(4);
  });
});

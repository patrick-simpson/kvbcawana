import { describe, it, expect } from 'vitest';
import { collectGarbage, getVideo, listVideoIds, makeVideoId, putVideo } from './videoStore.js';

// jsdom has no indexedDB global, which conveniently doubles as the
// "browser with IndexedDB blocked" case. The contract under test: read
// paths degrade to empty results, only writes reject — so a storage
// problem can badge the editor but never wedge the slideshow.
describe('videoStore without IndexedDB available', () => {
  it('getVideo resolves null instead of rejecting', async () => {
    await expect(getVideo('v_anything')).resolves.toBeNull();
  });

  it('listVideoIds resolves an empty list', async () => {
    await expect(listVideoIds()).resolves.toEqual([]);
  });

  it('putVideo rejects so the editor can surface the failure', async () => {
    await expect(putVideo('v_1', new Blob(['x']))).rejects.toBeTruthy();
  });

  it('collectGarbage resolves quietly', async () => {
    await expect(collectGarbage(['v_1'])).resolves.toBeUndefined();
  });
});

describe('makeVideoId', () => {
  it('makes unique v_-prefixed ids', () => {
    const ids = Array.from({ length: 50 }, makeVideoId);
    expect(ids.every((id) => id.startsWith('v_'))).toBe(true);
    expect(new Set(ids).size).toBe(50);
  });
});

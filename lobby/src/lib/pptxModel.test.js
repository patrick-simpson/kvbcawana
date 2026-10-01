import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredDeckModel, parseAndCacheDeck } from './pptxModel.js';
import { getDeck, getModel, putModel } from './pptxStore.js';
import { PARSER_VERSION, parsePptxToModel } from './pptxHandler.js';

vi.mock('./pptxStore.js', () => ({
  getDeck: vi.fn(),
  getModel: vi.fn(),
  putModel: vi.fn(),
}));

// Keep the real PARSER_VERSION so the cache-validity checks under test
// use the same constant the production code compares against.
vi.mock('./pptxHandler.js', async (importOriginal) => ({
  ...(await importOriginal()),
  parsePptxToModel: vi.fn(),
}));

const deckBlob = new Blob(['fake-pptx']);
const parsedModel = { widthEmu: 1, heightEmu: 1, slides: [{ shapes: [] }], images: {} };
const cachedModel = { widthEmu: 2, heightEmu: 2, slides: [{ shapes: [] }], images: {} };

beforeEach(() => {
  vi.clearAllMocks();
  getDeck.mockResolvedValue({ blob: deckBlob, name: 'deck.pptx', savedAt: 1234 });
  getModel.mockResolvedValue(null);
  putModel.mockResolvedValue(true);
  parsePptxToModel.mockResolvedValue(parsedModel);
});

describe('getStoredDeckModel', () => {
  it('returns the cached model without parsing when the cache is valid', async () => {
    getModel.mockResolvedValue({ parserVersion: PARSER_VERSION, deckSavedAt: 1234, model: cachedModel });
    await expect(getStoredDeckModel()).resolves.toBe(cachedModel);
    expect(parsePptxToModel).not.toHaveBeenCalled();
    expect(putModel).not.toHaveBeenCalled();
  });

  it('re-parses and re-caches when the cached parserVersion is stale', async () => {
    getModel.mockResolvedValue({ parserVersion: PARSER_VERSION - 1, deckSavedAt: 1234, model: cachedModel });
    await expect(getStoredDeckModel()).resolves.toBe(parsedModel);
    expect(parsePptxToModel).toHaveBeenCalledWith(deckBlob);
    expect(putModel).toHaveBeenCalledWith({ parserVersion: PARSER_VERSION, deckSavedAt: 1234, model: parsedModel });
  });

  it('re-parses when the cache belongs to a different upload (savedAt mismatch)', async () => {
    getModel.mockResolvedValue({ parserVersion: PARSER_VERSION, deckSavedAt: 999, model: cachedModel });
    await expect(getStoredDeckModel()).resolves.toBe(parsedModel);
    expect(parsePptxToModel).toHaveBeenCalledWith(deckBlob);
  });

  it('parses on a cold cache (getModel null)', async () => {
    await expect(getStoredDeckModel()).resolves.toBe(parsedModel);
    expect(parsePptxToModel).toHaveBeenCalledWith(deckBlob);
    expect(putModel).toHaveBeenCalled();
  });

  it('still returns the model when the cache write fails', async () => {
    putModel.mockResolvedValue(false);
    await expect(getStoredDeckModel()).resolves.toBe(parsedModel);
  });

  it('throws when no deck is stored on this device', async () => {
    getDeck.mockResolvedValue(null);
    await expect(getStoredDeckModel()).rejects.toThrow(/No uploaded deck/);
    expect(parsePptxToModel).not.toHaveBeenCalled();
  });

  it('propagates a parse failure so the caller can fall back', async () => {
    parsePptxToModel.mockRejectedValue(new Error('not a zip'));
    await expect(getStoredDeckModel()).rejects.toThrow('not a zip');
  });
});

describe('parseAndCacheDeck', () => {
  it('parses the blob, caches keyed to savedAt, and returns the model', async () => {
    await expect(parseAndCacheDeck(deckBlob, 777)).resolves.toBe(parsedModel);
    expect(parsePptxToModel).toHaveBeenCalledWith(deckBlob);
    expect(putModel).toHaveBeenCalledWith({ parserVersion: PARSER_VERSION, deckSavedAt: 777, model: parsedModel });
  });

  it('returns the model even when the cache write fails', async () => {
    putModel.mockResolvedValue(false);
    await expect(parseAndCacheDeck(deckBlob, 777)).resolves.toBe(parsedModel);
  });

  it('throws only when the blob cannot be parsed at all', async () => {
    parsePptxToModel.mockRejectedValue(new Error('corrupt'));
    await expect(parseAndCacheDeck(deckBlob, 777)).rejects.toThrow('corrupt');
    expect(putModel).not.toHaveBeenCalled();
  });
});

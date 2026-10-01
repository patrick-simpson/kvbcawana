import { describe, it, expect } from 'vitest';
import { convertToDownloadUrl } from './pptxHandler.js';

describe('convertToDownloadUrl', () => {
  it('returns null for empty input', () => {
    expect(convertToDownloadUrl('')).toBeNull();
    expect(convertToDownloadUrl(null)).toBeNull();
  });

  it('leaves URLs that already download alone', () => {
    const url = 'https://onedrive.live.com/x?download=1';
    expect(convertToDownloadUrl(url)).toBe(url);
  });

  it('rewrites OneDrive embed URLs to download URLs', () => {
    expect(convertToDownloadUrl('https://onedrive.live.com/embed?resid=ABC'))
      .toBe('https://onedrive.live.com/download?resid=ABC');
  });

  it('appends download=1 to OneDrive share and 1drv.ms URLs', () => {
    expect(convertToDownloadUrl('https://onedrive.live.com/view?id=1'))
      .toBe('https://onedrive.live.com/view?id=1&download=1');
    expect(convertToDownloadUrl('https://1drv.ms/p/s!Abc'))
      .toBe('https://1drv.ms/p/s!Abc?download=1');
  });

  it('passes other URLs through unchanged', () => {
    const url = 'https://example.com/deck.pptx';
    expect(convertToDownloadUrl(url)).toBe(url);
  });
});

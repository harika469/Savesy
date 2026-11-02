import { extractUrl, fetchLinkMetadata, normalizeUrl, parseHtmlMetadata } from '@/utils/metadata';

describe('normalizeUrl', () => {
  it('adds https to bare links', () => expect(normalizeUrl('example.com/a')).toBe('https://example.com/a'));
  it('keeps full links', () => expect(normalizeUrl(' http://a.co/x?y=1 ')).toBe('http://a.co/x?y=1'));
  it('rejects non-links and other schemes', () => {
    expect(normalizeUrl('hello')).toBeUndefined();
    expect(normalizeUrl('')).toBeUndefined();
    expect(normalizeUrl('ftp://files.com')).toBeUndefined();
  });
});

describe('extractUrl', () => {
  it('finds a link inside text and trims trailing punctuation', () => expect(extractUrl('look at this! https://youtu.be/abc). so good')).toBe('https://youtu.be/abc'));
  it('falls back to a bare link', () => expect(extractUrl('example.com')).toBe('https://example.com/'));
  it('returns undefined for plain text', () => expect(extractUrl('just words')).toBeUndefined());
});

describe('parseHtmlMetadata', () => {
  const url = 'https://site.com/post';
  it('prefers og tags in either attribute order and decodes entities', () => {
    const html = '<title>Fallback</title><meta content="/img.png" property="og:image"><meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Day&quot;"><meta property="og:site_name" content="Site">';
    expect(parseHtmlMetadata(html, url)).toEqual({ title: 'Tom & Jerry\'s "Day"', source: 'Site', imageUrl: 'https://site.com/img.png', ogType: undefined });
  });
  it('falls back to <title>', () => expect(parseHtmlMetadata('<title>\n  Plain  title </title>', url).title).toBe('Plain title'));
});

describe('fetchLinkMetadata', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it('uses the page metadata when the fetch works', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<meta property="og:title" content="Great talk"><meta property="og:type" content="video.other">') }) as never;
    await expect(fetchLinkMetadata('https://example.org/talk')).resolves.toEqual({ title: 'Great talk', source: 'Example', type: 'video', imageUrl: undefined });
  });
  it('falls back to URL guesses when offline', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    await expect(fetchLinkMetadata('https://www.youtube.com/watch?v=1')).resolves.toEqual({ title: 'A video worth coming back to', source: 'YouTube', type: 'video' });
  });
});

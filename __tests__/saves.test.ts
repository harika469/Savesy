import { SavedItem } from '@/types';
import { inferMetadata, matchesSave, parseTags, relativeDate, sameUrl } from '@/utils/saves';

const save = (over: Partial<SavedItem> = {}): SavedItem => ({ id: '1', url: 'https://shop.com/dress', title: 'Green linen dress', type: 'product', tags: ['summer'], isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', note: 'for dinners', ...over });

describe('matchesSave', () => {
  it('needs every word, in any field', () => {
    expect(matchesSave(save(), 'linen summer')).toBe(true);
    expect(matchesSave(save(), 'DINNERS shop.com')).toBe(true);
    expect(matchesSave(save(), 'linen winter')).toBe(false);
  });
  it('matches everything for an empty query', () => expect(matchesSave(save(), '  ')).toBe(true));
});

describe('inferMetadata', () => {
  it.each([
    ['https://youtu.be/x', 'video', 'YouTube'],
    ['https://www.instagram.com/p/1', 'social', 'Instagram'],
    ['https://maps.google.com/?q=cafe', 'place', 'Maps'],
    ['https://www.etsy.com/listing/1', 'product', 'Etsy'],
    ['https://blog.example.com/post', 'article', 'Example'],
  ])('%s → %s', (url, type, source) => expect(inferMetadata(url)).toMatchObject({ type, source }));
  it('only returns title, source and type', () => expect(Object.keys(inferMetadata('https://amazon.com/x')).sort()).toEqual(['source', 'title', 'type']));
});

it('parseTags lowercases, strips # and dedupes', () => expect(parseTags('#Travel, cafe, travel, ')).toEqual(['travel', 'cafe']));
it('sameUrl ignores scheme, www and trailing slash', () => expect(sameUrl('https://www.a.com/x/', 'http://a.com/x')).toBe(true));
it('relativeDate is friendly', () => {
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  expect([relativeDate(ago(0)), relativeDate(ago(1)), relativeDate(ago(5)), relativeDate(ago(65)), relativeDate(ago(800))]).toEqual(['today', 'yesterday', '5d ago', '2mo ago', '2y ago']);
});

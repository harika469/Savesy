import { Collection, SavedItem } from '@/types';

export const seedCollections: Collection[] = [
  { id: 'trips', name: '✈ Main character trips', createdAt: '2026-01-04T12:00:00.000Z' },
  { id: 'buy', name: '♧ I might buy this', createdAt: '2026-01-05T12:00:00.000Z' },
  { id: 'eat', name: '♨ Need to eat this', createdAt: '2026-01-06T12:00:00.000Z' },
  { id: 'brain', name: '✦ Big brain energy', createdAt: '2026-01-07T12:00:00.000Z' },
];

export const seedSaves: SavedItem[] = [
  { id: 'prague-pasta', url: 'https://maps.google.com/?q=Prague+pasta', title: 'That pasta place in Prague', note: 'Book the tiny table by the window.', type: 'place', source: 'Google Maps', tags: ['prague', 'pasta', 'trip'], collectionId: 'trips', isFavorite: true, createdAt: '2026-08-22T12:00:00.000Z' },
  { id: 'focus-playlist', url: 'https://open.spotify.com/', title: 'Focus playlist for deep work', note: 'No lyrics, genuinely useful.', type: 'other', source: 'Spotify', tags: ['music', 'focus'], collectionId: 'brain', isFavorite: false, createdAt: '2026-08-27T13:00:00.000Z' },
  { id: 'ghent-guide', url: 'https://visit.gent.be/', title: 'Ghent weekend guide', note: 'Save the vintage market for Sunday.', type: 'article', source: 'Article', tags: ['ghent', 'weekend', 'travel'], collectionId: 'trips', isFavorite: false, createdAt: '2026-08-26T11:00:00.000Z' },
  { id: 'green-dress', url: 'https://example.com/green-linen-dress', title: 'Green linen midi dress', note: 'This would work for summer dinners.', type: 'product', source: 'Product', tags: ['green dress', 'linen', 'outfit'], collectionId: 'buy', isFavorite: true, createdAt: '2026-08-24T11:00:00.000Z' },
  { id: 'olive-outfit', url: 'https://example.com/olive-outfit', title: 'Olive summer outfit', type: 'social', source: 'Instagram', tags: ['green dress', 'outfit'], collectionId: 'buy', isFavorite: false, createdAt: '2026-08-20T11:00:00.000Z' },
  { id: 'wardrobe', url: 'https://youtube.com/', title: 'Capsule wardrobe inspiration', type: 'video', source: 'YouTube', tags: ['green dress', 'style'], collectionId: 'buy', isFavorite: false, createdAt: '2026-08-12T11:00:00.000Z' },
  { id: 'ramen', url: 'https://example.com/ramen', title: '15-minute sesame ramen', note: 'Add chili crisp.', type: 'article', source: 'Recipe', tags: ['ramen', 'dinner'], collectionId: 'eat', isFavorite: false, createdAt: '2026-08-18T11:00:00.000Z' },
];

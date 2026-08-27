import { SaveType, SavedItem } from '@/types';

export function relativeDate(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function inferMetadata(url: string): { title: string; source: string; type: SaveType } {
  const value = url.toLowerCase();
  if (value.includes('youtube') || value.includes('youtu.be')) return { title: 'A video worth coming back to', source: 'YouTube', type: 'video' };
  if (value.includes('tiktok')) return { title: 'A TikTok you wanted to remember', source: 'TikTok', type: 'social' };
  if (value.includes('instagram')) return { title: 'An Instagram find', source: 'Instagram', type: 'social' };
  if (value.includes('maps') || value.includes('restaurant')) return { title: 'A place to check out', source: 'Maps', type: 'place' };
  if (value.includes('shop') || value.includes('product')) return { title: 'Something you might love', source: 'Product', type: 'product' };
  try { return { title: new URL(url).hostname.replace('www.', ''), source: 'Website', type: 'article' }; }
  catch { return { title: 'Untitled internet treasure', source: 'Link', type: 'other' }; }
}

export function matchesSave(save: SavedItem, query: string) {
  const haystack = [save.title, save.note, save.source, save.type, save.tags.join(' ')].join(' ').toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

import { SaveType, SavedItem } from '@/types';

export function relativeDate(value: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const rules: { match: RegExp; title: string; source: string; type: SaveType }[] = [
  { match: /youtube\.com|youtu\.be/, title: 'A video worth coming back to', source: 'YouTube', type: 'video' },
  { match: /vimeo\.com/, title: 'A video worth coming back to', source: 'Vimeo', type: 'video' },
  { match: /tiktok\.com/, title: 'A TikTok you wanted to remember', source: 'TikTok', type: 'social' },
  { match: /instagram\.com/, title: 'An Instagram find', source: 'Instagram', type: 'social' },
  { match: /pinterest\./, title: 'A Pinterest pin', source: 'Pinterest', type: 'social' },
  { match: /(twitter|x)\.com/, title: 'A post worth keeping', source: 'X', type: 'social' },
  { match: /reddit\.com/, title: 'A Reddit thread', source: 'Reddit', type: 'social' },
  { match: /maps\.google|google\.[a-z.]+\/maps|maps\.apple|goo\.gl\/maps|yelp\.|tripadvisor\./, title: 'A place to check out', source: 'Maps', type: 'place' },
  { match: /amazon\.|etsy\.com|ebay\.|zara\.com|ikea\.com|\/products?\/|shop/, title: 'Something you might love', source: 'Shop', type: 'product' },
  { match: /open\.spotify\.com|music\.apple/, title: 'Something to listen to', source: 'Music', type: 'other' },
];

export function inferMetadata(url: string): { title: string; source: string; type: SaveType } {
  const value = url.toLowerCase();
  const rule = rules.find(r => r.match.test(value));
  if (rule) {
    if (rule.source === 'Shop') {
      try { return { title: rule.title, source: prettyHost(url), type: rule.type }; } catch { /* fall through */ }
    }
    return { title: rule.title, source: rule.source, type: rule.type };
  }
  try { const host = prettyHost(url); return { title: host, source: host, type: 'article' }; }
  catch { return { title: 'Untitled internet treasure', source: 'Link', type: 'other' }; }
}

function prettyHost(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const name = host.split('.').slice(-2, -1)[0] ?? host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function parseTags(input: string) {
  return Array.from(new Set(input.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean)));
}

/** Every whitespace-separated word must appear somewhere in the save. */
export function matchesSave(save: SavedItem, query: string) {
  const haystack = [save.title, save.note, save.source, save.type, save.url, save.tags.join(' ')].join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

export function sameUrl(a: string, b: string) {
  const clean = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  return clean(a) === clean(b);
}

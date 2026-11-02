import { SaveType } from '@/types';
import { inferMetadata } from './saves';

export type LinkMetadata = { title?: string; source?: string; type: SaveType; imageUrl?: string };

/** Adds a scheme to bare links like "example.com/thing" and returns undefined for non-links. */
export function normalizeUrl(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Pulls the first http(s) link out of free text (e.g. "Look at this! https://…"). */
export function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.!?]+$/, '') : normalizeUrl(text);
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
function decode(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z#0-9]+);/gi, (whole, name) => entities[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, key: string) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decode(match[1]);
  }
  return undefined;
}

export function parseHtmlMetadata(html: string, url: string) {
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : undefined);
  const source = metaContent(html, 'og:site_name');
  let imageUrl = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  if (imageUrl) { try { imageUrl = new URL(imageUrl, url).toString(); } catch { imageUrl = undefined; } }
  const ogType = metaContent(html, 'og:type')?.toLowerCase();
  return { title: title || undefined, source, imageUrl, ogType };
}

/**
 * Best-effort metadata: instant guesses from the URL, upgraded with the page's own
 * title/site name/image when the network allows it. Never throws.
 */
export async function fetchLinkMetadata(url: string, timeoutMs = 6000): Promise<LinkMetadata> {
  const guess = inferMetadata(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/html' } });
    if (!response.ok) return guess;
    const html = (await response.text()).slice(0, 300_000);
    const page = parseHtmlMetadata(html, url);
    let type = guess.type;
    if (type === 'article' || type === 'other') {
      if (page.ogType?.startsWith('video')) type = 'video';
      else if (page.ogType?.includes('product')) type = 'product';
    }
    return { title: page.title ?? guess.title, source: page.source ?? guess.source, type, imageUrl: page.imageUrl };
  } catch {
    return guess;
  } finally {
    clearTimeout(timer);
  }
}

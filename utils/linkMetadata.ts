import type { SaveType } from '@/types';

export type LinkMetadata = {
  title?: string;
  creator?: string;
  thumbnailUrl?: string;
  tags?: string[];
  status: 'loaded' | 'limited' | 'unsupported' | 'unavailable';
};

export function parseSharedLink(input: string): { url: string; sharedText: string } | undefined {
  const match = input.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return;
  const raw = match[0].replace(/[),.;!?]+$/, '');
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    const host = url.hostname.toLowerCase();
    if (host === 'instagram.com' || host === 'www.instagram.com') {
      const reel = url.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/?$/);
      if (reel) {
        url.protocol = 'https:';
        url.hostname = 'www.instagram.com';
        url.pathname = '/' + reel[1] + '/' + reel[2] + '/';
        url.search = '';
        url.hash = '';
      }
    }
    return { url: url.toString(), sharedText: input.replace(match[0], '').trim() };
  } catch { return; }
}

export function instagramEmbedUrl(value: string): string | undefined {
  const parsed = parseSharedLink(value);
  if (!parsed) return;
  const url = new URL(parsed.url);
  if (url.hostname !== 'www.instagram.com') return;
  if (!/^\/(reel|p|tv)\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) return;
  return url.origin + url.pathname + 'embed/captioned/';
}

export function sourceForUrl(value: string): { source: string; type: SaveType; endpoint?: string } {
  const host = new URL(value).hostname.toLowerCase();
  const is = (domain: string) => host === domain || host.endsWith('.' + domain);
  const query = encodeURIComponent(value);
  if (is('youtube.com') || is('youtu.be')) return {source: 'YouTube', type: 'video', endpoint: 'https://www.youtube.com/oembed?format=json&url=' + query};
  if (is('tiktok.com')) return {source: 'TikTok', type: 'social', endpoint: 'https://www.tiktok.com/oembed?url=' + query};
  if (is('instagram.com')) return {source: 'Instagram', type: 'social'};
  if (is('facebook.com') || is('fb.watch')) return {source: 'Facebook', type: 'social'};
  return {source: host.replace(/^www\./, ''), type: 'article'};
}

const clean = (v: unknown): string | undefined => typeof v === 'string' ? v.trim().slice(0, 2000) || undefined : undefined;
function secureImage(v: unknown): string | undefined {
  const candidate = clean(v);
  if (!candidate) return;
  try { const url = new URL(candidate); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined; } catch { return; }
}

export async function fetchLinkMetadata(value: string, signal?: AbortSignal): Promise<LinkMetadata> {
  const parsed = parseSharedLink(value);
  if (!parsed) return {status: 'unsupported'};
  const provider = sourceForUrl(parsed.url);
  // Meta oEmbed is display-only. It does not expose a caption, author or thumbnail
  // as reusable structured metadata for arbitrary public Instagram posts.
  if (provider.source === 'Instagram' || provider.source === 'Facebook') return {status: 'limited'};
  if (!provider.endpoint) return {status: 'unsupported'};
  try {
    const response = await fetch(provider.endpoint, {headers: {Accept: 'application/json'}, signal});
    if (!response.ok) return {status: 'unavailable'};
    const data = await response.json();
    const title = clean(data.title);
    const creator = clean(data.author_name);
    const thumbnailUrl = secureImage(data.thumbnail_url);
    const tags = title?.match(/#[\p{L}\p{N}_]+/gu)?.map(t => t.slice(1));
    return {status: title || creator || thumbnailUrl ? 'loaded' : 'limited', title, creator, thumbnailUrl, tags: tags ? [...new Set(tags)] : undefined};
  } catch { return {status: 'unavailable'}; }
}

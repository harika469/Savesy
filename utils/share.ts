import { extractUrl } from './metadata';

export type IncomingShare = { text?: string | null; webUrl?: string | null; meta?: { title?: string | null } | null };
export type SharedSaveParams = { url?: string; sharedTitle?: string; sharedNote?: string };

/** Turns whatever another app shared into prefill values for the Save screen. */
export function shareToSaveParams(share: IncomingShare): SharedSaveParams | undefined {
  const text = share.text?.trim() ?? '';
  const url = share.webUrl?.trim() || (text ? extractUrl(text) : undefined);
  const title = share.meta?.title?.trim() || undefined;
  if (!url && !text) return undefined;
  // Shared text that isn't just the link becomes the note ("Look at this! https://…").
  let leftover = text;
  if (url) leftover = leftover.split(url).join(' ').replace(/\s+/g, ' ').trim();
  const note = leftover && leftover !== title && leftover !== url ? leftover : undefined;
  return { url, sharedTitle: title, sharedNote: note };
}

import type { SmartDetails } from '@/supabase/functions/_shared/enrich';
export type { SmartDetails };

export type SaveType = 'article' | 'video' | 'product' | 'place' | 'social' | 'other';

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  note?: string;
  type: SaveType;
  source?: string;
  imageUrl?: string;
  /** Recipe / place / product details from Smart Saves. */
  details?: SmartDetails;
  tags: string[];
  collectionId?: string;
  isFavorite: boolean;
  createdAt: string;
  /** Set on every change; the newer copy wins when syncing with the cloud. */
  updatedAt?: string;
  lastRediscoveredAt?: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export type NewSave = Omit<SavedItem, 'id' | 'createdAt' | 'updatedAt' | 'isFavorite'>;

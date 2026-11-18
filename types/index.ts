export type SaveType = 'article' | 'video' | 'product' | 'place' | 'social' | 'other';

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  note?: string;
  type: SaveType;
  source?: string;
  tags: string[];
  creator?: string;
  duration?: string;
  emoji?: string;
  gradient?: number;
  collectionId?: string;
  isFavorite: boolean;
  createdAt: string;
  lastRediscoveredAt?: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export type NewSave = Omit<SavedItem, 'id' | 'createdAt' | 'isFavorite'>;

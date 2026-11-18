import { Collection, SavedItem } from '@/types';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

export const seedCollections: Collection[] = [
  { id: 'recipes', name: 'Recipes', createdAt: daysAgo(30) },
  { id: 'travel', name: 'Travel', createdAt: daysAgo(30) },
  { id: 'fashion', name: 'Fashion', createdAt: daysAgo(30) },
  { id: 'home', name: 'Home', createdAt: daysAgo(30) },
  { id: 'try', name: 'To Try', createdAt: daysAgo(30) },
];

export const seedSaves: SavedItem[] = [
  { id: 'paneer', url: 'https://instagram.com/reel/paneer-butter-masala', title: '15-min Paneer Butter Masala', type: 'social', source: 'Instagram', creator: '@foodie_harika', duration: '0:32', emoji: '🍛', gradient: 0, tags: ['recipe', 'dinner'], collectionId: 'recipes', isFavorite: false, createdAt: daysAgo(0) },
  { id: 'amsterdam-cafe', url: 'https://instagram.com/reel/hidden-cafe-amsterdam', title: 'Hidden Cafe in Amsterdam', type: 'social', source: 'Instagram', creator: '@wanderlust', duration: '0:45', emoji: '☕', gradient: 1, tags: ['amsterdam', 'cafe'], collectionId: 'travel', isFavorite: false, createdAt: daysAgo(1) },
  { id: 'grwm', url: 'https://instagram.com/reel/grwm-wedding-outfit', title: 'GRWM - Wedding Outfit', type: 'social', source: 'Instagram', creator: '@style_diary', duration: '0:28', emoji: '👗', gradient: 2, tags: ['grwm', 'wedding'], collectionId: 'fashion', isFavorite: false, createdAt: daysAgo(2) },
  { id: 'workout', url: 'https://instagram.com/reel/home-workout', title: '15-min Home Workout', type: 'social', source: 'Instagram', creator: '@fit_daily', duration: '0:41', emoji: '💪', gradient: 3, tags: ['workout'], collectionId: 'home', isFavorite: false, createdAt: daysAgo(3) },
  { id: 'balcony', url: 'https://instagram.com/reel/balcony-makeover', title: 'Small Balcony Makeover', type: 'social', source: 'Instagram', creator: '@home.inspo', duration: '0:52', emoji: '🏠', gradient: 4, tags: ['decor'], collectionId: 'home', isFavorite: false, createdAt: daysAgo(10) },
  { id: 'hair-oiling', url: 'https://instagram.com/reel/hair-oiling-routine', title: 'Hair Oiling Routine', type: 'social', source: 'Instagram', creator: '@glowup', duration: '0:35', emoji: '💇‍♀️', gradient: 5, tags: ['haircare'], collectionId: 'fashion', isFavorite: false, createdAt: daysAgo(12) },
];

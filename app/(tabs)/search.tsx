import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SaveCard } from '@/components/SaveCard';
import { Screen } from '@/components/Screen';
import { FilterChip, ScreenHeader, SearchBar } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { SaveType } from '@/types';

type Filter = { label: string; value?: SaveType; favorites?: boolean };
const filters: Filter[] = [{ label: 'ALL' }, { label: '♥ FAVORITES', favorites: true }, { label: 'PRODUCTS', value: 'product' }, { label: 'VIDEOS', value: 'video' }, { label: 'PLACES', value: 'place' }, { label: 'ARTICLES', value: 'article' }, { label: 'SOCIAL', value: 'social' }, { label: 'OTHER', value: 'other' }];

export default function SearchScreen() {
  const { searchSaves, toggleFavorite, saves } = useSaves();
  const params = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const [filter, setFilter] = useState<Filter>(filters[0]);
  useEffect(() => { if (params.q !== undefined) setQuery(params.q); }, [params.q]);
  const results = useMemo(() => searchSaves(query, { type: filter.value, favoritesOnly: filter.favorites }), [query, filter, searchSaves]);
  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    saves.forEach(s => s.tags.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
  }, [saves]);
  return <Screen variant={1}>
    <ScreenHeader title="find that thing." subtitle="you know... that thing you saved." />
    <SearchBar value={query} onChangeText={setQuery} placeholder="Try ‘green dress’" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(f => <FilterChip key={f.label} label={f.label} active={f === filter} onPress={() => setFilter(f)} />)}</ScrollView>
    {!query && topTags.length ? <View style={styles.tags}>{topTags.map(tag => <Text key={tag} onPress={() => setQuery(tag)} style={styles.tag}>#{tag}</Text>)}</View> : null}
    <Text style={styles.count}>{results.length} {results.length === 1 ? 'THING' : 'THINGS'} FOUND</Text>
    <View style={{ gap: 10 }}>
      {results.map(item => <SaveCard key={item.id} item={item} onFavorite={() => toggleFavorite(item.id)} />)}
      {results.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>nothing hiding here.</Text><Text style={styles.emptyBody}>Try another word or loosen the filter.</Text></View> : null}
    </View>
  </Screen>;
}
const styles = StyleSheet.create({ filters: { gap: 8, paddingVertical: 17 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }, tag: { backgroundColor: colors.lavender, color: colors.purpleDark, fontSize: 12, fontWeight: '700', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 15, overflow: 'hidden' }, count: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: colors.gray, marginBottom: 12 }, empty: { paddingVertical: 55, alignItems: 'center' }, emptyTitle: { fontSize: 22, fontWeight: '900' }, emptyBody: { color: colors.gray, marginTop: 7 } });

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SaveCard } from '@/components/SaveCard';
import { Screen } from '@/components/Screen';
import { FilterChip, ScreenHeader, SearchBar } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { SaveType } from '@/types';

const filters: { label: string; value?: SaveType }[] = [{ label: 'ALL' }, { label: 'PRODUCTS', value: 'product' }, { label: 'VIDEOS', value: 'video' }, { label: 'PLACES', value: 'place' }, { label: 'ARTICLES', value: 'article' }];
export default function SearchScreen() {
  const { searchSaves, toggleFavorite } = useSaves(); const [query, setQuery] = useState(''); const [type, setType] = useState<SaveType>();
  const results = useMemo(() => searchSaves(query, type), [query, type, searchSaves]);
  return <Screen variant={1}><ScreenHeader title="find that thing." subtitle="you know... that thing you saved." /><SearchBar value={query} onChangeText={setQuery} placeholder="Try ‘green dress’" /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(filter => <FilterChip key={filter.label} label={filter.label} active={filter.value === type} onPress={() => setType(filter.value)} />)}</ScrollView><Text style={styles.count}>{results.length} {results.length === 1 ? 'THING' : 'THINGS'} FOUND</Text><View style={{ gap: 10 }}>{results.map(item => <SaveCard key={item.id} item={item} onFavorite={() => toggleFavorite(item.id)} />)}{results.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>nothing hiding here.</Text><Text style={styles.emptyBody}>Try another word or loosen the filter.</Text></View> : null}</View></Screen>;
}
const styles = StyleSheet.create({ filters: { gap: 8, paddingVertical: 17 }, count: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: colors.gray, marginBottom: 12 }, empty: { paddingVertical: 55, alignItems: 'center' }, emptyTitle: { fontSize: 22, fontWeight: '900' }, emptyBody: { color: colors.gray, marginTop: 7 } });

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';

export default function NotFoundScreen() {
  return <View style={styles.screen}><Text style={styles.title}>this page wandered off.</Text><Link href="/" style={styles.link}>Back to your saves →</Link></View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.paper, justifyContent: 'center', alignItems: 'center', padding: 24 }, title: { fontSize: 28, fontWeight: '900' }, link: { marginTop: 18, fontWeight: '800', textDecorationLine: 'underline' } });

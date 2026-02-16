import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import type {StackScreenProps} from '@react-navigation/stack';
import type {RootStackParamList} from '../navigation';

type Props = StackScreenProps<RootStackParamList, 'TourEnded'>;

export default function TourEndedScreen({navigation, route}: Props) {
  const {summary} = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.checkmark}>Done</Text>
      <Text style={styles.title}>Tour Complete</Text>
      <Text style={styles.subtitle}>Thanks for exploring with us</Text>

      <View style={styles.statsCard}>
        <StatRow label="Duration" value={`${summary.duration_minutes} min`} />
        <StatRow label="Spots Visited" value={`${summary.spots_visited.length}`} />
        <StatRow label="Interactions" value={`${summary.interactions}`} />
      </View>

      {summary.spots_visited.length > 0 && (
        <View style={styles.spotsCard}>
          <Text style={styles.spotsTitle}>Places Visited</Text>
          {summary.spots_visited.map((spotId, i) => (
            <Text key={spotId} style={styles.spotText}>
              {i + 1}. {spotId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.doneButton}
        activeOpacity={0.8}
        onPress={() => navigation.replace('Locating')}>
        <Text style={styles.doneButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#4CAF50',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#8888AA',
    fontSize: 16,
    marginBottom: 32,
  },
  statsCard: {
    backgroundColor: '#16213E',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A4A',
  },
  statLabel: {
    color: '#8888AA',
    fontSize: 15,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  spotsCard: {
    backgroundColor: '#16213E',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 32,
  },
  spotsTitle: {
    color: '#E8C547',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  spotText: {
    color: '#EEEEFF',
    fontSize: 14,
    lineHeight: 24,
  },
  doneButton: {
    backgroundColor: '#E8C547',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
  },
  doneButtonText: {
    color: '#1A1A2E',
    fontSize: 18,
    fontWeight: '700',
  },
});

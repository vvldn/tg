import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {getTourDetail} from '../services/api';
import {getBundle, downloadBundle} from '../services/BundleStorage';
import type {NearestTourResponse, TourDetailResponse} from '../types';
import type {StackScreenProps} from '@react-navigation/stack';
import type {RootStackParamList} from '../navigation';

type Props = StackScreenProps<RootStackParamList, 'TourReady'>;

export default function TourReadyScreen({navigation, route}: Props) {
  const {nearestTour} = route.params;
  const [detail, setDetail] = useState<TourDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bundleReady, setBundleReady] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchDetail() {
      try {
        const data = await getTourDetail(nearestTour.tour_id);
        if (!cancelled) {
          setDetail(data);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function checkBundle() {
      const cached = await getBundle(nearestTour.tour_id);
      if (!cancelled) {
        setBundleReady(cached !== null);
      }
    }

    fetchDetail();
    checkBundle();
    return () => {
      cancelled = true;
    };
  }, [nearestTour]);

  const tour = detail || nearestTour;

  if (loading && !detail) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#E8C547" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}>
        {/* Header badge */}
        {(tour as any).heritage_status && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {(tour as any).heritage_status}
            </Text>
          </View>
        )}

        {/* Tour name */}
        <Text style={styles.tourName}>{tour.name}</Text>

        {/* Location */}
        {(tour as any).city && (
          <Text style={styles.location}>
            {(tour as any).city}
            {(tour as any).country ? `, ${(tour as any).country}` : ''}
          </Text>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatItem
            label="Duration"
            value={`${tour.estimated_duration_minutes} min`}
          />
          <StatItem label="Stops" value={`${tour.spot_count}`} />
          {'distance_meters' in tour && (
            <StatItem
              label="Distance"
              value={`${(tour as NearestTourResponse).distance_meters}m`}
            />
          )}
        </View>

        {/* Extra detail fields */}
        {detail?.inception && (
          <DetailRow label="Built" value={detail.inception} />
        )}
        {detail?.architect && (
          <DetailRow label="Architect" value={detail.architect} />
        )}
        {detail?.architectural_style && (
          <DetailRow label="Style" value={detail.architectural_style} />
        )}

        {/* Spots list */}
        {detail?.spots_preview && detail.spots_preview.length > 0 && (
          <View style={styles.spotsSection}>
            <Text style={styles.spotsTitle}>Tour Stops</Text>
            {detail.spots_preview.map((spot, i) => (
              <View key={spot.id} style={styles.spotRow}>
                <View style={styles.spotNumber}>
                  <Text style={styles.spotNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.spotName}>{spot.name}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Start button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.startButton, downloading && styles.startButtonDisabled]}
          activeOpacity={0.8}
          disabled={downloading}
          onPress={async () => {
            if (!bundleReady) {
              setDownloading(true);
              try {
                await downloadBundle(tour.tour_id);
                setBundleReady(true);
                navigation.replace('ActiveTour', {tourId: tour.tour_id, tourName: tour.name});
              } catch {
                setDownloading(false);
              }
            } else {
              navigation.replace('ActiveTour', {tourId: tour.tour_id, tourName: tour.name});
            }
          }}>
          {downloading ? (
            <View style={styles.downloadingRow}>
              <ActivityIndicator size="small" color="#1A1A2E" />
              <Text style={styles.startButtonText}>Downloading...</Text>
            </View>
          ) : (
            <Text style={styles.startButtonText}>
              {bundleReady ? 'Start Tour' : 'Download & Start Tour'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StatItem({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 100,
  },
  badge: {
    backgroundColor: '#E8C54733',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  badgeText: {
    color: '#E8C547',
    fontSize: 12,
    fontWeight: '600',
  },
  tourName: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
  },
  location: {
    color: '#8888AA',
    fontSize: 16,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: '#8888AA',
    fontSize: 12,
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A4A',
  },
  detailLabel: {
    color: '#8888AA',
    fontSize: 14,
  },
  detailValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    marginLeft: 16,
    textAlign: 'right',
  },
  spotsSection: {
    marginTop: 24,
  },
  spotsTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  spotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A4A',
  },
  spotNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2A2A4A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  spotNumberText: {
    color: '#E8C547',
    fontSize: 13,
    fontWeight: '700',
  },
  spotName: {
    color: '#FFFFFF',
    fontSize: 15,
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: '#1A1A2E',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A4A',
  },
  startButton: {
    backgroundColor: '#E8C547',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#1A1A2E',
    fontSize: 18,
    fontWeight: '700',
  },
  startButtonDisabled: {
    opacity: 0.7,
  },
  downloadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

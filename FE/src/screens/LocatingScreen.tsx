import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {findNearestTour} from '../services/api';
import type {NearestTourResponse} from '../types';
import type {StackScreenProps} from '@react-navigation/stack';
import type {RootStackParamList} from '../navigation';

type Props = StackScreenProps<RootStackParamList, 'Locating'>;

export default function LocatingScreen({navigation}: Props) {
  const [status, setStatus] = useState('Acquiring location...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function locate() {
      try {
        Geolocation.requestAuthorization();

        const position = await new Promise<{coords: {latitude: number; longitude: number}}>(
          (resolve, reject) => {
            Geolocation.getCurrentPosition(resolve as any, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 10000,
            });
          },
        );

        if (cancelled) {
          return;
        }
        const {latitude, longitude} = position.coords;
        setStatus('Finding nearby tours...');

        const tour = await findNearestTour(latitude, longitude);
        if (cancelled) {
          return;
        }
        navigation.replace('TourReady', {nearestTour: tour});
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to find tours');
        }
      }
    }

    locate();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      {error ? (
        <>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text
            style={styles.retryText}
            onPress={() => {
              setError(null);
              setStatus('Acquiring location...');
              // Re-trigger by remounting via navigation
              navigation.replace('Locating');
            }}>
            Tap to retry
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color="#E8C547" />
          <Text style={styles.statusText}>{status}</Text>
          <Text style={styles.subtitleText}>
            Looking for heritage sites near you
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
    textAlign: 'center',
  },
  subtitleText: {
    color: '#8888AA',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  errorIcon: {
    color: '#FF6B6B',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 16,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryText: {
    color: '#E8C547',
    fontSize: 16,
    fontWeight: '600',
  },
});

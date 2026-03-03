import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {v4 as uuidv4} from 'uuid';
import Geolocation from '@react-native-community/geolocation';
import {launchCamera} from 'react-native-image-picker';
import {LOCATION_UPDATE_INTERVAL_MS, INTERRUPT_DEBOUNCE_MS} from '../config';
import {TourEngine} from '../services/TourEngine';
import {QuestionService} from '../services/QuestionService';
import {getBundle} from '../services/BundleStorage';
import type {TranscriptEntry} from '../types';
import type {StackScreenProps} from '@react-navigation/stack';
import type {RootStackParamList} from '../navigation';

type Props = StackScreenProps<RootStackParamList, 'ActiveTour'>;

export default function ActiveTourScreen({navigation, route}: Props) {
  const {tourId, tourName} = route.params;
  const engineRef = useRef<TourEngine | null>(null);
  const questionServiceRef = useRef<QuestionService | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastInterruptTimeRef = useRef(0);

  const [tourState, setTourState] = useState<'LOADING' | 'NARRATING' | 'PROCESSING'>('LOADING');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentSpot, setCurrentSpot] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const appendChunk = useCallback(
    (type: 'narration' | 'response', chunk: string, spotId?: string, refId?: string) => {
      setTranscript(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === type && last.spotId === spotId && last.refInterruptId === refId) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: last.text + ' ' + chunk,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: uuidv4(),
            type,
            text: chunk,
            spotId,
            refInterruptId: refId,
          },
        ];
      });
    },
    [],
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const canInterrupt = useCallback(() => {
    const now = Date.now();
    if (now - lastInterruptTimeRef.current < INTERRUPT_DEBOUNCE_MS) {
      return false;
    }
    lastInterruptTimeRef.current = now;
    return true;
  }, []);

  // Initialize local tour engine from cached bundle
  useEffect(() => {
    let destroyed = false;

    async function initTour() {
      const bundle = await getBundle(tourId);
      if (destroyed) return;

      if (!bundle) {
        showToast('Bundle not found. Please go back and try again.');
        return;
      }

      const engine = new TourEngine(bundle);
      const questionService = new QuestionService(tourId);

      engine.on(event => {
        if (destroyed) return;
        switch (event.type) {
          case 'narration':
            appendChunk('narration', event.chunk, event.spotId);
            break;
          case 'spot_transition':
            setCurrentSpot(event.spotName);
            showToast(`Arrived at: ${event.spotName}`);
            questionService.onSpotTransition();
            break;
          case 'tour_complete':
            engine.destroy();
            navigation.replace('TourEnded', {summary: event.summary});
            break;
          case 'state_change':
            if (event.state === 'narrating') {
              setTourState('NARRATING');
            }
            break;
        }
      });

      engineRef.current = engine;
      questionServiceRef.current = questionService;

      // Set initial spot name
      const firstSpot = engine.getCurrentSpot();
      setCurrentSpot(firstSpot.name);
      setTourState('NARRATING');

      engine.start();
    }

    initTour();

    return () => {
      destroyed = true;
      engineRef.current?.destroy();
    };
  }, [tourId, appendChunk, showToast, navigation]);

  // Location updates — feed into local engine
  useEffect(() => {
    locationTimerRef.current = setInterval(() => {
      Geolocation.getCurrentPosition(
        pos => {
          engineRef.current?.onLocationUpdate(
            pos.coords.latitude,
            pos.coords.longitude,
          );
        },
        () => {},
        {enableHighAccuracy: true, timeout: 5000, maximumAge: 5000},
      );
    }, LOCATION_UPDATE_INTERVAL_MS);

    return () => {
      if (locationTimerRef.current) {
        clearInterval(locationTimerRef.current);
      }
    };
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 100);
  }, [transcript]);

  // --- Action handlers ---

  const handleSkip = useCallback(() => {
    if (!canInterrupt()) return;
    engineRef.current?.skip();
  }, [canInterrupt]);

  const handleRepeat = useCallback(() => {
    if (!canInterrupt()) return;
    engineRef.current?.repeat();
  }, [canInterrupt]);

  const handleDetails = useCallback(async () => {
    if (!canInterrupt()) return;
    const engine = engineRef.current;
    const qs = questionServiceRef.current;
    if (!engine || !qs) return;

    engine.onQuestionStart();
    setTourState('PROCESSING');

    try {
      const spot = engine.getCurrentSpot();
      const answer = await qs.ask(
        spot.id,
        `Tell me more about ${spot.name}. Share interesting details, stories, or architectural features that weren't covered in the main narration.`,
      );
      appendChunk('response', answer, undefined, uuidv4());
    } catch {
      showToast('Could not get details. Check your connection.');
    }

    setTourState('NARRATING');
    engine.onQuestionEnd();
  }, [canInterrupt, appendChunk, showToast]);

  const handleCameraInterrupt = useCallback(() => {
    if (!canInterrupt()) return;
    launchCamera(
      {mediaType: 'photo', quality: 0.7, includeBase64: true},
      async result => {
        if (result.didCancel || result.errorCode || !result.assets?.[0]?.base64) {
          return;
        }
        const engine = engineRef.current;
        const qs = questionServiceRef.current;
        if (!engine || !qs) return;

        engine.onQuestionStart();
        setTourState('PROCESSING');

        try {
          const spot = engine.getCurrentSpot();
          const answer = await qs.askWithImage(spot.id, result.assets[0].base64!);
          appendChunk('response', answer, undefined, uuidv4());
        } catch {
          showToast('Could not analyze image. Check your connection.');
        }

        setTourState('NARRATING');
        engine.onQuestionEnd();
      },
    );
  }, [canInterrupt, appendChunk, showToast]);

  const handleEndTour = useCallback(() => {
    Alert.alert('End Tour', 'Are you sure you want to end the tour?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'End Tour',
        style: 'destructive',
        onPress: () => {
          engineRef.current?.end();
        },
      },
    ]);
  }, []);

  if (tourState === 'LOADING') {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#E8C547" />
        <Text style={styles.loadingText}>Loading tour...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.tourTitle} numberOfLines={1}>
            {tourName}
          </Text>
          {currentSpot && (
            <Text style={styles.spotLabel} numberOfLines={1}>
              {currentSpot}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={handleEndTour} style={styles.endButton}>
          <Text style={styles.endButtonText}>End Tour</Text>
        </TouchableOpacity>
      </View>

      {/* Transcript */}
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}>
        {transcript.map(entry => (
          <View
            key={entry.id}
            style={[
              styles.transcriptEntry,
              entry.type === 'response' && styles.responseEntry,
            ]}>
            <Text style={styles.entryLabel}>
              {entry.type === 'narration' ? 'Guide' : 'Answer'}
            </Text>
            <Text style={styles.entryText}>{entry.text}</Text>
          </View>
        ))}
        {tourState === 'PROCESSING' && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color="#E8C547" />
            <Text style={styles.thinkingText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Toast overlay */}
      {toastMessage && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={styles.controls}>
        <View style={styles.actionRow}>
          <ActionButton label="Skip" onPress={handleSkip} />
          <ActionButton label="Repeat" onPress={handleRepeat} />
          <ActionButton label="Details" onPress={handleDetails} />
        </View>

        <View style={styles.mainRow}>
          <TouchableOpacity
            style={styles.cameraButton}
            activeOpacity={0.7}
            onPress={handleCameraInterrupt}>
            <Text style={styles.cameraButtonIcon}>CAM</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#E8C547',
    fontSize: 16,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#16213E',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A4A',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  tourTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  spotLabel: {
    color: '#E8C547',
    fontSize: 13,
    marginTop: 2,
  },
  endButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  endButtonText: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '600',
  },
  transcript: {
    flex: 1,
  },
  transcriptContent: {
    padding: 16,
    paddingBottom: 24,
  },
  transcriptEntry: {
    marginBottom: 16,
    backgroundColor: '#16213E',
    borderRadius: 12,
    padding: 14,
  },
  responseEntry: {
    backgroundColor: '#1F3460',
    borderLeftWidth: 3,
    borderLeftColor: '#E8C547',
  },
  entryLabel: {
    color: '#8888AA',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  entryText: {
    color: '#EEEEFF',
    fontSize: 16,
    lineHeight: 24,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  thinkingText: {
    color: '#E8C547',
    fontSize: 14,
  },
  toast: {
    position: 'absolute',
    top: 110,
    left: 24,
    right: 24,
    backgroundColor: '#E8C547',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  toastText: {
    color: '#1A1A2E',
    fontSize: 14,
    fontWeight: '600',
  },
  controls: {
    backgroundColor: '#16213E',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A4A',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#2A2A4A',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  actionButtonText: {
    color: '#EEEEFF',
    fontSize: 14,
    fontWeight: '500',
  },
  mainRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
  },
  cameraButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2A2A4A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E8C547',
  },
  cameraButtonIcon: {
    color: '#E8C547',
    fontSize: 13,
    fontWeight: '700',
  },
});

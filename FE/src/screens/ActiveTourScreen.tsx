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
import {USE_MOCK_WS, LOCATION_UPDATE_INTERVAL_MS, INTERRUPT_DEBOUNCE_MS} from '../config';
import {WebSocketClient} from '../services/WebSocketClient';
import {MockWebSocket} from '../services/MockWebSocket';
import type {
  AppState,
  TranscriptEntry,
  NarrationMessage,
  ResponseMessage,
  AckInterruptMessage,
  StopArrivedMessage,
  TourCompleteMessage,
  TourStartMessage,
  ErrorMessage,
} from '../types';
import type {StackScreenProps} from '@react-navigation/stack';
import type {RootStackParamList} from '../navigation';

type Props = StackScreenProps<RootStackParamList, 'ActiveTour'>;

type WSClient = WebSocketClient | MockWebSocket;

export default function ActiveTourScreen({navigation, route}: Props) {
  const {tourId, tourName} = route.params;
  const wsRef = useRef<WSClient | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastInterruptTimeRef = useRef(0);
  const seqStoppedRef = useRef<number>(0);

  const [tourState, setTourState] = useState<'NARRATING' | 'PROCESSING'>('NARRATING');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentSpot, setCurrentSpot] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Add text to transcript, merging consecutive chunks of the same type and source
  const appendChunk = useCallback(
    (type: 'narration' | 'response', chunk: string, spotId?: string, refId?: string) => {
      setTranscript(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === type && last.spotId === spotId && last.refInterruptId === refId) {
          // Append to existing entry
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: last.text + ' ' + chunk,
          };
          return updated;
        }
        // New entry
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

  // Show a transient toast
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Debounced interrupt check
  const canInterrupt = useCallback(() => {
    const now = Date.now();
    if (now - lastInterruptTimeRef.current < INTERRUPT_DEBOUNCE_MS) {
      return false;
    }
    lastInterruptTimeRef.current = now;
    return true;
  }, []);

  // Setup WebSocket connection
  useEffect(() => {
    const ws: WSClient = USE_MOCK_WS
      ? new MockWebSocket()
      : new WebSocketClient(tourId);
    wsRef.current = ws;

    ws.on('tour_start', (msg: TourStartMessage) => {
      if (msg.spots.length > 0) {
        setCurrentSpot(msg.spots[0].name);
      }
    });

    ws.on('narration', (msg: NarrationMessage) => {
      setTourState('NARRATING');
      appendChunk('narration', msg.chunk, msg.spot_id);
    });

    ws.on('response', (msg: ResponseMessage) => {
      setTourState('NARRATING');
      appendChunk('response', msg.chunk, undefined, msg.ref_interrupt_id);
    });

    ws.on('ack_interrupt', (msg: AckInterruptMessage) => {
      seqStoppedRef.current = msg.seq_stopped;
      setTourState('PROCESSING');
    });

    ws.on('stop_arrived', (msg: StopArrivedMessage) => {
      setCurrentSpot(msg.name);
      showToast(`Arrived at: ${msg.name}`);
    });

    ws.on('tour_complete', (msg: TourCompleteMessage) => {
      ws.disconnect();
      navigation.replace('TourEnded', {summary: msg.summary});
    });

    ws.on('error', (msg: ErrorMessage) => {
      if (msg.message) {
        showToast(msg.message);
      }
    });

    ws.connect();

    return () => {
      ws.disconnect();
    };
  }, [tourId, appendChunk, showToast, navigation]);

  // Location updates
  useEffect(() => {
    locationTimerRef.current = setInterval(() => {
      Geolocation.getCurrentPosition(
        pos => {
          wsRef.current?.send({
            type: 'location_update',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? 0,
            speed: pos.coords.speed ?? 0,
            accuracy: pos.coords.accuracy ?? 10,
          });
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

  // --- Interrupt handlers ---

  const handleActionInterrupt = useCallback(
    (action: 'skip' | 'repeat' | 'details') => {
      if (!canInterrupt()) {
        return;
      }
      setTourState('PROCESSING');
      wsRef.current?.send({
        type: 'interrupt:action',
        id: uuidv4(),
        action,
      });
    },
    [canInterrupt],
  );

  const handleCameraInterrupt = useCallback(() => {
    if (!canInterrupt()) {
      return;
    }
    launchCamera(
      {mediaType: 'photo', quality: 0.7, includeBase64: true},
      result => {
        if (result.didCancel || result.errorCode || !result.assets?.[0]?.base64) {
          return;
        }
        const asset = result.assets[0];
        setTourState('PROCESSING');

        Geolocation.getCurrentPosition(
          pos => {
            wsRef.current?.send({
              type: 'interrupt:camera',
              id: uuidv4(),
              frame: asset.base64!,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? 0,
            });
          },
          () => {
            // If GPS fails, send with zeros
            wsRef.current?.send({
              type: 'interrupt:camera',
              id: uuidv4(),
              frame: asset.base64!,
              lat: 0,
              lng: 0,
              heading: 0,
            });
          },
          {enableHighAccuracy: true, timeout: 5000},
        );
      },
    );
  }, [canInterrupt]);

  const handleEndTour = useCallback(() => {
    Alert.alert('End Tour', 'Are you sure you want to end the tour?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'End Tour',
        style: 'destructive',
        onPress: () => {
          wsRef.current?.send({type: 'tour_end'});
        },
      },
    ]);
  }, []);

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
        {/* Action buttons row */}
        <View style={styles.actionRow}>
          <ActionButton label="Skip" onPress={() => handleActionInterrupt('skip')} />
          <ActionButton label="Repeat" onPress={() => handleActionInterrupt('repeat')} />
          <ActionButton label="Details" onPress={() => handleActionInterrupt('details')} />
        </View>

        {/* Main interaction row */}
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

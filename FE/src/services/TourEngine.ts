import type {MonumentBundle, Spot} from '../types/bundle';
import {haversineDistance, SPOT_PROXIMITY_THRESHOLD_M} from '../utils/geo';

// ~150 words per minute. Average word ~6 chars.
// 150 * 6 = 900 chars/min = 15 chars/sec.
const CHARS_PER_SECOND = 15;

export type TourEngineEvent =
  | {type: 'narration'; chunk: string; spotId: string; isFinal: boolean}
  | {type: 'spot_transition'; spotId: string; spotName: string; order: number}
  | {type: 'tour_complete'; summary: TourSummary}
  | {type: 'state_change'; state: 'narrating' | 'paused' | 'idle'};

export interface TourSummary {
  duration_minutes: number;
  spots_visited: string[];
  interactions: number;
}

type TourEngineListener = (event: TourEngineEvent) => void;

function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  const regex = /[^.!?]*[.!?]+[\s]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push(text.trim());
  }
  return sentences;
}

function calculateDelay(text: string): number {
  return Math.max(200, (text.length / CHARS_PER_SECOND) * 1000);
}

export class TourEngine {
  private bundle: MonumentBundle;
  private currentSpotIndex: number = 0;
  private narrationPosition: number = 0;
  private _isPaused: boolean = false;
  private narrationTimer: ReturnType<typeof setTimeout> | null = null;
  private spotsVisited: string[] = [];
  private startedAt: number = 0;
  private interactionCount: number = 0;
  private listeners: Set<TourEngineListener> = new Set();
  private aborted: boolean = false;

  constructor(bundle: MonumentBundle) {
    this.bundle = bundle;
  }

  start(): void {
    this.startedAt = Date.now();
    this.currentSpotIndex = 0;
    this.narrationPosition = 0;
    this.aborted = false;
    this.startNarration();
  }

  pause(): void {
    this._isPaused = true;
    this.cancelTimer();
    this.emit({type: 'state_change', state: 'paused'});
  }

  resume(): void {
    this._isPaused = false;
    this.emit({type: 'state_change', state: 'narrating'});
    this.resumeNarration();
  }

  skip(): void {
    this.cancelTimer();
    this.interactionCount++;
    this.advanceToNextSpot();
  }

  repeat(): void {
    this.cancelTimer();
    this.interactionCount++;
    this.narrationPosition = 0;
    this.startNarration();
  }

  end(): void {
    this.cancelTimer();
    this.aborted = true;
    this.emitTourComplete();
  }

  onQuestionStart(): void {
    this.cancelTimer();
    this.interactionCount++;
    this.emit({type: 'state_change', state: 'idle'});
  }

  onQuestionEnd(): void {
    if (!this._isPaused) {
      this.resumeNarration();
    }
  }

  onLocationUpdate(lat: number, lng: number): void {
    const spotOrder = this.bundle.route.spot_order;
    const nextIndex = this.currentSpotIndex + 1;
    if (nextIndex >= spotOrder.length) return;

    const nextSpotId = spotOrder[nextIndex];
    const nextSpot = this.bundle.spots.find(s => s.id === nextSpotId);
    if (!nextSpot) return;

    const distance = haversineDistance(
      {lat, lng},
      {lat: nextSpot.lat, lng: nextSpot.lng},
    );

    if (distance <= SPOT_PROXIMITY_THRESHOLD_M) {
      this.transitionToSpot(nextIndex);
    }
  }

  getCurrentSpot(): Spot {
    const spotId = this.bundle.route.spot_order[this.currentSpotIndex];
    return this.bundle.spots.find(s => s.id === spotId)!;
  }

  getBundle(): MonumentBundle {
    return this.bundle;
  }

  on(listener: TourEngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.cancelTimer();
    this.aborted = true;
    this.listeners.clear();
  }

  // --- Private ---

  private startNarration(): void {
    const spot = this.getCurrentSpot();

    if (!this.spotsVisited.includes(spot.id)) {
      this.spotsVisited.push(spot.id);
    }

    const sentences: string[] = [];
    if (spot.walking_from_previous) {
      sentences.push(...splitIntoSentences(spot.walking_from_previous));
    }
    sentences.push(...splitIntoSentences(spot.narration_text));

    this.narrationPosition = 0;
    this.emit({type: 'state_change', state: 'narrating'});
    this.streamSentences(sentences, spot.id);
  }

  private resumeNarration(): void {
    if (this._isPaused) return;

    const spot = this.getCurrentSpot();
    const allSentences: string[] = [];
    if (spot.walking_from_previous) {
      allSentences.push(...splitIntoSentences(spot.walking_from_previous));
    }
    allSentences.push(...splitIntoSentences(spot.narration_text));

    const remaining = allSentences.slice(this.narrationPosition);
    if (remaining.length === 0) {
      this.advanceToNextSpot();
      return;
    }

    this.emit({type: 'state_change', state: 'narrating'});
    this.streamSentences(remaining, spot.id);
  }

  private streamSentences(sentences: string[], spotId: string): void {
    let index = 0;

    const sendNext = (): void => {
      if (this.aborted) return;
      if (this._isPaused) return;
      if (index >= sentences.length) {
        this.advanceToNextSpot();
        return;
      }

      const chunk = sentences[index];
      const isFinal = index === sentences.length - 1;

      this.emit({type: 'narration', chunk, spotId, isFinal});
      this.narrationPosition++;
      index++;

      const delay = calculateDelay(chunk);
      if (!isFinal) {
        this.narrationTimer = setTimeout(sendNext, delay);
      } else {
        this.narrationTimer = setTimeout(() => {
          this.advanceToNextSpot();
        }, delay);
      }
    };

    sendNext();
  }

  private advanceToNextSpot(): void {
    const spotOrder = this.bundle.route.spot_order;
    const nextIndex = this.currentSpotIndex + 1;

    if (nextIndex >= spotOrder.length) {
      this.emitTourComplete();
      return;
    }

    this.currentSpotIndex = nextIndex;
    this.narrationPosition = 0;

    const nextSpot = this.getCurrentSpot();

    this.emit({
      type: 'spot_transition',
      spotId: nextSpot.id,
      spotName: nextSpot.name,
      order: nextSpot.narration_order,
    });

    this.startNarration();
  }

  private transitionToSpot(targetIndex: number): void {
    this.cancelTimer();
    this.currentSpotIndex = targetIndex;
    this.narrationPosition = 0;

    const spot = this.getCurrentSpot();

    this.emit({
      type: 'spot_transition',
      spotId: spot.id,
      spotName: spot.name,
      order: spot.narration_order,
    });

    this.startNarration();
  }

  private cancelTimer(): void {
    if (this.narrationTimer) {
      clearTimeout(this.narrationTimer);
      this.narrationTimer = null;
    }
  }

  private emit(event: TourEngineEvent): void {
    this.listeners.forEach(fn => fn(event));
  }

  private emitTourComplete(): void {
    const durationMinutes = Math.round(
      (Date.now() - this.startedAt) / 60_000,
    );
    this.emit({
      type: 'tour_complete',
      summary: {
        duration_minutes: durationMinutes,
        spots_visited: this.spotsVisited,
        interactions: this.interactionCount,
      },
    });
  }
}

export interface LatLng {
  lat: number;
  lng: number;
}

// --- REST API Types ---

export interface NearestTourResponse {
  tour_id: string;
  name: string;
  center: LatLng;
  distance_meters: number;
  city: string | null;
  country: string | null;
  heritage_status: string | null;
  estimated_duration_minutes: number;
  spot_count: number;
  thumbnail_url: string | null;
}

export interface TourDetailResponse {
  tour_id: string;
  name: string;
  center: LatLng;
  city: string | null;
  country: string | null;
  heritage_status: string | null;
  inception: string | null;
  architect: string | null;
  architectural_style: string | null;
  estimated_duration_minutes: number;
  spot_count: number;
  spots_preview: Array<{ id: string; name: string; order: number }>;
  overview_text: string;
  thumbnail_url: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

// --- WebSocket Client -> Server ---

export interface InterruptVoiceMessage {
  type: 'interrupt:voice';
  id: string;
  audio: string;
  format: 'wav' | 'mp3' | 'ogg';
  duration_ms: number;
  sample_rate: number;
}

export interface InterruptCameraMessage {
  type: 'interrupt:camera';
  id: string;
  frame: string;
  lat: number;
  lng: number;
  heading: number;
  text?: string;
}

export type InterruptAction = 'pause' | 'resume' | 'repeat' | 'skip' | 'details';

export interface InterruptActionMessage {
  type: 'interrupt:action';
  id: string;
  action: InterruptAction;
}

export interface LocationUpdateMessage {
  type: 'location_update';
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  accuracy: number;
}

export interface TourEndMessage {
  type: 'tour_end';
}

export type ClientMessage =
  | InterruptVoiceMessage
  | InterruptCameraMessage
  | InterruptActionMessage
  | LocationUpdateMessage
  | TourEndMessage;

// --- WebSocket Server -> Client ---

export interface TourStartMessage {
  type: 'tour_start';
  tour_id: string;
  name: string;
  spots: Array<{ id: string; name: string; order: number }>;
  estimated_duration_minutes: number;
}

export interface NarrationMessage {
  type: 'narration';
  seq: number;
  chunk: string;
  spot_id: string;
  is_final: boolean;
}

export interface ResponseMessage {
  type: 'response';
  seq: number;
  chunk: string;
  ref_interrupt_id: string;
  is_final: boolean;
}

export interface AckInterruptMessage {
  type: 'ack_interrupt';
  interrupt_id: string;
  seq_stopped: number;
}

export interface StopArrivedMessage {
  type: 'stop_arrived';
  spot_id: string;
  name: string;
  order: number;
}

export interface TourCompleteMessage {
  type: 'tour_complete';
  summary: {
    duration_minutes: number;
    spots_visited: string[];
    interactions: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  code: 'stt_failed' | 'llm_timeout' | 'invalid_message' | 'internal';
  message: string;
}

export interface AudioMetaMessage {
  type: 'audio_meta';
  seq: number;
  format: 'mp3' | 'wav' | 'opus';
  sample_rate: number;
  chunk_index: number;
  is_final: boolean;
  ref_type: 'narration' | 'response';
}

export type ServerMessage =
  | TourStartMessage
  | NarrationMessage
  | ResponseMessage
  | AckInterruptMessage
  | StopArrivedMessage
  | TourCompleteMessage
  | ErrorMessage
  | AudioMetaMessage;

// --- App State ---

export type AppState =
  | 'LOCATING'
  | 'TOUR_READY'
  | 'NARRATING'
  | 'PROCESSING'
  | 'TOUR_ENDED';

export interface TranscriptEntry {
  id: string;
  type: 'narration' | 'response';
  text: string;
  spotId?: string;
  refInterruptId?: string;
}

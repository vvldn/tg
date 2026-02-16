/**
 * TypeScript types for the Monument Bundle schema.
 * Used by both BE (runtime server) and FE (React Native app).
 *
 * Source of truth: contracts/bundle.schema.json
 * DO NOT modify these types without updating the schema first.
 */

// --- Primitives ---

export interface LatLng {
  lat: number;
  lng: number;
}

// --- Story ---

export type StoryType = "history" | "architecture" | "legend" | "anecdote";

export interface Story {
  title: string;
  narration_text: string;
  type: StoryType;
  duration_seconds?: number;
  sources?: string[];
}

// --- Spot ---

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  narration_order: number;
  walking_from_previous: string | null;
  walking_seconds_from_previous: number;
  narration_text: string;
  narration_duration_seconds: number;
  stories: Story[];
  architectural_notes: string | null;
  visual_anchors: string[];
  visitor_context: string | null;
}

// --- Monument ---

export interface Monument {
  id: string;
  name: string;
  wikidata_qid: string | null;
  center: LatLng;
  city: string | null;
  country: string | null;
  inception: string | null;
  architect: string | null;
  architectural_style: string | null;
  unesco_id: string | null;
  heritage_status: string | null;
}

// --- Overview ---

export interface TimelineEvent {
  year: string;
  event: string;
  description?: string;
  source?: string;
}

export interface Figure {
  name: string;
  role: string;
  description?: string;
  source?: string;
}

export interface Overview {
  narration_text: string;
  narration_duration_seconds: number;
  cultural_significance: string | null;
  timeline: TimelineEvent[];
  figures: Figure[];
}

// --- Route ---

export interface Route {
  total_walking_minutes: number;
  total_narration_minutes: number;
  total_tour_minutes: number;
  spot_order: string[];
}

// --- Source ---

export interface SourceInfo {
  url?: string;
  fetched_at?: string;
  qid?: string;
}

// --- Quality ---

export type Confidence = "high" | "medium" | "low";

export interface Quality {
  confidence: Confidence;
  total_source_words: number;
  total_narration_words: number;
  spots_with_thin_content: string[];
  unverified_claims: string[];
  human_reviewed: boolean;
}

// --- Bundle (top-level) ---

export interface MonumentBundle {
  version: "1.0";
  generated_at: string;
  pipeline_version?: string;
  monument: Monument;
  overview: Overview;
  spots: Spot[];
  route: Route;
  sources: Record<string, SourceInfo>;
  quality: Quality;
}

// --- REST API Types ---

export interface NearestTourRequest {
  lat: number;
  lng: number;
}

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

// --- WebSocket Message Types ---

// Client → Server

export interface InterruptVoiceMessage {
  type: "interrupt:voice";
  id: string;
  audio: string; // base64
  format: "wav" | "mp3" | "ogg";
  duration_ms: number;
  sample_rate: number;
}

export interface InterruptCameraMessage {
  type: "interrupt:camera";
  id: string;
  frame: string; // base64 jpeg
  lat: number;
  lng: number;
  heading: number;
  text?: string;
}

export type InterruptAction = "pause" | "resume" | "repeat" | "skip" | "details";

export interface InterruptActionMessage {
  type: "interrupt:action";
  id: string;
  action: InterruptAction;
}

export interface LocationUpdateMessage {
  type: "location_update";
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  accuracy: number;
}

export interface TourEndMessage {
  type: "tour_end";
}

export type ClientMessage =
  | InterruptVoiceMessage
  | InterruptCameraMessage
  | InterruptActionMessage
  | LocationUpdateMessage
  | TourEndMessage;

// Server → Client

export interface TourStartMessage {
  type: "tour_start";
  tour_id: string;
  name: string;
  spots: Array<{ id: string; name: string; order: number }>;
  estimated_duration_minutes: number;
}

export interface NarrationMessage {
  type: "narration";
  seq: number;
  chunk: string;
  spot_id: string;
  is_final: boolean;
}

export interface ResponseMessage {
  type: "response";
  seq: number;
  chunk: string;
  ref_interrupt_id: string;
  is_final: boolean;
}

export interface AckInterruptMessage {
  type: "ack_interrupt";
  interrupt_id: string;
  seq_stopped: number;
}

export interface StopArrivedMessage {
  type: "stop_arrived";
  spot_id: string;
  name: string;
  order: number;
}

export interface TourCompleteMessage {
  type: "tour_complete";
  summary: {
    duration_minutes: number;
    spots_visited: string[];
    interactions: number;
  };
}

export interface ErrorMessage {
  type: "error";
  code: "stt_failed" | "llm_timeout" | "invalid_message" | "internal";
  message: string;
}

export interface AudioMetaMessage {
  type: "audio_meta";
  seq: number;
  format: "mp3" | "wav" | "opus";
  sample_rate: number;
  chunk_index: number;
  is_final: boolean;
  ref_type: "narration" | "response";
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

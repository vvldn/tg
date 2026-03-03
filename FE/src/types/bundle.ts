/**
 * TypeScript types for the Monument Bundle schema.
 * Copied from contracts/bundle.types.ts for FE use.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type StoryType = 'history' | 'architecture' | 'legend' | 'anecdote';

export interface Story {
  title: string;
  narration_text: string;
  type: StoryType;
  duration_seconds?: number;
  sources?: string[];
}

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

export interface Route {
  total_walking_minutes: number;
  total_narration_minutes: number;
  total_tour_minutes: number;
  spot_order: string[];
}

export interface SourceInfo {
  url?: string;
  fetched_at?: string;
  qid?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Quality {
  confidence: Confidence;
  total_source_words: number;
  total_narration_words: number;
  spots_with_thin_content: string[];
  unverified_claims: string[];
  human_reviewed: boolean;
}

export interface MonumentBundle {
  version: '1.0';
  generated_at: string;
  pipeline_version?: string;
  monument: Monument;
  overview: Overview;
  spots: Spot[];
  route: Route;
  sources: Record<string, SourceInfo>;
  quality: Quality;
}

// --- Bundle Catalog API ---

export interface BundleCatalogEntry {
  tour_id: string;
  name: string;
  center: LatLng;
  city: string | null;
  country: string | null;
  heritage_status: string | null;
  estimated_duration_minutes: number;
  spot_count: number;
  bundle_size_bytes: number;
  generated_at: string;
}

// --- Q&A API ---

export interface AskRequest {
  tour_id: string;
  spot_id: string;
  question: string;
  image?: string;
  conversation_history?: Array<{role: 'user' | 'assistant'; content: string}>;
}

export interface AskResponse {
  answer: string;
}

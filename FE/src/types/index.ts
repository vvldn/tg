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
  spots_preview: Array<{id: string; name: string; order: number}>;
  overview_text: string;
  thumbnail_url: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

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

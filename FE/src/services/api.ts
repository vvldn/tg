import {API_BASE} from '../config';
import type {NearestTourResponse, TourDetailResponse} from '../types';

export async function findNearestTour(
  lat: number,
  lng: number,
): Promise<NearestTourResponse> {
  const res = await fetch(`${API_BASE}/api/tour/nearest`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({lat, lng}),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getTourDetail(
  tourId: string,
): Promise<TourDetailResponse> {
  const res = await fetch(`${API_BASE}/api/tour/${encodeURIComponent(tourId)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

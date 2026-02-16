export const API_BASE = 'http://localhost:3000';

export const WS_BASE = API_BASE.replace(/^http/, 'ws');

export const USE_MOCK_WS = __DEV__;

export const LOCATION_UPDATE_INTERVAL_MS = 5000;

export const INTERRUPT_DEBOUNCE_MS = 300;

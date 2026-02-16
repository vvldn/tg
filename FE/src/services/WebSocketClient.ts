import {WS_BASE} from '../config';
import type {ClientMessage, ServerMessage} from '../types';

export type WSEventType = ServerMessage['type'] | 'open' | 'close' | 'error';

type Listener = (data: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<WSEventType, Set<Listener>> = new Map();
  private tourId: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(tourId: string) {
    this.tourId = tourId;
  }

  connect(): void {
    this.shouldReconnect = true;
    const url = `${WS_BASE}/ws/tour/${encodeURIComponent(this.tourId)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.emit('open', null);
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch {
          // ignore parse errors
        }
      }
      // Binary frames (audio) — skip for MVP
    };

    this.ws.onerror = (event: Event) => {
      this.emit('error', event);
    };

    this.ws.onclose = () => {
      this.emit('close', null);
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(event: WSEventType, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: WSEventType, data: any): void {
    this.listeners.get(event)?.forEach(fn => fn(data));
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

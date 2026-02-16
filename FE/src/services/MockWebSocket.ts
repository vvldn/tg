import type {ClientMessage, ServerMessage} from '../types';
import type {WSEventType} from './WebSocketClient';

// Narration sentences from the test fixture's overview + first spot
const MOCK_NARRATION_SENTENCES = [
  "Welcome to Humayun's Tomb, one of the finest examples of Mughal architecture and a UNESCO World Heritage Site right here in the heart of Delhi.",
  'This magnificent structure was commissioned in 1565 by Hamida Banu Begum, the grieving wife of the second Mughal Emperor Humayun.',
  'What makes this tomb truly remarkable is that it set the template for an entire tradition of Mughal garden tombs.',
  'A tradition that would culminate, nearly a century later, in the Taj Mahal itself.',
  'The architect, Mirak Mirza Ghiyas, was brought all the way from Persia to design this masterpiece.',
  'You can see the Persian influence everywhere, from the grand double-domed structure to the intricate geometric patterns carved into red sandstone and white marble.',
  'As we walk through this complex together, you will discover not just one tomb, but an entire necropolis, a city of the dead.',
  'With over 150 graves scattered across these beautifully landscaped Mughal gardens. Each structure has its own story, its own secrets. Let us begin.',
];

const MOCK_RESPONSE_TEXT =
  "Great question! The double dome was a revolutionary Persian innovation brought to India by the Mughal architects. The outer dome creates an impressive silhouette, while the inner dome provides a proportioned ceiling inside the burial chamber. This technique was later perfected at the Taj Mahal.";

type Listener = (data: any) => void;

export class MockWebSocket {
  private listeners: Map<WSEventType, Set<Listener>> = new Map();
  private seq = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private narrationIndex = 0;
  private isStreaming = false;

  connect(): void {
    // Simulate connection open
    setTimeout(() => {
      this.emit('open', null);

      // Send tour_start after 100ms
      setTimeout(() => {
        this.emit('tour_start', {
          type: 'tour_start',
          tour_id: 'humayuns-tomb',
          name: "Humayun's Tomb",
          spots: [
            {id: 'main-gateway', name: 'Main Gateway (West Gate)', order: 1},
            {id: 'bu-halimas-garden', name: "Bu Halima's Garden", order: 2},
            {id: 'isa-khans-tomb', name: "Isa Khan's Tomb", order: 3},
            {id: 'afsarwala-tomb', name: 'Afsarwala Tomb and Mosque', order: 4},
            {id: 'arab-ki-sarai', name: 'Arab Ki Sarai', order: 5},
            {id: 'char-bagh', name: 'Char Bagh (Four Gardens)', order: 6},
            {id: 'main-tomb', name: 'Main Tomb of Humayun', order: 7},
          ],
          estimated_duration_minutes: 38,
        } satisfies ServerMessage);

        // Start streaming narration
        this.streamNarration();
      }, 100);
    }, 50);
  }

  private streamNarration(): void {
    this.isStreaming = true;
    this.narrationIndex = 0;
    this.scheduleNextChunk();
  }

  private scheduleNextChunk(): void {
    if (!this.isStreaming) {
      return;
    }
    if (this.narrationIndex >= MOCK_NARRATION_SENTENCES.length) {
      // Restart from beginning for demo loop
      this.narrationIndex = 0;
    }
    const timer = setTimeout(() => {
      if (!this.isStreaming) {
        return;
      }
      this.seq++;
      const isFinal =
        this.narrationIndex === MOCK_NARRATION_SENTENCES.length - 1;
      this.emit('narration', {
        type: 'narration',
        seq: this.seq,
        chunk: MOCK_NARRATION_SENTENCES[this.narrationIndex],
        spot_id: 'main-gateway',
        is_final: isFinal,
      } satisfies ServerMessage);
      this.narrationIndex++;
      if (!isFinal) {
        this.scheduleNextChunk();
      } else {
        this.isStreaming = false;
      }
    }, 500);
    this.timers.push(timer);
  }

  send(message: ClientMessage): void {
    if (message.type === 'tour_end') {
      this.stopStreaming();
      setTimeout(() => {
        this.emit('tour_complete', {
          type: 'tour_complete',
          summary: {
            duration_minutes: 5,
            spots_visited: ['main-gateway'],
            interactions: 1,
          },
        } satisfies ServerMessage);
        setTimeout(() => this.emit('close', null), 100);
      }, 200);
      return;
    }

    if (message.type === 'location_update') {
      return; // silently consume
    }

    // Any interrupt
    if (message.type.startsWith('interrupt')) {
      this.stopStreaming();

      const interruptId =
        'id' in message ? (message as any).id : 'unknown';

      // Send ack
      setTimeout(() => {
        this.emit('ack_interrupt', {
          type: 'ack_interrupt',
          interrupt_id: interruptId,
          seq_stopped: this.seq,
        } satisfies ServerMessage);

        // After 1s, send canned response
        setTimeout(() => {
          const words = MOCK_RESPONSE_TEXT.split('. ');
          let i = 0;
          const sendChunk = () => {
            if (i >= words.length) {
              // Resume narration after response
              setTimeout(() => this.streamNarration(), 500);
              return;
            }
            this.seq++;
            const chunk = words[i] + (i < words.length - 1 ? '.' : '');
            this.emit('response', {
              type: 'response',
              seq: this.seq,
              chunk,
              ref_interrupt_id: interruptId,
              is_final: i === words.length - 1,
            } satisfies ServerMessage);
            i++;
            const timer = setTimeout(sendChunk, 400);
            this.timers.push(timer);
          };
          sendChunk();
        }, 1000);
      }, 100);
    }
  }

  private stopStreaming(): void {
    this.isStreaming = false;
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
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
    this.stopStreaming();
    this.listeners.clear();
  }
}

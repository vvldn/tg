import {askQuestion} from './api';

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 20;

export class QuestionService {
  private conversationHistory: ConversationEntry[] = [];
  private tourId: string;

  constructor(tourId: string) {
    this.tourId = tourId;
  }

  async ask(spotId: string, question: string): Promise<string> {
    const response = await askQuestion({
      tour_id: this.tourId,
      spot_id: spotId,
      question,
      conversation_history: this.conversationHistory.slice(-MAX_HISTORY),
    });
    this.conversationHistory.push({role: 'user', content: question});
    this.conversationHistory.push({role: 'assistant', content: response.answer});
    return response.answer;
  }

  async askWithImage(
    spotId: string,
    imageBase64: string,
    question?: string,
  ): Promise<string> {
    const q = question || 'What am I looking at?';
    const response = await askQuestion({
      tour_id: this.tourId,
      spot_id: spotId,
      question: q,
      image: imageBase64,
      conversation_history: this.conversationHistory.slice(-MAX_HISTORY),
    });
    this.conversationHistory.push({role: 'user', content: q});
    this.conversationHistory.push({role: 'assistant', content: response.answer});
    return response.answer;
  }

  onSpotTransition(): void {
    if (this.conversationHistory.length > 4) {
      this.conversationHistory = this.conversationHistory.slice(-4);
    }
  }
}

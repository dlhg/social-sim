import { type Character, characters } from "./characters";
import { type ChatMessage, streamChat } from "./ollama";

export interface ConversationMessage {
  characterId: string;
  characterName: string;
  text: string;
}

export interface ActivityEvent {
  timestamp: Date;
  text: string;
}

export interface SimulationCallbacks {
  onStreamToken: (characterId: string, fullText: string) => void;
  onMessageComplete: (msg: ConversationMessage) => void;
  onActivity: (event: ActivityEvent) => void;
  onSpeakerChange: (characterId: string | null) => void;
}

export class Simulation {
  private history: ConversationMessage[] = [];
  private abortController: AbortController | null = null;
  private running = false;
  private paused = false;

  constructor(private callbacks: SimulationCallbacks) {}

  private log(text: string) {
    this.callbacks.onActivity({ timestamp: new Date(), text });
  }

  private buildMessages(speaker: Character): ChatMessage[] {
    const msgs: ChatMessage[] = [
      { role: "system", content: speaker.systemPrompt },
    ];

    for (const msg of this.history) {
      msgs.push({
        role: msg.characterId === speaker.id ? "assistant" : "user",
        content: `${msg.characterName}: ${msg.text}`,
      });
    }

    return msgs;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.history = [];
    this.abortController = new AbortController();
    this.log("Simulation started");

    let turnIndex = 0;

    while (this.running) {
      if (this.paused) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const speaker = characters[turnIndex % characters.length];
      this.callbacks.onSpeakerChange(speaker.id);
      this.log(`${speaker.name} is thinking...`);

      const messages = this.buildMessages(speaker);

      // If it's the very first message, give a nudge to start the conversation
      if (this.history.length === 0) {
        messages.push({
          role: "user",
          content:
            "Start a casual conversation. Say something to open the chat.",
        });
      }

      let streamedSoFar = "";
      try {
        await streamChat(
          messages,
          (token) => {
            streamedSoFar += token;
            this.callbacks.onStreamToken(speaker.id, streamedSoFar);
          },
          this.abortController!.signal
        );
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          break;
        }
        this.log(`Error: ${e}`);
        break;
      }

      // Strip the character's own name prefix if the LLM added it
      let cleaned = streamedSoFar.trim();
      const prefixPattern = new RegExp(`^${speaker.name}:\\s*`, "i");
      cleaned = cleaned.replace(prefixPattern, "");

      const msg: ConversationMessage = {
        characterId: speaker.id,
        characterName: speaker.name,
        text: cleaned,
      };

      this.history.push(msg);
      this.callbacks.onMessageComplete(msg);
      this.callbacks.onSpeakerChange(null);
      this.log(`${speaker.name} finished speaking`);

      turnIndex++;

      // Brief pause between turns
      await new Promise((r) => setTimeout(r, 1000));
    }

    this.callbacks.onSpeakerChange(null);
    this.log("Simulation stopped");
  }

  pause() {
    this.paused = true;
    this.log("Simulation paused");
  }

  resume() {
    this.paused = false;
    this.log("Simulation resumed");
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  get isRunning() {
    return this.running;
  }

  get isPaused() {
    return this.paused;
  }
}

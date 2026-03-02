import { useCallback, useRef, useState } from "react";
import { Scene } from "./components/Scene";
import { ChatLog } from "./components/ChatLog";
import { ActivityLog } from "./components/ActivityLog";
import { Simulation, type ConversationMessage, type ActivityEvent } from "./simulation";
import "./App.css";

function App() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [lastMessages, setLastMessages] = useState<Record<string, ConversationMessage>>({});
  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");

  const simRef = useRef<Simulation | null>(null);

  const handleStart = useCallback(() => {
    setMessages([]);
    setEvents([]);
    setStreamingText({});
    setCurrentSpeaker(null);
    setLastMessages({});

    const sim = new Simulation({
      onStreamToken: (characterId, fullText) => {
        setStreamingText((prev) => ({ ...prev, [characterId]: fullText }));
      },
      onMessageComplete: (msg) => {
        setMessages((prev) => [...prev, msg]);
        setLastMessages((prev) => ({ ...prev, [msg.characterId]: msg }));
        setStreamingText((prev) => ({ ...prev, [msg.characterId]: "" }));
      },
      onActivity: (event) => {
        setEvents((prev) => [...prev, event]);
      },
      onSpeakerChange: (characterId) => {
        setCurrentSpeaker(characterId);
        if (characterId) {
          setStreamingText((prev) => ({ ...prev, [characterId]: "" }));
        }
      },
    });

    simRef.current = sim;
    setStatus("running");
    sim.start().then(() => setStatus("idle"));
  }, []);

  const handlePause = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.isPaused) {
      sim.resume();
      setStatus("running");
    } else {
      sim.pause();
      setStatus("paused");
    }
  }, []);

  const handleStop = useCallback(() => {
    simRef.current?.stop();
    simRef.current = null;
    setStatus("idle");
    setCurrentSpeaker(null);
  }, []);

  return (
    <div className="app">
      <Scene
        currentSpeaker={currentSpeaker}
        streamingText={streamingText}
        lastMessages={lastMessages}
      />
      <div className="controls">
        {status === "idle" ? (
          <button onClick={handleStart} className="btn btn-start">Start</button>
        ) : (
          <>
            <button onClick={handlePause} className="btn btn-pause">
              {status === "paused" ? "Resume" : "Pause"}
            </button>
            <button onClick={handleStop} className="btn btn-stop">Stop</button>
          </>
        )}
      </div>
      <div className="hud">
        <ChatLog
          messages={messages}
          streamingText={streamingText}
          currentSpeaker={currentSpeaker}
        />
        <ActivityLog events={events} />
      </div>
    </div>
  );
}

export default App;

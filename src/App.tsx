import { useCallback, useEffect, useRef, useState } from "react";
import { Scene } from "./components/Scene";
import { ChatLog } from "./components/ChatLog";
import { ActivityLog } from "./components/ActivityLog";
import { NpcStore } from "./npc-store";
import { initialNpcs } from "./npcs";
import { ConversationManager } from "./conversation-manager";
import type { NPC, ConversationMessage, ActivityEvent } from "./types";
import "./App.css";

function App() {
  const storeRef = useRef(new NpcStore(initialNpcs));
  const [npcs, setNpcs] = useState<NPC[]>(() => storeRef.current.getAll());
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [streamingText, setStreamingText] = useState<Record<string, string>>(
    {}
  );
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [lastMessages, setLastMessages] = useState<
    Record<string, ConversationMessage>
  >({});
  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");

  const managerRef = useRef<ConversationManager | null>(null);

  useEffect(() => {
    return storeRef.current.subscribe(() => {
      setNpcs(storeRef.current.getAll());
    });
  }, []);

  const handleStart = useCallback(() => {
    setMessages([]);
    setEvents([]);
    setStreamingText({});
    setCurrentSpeaker(null);
    setLastMessages({});

    const manager = new ConversationManager(storeRef.current, {
      onStreamToken: (npcId, fullText) => {
        setStreamingText((prev) => ({ ...prev, [npcId]: fullText }));
      },
      onTurnComplete: (msg) => {
        setMessages((prev) => [...prev, msg]);
        setLastMessages((prev) => ({ ...prev, [msg.npcId]: msg }));
        setStreamingText((prev) => ({ ...prev, [msg.npcId]: "" }));
      },
      onConversationStart: () => {},
      onConversationEnd: () => {},
      onActivity: (event) => {
        setEvents((prev) => [...prev, event]);
      },
      onSpeakerChange: (npcId) => {
        setCurrentSpeaker(npcId);
        if (npcId) {
          setStreamingText((prev) => ({ ...prev, [npcId]: "" }));
        }
      },
    });

    managerRef.current = manager;
    setStatus("running");
    manager.start();
  }, []);

  const handlePause = useCallback(() => {
    const mgr = managerRef.current;
    if (!mgr) return;
    if (status === "paused") {
      mgr.resume();
      setStatus("running");
    } else {
      mgr.pause();
      setStatus("paused");
    }
  }, [status]);

  const handleStop = useCallback(() => {
    managerRef.current?.stop();
    managerRef.current = null;
    setStatus("idle");
    setCurrentSpeaker(null);
  }, []);

  const handleTrigger = useCallback(() => {
    managerRef.current?.triggerConversation();
  }, []);

  return (
    <div className="app">
      <Scene
        npcs={npcs}
        currentSpeaker={currentSpeaker}
        streamingText={streamingText}
        lastMessages={lastMessages}
      />
      <div className="controls">
        {status === "idle" ? (
          <button onClick={handleStart} className="btn btn-start">
            Start
          </button>
        ) : (
          <>
            <button onClick={handlePause} className="btn btn-pause">
              {status === "paused" ? "Resume" : "Pause"}
            </button>
            <button onClick={handleStop} className="btn btn-stop">
              Stop
            </button>
            <button onClick={handleTrigger} className="btn btn-trigger">
              Trigger Conversation
            </button>
          </>
        )}
      </div>
      <div className="hud">
        <ChatLog
          npcs={npcs}
          messages={messages}
          currentSpeaker={currentSpeaker}
        />
        <ActivityLog events={events} />
      </div>
    </div>
  );
}

export default App;

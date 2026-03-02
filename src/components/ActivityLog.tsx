import { useEffect, useRef } from "react";
import type { ActivityEvent } from "../types";

interface ActivityLogProps {
  events: ActivityEvent[];
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ActivityLog({ events }: ActivityLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="hud-panel activity-log">
      <div className="hud-title">Activity Log</div>
      <div className="hud-content">
        {events.map((evt, i) => (
          <div key={i} className="activity-entry">
            <span className="activity-time">{formatTime(evt.timestamp)}</span>{" "}
            <span className="activity-text">{evt.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

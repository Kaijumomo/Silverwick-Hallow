import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { connectFirebase } from "./session";
import type { RoomBackend } from "./backend";
import { lifecycleMessage } from "./lifecycle";
import { retryStorytellerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";

export function StorytellerSession() {
  const lobby = useStorytellerStore(s => s.lobby);
  const { error, retry } = useSessionRuntime();
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  useEffect(() => {
    let active = true;
    setBackend(null);
    if (!lobby) return;
    void connectFirebase().then(connection => {
      if (!active) return;
      if (connection.uid !== lobby.uid) throw new Error("Session authorization changed.");
      setBackend(connection.backend);
    }).catch(error => { if (active) useSessionRuntime.setState({ error: lifecycleMessage(error) }); });
    return () => { active = false; };
  }, [lobby?.code, retry]);
  useStorytellerSync(backend);
  return lobby && error ? <div className="error-list lobby-error" role="alert">
    <strong>Lobby connection</strong><p>{error}</p>
    <button className="btn btn-sm" onClick={retryStorytellerSession}>Reconnect / reclaim expired writer</button>
  </div> : null;
}

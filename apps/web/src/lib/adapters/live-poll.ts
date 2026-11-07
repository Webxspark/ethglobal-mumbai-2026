/** Pause MCP live-store polling while claim / PoH / fund modals are open. */
let pauseDepth = 0;

export function pauseLivePolling(): () => void {
  pauseDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauseDepth = Math.max(0, pauseDepth - 1);
  };
}

export function isLivePollingPaused(): boolean {
  return pauseDepth > 0;
}

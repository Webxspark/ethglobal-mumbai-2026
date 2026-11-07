"use client";

import { useCallback, useEffect, useState } from "react";

export type ClientSession = {
  authenticated: boolean;
  nullifierHash?: string;
  potId?: string;
  owner?: string;
  authMode?: "live";
  verificationLevel?: "orb" | "device" | "none";
  oidcIss?: string | null;
  mcpUrl?: string;
};

export function useSession() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = (await res.json()) as ClientSession;
      setSession(json);
      return json;
    } catch {
      setSession({ authenticated: false });
      return { authenticated: false } as ClientSession;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession({ authenticated: false });
  }

  return { session, loading, refresh, logout };
}

/** Minimal World auth env for unit tests (live-only config loader). */
export const TEST_WORLD_KEYS: Record<string, string> = {
  WORLD_AGENT_PASS_CLIENT_ID: "test-agent-pass",
  WORLD_AGENT_PASS_CLIENT_SECRET: "test-secret",
  WORLD_IDKIT_APP_ID: "app_test",
  WORLD_IDKIT_RP_ID: "rp_test",
  WORLD_IDKIT_RP_SIGNING_KEY: "00".repeat(32),
  WORLD_IDKIT_ENVIRONMENT: "staging",
  PROOFWORK_PUBLIC_URL: "http://127.0.0.1:38471",
};

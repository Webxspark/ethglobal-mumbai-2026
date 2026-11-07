declare module "@worldcoin/idkit-core/signing" {
  export function signRequest(i: {
    signingKeyHex: string;
    /** Omit for session-only RP signatures. */
    action?: string;
    ttl?: number;
  }): {
    sig: string;
    nonce: string;
    createdAt: number;
    expiresAt: number;
  };
}

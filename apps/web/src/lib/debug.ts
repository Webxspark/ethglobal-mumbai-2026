/** Gate noisy server/client debug logs. */
export function isProofworkDebug(): boolean {
  return (
    process.env.PROOFWORK_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_PROOFWORK_DEBUG === "1" ||
    process.env.DEBUG === "1"
  );
}

export function debugInfo(tag: string, data?: unknown) {
  if (!isProofworkDebug()) return;
  if (data === undefined) console.info(tag);
  else console.info(tag, data);
}

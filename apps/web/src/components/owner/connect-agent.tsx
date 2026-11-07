"use client";

import { useMemo, useState, useTransition } from "react";
import { Input, Label, NumberField, TextField } from "@heroui/react";
import { callMcpTool } from "@/lib/adapters/mcp-client";
import { mcpBaseUrl } from "@/lib/adapters/mcp-client";
import {
  SNIPPET_LABELS,
  buildSnippets,
  type SnippetKind,
} from "@/lib/agent-snippets";
import { requireSessionPot } from "@/lib/session-pot";
import { useSession } from "@/lib/use-session";
import { Button } from "@/components/ui/button";
import { Copyable, CopyIconButton } from "@/components/ui/copyable";
import { Toast } from "@/components/ui/toast";

type Issued = {
  token: string;
  potId: string;
  expiresAt: number;
  notifyUrl: string | null;
  maxBountyWei: string | null;
};

const KINDS = Object.keys(SNIPPET_LABELS) as SnippetKind[];

export function ConnectAgentPanel() {
  const { session } = useSession();
  const [notifyUrl, setNotifyUrl] = useState("");
  const [ttlMins, setTtlMins] = useState("60");
  const [maxBounty, setMaxBounty] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [kind, setKind] = useState<SnippetKind>("claude-code");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  let potId: string | null = null;
  try {
    potId = requireSessionPot(session).potId;
  } catch {
    potId = null;
  }

  const mcpHttp = useMemo(() => {
    if (session?.mcpUrl) return session.mcpUrl.replace(/\/$/, "");
    if (typeof window === "undefined") return "http://127.0.0.1:38472";
    const fromEnv = process.env.NEXT_PUBLIC_PROOFWORK_MCP_HTTP;
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    if (
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost"
    ) {
      return "http://127.0.0.1:38472";
    }
    return `${window.location.origin}/api/mcp`;
  }, [session?.mcpUrl]);

  const snippets = useMemo(
    () =>
      buildSnippets({
        mcpUrl: mcpHttp,
        token: issued?.token,
      }),
    [mcpHttp, issued?.token],
  );

  function mint() {
    setError(null);
    startTransition(async () => {
      try {
        const credit = requireSessionPot(session);
        const ttlSecs = Math.max(60, Math.floor(Number(ttlMins || "60") * 60));
        const result = await callMcpTool<{
          token: string;
          potId: string;
          expiresAt: number;
          notifyUrl: string | null;
          maxBountyWei: string | null;
        }>("issue_connect", {
          potId: credit.potId,
          notify_url: notifyUrl.trim() || undefined,
          ttl_secs: ttlSecs,
          max_bounty_wei: maxBounty.trim() || undefined,
          label: "owner-desk",
        });
        setIssued({
          token: result.token,
          potId: result.potId,
          expiresAt: result.expiresAt,
          notifyUrl: result.notifyUrl,
          maxBountyWei: result.maxBountyWei,
        });
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not mint connect token — is MCP up? (npm start)",
        );
      }
    });
  }

  const expiresLabel = issued
    ? new Date(issued.expiresAt * 1000).toLocaleString()
    : null;

  return (
    <section className="pw-connect-agent" data-testid="connect-agent">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="pw-kicker">Connect your AI agent</p>
          <h2 className="pw-section-title mt-0.5">Agent onboarding</h2>
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
        Snippets are prefilled with your MCP URL. Prefer the device flow (
        <span className="font-mono text-[11px]">connect</span> →{" "}
        <span className="font-mono text-[11px]">accept_terms</span> → approve
        at <span className="font-mono text-[11px]">/connect/authorize</span>
        ), or mint a token here for paste configs.
      </p>

      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        mcp {mcpHttp}
        {potId ? ` · pot ${potId.slice(0, 12)}…` : " · sign in to bind your pot"}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField
          className="sm:col-span-2"
          fullWidth
          value={notifyUrl}
          onChange={setNotifyUrl}
        >
          <Label>Notify URL (optional)</Label>
          <Input
            variant="secondary"
            placeholder="http://127.0.0.1:8787/hook"
          />
        </TextField>
        <NumberField
          className="w-full"
          fullWidth
          minValue={1}
          value={Number.parseInt(ttlMins, 10) || 60}
          onChange={(n) =>
            setTtlMins(String(Number.isFinite(n) ? Math.round(n) : 60))
          }
        >
          <Label>Expires in (minutes)</Label>
          <NumberField.Group className="w-full">
            <NumberField.Input className="w-full font-mono tabular-nums" />
          </NumberField.Group>
        </NumberField>
        <TextField fullWidth value={maxBounty} onChange={setMaxBounty}>
          <Label>Max bounty wei (optional)</Label>
          <Input
            variant="secondary"
            inputMode="numeric"
            placeholder="leave open"
            className="font-mono"
          />
        </TextField>
      </div>

      <Button
        className="mt-3 w-full sm:w-auto"
        isDisabled={pending || !potId}
        onPress={mint}
      >
        {pending ? "Minting…" : issued ? "Mint another token" : "Mint connect token"}
      </Button>

      {error ? (
        <Toast tone="error" className="mt-3">
          {error}
        </Toast>
      ) : null}

      {issued ? (
        <div className="mt-4 space-y-2">
          <p className="pw-kicker">Token</p>
          <div className="flex items-start gap-1">
            <code className="pw-connect-token flex-1" data-testid="connect-token">
              {issued.token}
            </code>
            <CopyIconButton value={issued.token} label="Copy token" />
          </div>
          <Copyable value={issued.potId} label="pot" head={10} tail={4} />
          <p className="font-mono text-[10px] text-muted-foreground">
            expires {expiresLabel}
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="pw-kicker">Copy-paste configs</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "secondary" : "ghost"}
              className="h-7 rounded-[4px] px-2.5 text-[11px]"
              onPress={() => setKind(k)}
            >
              {SNIPPET_LABELS[k]}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-1">
          <pre
            className="pw-connect-snippet min-w-0 flex-1"
            data-testid="connect-snippet"
          >
            {snippets[kind]}
          </pre>
          <CopyIconButton
            value={snippets[kind]}
            label={`Copy ${SNIPPET_LABELS[kind]}`}
          />
        </div>
      </div>

      <ol className="pw-connect-steps mt-4">
        <li>Agent calls connect → gets Terms + authorize URL.</li>
        <li>
          Agent calls accept_terms with{" "}
          <span className="font-mono text-[11px]">agreed: true</span>.
        </li>
        <li>You open /connect/authorize (World-gated) and approve.</li>
        <li>
          Agent receives a bearer token, then{" "}
          <span className="font-mono text-[11px]">get_account</span> /{" "}
          <span className="font-mono text-[11px]">post</span>.
        </li>
      </ol>

      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
        browser proxy {mcpBaseUrl()}
      </p>
    </section>
  );
}

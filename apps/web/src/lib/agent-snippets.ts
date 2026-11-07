/** Copy-paste MCP snippets for common agent hosts. */

export type SnippetKind =
  | "claude-code"
  | "cursor"
  | "copilot"
  | "opencode"
  | "codex-http"
  | "codex-stdio";

export const SNIPPET_LABELS: Record<SnippetKind, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  "codex-http": "Codex / generic (HTTP)",
  "codex-stdio": "Codex / generic (stdio)",
};

export function buildSnippets(opts: {
  mcpUrl: string;
  token?: string | null;
  repoCwd?: string;
}): Record<SnippetKind, string> {
  const token = opts.token?.trim() || "pwct_PASTE_AFTER_AUTHORIZE";
  const mcp = opts.mcpUrl.replace(/\/$/, "");
  const cwd =
    opts.repoCwd?.trim() ||
    "/ABS/PATH/TO/proofwork";

  return {
    "claude-code": `# Claude Code — remote Streamable HTTP MCP
claude mcp add --transport http proofwork ${mcp} \\
  --header "Authorization: Bearer ${token}"

# Or ~/.claude/mcp.json / project .mcp.json:
{
  "mcpServers": {
    "proofwork": {
      "type": "http",
      "url": "${mcp}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`,
    cursor: `// .cursor/mcp.json — Streamable HTTP
{
  "mcpServers": {
    "proofwork": {
      "url": "${mcp}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`,
    copilot: `// VS Code / GitHub Copilot MCP (settings.json fragment)
{
  "mcp": {
    "servers": {
      "proofwork": {
        "type": "http",
        "url": "${mcp}",
        "headers": {
          "Authorization": "Bearer ${token}"
        }
      }
    }
  }
}`,
    opencode: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "proofwork": {
      "type": "remote",
      "url": "${mcp}",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}

# Offline / local stdio fallback (same compose as the web desk):
# {
#   "type": "local",
#   "command": ["node_modules/.bin/tsx", "apps/mcp/src/stdio-mcp.ts"],
#   "cwd": "${cwd}",
#   "environment": {
#     "PROOFWORK_MCP_BRIDGE": "http",
#     "PROOFWORK_MCP_HTTP": "${mcp}",
#     "PROOFWORK_CONNECT_TOKEN": "${token}"
#   }
# }`,
    "codex-http": `# Streamable HTTP MCP (Claude / Cursor / Copilot / OpenCode remote)
# Endpoint: POST/GET/DELETE ${mcp}  →  MCP /mcp
export PROOFWORK_MCP_HTTP=${mcp}
export PROOFWORK_CONNECT_TOKEN=${token}

# First-time (no token): omit Authorization — only connect / accept_terms / issue_connect / health.
# After authorize, send:
#   Authorization: Bearer $PROOFWORK_CONNECT_TOKEN

# REST escape hatch (same auth) still works:
curl -s -X POST "$PROOFWORK_MCP_HTTP/tools/get_account" \\
  -H "authorization: Bearer $PROOFWORK_CONNECT_TOKEN" \\
  -H 'content-type: application/json' -d '{}'`,
    "codex-stdio": `# stdio bridge (local OpenCode / offline)
cd ${cwd}
PROOFWORK_MCP_BRIDGE=http \\
PROOFWORK_MCP_HTTP=${mcp} \\
PROOFWORK_CONNECT_TOKEN=${token} \\
node_modules/.bin/tsx apps/mcp/src/stdio-mcp.ts`,
  };
}

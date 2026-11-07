# PROOFWORK monorepo — targets: mcp | web
# Build: docker compose build
# Secrets stay in compose env_file (.env), never COPY'd into the image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/contracts/package.json ./packages/contracts/

# Skip prepare (shared build) until sources are present
RUN npm ci --ignore-scripts

FROM deps AS shared-build
COPY packages/shared ./packages/shared
RUN npm run build -w @proofwork/shared

# --- MCP (HTTP tools on 38472) ---
FROM shared-build AS mcp
COPY apps/mcp ./apps/mcp
RUN npm run build -w @proofwork/mcp
ENV MCP_PORT=38472
EXPOSE 38472
CMD ["node", "apps/mcp/dist/server.js"]

# --- Next web (38471) — rewrites /api/mcp → mcp service ---
FROM shared-build AS web
COPY apps/web ./apps/web
# Bake rewrite destination for in-compose networking (runtime also set in compose).
ARG PROOFWORK_MCP_URL=http://mcp:38472
ENV PROOFWORK_MCP_URL=$PROOFWORK_MCP_URL
ENV NEXT_PUBLIC_PROOFWORK_MCP_URL=/api/mcp
RUN npm run build -w @proofwork/web
ENV PORT=38471
EXPOSE 38471
CMD ["npm", "run", "start", "-w", "@proofwork/web"]

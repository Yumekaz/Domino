FROM node:24.11.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/domino
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/core/evidence/package.json packages/core/evidence/package.json
COPY packages/core/history/package.json packages/core/history/package.json
COPY packages/core/impact/package.json packages/core/impact/package.json
COPY packages/core/knowledge-risk/package.json packages/core/knowledge-risk/package.json
COPY packages/dependency-adapter/package.json packages/dependency-adapter/package.json
COPY packages/git-adapter/package.json packages/git-adapter/package.json
COPY packages/github-adapter/package.json packages/github-adapter/package.json
COPY packages/llm-adapter/package.json packages/llm-adapter/package.json
COPY packages/retrieval/package.json packages/retrieval/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
ENV NODE_ENV=production
CMD ["npm", "run", "dev:api"]

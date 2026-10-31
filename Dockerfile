FROM node:24.11.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/domino
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
ENV NODE_ENV=production
CMD ["npm", "run", "dev:api"]

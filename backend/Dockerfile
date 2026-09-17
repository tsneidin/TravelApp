FROM node:20-trixie-slim

# KItinerary's extractor is packaged for Debian; keep it in the API image so
# email and AI Assist can use the same local parser without a network service.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libkitinerary-bin libkitinerary-data \
    && ln -s "$(find /usr/lib -type f -name kitinerary-extractor -print -quit)" /usr/local/bin/kitinerary-extractor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (includes dev deps so prisma CLI + generation work at build)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Build TS
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build

EXPOSE 3000

# First sync the schema (db push = idempotent), then start the API.
# Dev deps (prisma CLI) are kept in the image so `prisma db push` works at startup.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/src/index.js"]

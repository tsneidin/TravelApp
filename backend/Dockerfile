FROM node:20-alpine

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
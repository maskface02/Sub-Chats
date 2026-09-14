# Local production-like deployment image.
# Multi-stage: deps → build → runtime. No DB at build time (US-503 AC.7).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Sentinel URL: build must never connect to a DB (route handlers are force-dynamic)
ENV DATABASE_URL=postgres://offline:offline@localhost:5432/offline
RUN npx next build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/src/lib/db ./src/lib/db
# Migrate then serve (drizzle-kit ships in node_modules devDeps)
CMD ["sh", "-c", "npx drizzle-kit migrate && npx next start -p 3000"]

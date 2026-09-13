# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# Install workspace root deps + all workspace packages
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ethereum/package.json ./packages/ethereum/package.json
COPY packages/detector/package.json ./packages/detector/package.json
COPY packages/simulator/package.json ./packages/simulator/package.json
COPY packages/creditcoin/package.json ./packages/creditcoin/package.json
RUN npm install --omit=dev

# Copy source
COPY packages ./packages
COPY apps/api ./apps/api
COPY demo ./demo

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/demo ./demo

EXPOSE 3000
CMD ["npx", "tsx", "apps/api/src/index.ts"]

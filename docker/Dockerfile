FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY app/package.json app/bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY app/src ./src
COPY app/tsconfig.json ./tsconfig.json

RUN bun build src/index.ts --outfile dist/index.js --target bun

# --- runtime ---
FROM oven/bun:1-alpine

WORKDIR /app

COPY --from=builder /app/dist/index.js ./dist/index.js

EXPOSE 3000
ENV NODE_ENV=production

CMD ["bun", "run", "dist/index.js"]

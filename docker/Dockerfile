FROM oven/bun:1-alpine

WORKDIR /app

# Install app deps
COPY app/package.json app/bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY app/src ./src
COPY app/tsconfig.json ./tsconfig.json

EXPOSE 3000
ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]

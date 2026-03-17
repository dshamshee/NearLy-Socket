FROM oven/bun:1.3-alpine

WORKDIR /usr/src/app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile --production

COPY . .

EXPOSE 4000

CMD ["bun", "server.ts"]
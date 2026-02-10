FROM oven/bun:1

WORKDIR /usr/src/app

COPY package.json bun.lock ./

RUN bun install --production

COPY . .

# Environment variables will be passed at runtime via docker-compose or docker run
# No need to set defaults here - they come from .env file or runtime args

EXPOSE 4000

CMD ["bun", "server.ts"]
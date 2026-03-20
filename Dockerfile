FROM node:20-alpine

  RUN npm install -g pnpm

  WORKDIR /app

  COPY . .

  RUN pnpm install --no-frozen-lockfile

  ENV NODE_ENV=production

  EXPOSE 8080

  CMD ["artifacts/api-server/node_modules/.bin/tsx", "artifacts/api-server/src/index.ts"]
  
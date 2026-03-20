FROM node:20-alpine

  RUN npm install -g pnpm

  WORKDIR /app

  COPY . .

  RUN pnpm install --no-frozen-lockfile

  RUN pnpm --filter @workspace/api-server run build

  ENV NODE_ENV=production

  EXPOSE 8080

  CMD ["node", "artifacts/api-server/dist/index.cjs"]
  
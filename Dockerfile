FROM node:20-alpine

RUN npm install -g pnpm@10

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production

CMD ["node", "artifacts/api-server/dist/index.cjs"]

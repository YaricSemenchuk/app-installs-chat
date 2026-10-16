# Один образ: NestJS API + собранный SPA. На Railway — один сервис рядом с Postgres.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/api
EXPOSE 3000
# Миграции применяются при каждом старте; prisma migrate deploy идемпотентен.
CMD ["npm", "start"]

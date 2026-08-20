FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/crypto/package.json packages/crypto/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/crypto/tsconfig.json packages/crypto/tsconfig.json
COPY packages/crypto/src packages/crypto/src
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/tsconfig.app.json apps/web/tsconfig.app.json
COPY apps/web/tsconfig.node.json apps/web/tsconfig.node.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/vitest.config.ts apps/web/vitest.config.ts
COPY apps/web/index.html apps/web/index.html
COPY apps/web/src apps/web/src
RUN npm run build --workspace @cipherspace/web

FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

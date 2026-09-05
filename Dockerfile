FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.* ./
COPY src ./src
COPY public ./public
COPY shared ./shared
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]

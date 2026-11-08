# VEIL relayer. One instance only: its nonce handling, crank de-duplication and rate limits live
# in memory, so two copies would race each other's transactions.
FROM node:22.11.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs policy.mjs ./
USER node
EXPOSE 8790
CMD ["node", "server.mjs"]

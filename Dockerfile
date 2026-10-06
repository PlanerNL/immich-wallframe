FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/PlanerNL/immich-wallframe"
LABEL org.opencontainers.image.description="Photo frame for Immich with weather, agenda and waste pickups"
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]

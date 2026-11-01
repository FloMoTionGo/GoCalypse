FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build

# Starts as root only to make the data volume the node user's, then becomes
# node before it opens a port (src/util/privileges.ts).
ENV RUN_AS=node
EXPOSE 2567
CMD ["node", "build/index.js"]

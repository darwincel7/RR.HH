# Build and run the Darwin Cell ATS (Express API + Vite SPA) on Cloud Run.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching). Dev deps are needed for the build.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the source and build: Vite (frontend -> dist/) + esbuild (server -> dist/server.cjs).
COPY . .
RUN npm run build

# Production runtime. Cloud Run sets PORT; the server reads process.env.PORT.
ENV NODE_ENV=production
CMD ["node", "dist/server.cjs"]

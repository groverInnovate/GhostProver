# GhostProver — Compute API server
# Runs Compute/src/server.ts which exposes the live 0G pipeline over HTTP.

FROM node:23-slim

WORKDIR /app

# Copy the Compute workspace
COPY package.json package-lock.json ./
RUN npm install

# Copy source
COPY . .

# Default port (override with PORT env var in Railway dashboard)
ENV PORT=8790

EXPOSE 8790

CMD ["npm", "run", "server"]

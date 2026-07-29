# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Transporte HTTP é o modo indicado para hospedagem remota (Coolify).
ENV MCP_TRANSPORT=http
ENV HTTP_PORT=8080
ENV HTTP_PATH=/mcp
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
# As variáveis PROTHEUS_BASE_URL, PROTHEUS_USER, PROTHEUS_PASSWORD, PROTHEUS_TENANT_ID
# e CONNECTOR_API_KEY devem ser fornecidas em runtime (env do Coolify / --env-file).
CMD ["node", "dist/index.js"]

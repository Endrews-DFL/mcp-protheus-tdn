/**
 * Carrega configuração a partir de variáveis de ambiente (.env em dev, secrets em prod).
 * Espelha o padrão do conector do Interact (transporte stdio/http + chave do conector).
 */
import dotenv from "dotenv";
dotenv.config();

export interface AppConfig {
  transport: "stdio" | "http";
  protheus: {
    baseUrl: string;
    user: string;
    password: string;
    tenantId?: string;
    dflToken?: string;
  };
  http: {
    port: number;
    path: string;
    connectorApiKey?: string;
  };
}

export function loadConfig(): AppConfig {
  const baseUrl = process.env.PROTHEUS_BASE_URL ?? "";
  const user = process.env.PROTHEUS_USER ?? "";
  const password = process.env.PROTHEUS_PASSWORD ?? "";

  if (!baseUrl || !user || !password) {
    console.error(
      "[protheus-mcp] Faltam variáveis obrigatórias: PROTHEUS_BASE_URL, PROTHEUS_USER, PROTHEUS_PASSWORD."
    );
    process.exit(1);
  }

  return {
    transport: process.env.MCP_TRANSPORT === "http" ? "http" : "stdio",
    protheus: {
      baseUrl,
      user,
      password,
      tenantId: process.env.PROTHEUS_TENANT_ID || undefined,
      dflToken: process.env.PROTHEUS_DFL_TOKEN || undefined,
    },
    http: {
      port: Number(process.env.HTTP_PORT ?? 8080),
      path: process.env.HTTP_PATH ?? "/mcp",
      connectorApiKey: process.env.CONNECTOR_API_KEY || undefined,
    },
  };
}

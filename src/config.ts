/**
 * Carrega configuração a partir de variáveis de ambiente (.env em dev, secrets em prod).
 */
import dotenv from "dotenv";
dotenv.config();

export interface OAuthConfig {
  enabled: boolean;
  publicUrl: string; // ex.: https://protheus-mcp.seudominio.com.br (sem barra no fim)
  entraTenantId: string;
  entraClientId: string;
  entraClientSecret: string;
  allowedEmails: string[]; // e-mails específicos permitidos (minúsculos)
  allowedDomains: string[]; // domínios permitidos, ex.: dfl.com.br
  jwtSecret: string; // segredo para assinar os tokens emitidos pelo nosso conector
}

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
  oauth: OAuthConfig;
}

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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

  const oauthEnabled = (process.env.AUTH_MODE ?? "none").toLowerCase() === "oauth";
  const oauth: OAuthConfig = {
    enabled: oauthEnabled,
    publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    entraTenantId: process.env.ENTRA_TENANT_ID ?? "",
    entraClientId: process.env.ENTRA_CLIENT_ID ?? "",
    entraClientSecret: process.env.ENTRA_CLIENT_SECRET ?? "",
    allowedEmails: csv(process.env.OAUTH_ALLOWED_EMAILS),
    allowedDomains: csv(process.env.OAUTH_ALLOWED_DOMAINS),
    jwtSecret: process.env.OAUTH_JWT_SECRET ?? "",
  };

  if (oauthEnabled) {
    const missing: string[] = [];
    if (!oauth.publicUrl) missing.push("PUBLIC_URL");
    if (!oauth.entraTenantId) missing.push("ENTRA_TENANT_ID");
    if (!oauth.entraClientId) missing.push("ENTRA_CLIENT_ID");
    if (!oauth.entraClientSecret) missing.push("ENTRA_CLIENT_SECRET");
    if (!oauth.jwtSecret) missing.push("OAUTH_JWT_SECRET");
    if (oauth.allowedEmails.length === 0 && oauth.allowedDomains.length === 0)
      missing.push("OAUTH_ALLOWED_EMAILS ou OAUTH_ALLOWED_DOMAINS");
    if (missing.length) {
      console.error(`[protheus-mcp] AUTH_MODE=oauth exige: ${missing.join(", ")}.`);
      process.exit(1);
    }
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
    oauth,
  };
}

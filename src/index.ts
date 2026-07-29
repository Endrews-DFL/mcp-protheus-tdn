/**
 * Bootstrap do protheus-mcp-server. Seleciona o transporte por MCP_TRANSPORT:
 *   - "stdio": uso local (Claude Desktop / Inspector). Sem rede, sem segredo de conector.
 *   - "http" : hospedado/remoto (Streamable HTTP), protegido por CONNECTOR_API_KEY.
 * Espelha o padrão do conector do Interact (sa-api-mcp-server).
 */
import { loadConfig } from "./config.js";
import { createMcpServer, toolCount } from "./server.js";

const config = loadConfig();

async function startStdio(): Promise<void> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[protheus-mcp] Pronto via stdio. ${toolCount} tools registradas.`);
}

async function startHttp(): Promise<void> {
  const express = (await import("express")).default;
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Healthcheck (não exige o segredo do conector).
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tools: toolCount });
  });

  // Autenticação do CONECTOR (diferente das credenciais do Protheus).
  const expectedKey = config.http.connectorApiKey;
  app.use(config.http.path, (req, res, next) => {
    if (!expectedKey) return next(); // sem segredo: acesso liberado (NÃO recomendado)
    const auth = req.header("authorization");
    const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
    const provided = bearer || req.header("x-connector-key");
    if (provided !== expectedKey) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Não autorizado: segredo do conector inválido." },
        id: null,
      });
    }
    next();
  });

  // Modo stateless: um server + transporte por requisição.
  app.post(config.http.path, async (req, res) => {
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[protheus-mcp] Erro ao tratar requisição:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Erro interno do servidor." },
          id: null,
        });
      }
    }
  });

  app.listen(config.http.port, () => {
    console.error(
      `[protheus-mcp] HTTP ouvindo em :${config.http.port}${config.http.path} | ${toolCount} tools | auth do conector: ${
        expectedKey ? "ATIVA" : "DESATIVADA"
      }`
    );
  });
}

async function main(): Promise<void> {
  if (config.transport === "http") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("[protheus-mcp] Falha fatal:", err);
  process.exit(1);
});

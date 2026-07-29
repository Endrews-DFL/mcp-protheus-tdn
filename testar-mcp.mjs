// Mini-cliente MCP: sobe o servidor via stdio, lista as tools e chama algumas.
// Valida a camada MCP ponta a ponta sem depender do Inspector (funciona no Node 18).
// Uso:  npm run build   &&   node testar-mcp.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath, // o mesmo node em execução
  args: ["dist/index.js"],
});

const client = new Client({ name: "smoke-mcp", version: "1.0.0" }, { capabilities: {} });

function printResult(label, r) {
  console.log("\n===", label, "===");
  const parts = (r.content || []).map((c) => (c.type === "text" ? c.text : JSON.stringify(c)));
  console.log((r.isError ? "[isError] " : "") + parts.join("\n").slice(0, 1500));
}

try {
  await client.connect(transport);

  const list = await client.listTools();
  console.log("Tools registradas:", list.tools.length);
  for (const t of list.tools) console.log(" -", t.name);

  printResult("condicoes_pagamento (sem args)", await client.callTool({ name: "protheus_condicoes_pagamento", arguments: {} }));
  printResult("produtos_mrp (deve vir vazio amigavel)", await client.callTool({ name: "protheus_produtos_mrp", arguments: {} }));
  printResult("limite_credito (sem args)", await client.callTool({ name: "protheus_limite_credito_cliente", arguments: {} }));

  console.log("\nOK — camada MCP validada.");
} catch (e) {
  console.error("ERRO:", e?.message ?? e);
} finally {
  await client.close();
}

// Testa TODAS as tools registradas no servidor MCP, uma a uma, usando valores de
// desenvolvimento conhecidos (mesmo kit do diagnóstico: fil=01, cliente 000087,
// fornecedor A04559/01, CNPJ 62849644000106, cc 600011, e-mail do usuário, etc.).
//
// Sobe o servidor via stdio (não precisa do transporte HTTP), lista as tools via MCP
// e chama cada uma preenchendo os parâmetros pelo NOME (heurística) com os valores DEV.
// Para os campos cujo nome não bate com o kit DEV, usa um valor genérico "1" (o objetivo
// é apenas confirmar que o serviço responde — os campos [?] presumidos precisam de revisão
// manual do resultado real).
//
// Uso:  npm run build   &&   node testar-todas-tools.mjs
// Requer PROTHEUS_USER/PROTHEUS_PASSWORD no .env e rede até o Protheus (porta 1916).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEV_MAP = {
  fil: "01",
  filial: "01",
  fornece: "A04559",
  loja: "01",
  cnpj: "62849644000106",
  cliente: "000087",
  codcli: "000087",
  codloja: "01",
  cc: "600011",
  ccusto: "600011",
  email: "endrews.santos@dfl.com.br",
  login: "endrews.santos",
  operacao: "LISTA",
  mes: "01",
  produto: "000001",
  pai: "000001",
  codtab: "01",
  numsc: "1",
  usuario: "endrews.santos",
  bordero: "1",
  op: "1",
  pagamento: "1",
  cotacao: "1",
  data: "20260101",
  projeto: "1",
};

// Tools que fazem mais sentido pular no smoke-test em massa (varredura pesada/duplicada).
const SKIP = new Set(["protheus_diagnostico"]);

function buildArgs(tool) {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const args = {};
  for (const key of Object.keys(props)) {
    if (key in DEV_MAP) {
      args[key] = DEV_MAP[key];
    } else if (required.has(key)) {
      args[key] = "1"; // fallback genérico p/ campo obrigatório sem valor DEV conhecido
    }
    // campos opcionais sem valor DEV mapeado ficam de fora (deixa o default da tool agir)
  }
  return args;
}

function summarize(result) {
  const parts = (result.content || []).map((c) => (c.type === "text" ? c.text : JSON.stringify(c)));
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return (result.isError ? "[ERRO] " : "[OK] ") + text.slice(0, 200);
}

async function main() {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"] });
  const client = new Client({ name: "smoke-todas-tools", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`Tools registradas: ${tools.length}\n`);

  const linhas = [];
  for (const tool of tools) {
    if (SKIP.has(tool.name)) continue;
    const args = buildArgs(tool);
    process.stdout.write(`- ${tool.name} (${JSON.stringify(args)}) ... `);
    try {
      const r = await client.callTool({ name: tool.name, arguments: args });
      const linha = summarize(r);
      console.log(linha);
      linhas.push({ tool: tool.name, args, resultado: linha });
    } catch (e) {
      const linha = `[EXCEÇÃO] ${e?.message ?? e}`;
      console.log(linha);
      linhas.push({ tool: tool.name, args, resultado: linha });
    }
  }

  const ok = linhas.filter((l) => l.resultado.startsWith("[OK]")).length;
  const erro = linhas.length - ok;
  console.log(`\nResumo: ${ok} OK / ${erro} com erro/exceção (de ${linhas.length} tools testadas).`);

  await client.close();
}

main().catch((e) => {
  console.error("Falha no smoke-test:", e);
  process.exit(1);
});

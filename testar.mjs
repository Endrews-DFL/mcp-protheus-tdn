// Smoke-test do conector (sem MCP): valida token + consulta + tratamento amigável.
// Uso:  npm run build   &&   node testar.mjs
// Le as variaveis do .env (mesmo carregador do index).

import { readFileSync, existsSync } from "node:fs";
import { ProtheusClient } from "./dist/protheusClient.js";

function loadDotenv(p = ".env") {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotenv();

if (!process.env.PROTHEUS_USER || !process.env.PROTHEUS_PASSWORD) {
  console.error("Preencha PROTHEUS_USER e PROTHEUS_PASSWORD no arquivo .env antes de rodar.");
  process.exit(1);
}

const client = new ProtheusClient({
  baseUrl: process.env.PROTHEUS_BASE_URL,
  user: process.env.PROTHEUS_USER,
  password: process.env.PROTHEUS_PASSWORD,
  tenantId: process.env.PROTHEUS_TENANT_ID || undefined,
  dflToken: process.env.PROTHEUS_DFL_TOKEN || undefined,
});

async function show(label, route, query = {}) {
  console.log("\n===", label, "===");
  try {
    const r = await client.get(route, query);
    console.log(JSON.stringify(r, null, 2).slice(0, 1500));
  } catch (e) {
    console.error("ERRO:", e.message);
  }
}

await show("1) Condicoes de pagamento (deve vir com dados)", "/api/fat/v1/paymentcondition", { pagesize: 1 });
await show("2) Limite de credito (deve vir com dados)", "/api/fat/v1/CustomerCreditLimit", { pagesize: 1 });
await show("3) Produtos MRP (deve cair no 'nenhum registro' amigavel)", "/api/pcp/v1/mrpproduct", { pagesize: 1 });

console.log("\nSmoke-test concluido.");

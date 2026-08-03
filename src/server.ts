/**
 * Fábrica do servidor MCP: registra as tools de consulta.
 * Piloto atual: usa EXCLUSIVAMENTE web services customizados da DFL (WSR*), sempre GET.
 * O ProtheusClient é singleton de módulo (cache de token compartilhado, mesmo no HTTP stateless).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { ProtheusClient, ProtheusResult } from "./protheusClient.js";

const cfg = loadConfig();
const client = new ProtheusClient(cfg.protheus);

export const toolCount = 10;

function toToolResult(r: ProtheusResult) {
  if (r.ok && r.kind === "data") {
    return { content: [{ type: "text" as const, text: JSON.stringify(r.data, null, 2) }] };
  }
  if (r.ok && r.kind === "empty") {
    return { content: [{ type: "text" as const, text: r.message }] };
  }
  const raw = r.ok ? undefined : r.raw;
  const detail = raw ? `\n\n[resposta do Protheus]: ${String(raw).slice(0, 600)}` : "";
  return { content: [{ type: "text" as const, text: r.message + detail }], isError: true };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "protheus-mcp-server", version: "0.2.0" });

  // ===================== CLIENTES / FINANCEIRO =====================

  // 1. WSRCLIENTE — clientes de um vendedor (e-mail do vendedor). [WSRECEIVE EMAIL — OK]
  server.registerTool(
    "protheus_clientes_por_vendedor",
    {
      title: "Clientes por vendedor (WSRCLIENTE)",
      description:
        "Retorna os clientes vinculados a um vendedor/gerente, identificado pelo e-mail (SA3.A3_EMAIL). O e-mail é do VENDEDOR, não do cliente.",
      inputSchema: { email: z.string().describe("E-mail do vendedor/gerente (obrigatório).") },
    },
    async ({ email }) => toToolResult(await client.get("/WSRCLIENTE", { email, fil: "01" }))
  );

  // 2. WSRSALDOCLIENTE — saldo em aberto do cliente (títulos SE1). [WSRECEIVE FIL — precisa ADVPL receber CLIENTE]
  server.registerTool(
    "protheus_saldo_cliente",
    {
      title: "Saldo em aberto do cliente (WSRSALDOCLIENTE)",
      description:
        "Saldo em aberto (títulos a receber, SE1) de um cliente. Informe o código do cliente. Empresa/filial fixas em 03/01 no web service.",
      inputSchema: { cliente: z.string().describe("Código do cliente (E1_CLIENTE) — obrigatório.") },
    },
    async ({ cliente }) => toToolResult(await client.get("/WSRSALDOCLIENTE", { cliente, fil: "01" }))
  );

  // 3. WSRCONTASR — contas a receber por cliente/período. [WSRECEIVE FILIAL — precisa ADVPL]
  server.registerTool(
    "protheus_contas_receber",
    {
      title: "Contas a receber (WSRCONTASR)",
      description:
        "Títulos a receber de um cliente, opcionalmente por período. Informe o código do cliente (e loja). Datas no formato AAAAMMDD.",
      inputSchema: {
        codcli: z.string().describe("Código do cliente (obrigatório)."),
        codloja: z.string().optional().describe("Loja do cliente (opcional)."),
        datainicio: z.string().optional().describe("Data inicial AAAAMMDD (opcional)."),
        datafim: z.string().optional().describe("Data final AAAAMMDD (opcional)."),
      },
    },
    async ({ codcli, codloja, datainicio, datafim }) =>
      toToolResult(
        await client.get("/WSRCONTASR", {
          fil: "01",
          codcli,
          codloja,
          dataini: datainicio,
          datafim,
        })
      )
  );

  // 4. WSRCONSAFES — cliente por CNPJ. [WSRECEIVE CNPJ — OK]
  server.registerTool(
    "protheus_cliente_por_cnpj",
    {
      title: "Cliente por CNPJ (WSRCONSAFES)",
      description: "Retorna o(s) cliente(s) no Protheus a partir do CNPJ informado.",
      inputSchema: { cnpj: z.string().describe("CNPJ do cliente (só números ou formatado) — obrigatório.") },
    },
    async ({ cnpj }) => toToolResult(await client.get("/WSRCONSAFES", { cnpj, fil: "01" }))
  );

  // ===================== PRODUTOS / ESTOQUE =====================

  // 5. WSRB2BPRODUTO — produtos (filial/armazém). [WSRECEIVE FIL — OK p/ FIL]
  server.registerTool(
    "protheus_produtos",
    {
      title: "Produtos (WSRB2BPRODUTO)",
      description: "Retorna os produtos do Protheus. Opcionalmente por armazém. (Serviço B2B customizado.)",
      inputSchema: {
        armazem: z.string().optional().describe("Código do armazém (opcional)."),
        operacao: z.string().optional().describe("Operação: LISTA (padrão), ESTOQUE ou PRECO."),
      },
    },
    async ({ armazem, operacao }) =>
      toToolResult(await client.get("/WSRB2BPRODUTO", { fil: "01", armazem, operacao: operacao || "LISTA" }))
  );

  // 6. WSRCRMSB2 — saldo em estoque por produto. [WSRECEIVE incorreto — precisa ADVPL]
  server.registerTool(
    "protheus_saldo_estoque",
    {
      title: "Saldo em estoque (WSRCRMSB2)",
      description: "Retorna o saldo em estoque dos produtos (SB2). Opcionalmente filtra por produto.",
      inputSchema: {
        produto: z.string().optional().describe("Código do produto (opcional)."),
        operacao: z.string().optional().describe("Operação: LISTA (padrão) ou ESTOQUE."),
      },
    },
    async ({ produto, operacao }) =>
      toToolResult(await client.get("/WSRCRMSB2", { fil: "01", produto, operacao: operacao || "LISTA" }))
  );

  // 7. WSRESTRUTURA — estrutura do produto (PAI/REV). [WSRECEIVE FILIAL — precisa ADVPL]
  server.registerTool(
    "protheus_estrutura_produto",
    {
      title: "Estrutura do produto (WSRESTRUTURA)",
      description: "Retorna os itens da estrutura (BOM) de um produto pai, para uma revisão.",
      inputSchema: {
        pai: z.string().describe("Código do produto pai (obrigatório)."),
        rev: z.string().optional().describe("Revisão da estrutura (opcional)."),
      },
    },
    async ({ pai, rev }) => toToolResult(await client.get("/WSRESTRUTURA", { fil: "01", pai, rev }))
  );

  // ===================== COMPRAS =====================

  // 8. WSRESTSC — solicitação de compra por número. [WSRECEIVE RECEIVE — precisa ADVPL]
  server.registerTool(
    "protheus_solicitacao_compra",
    {
      title: "Solicitação de compra por número (WSRESTSC)",
      description:
        "Retorna os dados de uma Solicitação de Compra (SC1) pelo número, com itens e centro de custo.",
      inputSchema: { numsc: z.string().describe("Número da solicitação de compra (C1_NUM) — obrigatório.") },
    },
    async ({ numsc }) => toToolResult(await client.get("/WSRESTSC", { numsc, op: "1", fil: "01" }))
  );

  // 9. WSRPCABERTO — pedidos de compra em aberto por fornecedor/loja. [WSRECEIVE FILIAL — precisa ADVPL]
  server.registerTool(
    "protheus_pedidos_compra_aberto",
    {
      title: "Pedidos de compra em aberto (WSRPCABERTO)",
      description:
        "Retorna os Pedidos de Compra (SC7) em aberto de um fornecedor+loja, com saldo, armazém e centro de custo.",
      inputSchema: {
        fornece: z.string().describe("Código do fornecedor (obrigatório)."),
        loja: z.string().describe("Loja do fornecedor (obrigatório)."),
      },
    },
    async ({ fornece, loja }) =>
      toToolResult(await client.get("/WSRPCABERTO", { fornece, loja, filial: "01" }))
  );

  // 10. WSRFORNECE — fornecedor. [WSRECEIVE FORNECE — OK]
  server.registerTool(
    "protheus_fornecedor",
    {
      title: "Fornecedor (WSRFORNECE)",
      description: "Retorna os dados de um fornecedor pelo código.",
      inputSchema: { fornece: z.string().describe("Código do fornecedor (A2_COD) — obrigatório.") },
    },
    async ({ fornece }) => toToolResult(await client.get("/WSRFORNECE", { fornece, fil: "01" }))
  );

  return server;
}

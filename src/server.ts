/**
 * Fábrica do servidor MCP: cria a instância e registra as 10 tools de consulta.
 * O ProtheusClient é um singleton de módulo (cache de token compartilhado entre requests,
 * mesmo no modo HTTP stateless, onde createMcpServer() é chamado por requisição).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { ProtheusClient, ProtheusResult } from "./protheusClient.js";

const cfg = loadConfig();
const client = new ProtheusClient(cfg.protheus);

export const toolCount = 10;

/** Converte um ProtheusResult em resposta de tool MCP (texto amigável + dados). */
function toToolResult(r: ProtheusResult) {
  if (r.ok && r.kind === "data") {
    return { content: [{ type: "text" as const, text: JSON.stringify(r.data, null, 2) }] };
  }
  if (r.ok && r.kind === "empty") {
    return { content: [{ type: "text" as const, text: r.message }] };
  }
  return { content: [{ type: "text" as const, text: r.message }], isError: true };
}

// paginação comum das APIs padrão
const pageArgs = {
  page: z.number().int().positive().optional().describe("Número da página (opcional)."),
  pagesize: z.number().int().positive().optional().describe("Registros por página (opcional)."),
  fields: z.string().optional().describe("Lista de campos desejados, separada por vírgula (opcional)."),
  order: z.string().optional().describe("Campo(s) de ordenação (opcional)."),
};

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "protheus-mcp-server", version: "0.1.0" });

  // 1. CUSTOMERCREDITLIMIT — Limite de crédito do cliente (Faturamento)
  server.registerTool(
    "protheus_limite_credito_cliente",
    {
      title: "Limite de crédito do cliente",
      description:
        "Consulta o limite de crédito dos clientes (Faturamento). Sem internalId, retorna a lista; com internalId (código+loja), um cliente específico.",
      inputSchema: {
        internalId: z.string().optional().describe("Identificador do cliente (código+loja). Opcional."),
        ...pageArgs,
      },
    },
    async ({ internalId, page, pagesize, fields, order }) => {
      const base = "/api/fat/v1/CustomerCreditLimit";
      const route = internalId ? `${base}/${encodeURIComponent(internalId)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 2. PAYMENTCONDITION — Condições de pagamento (Financeiro)
  server.registerTool(
    "protheus_condicoes_pagamento",
    {
      title: "Condições de pagamento",
      description:
        "Consulta as condições de pagamento (Faturamento/Financeiro). Sem code, retorna a lista; com code, uma condição específica.",
      inputSchema: {
        code: z.string().optional().describe("Código da condição de pagamento. Opcional."),
        ...pageArgs,
      },
    },
    async ({ code, page, pagesize, fields, order }) => {
      const base = "/api/fat/v1/paymentcondition";
      const route = code ? `${base}/${encodeURIComponent(code)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 3. MRPPRODUCT — Produtos (MRP/Estoque)
  server.registerTool(
    "protheus_produtos_mrp",
    {
      title: "Produtos (MRP)",
      description:
        "Consulta produtos do MRP. Sem ID, retorna a lista; com branchId+product, um produto específico. Obs.: base pode estar sem registros.",
      inputSchema: {
        branchId: z.string().optional().describe("Filial do produto (com product)."),
        product: z.string().optional().describe("Código do produto (com branchId)."),
        ...pageArgs,
      },
    },
    async ({ branchId, product, page, pagesize, fields, order }) => {
      const base = "/api/pcp/v1/mrpproduct";
      const route = branchId && product ? `${base}/${encodeURIComponent(branchId)}/${encodeURIComponent(product)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 4. MRPSTOCKBALANCE — Saldo em estoque (MRP)
  server.registerTool(
    "protheus_saldo_estoque_mrp",
    {
      title: "Saldo em estoque (MRP)",
      description:
        "Consulta os saldos em estoque do MRP. Sem ID, retorna a lista; com branchId+code, um registro específico. Obs.: base pode estar sem registros.",
      inputSchema: {
        branchId: z.string().optional().describe("Filial (com code)."),
        code: z.string().optional().describe("Código do registro (com branchId)."),
        ...pageArgs,
      },
    },
    async ({ branchId, code, page, pagesize, fields, order }) => {
      const base = "/api/pcp/v1/mrpstockbalance";
      const route = branchId && code ? `${base}/${encodeURIComponent(branchId)}/${encodeURIComponent(code)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 5. MRPWAREHOUSE — Armazéns (MRP)
  server.registerTool(
    "protheus_armazens_mrp",
    {
      title: "Armazéns (MRP)",
      description:
        "Consulta os armazéns do MRP. Sem ID, retorna a lista; com branchId+code, um armazém específico. Obs.: base pode estar sem registros.",
      inputSchema: {
        branchId: z.string().optional().describe("Filial (com code)."),
        code: z.string().optional().describe("Código do armazém (com branchId)."),
        ...pageArgs,
      },
    },
    async ({ branchId, code, page, pagesize, fields, order }) => {
      const base = "/api/pcp/v1/mrpwarehouse";
      const route = branchId && code ? `${base}/${encodeURIComponent(branchId)}/${encodeURIComponent(code)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 6. MRPPURCHASEORDER — Solicitações de compra (MRP) [ambiente DFL = SOLICITAÇÕES]
  server.registerTool(
    "protheus_solicitacoes_compra_mrp",
    {
      title: "Solicitações de compra (MRP)",
      description:
        "Solicitações de compra do MRP (endpoint MRPPurchaseOrder — no ambiente DFL retorna SOLICITAÇÕES). Sem ID, lista; com branchId+code, uma específica. Obs.: base pode estar sem registros.",
      inputSchema: {
        branchId: z.string().optional().describe("Filial (com code)."),
        code: z.string().optional().describe("Código (com branchId)."),
        ...pageArgs,
      },
    },
    async ({ branchId, code, page, pagesize, fields, order }) => {
      const base = "/api/pcp/v1/mrppurchaseorder";
      const route = branchId && code ? `${base}/${encodeURIComponent(branchId)}/${encodeURIComponent(code)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 7. MRPPURCHASEREQUEST — Pedidos de compra (MRP) [ambiente DFL = PEDIDOS]
  server.registerTool(
    "protheus_pedidos_compra_mrp",
    {
      title: "Pedidos de compra (MRP)",
      description:
        "Pedidos de compra do MRP (endpoint MRPPurchaseRequest — no ambiente DFL retorna PEDIDOS). Sem ID, lista; com branchId+code, um específico. Obs.: base pode estar sem registros.",
      inputSchema: {
        branchId: z.string().optional().describe("Filial (com code)."),
        code: z.string().optional().describe("Código (com branchId)."),
        ...pageArgs,
      },
    },
    async ({ branchId, code, page, pagesize, fields, order }) => {
      const base = "/api/pcp/v1/mrppurchaserequest";
      const route = branchId && code ? `${base}/${encodeURIComponent(branchId)}/${encodeURIComponent(code)}` : base;
      return toToolResult(await client.get(route, { page, pagesize, fields, order }));
    }
  );

  // 8. PAYMENT — Folha de pagamento (RH) — DADO SENSÍVEL
  server.registerTool(
    "protheus_folha_pagamento",
    {
      title: "Folha de pagamento (RH)",
      description:
        "Demonstrativo de pagamento (RH). Sem employeeId, retorna os tipos de alteração salarial (sem dado pessoal). Com employeeId, retorna o demonstrativo do funcionário — DADO PESSOAL SENSÍVEL (LGPD).",
      inputSchema: {
        employeeId: z.string().optional().describe("Matrícula do funcionário. Opcional (dado sensível)."),
      },
    },
    async ({ employeeId }) => {
      const route = employeeId ? `/payment/payments/${encodeURIComponent(employeeId)}` : "/payment/salaryHistory/type";
      return toToolResult(await client.get(route, {}));
    }
  );

  // 9. WSRCLIENTE — Clientes por vendedor (customizado)
  server.registerTool(
    "protheus_clientes_por_vendedor",
    {
      title: "Clientes por vendedor (WSRCLIENTE)",
      description:
        "Retorna os clientes vinculados a um vendedor/gerente, identificado pelo e-mail (SA3.A3_EMAIL). Atenção: o e-mail é do VENDEDOR, não do cliente.",
      inputSchema: {
        email: z.string().describe("E-mail do vendedor/gerente (obrigatório)."),
      },
    },
    async ({ email }) => {
      return toToolResult(await client.get("/WSRCLIENTE", { email }));
    }
  );

  // 10. WSRSALDOCLIENTE — Saldo em aberto do cliente (customizado)
  server.registerTool(
    "protheus_saldo_cliente",
    {
      title: "Saldo em aberto do cliente (WSRSALDOCLIENTE)",
      description:
        "Retorna o saldo em aberto (títulos a receber, SE1) de um cliente. Informe o código do cliente. Empresa/filial são fixadas em 03/01 pelo web service.",
      inputSchema: {
        cliente: z.string().describe("Código do cliente (E1_CLIENTE) — obrigatório."),
      },
    },
    async ({ cliente }) => {
      return toToolResult(await client.get("/WSRSALDOCLIENTE", { cliente }));
    }
  );

  return server;
}

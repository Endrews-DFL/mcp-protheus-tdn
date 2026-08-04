/**
 * Fábrica do servidor MCP. Tools de consulta (somente GET) sobre os web services
 * customizados da DFL (WSR*), definidas por configuração. Inclui a tool de diagnóstico.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { ProtheusClient, ProtheusResult } from "./protheusClient.js";

const cfg = loadConfig();
const client = new ProtheusClient(cfg.protheus);

// ---------------- utilidades de resposta ----------------

const MAX_ITEMS = 100;
function capLargeArrays(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v) && v.length > MAX_ITEMS) {
        const total = v.length;
        obj[k] = v.slice(0, MAX_ITEMS);
        obj[`_aviso_${k}`] = `Mostrando ${MAX_ITEMS} de ${total} registros (truncado). Refine a busca ou peça um filtro ao ADVPL.`;
      }
    }
  }
  return data;
}

function toToolResult(r: ProtheusResult) {
  if (r.ok && r.kind === "data") {
    let text = JSON.stringify(capLargeArrays(r.data), null, 2);
    if (text.length > 120000) text = text.slice(0, 120000) + "\n…[resposta truncada por tamanho]";
    return { content: [{ type: "text" as const, text }] };
  }
  if (r.ok && r.kind === "empty") {
    return { content: [{ type: "text" as const, text: r.message }] };
  }
  const raw = r.ok ? undefined : r.raw;
  const detail = raw ? `\n\n[resposta do Protheus]: ${String(raw).slice(0, 400)}` : "";
  return { content: [{ type: "text" as const, text: r.message + detail }], isError: true };
}

// ---------------- definição das tools (WSR que retornam dados) ----------------

interface ParamDef { key: string; required?: boolean; desc: string; default?: string }
interface ToolDef { name: string; service: string; title: string; description: string; params: ParamDef[] }

const TOOLS: ToolDef[] = [
  // Clientes / financeiro
  { name: "protheus_clientes", service: "WSRCRMSA1", title: "Clientes (cadastro)",
    description: "Cadastro de clientes (SA1). Sem filtro retorna a lista (grande). Pode filtrar por e-mail.",
    params: [{ key: "operacao", desc: "Operação (LISTA por padrão).", default: "LISTA" }, { key: "email", desc: "E-mail para filtrar (opcional)." }] },
  { name: "protheus_clientes_saldo_aberto", service: "WSRCLIABE", title: "Clientes com saldo em aberto",
    description: "Clientes com saldo/adiantamentos em aberto. Pode informar o código do cliente.",
    params: [{ key: "cliente", desc: "Código do cliente (opcional)." }] },
  { name: "protheus_clientes_estrangeiros", service: "WSRSA1EX", title: "Clientes estrangeiros",
    description: "Lista os clientes estrangeiros cadastrados.", params: [] },
  { name: "protheus_clientes_por_vendedor", service: "WSRCLIENTE", title: "Clientes por vendedor",
    description: "Clientes vinculados a um vendedor/gerente pelo e-mail (SA3.A3_EMAIL). O e-mail é do VENDEDOR.",
    params: [{ key: "email", required: true, desc: "E-mail do vendedor/gerente." }] },
  { name: "protheus_saldo_cliente", service: "WSRSALDOCLIENTE", title: "Saldo em aberto do cliente",
    description: "Saldo em aberto (títulos SE1) de um cliente. Empresa/filial 03/01.",
    params: [{ key: "cliente", required: true, desc: "Código do cliente (E1_CLIENTE)." }] },
  { name: "protheus_cliente_por_cnpj", service: "WSCONSAFES", title: "Cliente por CNPJ",
    description: "Retorna cliente(s) a partir do CNPJ.", params: [{ key: "cnpj", required: true, desc: "CNPJ do cliente." }] },

  // Produtos / estoque
  { name: "protheus_produtos", service: "WSRB2BPRODUTO", title: "Produtos (B2B)",
    description: "Produtos (PA). operacao=LISTA (padrão), ESTOQUE ou PRECO. Base grande — use filtro se possível.",
    params: [{ key: "operacao", desc: "LISTA (padrão), ESTOQUE ou PRECO.", default: "LISTA" }, { key: "armazem", desc: "Armazém (opcional)." }] },
  { name: "protheus_produtos_preco", service: "WSRCRMSB1", title: "Produtos (preço/tabela)",
    description: "Produtos com dados de preço. Pode informar a tabela (codtab).",
    params: [{ key: "codtab", desc: "Código da tabela de preço (opcional)." }] },
  { name: "protheus_produtos_pa", service: "WSRSB1PA", title: "Produtos PA (código+descrição)",
    description: "Lista de produtos PA (código e descrição).", params: [] },
  { name: "protheus_saldo_estoque", service: "WSRCRMSB2", title: "Saldo em estoque",
    description: "Saldo em estoque (SB2, armazém 04). operacao=LISTA (padrão) ou ESTOQUE.",
    params: [{ key: "operacao", desc: "LISTA (padrão) ou ESTOQUE.", default: "LISTA" }, { key: "produto", desc: "Código do produto (opcional)." }] },

  // Compras
  { name: "protheus_solicitacao_compra", service: "WSRESTSC", title: "Solicitação de compra (por número)",
    description: "Dados de uma Solicitação de Compra (SC1) pelo número, com itens e centro de custo.",
    params: [{ key: "numsc", required: true, desc: "Número da SC (C1_NUM)." }, { key: "op", desc: "Operação interna.", default: "1" }] },
  { name: "protheus_pedidos_compra_aberto", service: "WSRPCABERTO", title: "Pedidos de compra em aberto",
    description: "Pedidos de Compra (SC7) em aberto de um fornecedor+loja, com saldo e centro de custo.",
    params: [{ key: "fornece", required: true, desc: "Código do fornecedor." }, { key: "loja", required: true, desc: "Loja do fornecedor." }] },

  // Faturamento / contábil / fiscal
  { name: "protheus_faturamento_pedidos", service: "WSRDFLFATR01", title: "Pedidos / faturamento (status)",
    description: "Pedidos de venda com status (expedição, região, cliente).", params: [] },
  { name: "protheus_plano_contas", service: "WSRESTCONTA", title: "Plano de contas",
    description: "Plano de contas contábil (código, descrição, situação).", params: [] },
  { name: "protheus_ncm", service: "WSRSYD", title: "Tabela NCM",
    description: "Tabela de NCM (código e descrição). Base grande.", params: [] },

  // RH / acessos
  { name: "protheus_funcionarios", service: "WSRFUNC", title: "Funcionários",
    description: "Funcionários (matrícula, nome, cargo, CC). Pode filtrar por mês.",
    params: [{ key: "mes", desc: "Mês (MM) para filtro (opcional)." }] },
  { name: "protheus_aniversariantes", service: "WSRNIVER", title: "Aniversariantes",
    description: "Aniversariantes do mês.", params: [{ key: "mes", desc: "Mês (MM) (opcional)." }] },
  { name: "protheus_usuarios_cargo", service: "WSRUSERCARGO", title: "Usuários × cargo × centro de custo",
    description: "Usuários com cargo, CPF, matrícula e centro de custo.", params: [] },
  { name: "protheus_aprovadores", service: "WSRSRASUPERIOR", title: "Aprovadores (cargo superior)",
    description: "Colaboradores com cargo superior (alçada de aprovação). Pode filtrar por e-mail ou CC.",
    params: [{ key: "email", desc: "E-mail (opcional)." }, { key: "cc", desc: "Centro de custo (opcional)." }] },
  { name: "protheus_acesso_terceiros", service: "WSRTERCEIRO", title: "Liberação de acesso (terceiros)",
    description: "Liberações de acesso de terceiros (matrícula/CPF, nome, empresa).", params: [] },

  // Produção
  { name: "protheus_operacoes", service: "WSROPER", title: "Operações (roteiro)",
    description: "Operações de produção por produto (recurso, descrição).", params: [] },
  { name: "protheus_recursos", service: "WSRRECUR", title: "Recursos (produção)",
    description: "Recursos de produção (código, descrição, linha, CC).", params: [] },

  // Logística / outros
  { name: "protheus_transportadoras", service: "WSRTRANSPORTE", title: "Transportadoras",
    description: "Transportadoras (código e nome).", params: [] },
  { name: "protheus_tipos_reembolso", service: "WSRSZM", title: "Tipos de reembolso",
    description: "Tipos de reembolso (código, descrição, natureza).", params: [] },
  { name: "protheus_categorias_reembolso", service: "WSRTIPOREE", title: "Categorias de reembolso",
    description: "Categorias de reembolso (código, tipo, valores).", params: [] },

  // ---- Completando os 37 (OK + vazio) do diagnóstico de 03/08/2026 ----

  // Produtos / estrutura
  { name: "protheus_produto_tabela", service: "WSRPRODUTO", title: "Produto por tabela de preço",
    description: "Produto(s) de uma tabela de preço. Sem 'codtab' o serviço responde \"Tabela [] não encontrada\".",
    params: [{ key: "codtab", required: true, desc: "Código da tabela de preço (obrigatório)." },
             { key: "produto", desc: "Código do produto (opcional)." }] },
  { name: "protheus_estrutura_produto", service: "WSRESTRUTURA", title: "Estrutura do produto (BOM)",
    description: "Itens da estrutura (BOM) de um produto pai, para uma revisão. Contrato confirmado em produção (pai/rev).",
    params: [{ key: "pai", required: true, desc: "Código do produto pai (obrigatório)." },
             { key: "rev", desc: "Revisão da estrutura (opcional)." }] },
  { name: "protheus_produtos_estrutura_sb1", service: "WSESTRUTSB1", title: "Produtos (filtro SB1 para estrutura)",
    description: "Consulta de produtos (SB1) usada como apoio de estrutura. Precisa de filtro de produto válido.",
    params: [{ key: "produto", required: true, desc: "Código do produto (obrigatório)." }] },

  // Compras / centro de custo / orçamento
  { name: "protheus_aprovador_cc", service: "WSRAPROVCC", title: "Aprovador do centro de custo",
    description: "Aprovador(es) vinculados a um centro de custo válido.",
    params: [{ key: "cc", required: true, desc: "Centro de custo (obrigatório)." }] },
  { name: "protheus_solicitante_cc", service: "WSRSOLICITANTECC", title: "Solicitante por centro de custo",
    description: "Solicitante vinculado a um centro de custo, identificado pelo login.",
    params: [{ key: "login", required: true, desc: "Login do solicitante (obrigatório)." },
             { key: "cc", desc: "Centro de custo (opcional)." }] },
  { name: "protheus_itens_orcamento", service: "WSRITENSORC", title: "Itens do orçamento",
    description: "Itens de orçamento por centro de custo e/ou projeto.",
    params: [{ key: "cc", desc: "Centro de custo (opcional, mas recomendado)." },
             { key: "projeto", desc: "Projeto do orçamento (opcional)." }] },
  { name: "protheus_bordero", service: "WSBORDERO", title: "Borderô",
    description: "Dados de um borderô pelo código.",
    params: [{ key: "bordero", required: true, desc: "Código do borderô (obrigatório)." }] },
  { name: "protheus_empenho", service: "WSREMPENHO", title: "Empenho (OP)",
    description: "Empenho vinculado a uma Ordem de Produção (OP).",
    params: [{ key: "op", required: true, desc: "Número da OP (obrigatório)." }] },

  // Produção
  { name: "protheus_roteiro_producao", service: "WSRROTEIRO", title: "Roteiro de produção",
    description: "Roteiro de produção de uma Ordem de Produção (OP).",
    params: [{ key: "op", required: true, desc: "Número da OP (obrigatório)." }] },
  { name: "protheus_inspecao_contagem", service: "wsrInspContagem", title: "Inspeção de contagem",
    description: "Dados de inspeção de contagem vinculados a uma OP/inspeção.",
    params: [{ key: "op", required: true, desc: "Número da OP/inspeção (obrigatório)." }] },

  // Acessos / usuários / status (contrato [?] presumido — confirmar após 1º teste real)
  { name: "protheus_usuarios", service: "WSRUSUARIOS", title: "Usuários",
    description: "Lista de usuários; filtra pelo login/usuário quando informado.",
    params: [{ key: "usuario", desc: "Login/usuário para filtrar (opcional, mas recomendado — sem filtro pode retornar vazio)." }] },
  { name: "protheus_status_aprovacao_pagamento", service: "WSRSTAP", title: "Status de aprovação de pagamento",
    description: "[Contrato ainda não confirmado — o serviço responde '{}' sem um parâmetro de pagamento. " +
      "Ajustar o nome/valor do parâmetro após o 1º teste real; ver index/WSRSTAP no Protheus.]",
    params: [{ key: "pagamento", desc: "Identificador do pagamento (nome do parâmetro a confirmar)." }] },
  { name: "protheus_status_cotacao", service: "WSRSTPC", title: "Status de cotação",
    description: "[Contrato ainda não confirmado — o serviço responde '{}' sem um parâmetro de cotação. " +
      "Ajustar o nome/valor do parâmetro após o 1º teste real; ver index/WSRSTPC no Protheus.]",
    params: [{ key: "cotacao", desc: "Identificador da cotação (nome do parâmetro a confirmar)." }] },
  { name: "protheus_cc_data", service: "WSDSLEVERP", title: "Consulta por centro de custo + data",
    description: "[Nome do serviço (WSDSLEVERP) não permite inferir o domínio com segurança — contrato " +
      "presumido a partir do diagnóstico (precisa de CC + data). Confirmar em index/WSDSLEVERP antes de usar em produção.]",
    params: [{ key: "cc", required: true, desc: "Centro de custo (obrigatório)." },
             { key: "data", required: true, desc: "Data no formato AAAAMMDD (obrigatório)." }] },
];

export const toolCount = TOOLS.length + 1; // +1 = diagnóstico

// ---------------- lista para a varredura de diagnóstico ----------------

const WS_GET = [
  "WSBORDERO", "WSCONSAFES", "WSCONSULTA", "WSDESPESA", "WSDSLEVERP", "WSESTRUTSB1", "WSLERNFSF1",
  "WSRAPROVCC", "WSRB2BCLIENTE", "WSRB2BPRODUTO", "WSRB2BSB1", "WSRCLIABE", "WSRCLIENTE", "WSRCONTASR",
  "WSRCRMPRECO", "WSRCRMSA1", "WSRCRMSB1", "WSRCRMSB2", "WSRDFLFATR01", "WSREMPENHO", "WSRESTCONTA",
  "WSRESTFORNECEDORES", "WSRESTRUTURA", "WSRESTSC", "WSRFLUXOMEDICAO", "WSRFORNECE", "WSRFUNC",
  "WSRFUNCTERC", "WSRGESTOR", "WSRITENSORC", "WSRLANCCTB", "WSRNIVER", "WSROP", "WSROPER", "WSRORDEM",
  "WSRPAAPEND", "WSRPCABERTO", "WSRPRODUTO", "WSRRECAPV", "WSRRECUR", "WSRREEAPV", "WSRROTEIRO",
  "WSRSA1EX", "WSRSA2TOPN", "WSRSALDOCLIENTE", "WSRSB1PA", "WSRSOLICITANTECC", "WSRSRASUPERIOR",
  "WSRSTAP", "WSRSTPC", "WSRSYD", "WSRSZM", "WSRTERCEIRO", "WSRTIPOREE", "WSRTITOPEN", "WSRTRACKORD",
  "WSRTRANSPORTE", "WSRUSERCARGO", "WSRUSERSRA", "WSRUSUARIOS", "WSSB1TOPN", "WSTABELA", "WSTITULOS",
  "wsrInspContagem",
];
const DEV_PARAMS: Record<string, string> = {
  fil: "01", filial: "01", fornece: "A04559", loja: "01", cnpj: "62849644000106",
  cliente: "000087", codcli: "000087", codloja: "01", cc: "600011", ccusto: "600011",
  email: "endrews.santos@dfl.com.br", login: "endrews.santos", operacao: "LISTA", mes: "01",
};

// ---------------- fábrica ----------------

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "protheus-mcp-server", version: "0.4.0" });

  for (const def of TOOLS) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const p of def.params) {
      shape[p.key] = (p.required ? z.string() : z.string().optional()).describe(p.desc);
    }
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: shape },
      async (args: Record<string, unknown>) => {
        const query: Record<string, string> = { fil: "01" };
        for (const p of def.params) {
          const v = (args?.[p.key] as string | undefined) ?? p.default;
          if (v !== undefined && v !== "") query[p.key] = v;
        }
        return toToolResult(await client.get("/" + def.service, query));
      }
    );
  }

  // Diagnóstico — varre todos os WS GET com os parâmetros DEV.
  server.registerTool(
    "protheus_diagnostico",
    {
      title: "Diagnóstico — varre todos os WS GET (DEV)",
      description: "Percorre todos os web services GET com os parâmetros DEV e retorna um resumo compacto (ok/vazio/erro). Uso interno de teste.",
      inputSchema: {},
    },
    async () => {
      const out: Array<Record<string, unknown>> = [];
      for (const s of WS_GET) {
        const inicio = Date.now();
        const r = await client.get("/" + s, DEV_PARAMS);
        const ms = Date.now() - inicio;
        if (r.ok && r.kind === "data") {
          const t = JSON.stringify(r.data);
          out.push({ servico: s, status: "ok", ms, tamanho: t.length, amostra: t.slice(0, 140) });
        } else if (r.ok && r.kind === "empty") {
          out.push({ servico: s, status: "vazio", ms, amostra: r.message.slice(0, 140) });
        } else {
          out.push({ servico: s, status: "erro", ms, amostra: (r.message + " " + String(r.raw ?? "")).slice(0, 160) });
        }
      }
      const resumo = {
        total: out.length,
        ok: out.filter((x) => x.status === "ok").length,
        vazio: out.filter((x) => x.status === "vazio").length,
        erro: out.filter((x) => x.status === "erro").length,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify({ resumo, servicos: out }, null, 1) }] };
    }
  );

  return server;
}

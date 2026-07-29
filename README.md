# protheus-mcp-server (piloto)

Conector **MCP somente-leitura** para consulta ao Protheus (TOTVS) da DFL. Expõe 10 endpoints
GET como tools MCP, com autenticação OAuth2 (password grant + refresh automático) e tratamento
amigável de respostas vazias/erros.

> Este conector **apenas consulta** (GET). Não altera nada no Protheus. Os fontes `.prw` são
> usados só como referência de contrato — nunca são modificados.

## Configuração

Copie `.env.example` para `.env` e preencha:

- `PROTHEUS_BASE_URL` — base REST (inclui `/rest/03`).
- `PROTHEUS_USER` / `PROTHEUS_PASSWORD` — credenciais OAuth2. **Use um usuário de serviço só-leitura.**
- `PROTHEUS_TENANT_ID` — `empresa,filial` (ex.: `03,01`). Deixe vazio para não enviar o header.
- `PROTHEUS_DFL_TOKEN` — token dos WS customizados (só se a MV `DFL_TOKEN` estiver ligada).

## Build e execução

```
npm install
npm run build
node dist/index.js        # inicia o servidor MCP via stdio
```

As variáveis de ambiente precisam estar carregadas (via `.env` do seu runner, Docker, ou export).

## Tools (10 endpoints do piloto)

| Tool | Endpoint | Observação |
|---|---|---|
| `protheus_limite_credito_cliente` | `/api/fat/v1/CustomerCreditLimit` | ✅ com dados |
| `protheus_condicoes_pagamento` | `/api/fat/v1/paymentcondition` | ✅ com dados |
| `protheus_produtos_mrp` | `/api/pcp/v1/mrpproduct` | base pode estar vazia |
| `protheus_saldo_estoque_mrp` | `/api/pcp/v1/mrpstockbalance` | base pode estar vazia |
| `protheus_armazens_mrp` | `/api/pcp/v1/mrpwarehouse` | base pode estar vazia |
| `protheus_solicitacoes_compra_mrp` | `/api/pcp/v1/mrppurchaseorder` | = Solicitações (ambiente DFL) |
| `protheus_pedidos_compra_mrp` | `/api/pcp/v1/mrppurchaserequest` | = Pedidos (ambiente DFL) |
| `protheus_folha_pagamento` | `/payment/...` | RH — dado sensível (LGPD) |
| `protheus_clientes_por_vendedor` | `/WSRCLIENTE?email=` | e-mail do VENDEDOR |
| `protheus_saldo_cliente` | `/WSRSALDOCLIENTE?cliente=` | saldo em aberto (SE1) |

## Tratamento amigável de respostas

Regra geral aplicada a toda tool (`protheusClient.normalize`):

- **Lista vazia** (`items: []`), **404 "Nenhum registro foi encontrado"** → mensagem "Nenhum
  registro encontrado para os filtros informados." (não é erro).
- **500** (inclui o comportamento conhecido de alguns WS customizados quando não há registro ou
  falta parâmetro) → mensagem explicativa pedindo revisão dos parâmetros.
- **401** → renova o token uma vez e repete; persistindo, retorna erro de autorização.
- Formatos: envelope padrão `{hasNext, items}` e o formato custom dos `WSR*` são ambos aceitos.

## Regra de autenticação (token/refresh)

O endpoint OAuth2 do Protheus é sensível à codificação dos parâmetros: se `username`/`password`/
`refresh_token` forem 100% percent-encoded (ex.: `@` → `%40`), a autenticação falha. Por isso o
cliente monta as URLs de **token e refresh** com os parâmetros **direto na URL**, escapando apenas
o que quebraria a própria URL (`#`, `&`, `+`, espaço e `%`) e preservando `@`, `!`, etc.
Ver `ProtheusClient.encTokenParam`. **Não trocar por `URLSearchParams`** — ele reescapa o `@` e
volta a dar erro de autenticação.

## Contratos

Os contratos completos (rotas, parâmetros, campos de retorno, bugs conhecidos) estão em
`../protheus-piloto-contratos.json` e `../Protheus_Piloto_Spec_10_Endpoints.md`.

# Deploy do protheus-mcp-server no Coolify + registro no Claude

Mesmo fluxo do conector do Interact (`sa-api-mcp-server`): imagem Docker Node 22,
transporte HTTP (`MCP_TRANSPORT=http`) em `/mcp`, protegido por `CONNECTOR_API_KEY`.

## 1. Pré-requisitos

- Repositório Git com esta pasta (`protheus-mcp-server`) — ou subir via "Docker Compose" no Coolify.
- Um **usuário de serviço só-leitura** do Protheus (não usar login pessoal).
- Definir um segredo forte para `CONNECTOR_API_KEY` (ex.: `openssl rand -hex 32`).

## 2. Criar o recurso no Coolify

1. **New Resource** → selecione o servidor/projeto.
2. Fonte: **Dockerfile** (aponte para a pasta do projeto) ou **Docker Compose** (usa o `docker-compose.yml` incluso).
3. **Porta exposta:** `8080`. O Coolify provisiona o domínio HTTPS (proxy Traefik).
4. Em **Environment Variables**, defina (marque as sensíveis como *secret*):

   | Variável | Valor |
   |---|---|
   | `MCP_TRANSPORT` | `http` |
   | `HTTP_PORT` | `8080` |
   | `HTTP_PATH` | `/mcp` |
   | `PROTHEUS_BASE_URL` | `https://dflindustria141981.protheus.cloudtotvs.com.br:1916/rest/03` |
   | `PROTHEUS_USER` | *(usuário de serviço)* |
   | `PROTHEUS_PASSWORD` | *(senha — secret)* |
   | `PROTHEUS_TENANT_ID` | `03,01` |
   | `PROTHEUS_DFL_TOKEN` | *(só se a MV DFL_TOKEN estiver ligada)* |
   | `CONNECTOR_API_KEY` | *(segredo do conector — secret)* |

5. **Deploy.** O `healthcheck` bate em `GET /health` (deve responder `{"status":"ok","tools":10}`).

## 3. Validar após o deploy

Troque `SEU_DOMINIO` e `SUA_CHAVE`:

```
# saúde (sem auth)
curl https://SEU_DOMINIO/health

# lista as 10 tools (com auth do conector)
curl -X POST https://SEU_DOMINIO/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer SUA_CHAVE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Deve listar as 10 tools `protheus_*`.

## 4. Registrar no Claude

Como conector MCP remoto (mesmo caminho do Interact):

- **URL:** `https://SEU_DOMINIO/mcp`
- **Autenticação:** header `Authorization: Bearer <CONNECTOR_API_KEY>`
  (o servidor também aceita `x-connector-key: <CONNECTOR_API_KEY>`).

Em Settings → Connectors (ou no painel admin da organização), adicione o conector com a URL e a chave acima. Feito isso, as 10 tools de consulta ao Protheus ficam disponíveis no Claude.

## 5. Notas de segurança

- `CONNECTOR_API_KEY` protege o endpoint MCP; sem ela, qualquer um que alcance a URL usa o conector. **Sempre defina.**
- As credenciais do Protheus ficam só no servidor (env/secret) — nunca no cliente.
- Conector é **somente leitura** (apenas GET); não expõe POST/PUT/DELETE.

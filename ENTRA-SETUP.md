# OAuth por pessoa (login Microsoft/Entra) — configuração

O conector passa a exigir login Microsoft. Só e-mails da sua allowlist conseguem usar —
mesmo que alguém veja/adicione o conector no Claude (resolve a limitação do plano Team).

Fluxo: Claude → nosso conector (`/authorize`) → login Microsoft → nosso `/callback` valida o
e-mail na allowlist → emite os tokens → Claude usa o `/mcp`. O login acontece **uma vez** ao
vincular; depois o Claude renova sozinho.

## Parte A — App Registration no Entra (portal do admin)

1. Acesse **https://entra.microsoft.com** → **Identity → Applications → App registrations → New registration**.
2. **Name:** `Protheus MCP Connector`.
3. **Supported account types:** *Accounts in this organizational directory only* (single tenant — só DFL).
4. **Redirect URI:** tipo **Web**, valor:
   `https://protheus-mcp.SEUDOMINIO.com.br/callback`
   (troque pelo domínio real da VPS; é o `/callback` do nosso conector.)
5. Clique **Register**.
6. Na tela **Overview**, copie:
   - **Application (client) ID** → variável `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → variável `ENTRA_TENANT_ID`
7. **Certificates & secrets → Client secrets → New client secret** → descrição + validade (ex.: 24 meses) → **Add**.
   Copie o **Value** (aparece uma vez só) → variável `ENTRA_CLIENT_SECRET`. (Anote a data de expiração para renovar depois.)
8. **API permissions:** já vem `Microsoft Graph → User.Read (Delegated)`. Adicione, se não houver, as permissões delegadas **openid**, **profile**, **email** (*Add a permission → Microsoft Graph → Delegated*). Não precisa de admin consent para essas.
9. (Recomendado) **Token configuration → Add optional claim → ID → `email`** para garantir o claim de e-mail no token. Mesmo sem isso funciona (usamos `preferred_username`/UPN como fallback).

> Só isso. Não precisa habilitar "implicit/hybrid" — usamos Authorization Code flow.

## Parte B — Variáveis no `.env` da VPS

No `.env` do conector, preencha:

```
AUTH_MODE=oauth
PUBLIC_URL=https://protheus-mcp.SEUDOMINIO.com.br
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<Value do secret>
OAUTH_ALLOWED_DOMAINS=dfl.com.br
# opcional, para restringir a pessoas específicas (em vez do domínio inteiro):
OAUTH_ALLOWED_EMAILS=fulano1@dfl.com.br,fulano2@dfl.com.br
OAUTH_JWT_SECRET=<gere com: openssl rand -hex 32>
```

Regras da allowlist:
- `OAUTH_ALLOWED_DOMAINS=dfl.com.br` → qualquer @dfl.com.br pode usar.
- `OAUTH_ALLOWED_EMAILS=...` → libera pessoas específicas (some com o domínio se quiser só elas — deixe `OAUTH_ALLOWED_DOMAINS` vazio e liste os e-mails).
- Precisa de **pelo menos um** dos dois preenchidos.

## Parte C — Rebuild + deploy

```
cd /opt/protheus-mcp-server
git pull            # ou reenvie os arquivos atualizados
docker compose up -d --build
curl -s https://protheus-mcp.SEUDOMINIO.com.br/health   # deve mostrar "auth":"oauth"
```

**Caddy:** no modo OAuth, o `/authorize` e o `/callback` são acessados pelo navegador do usuário e pelo Entra — então **não** restrinja mais por IP. Use um Caddyfile simples:

```
protheus-mcp.SEUDOMINIO.com.br {
    reverse_proxy localhost:8080
}
```
(A proteção agora é o OAuth + allowlist, não o IP.)

## Parte D — Registrar no Claude

1. Remova o conector antigo.
2. **Add custom connector** → URL: `https://protheus-mcp.SEUDOMINIO.com.br/mcp`.
3. Agora a tela de **OAuth** que o Claude mostra é exatamente o que queremos — ela vai abrir o **login Microsoft**. Não precisa preencher Client ID/Secret (o conector suporta registro automático/DCR).
4. Cada pessoa que adicionar faz login com a conta DFL. Quem estiver na allowlist entra; quem não estiver é barrado na hora.

## Teste rápido de discovery (antes do Claude)

```
curl -s https://protheus-mcp.SEUDOMINIO.com.br/.well-known/oauth-authorization-server
curl -s -i https://protheus-mcp.SEUDOMINIO.com.br/mcp -X POST -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -i www-authenticate
```
O segundo deve retornar **401** com `WWW-Authenticate: Bearer resource_metadata=...`.

## Como gerenciar quem tem acesso

- Adicionar/remover pessoas = editar `OAUTH_ALLOWED_EMAILS` (ou o domínio) e `docker compose up -d` de novo.
- Remover alguém tem efeito na próxima renovação do token dela (o servidor revalida a allowlist em cada chamada e a cada refresh).

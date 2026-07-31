# Solicitação de consentimento de administrador — App "Protheus MCP Connector"

**Para:** Administrador do Microsoft Entra (Azure AD) da DFL
**De:** [seu nome] — [área/cargo]
**Assunto:** Aprovar (grant admin consent) as permissões de identidade de um App Registration

## 1. O que é e para que serve

Registramos um aplicativo no Entra para servir **apenas de login (SSO)** de um conector interno
que consulta dados do **Protheus** de forma **somente leitura** dentro do Claude. O aplicativo do
Entra é usado exclusivamente para **autenticar a pessoa** (confirmar quem é e o e-mail) e assim
liberar o uso do conector **só para uma lista de usuários autorizados**. Ele **não** lê e-mail,
arquivos, agenda, Teams nem dados do diretório.

Precisamos do **consentimento do administrador** porque o tenant da DFL exige aprovação de admin
para qualquer aplicativo (o consentimento por usuário final está desabilitado). As permissões em
si são de baixo privilégio (identidade básica).

## 2. O que foi configurado no Entra (para revisão)

- **App registration** criado: nome **"Protheus MCP Connector"**.
- **Tipo de conta:** *Single tenant* — apenas contas da organização DFL.
- **Redirect URI (Web):** `https://protheus-mcp.SEUDOMINIO.com.br/callback` (endpoint do nosso conector).
- **Client secret:** gerado e guardado **apenas no servidor** do conector (não exposto ao Claude nem ao usuário).
- **API permissions (Microsoft Graph, Delegated):** `openid`, `profile`, `email` (e o padrão `User.Read`).
- **Fluxo:** OAuth 2.0 Authorization Code + PKCE (padrão, sem "implicit").

**Identificadores do app (para conferência):**
- Application (client) ID: `[preencher]`
- Directory (tenant) ID: `[preencher]`

## 3. Permissões solicitadas e o que cada uma concede

| Permissão | Tipo | O que concede | Admin consent |
|---|---|---|---|
| `openid` | Delegated | Autenticar o usuário (login/SSO). Nenhum dado além da identidade. | Exigido pela política do tenant |
| `profile` | Delegated | Nome e dados básicos de perfil no token de identidade. | Exigido pela política do tenant |
| `email` | Delegated | Endereço de e-mail do usuário no token de identidade. | Exigido pela política do tenant |
| `User.Read` | Delegated | Ler o perfil básico do **próprio** usuário logado (padrão do Entra). Não usamos ativamente; pode ser removida. | Normalmente não exige |

Todas são **delegadas** (agem em nome do usuário logado, só sobre os dados **dele**) e de escopo
**identidade**. Não há permissões de aplicativo (application), nem escopos de e-mail/arquivos/diretório.

## 4. O que o aplicativo NÃO acessa (importante)

- ❌ Não lê caixa de e-mail, calendário, contatos.
- ❌ Não lê OneDrive/SharePoint/arquivos.
- ❌ Não lê Teams/mensagens.
- ❌ Não lê a lista de usuários/grupos do diretório.
- ❌ Não escreve/altera nada no Microsoft 365.
- ❌ Não age sem o usuário presente (sem client_credentials/app-only).

O único dado consumido é **nome e e-mail da pessoa que está logando**, e só para checar se ela
está na lista de autorizados do conector.

## 5. Riscos e mitigações

- **Exposição de identidade:** o servidor do conector recebe nome/e-mail de quem loga — informação
  de baixa sensibilidade e já conhecida internamente. *Mitigação:* dados usados só para autorização; nada é compartilhado externamente.
- **Vazamento do client secret:** permitiria a um atacante se passar pelo app no fluxo OAuth, mas
  ainda assim ele precisaria **passar pelo login Microsoft** e **estar na allowlist**, e só obteria
  claims de identidade (não dados da organização). *Mitigação:* secret só no servidor (secret manager),
  com validade e rotação; app single-tenant.
- **Acesso indevido ao conector:** *Mitigação:* uso restrito a uma **allowlist de e-mails**; o
  servidor revalida a cada requisição e a cada renovação de token; admin pode revogar removendo o
  Enterprise Application ou o usuário da allowlist.

## 6. O que está protegido

- **App single-tenant** (só contas DFL) + **Authorization Code + PKCE** (padrão seguro atual).
- **Credenciais do Protheus** ficam no servidor, isoladas deste app do Entra, e o conector é **somente leitura** (apenas GET; sem POST/PUT/DELETE).
- **Segredos** (client secret e chave de assinatura dos tokens) apenas no servidor, nunca no Claude/cliente.
- **Controle por pessoa:** só e-mails autorizados usam o conector; login individual e auditável.
- **Revogação simples:** desabilitar o Enterprise Application no Entra corta o acesso de todos imediatamente.

## 7. Ação solicitada ao administrador

Conceder o **admin consent** para as permissões delegadas acima:

> Entra admin center → **Identity → Applications → App registrations → "Protheus MCP Connector" → API permissions → "Grant admin consent for DFL"**.
>
> (Ou via **Enterprise applications → "Protheus MCP Connector" → Permissions → Grant admin consent**.)

Após o consentimento, os usuários autorizados conseguirão fazer login no conector normalmente,
sem novas telas de aprovação.

Qualquer dúvida ou revisão adicional de segurança, ficamos à disposição.

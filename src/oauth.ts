/**
 * Camada OAuth do conector (padrão "broker").
 *
 * O Claude autentica contra ESTE servidor (que atua como Authorization Server + Resource
 * Server para o Claude). Este servidor, por sua vez, delega o login do usuário à
 * Microsoft/Entra (agindo como client confidencial do Entra) e, ao receber o e-mail do
 * usuário, valida-o contra uma allowlist antes de emitir os próprios tokens (JWT HS256).
 *
 * Fluxo:
 *   Claude → GET  /authorize            → redireciona p/ Entra /authorize
 *   Entra  → GET  /callback?code=...     → troca code no Entra, pega e-mail, checa allowlist,
 *                                          emite "nosso code" e redireciona p/ o Claude
 *   Claude → POST /token (code+PKCE)     → valida PKCE, emite access/refresh (JWT) do conector
 *   Claude → POST /mcp (Bearer <token>)  → middleware valida o JWT + allowlist
 *
 * Tokens do conector são JWT assinados com OAUTH_JWT_SECRET (stateless). Auth codes e o
 * "state" do round-trip com o Entra também são JWTs curtos — não há storage no servidor.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import type { OAuthConfig } from "./config.js";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function isRedirectAllowed(uri: string): boolean {
  if (uri === CLAUDE_CALLBACK) return true;
  // Claude Code usa loopback em porta efêmera
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(uri);
}

export function makeOAuth(cfg: OAuthConfig) {
  const key = new TextEncoder().encode(cfg.jwtSecret);
  const issuer = cfg.publicUrl;
  const redirectToEntra = `${cfg.publicUrl}/callback`;

  const sign = (payload: Record<string, unknown>, expSeconds: number) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(issuer)
      .setExpirationTime(`${expSeconds}s`)
      .sign(key);

  const verify = async (token: string) => (await jwtVerify(token, key, { issuer })).payload;

  function emailAllowed(email: string): boolean {
    const e = email.toLowerCase();
    if (cfg.allowedEmails.includes(e)) return true;
    const domain = e.split("@")[1] ?? "";
    return cfg.allowedDomains.includes(domain);
  }

  // ---- metadata (discovery) ----
  const protectedResource = {
    resource: `${cfg.publicUrl}${"/mcp"}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
  };
  const asMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "email", "profile", "offline_access", "mcp"],
  };

  function mount(app: Express, mcpPath: string): void {
    // protected resource metadata (com e sem sufixo do path do MCP)
    const prBody = { ...protectedResource, resource: `${cfg.publicUrl}${mcpPath}` };
    app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(prBody));
    app.get(`/.well-known/oauth-protected-resource${mcpPath}`, (_req, res) => res.json(prBody));
    // authorization server metadata
    app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(asMetadata));
    app.get("/.well-known/openid-configuration", (_req, res) => res.json(asMetadata));

    // Dynamic Client Registration (público, sem secret)
    app.post("/register", (req, res) => {
      const body = req.body ?? {};
      const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      res.status(201).json({
        client_id: `mcp-${randomUUID()}`,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    });

    // /authorize — inicia o login redirecionando para o Entra
    app.get("/authorize", async (req, res) => {
      try {
        const q = req.query as Record<string, string>;
        if (q.response_type !== "code") return res.status(400).send("response_type deve ser 'code'");
        if (!q.code_challenge || q.code_challenge_method !== "S256")
          return res.status(400).send("PKCE S256 obrigatório");
        if (!q.redirect_uri || !isRedirectAllowed(q.redirect_uri))
          return res.status(400).send("redirect_uri não permitido");

        // guarda os parâmetros do Claude num state assinado (10 min)
        const state = await sign(
          { rd: q.redirect_uri, st: q.state ?? "", cc: q.code_challenge, ci: q.client_id ?? "" },
          600
        );

        const entra = new URL(
          `https://login.microsoftonline.com/${cfg.entraTenantId}/oauth2/v2.0/authorize`
        );
        entra.searchParams.set("client_id", cfg.entraClientId);
        entra.searchParams.set("response_type", "code");
        entra.searchParams.set("redirect_uri", redirectToEntra);
        entra.searchParams.set("response_mode", "query");
        entra.searchParams.set("scope", "openid profile email");
        entra.searchParams.set("state", state);
        res.redirect(entra.toString());
      } catch (e: any) {
        res.status(500).send(`Erro no /authorize: ${e?.message ?? e}`);
      }
    });

    // /callback — retorno do Entra
    app.get("/callback", async (req, res) => {
      const q = req.query as Record<string, string>;
      let claude: any;
      try {
        claude = await verify(q.state);
      } catch {
        return res.status(400).send("state inválido ou expirado");
      }
      const backToClaude = (params: Record<string, string>) => {
        const u = new URL(claude.rd);
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
        if (claude.st) u.searchParams.set("state", claude.st);
        res.redirect(u.toString());
      };

      if (q.error) return backToClaude({ error: q.error, error_description: q.error_description ?? "" });
      if (!q.code) return backToClaude({ error: "invalid_request", error_description: "sem code" });

      // troca o code do Entra por tokens
      try {
        const form = new URLSearchParams({
          client_id: cfg.entraClientId,
          client_secret: cfg.entraClientSecret,
          grant_type: "authorization_code",
          code: q.code,
          redirect_uri: redirectToEntra,
          scope: "openid profile email",
        });
        const tr = await fetch(
          `https://login.microsoftonline.com/${cfg.entraTenantId}/oauth2/v2.0/token`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }
        );
        const tj: any = await tr.json();
        if (!tr.ok || !tj.id_token) {
          return backToClaude({ error: "access_denied", error_description: "falha ao autenticar no Entra" });
        }
        const claims: any = decodeJwt(tj.id_token);
        const email = String(claims.email || claims.preferred_username || claims.upn || "").toLowerCase();
        const name = String(claims.name || email);
        if (!email) return backToClaude({ error: "access_denied", error_description: "e-mail não retornado" });
        if (!emailAllowed(email))
          return backToClaude({ error: "access_denied", error_description: `Usuário ${email} não autorizado.` });

        // emite "nosso" authorization code (5 min), amarrado ao PKCE do Claude
        const code = await sign({ email, name, cc: claude.cc, rd: claude.rd, typ: "code" }, 300);
        return backToClaude({ code });
      } catch (e: any) {
        return backToClaude({ error: "server_error", error_description: e?.message ?? "erro" });
      }
    });

    // /token — troca code por access/refresh, e refresh por novo access
    app.post("/token", async (req, res) => {
      const b = req.body ?? {};
      const fail = (code: string, desc?: string, status = 400) =>
        res.status(status).json({ error: code, error_description: desc });
      try {
        if (b.grant_type === "authorization_code") {
          let p: any;
          try {
            p = await verify(b.code);
          } catch {
            return fail("invalid_grant", "code inválido ou expirado");
          }
          if (p.typ !== "code") return fail("invalid_grant", "tipo de token incorreto");
          // valida PKCE
          const challenge = b64url(sha256(String(b.code_verifier ?? "")));
          if (challenge !== p.cc) return fail("invalid_grant", "PKCE inválido");
          if (b.redirect_uri && b.redirect_uri !== p.rd) return fail("invalid_grant", "redirect_uri divergente");
          if (!emailAllowed(p.email)) return fail("invalid_grant", "usuário não autorizado");
          return res.json(await issueTokens(p.email, p.name));
        }

        if (b.grant_type === "refresh_token") {
          let p: any;
          try {
            p = await verify(b.refresh_token);
          } catch {
            return fail("invalid_grant", "refresh_token inválido ou expirado");
          }
          if (p.typ !== "refresh") return fail("invalid_grant", "tipo de token incorreto");
          if (!emailAllowed(p.email)) return fail("invalid_grant", "usuário não autorizado");
          return res.json(await issueTokens(p.email, p.name));
        }

        return fail("unsupported_grant_type", `grant_type '${b.grant_type}' não suportado`);
      } catch (e: any) {
        return fail("server_error", e?.message ?? "erro", 500);
      }
    });
  }

  async function issueTokens(email: string, name: string) {
    const access = await sign({ email, name, typ: "access", aud: `${cfg.publicUrl}/mcp` }, 3600);
    const refresh = await sign({ email, name, typ: "refresh" }, 30 * 24 * 3600);
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: "mcp" };
  }

  // Middleware que protege o /mcp
  function authMiddleware() {
    const wwwAuth = `Bearer resource_metadata="${cfg.publicUrl}/.well-known/oauth-protected-resource"`;
    return async (req: Request, res: Response, next: NextFunction) => {
      const auth = req.header("authorization");
      const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
      if (!token) {
        res.setHeader("WWW-Authenticate", wwwAuth);
        return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Autenticação necessária." }, id: null });
      }
      try {
        const p: any = await verify(token);
        if (p.typ !== "access" || !emailAllowed(p.email)) throw new Error("token inválido");
        (req as any).userEmail = p.email;
        next();
      } catch {
        res.setHeader("WWW-Authenticate", wwwAuth);
        return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Token inválido ou usuário não autorizado." }, id: null });
      }
    };
  }

  return { mount, authMiddleware };
}

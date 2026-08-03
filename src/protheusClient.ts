/**
 * protheusClient — cliente OAuth2 (password grant) para o Protheus REST.
 * - Obtém e renova o token automaticamente (refresh_token; fallback para novo password grant).
 * - Retry único em 401 (renova e repete).
 * - Normaliza respostas em um formato amigável (ver ProtheusResult), tratando os casos
 *   conhecidos: 404 "Nenhum registro foi encontrado" e 500 dos WS customizados.
 * Somente-leitura: expõe apenas GET.
 */

export interface ProtheusConfig {
  baseUrl: string;
  user: string;
  password: string;
  tenantId?: string; // "empresa,filial" — se vazio, não envia o header
  dflToken?: string; // token de aplicação dos WS customizados (MV DFL_TOKEN)
}

export type ProtheusResult =
  | { ok: true; kind: "data"; data: unknown; message?: string }
  | { ok: true; kind: "empty"; message: string }
  | { ok: false; kind: "error"; message: string; status?: number; raw?: string };

interface TokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

export class ProtheusClient {
  private cfg: ProtheusConfig;
  private token?: TokenState;

  constructor(cfg: ProtheusConfig) {
    this.cfg = cfg;
  }

  // ---------- Token ----------

  /**
   * REGRA DO TOKEN: os endpoints de token/refresh do Protheus são sensíveis à codificação.
   * Passando os valores 100% percent-encoded (ex.: '@' -> '%40'), a autenticação falha.
   * Só funciona com os parâmetros literais na URL, escapando apenas o que quebraria a própria
   * URL (#, &, +, espaço e o próprio %). Preservamos '@', '!', etc. — reproduzindo o que
   * funciona no Postman quando tudo é colocado direto na URL.
   */
  private static encTokenParam(v: string): string {
    return v
      .replace(/%/g, "%25")
      .replace(/#/g, "%23")
      .replace(/&/g, "%26")
      .replace(/\+/g, "%2B")
      .replace(/ /g, "%20");
  }

  private tokenUrl(params: Record<string, string>): string {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${ProtheusClient.encTokenParam(v)}`)
      .join("&");
    return `${this.cfg.baseUrl}/api/oauth2/v1/token?${qs}`;
  }

  private async fetchToken(): Promise<void> {
    const url = this.tokenUrl({
      grant_type: "password",
      username: this.cfg.user,
      password: this.cfg.password,
    });

    // O endpoint OAuth do Protheus às vezes retorna 401 intermitente na 1ª tentativa
    // (cold start do ambiente REST). Tentamos algumas vezes antes de desistir.
    const maxAttempts = 4;
    let lastErr = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
      } catch (e: any) {
        const cause = e?.cause?.code || e?.cause?.message || "";
        lastErr = `conexão: ${e?.message ?? e}${cause ? ` (${cause})` : ""}`;
        if (attempt < maxAttempts) await delay(400 * attempt);
        continue;
      }
      const raw = await res.text();
      if (res.ok) {
        try {
          this.storeToken(JSON.parse(raw));
          return;
        } catch {
          throw new Error(`Token: resposta não-JSON (HTTP ${res.status}): ${raw.slice(0, 200)}`);
        }
      }
      lastErr = `HTTP ${res.status}: ${raw.slice(0, 300)}`;
      if (attempt < maxAttempts) await delay(400 * attempt);
    }
    throw new Error(
      `Falha ao obter token após ${maxAttempts} tentativas. Último erro: ${lastErr} — ` +
        `verifique usuário/senha (PROTHEUS_USER/PROTHEUS_PASSWORD), a base /rest/03 e a porta 1916.`
    );
  }

  private async refresh(): Promise<void> {
    if (!this.token?.refreshToken) {
      return this.fetchToken();
    }
    const url = this.tokenUrl({
      grant_type: "refresh_token",
      refresh_token: this.token.refreshToken,
    });
    const res = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
    if (!res.ok) {
      // refresh expirou/invalidou — tenta novo password grant
      return this.fetchToken();
    }
    this.storeToken(await res.json());
  }

  private storeToken(body: any): void {
    const expiresInSec = Number(body?.expires_in ?? 3600);
    this.token = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      // margem de 60s para renovar antes de expirar
      expiresAt: Date.now() + Math.max(0, expiresInSec - 60) * 1000,
    };
  }

  private async ensureToken(): Promise<void> {
    if (!this.token) return this.fetchToken();
    if (Date.now() >= this.token.expiresAt) return this.refresh();
  }

  // ---------- GET ----------

  /**
   * Executa um GET no Protheus e devolve um ProtheusResult normalizado.
   * @param routePath rota relativa à baseUrl, começando com "/" (ex.: "/api/pcp/v1/mrpproduct")
   * @param query     parâmetros de query (undefined são ignorados)
   */
  async get(routePath: string, query: Record<string, string | number | undefined> = {}): Promise<ProtheusResult> {
    await this.ensureToken();

    const url = new URL(this.cfg.baseUrl + routePath);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    // token de aplicação dos WS customizados, quando configurado
    if (this.cfg.dflToken && !url.searchParams.has("token")) {
      url.searchParams.set("token", this.cfg.dflToken);
    }

    let res = await this.rawGet(url.toString());
    if (res.status === 401) {
      // token possivelmente expirado no servidor — renova e tenta 1x
      await this.refresh();
      res = await this.rawGet(url.toString());
    }
    return this.normalize(res.status, res.body);
  }

  private async rawGet(url: string): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token?.accessToken ?? ""}`,
    };
    if (this.cfg.tenantId) headers["tenantId"] = this.cfg.tenantId;
    const res = await fetch(url, { method: "GET", headers });
    return { status: res.status, body: await res.text() };
  }

  // ---------- Normalização amigável ----------

  private normalize(status: number, body: string): ProtheusResult {
    let parsed: any = undefined;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      /* corpo não-JSON (ex.: mensagem de texto de alguns WS) */
    }

    // 200 OK
    if (status >= 200 && status < 300) {
      // envelope padrão TOTVS { hasNext, items: [...] }
      if (parsed && Array.isArray(parsed.items)) {
        if (parsed.items.length === 0) {
          return { ok: true, kind: "empty", message: "Nenhum registro encontrado para os filtros informados." };
        }
        return { ok: true, kind: "data", data: parsed };
      }
      // WS customizado: resposta de texto "Cliente não localizado..." / "Clientes não cadastrados..."
      if (parsed === undefined && /localizad|cadastrad|não|nao/i.test(body)) {
        return { ok: true, kind: "empty", message: friendlyEmpty(body) };
      }
      // WSR customizados: mensagens de vazio, ex.: {"RETORNO":"Nenhum registro foi encontrado."}
      // ou {"Aviso":{"Mensagem":"Não há registros..."}}
      const flat = JSON.stringify(parsed ?? body ?? "");
      if (flat.length < 400 && /nenhum registro|n[ãa]o h[áa] |sem registro|n[ãa]o localiz|n[ãa]o cadastr/i.test(flat)) {
        return { ok: true, kind: "empty", message: "Nenhum registro encontrado para os filtros informados." };
      }
      // formato custom U_JSON { "CLIENTES": {...} } ou objeto único
      return { ok: true, kind: "data", data: parsed ?? body };
    }

    // 404 — no Protheus normalmente significa "nenhum registro", não rota inexistente
    if (status === 404) {
      const msg = parsed?.message ?? "";
      if (/nenhum registro/i.test(msg) || msg === "") {
        return { ok: true, kind: "empty", message: "Nenhum registro encontrado para os filtros informados." };
      }
      return { ok: false, kind: "error", status, message: `Recurso não encontrado: ${msg}`, raw: body };
    }

    // 500 — inclui o bug conhecido dos WS customizados (retornam 500 quando não há registro)
    if (status === 500) {
      return {
        ok: false,
        kind: "error",
        status,
        message:
          "O serviço do Protheus retornou erro interno. Em alguns web services customizados isso " +
          "acontece quando não há registro para o filtro informado ou quando falta um parâmetro " +
          "obrigatório. Revise os parâmetros e tente novamente.",
        raw: body,
      };
    }

    if (status === 401 || status === 403) {
      return { ok: false, kind: "error", status, message: "Acesso não autorizado. Verifique as credenciais do conector.", raw: body };
    }

    return { ok: false, kind: "error", status, message: `Erro ao consultar o Protheus (HTTP ${status}).`, raw: body };
  }
}

function friendlyEmpty(body: string): string {
  const t = body.replace(/["{}]/g, " ").trim();
  return t.length ? `Sem resultados: ${t}` : "Nenhum registro encontrado para os filtros informados.";
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

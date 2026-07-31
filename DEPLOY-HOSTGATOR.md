# Deploy na VPS HostGator (AlmaLinux 9) — Docker + Caddy

A VPS já alcança o Protheus:1916 (testado). Aqui subimos o conector com Docker e
publicamos o `/mcp` com HTTPS via Caddy, para registrar no Claude.

Pré-requisito: um **subdomínio** com registro DNS **A** apontando para o IP público da VPS
(ex.: `protheus-mcp.seudominio.com.br` → IP da VPS). Sem domínio, veja a alternativa
"Cloudflare Tunnel" no fim.

Todos os comandos são como `root`.

## 1. Instalar Docker

```
dnf -y install dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker --version
```

## 2. Colocar o projeto na VPS

Opção A — enviar o pacote (do seu PC):
```
scp protheus-mcp-server.tar.gz root@IP_DA_VPS:/opt/
```
Na VPS:
```
cd /opt
tar -xzf protheus-mcp-server.tar.gz
cd protheus-mcp-server
```

Opção B — se você tem repositório git:
```
cd /opt && git clone <URL_DO_SEU_REPO> protheus-mcp-server && cd protheus-mcp-server
```

## 3. Configurar o .env

```
cp .env.example .env
nano .env
```
Preencha:
- `PROTHEUS_BASE_URL=https://dflindustria141981.protheus.cloudtotvs.com.br:1916/rest/03`
- `PROTHEUS_USER=` e `PROTHEUS_PASSWORD=` (usuário de serviço só-leitura, de preferência)
- `PROTHEUS_TENANT_ID=03,01`
- `MCP_TRANSPORT=http`
- `HTTP_PORT=8080` · `HTTP_PATH=/mcp`
- `CONNECTOR_API_KEY=` — deixe **vazio** por enquanto (o Claude conecta sem OAuth; a proteção fica na camada de rede pelo Caddy, passo 6).

## 4. Não expor a 8080 na internet

Edite o `docker-compose.yml` e troque a linha de porta para escutar só localmente:
```
    ports:
      - "127.0.0.1:8080:8080"
```
Assim só o Caddy (na própria VPS) acessa a 8080; a internet chega apenas pelo Caddy (443).

## 5. Subir o conector

```
docker compose up -d --build
docker compose logs --tail=20
curl -s http://localhost:8080/health
```
Esperado: `{"status":"ok","tools":10}`.

## 6. Publicar com HTTPS (Caddy) restrito ao Claude

Instalar Caddy:
```
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy
```

Abrir 80/443 no firewall:
```
firewall-cmd --permanent --add-service=http --add-service=https
firewall-cmd --reload
```

Criar o `/etc/caddy/Caddyfile` (troque o domínio):
```
protheus-mcp.seudominio.com.br {
    # libera /health pra você testar
    handle /health {
        reverse_proxy localhost:8080
    }
    # /mcp só a partir do range de saída do Claude/Anthropic
    @claude remote_ip 160.79.104.0/21
    handle @claude {
        reverse_proxy localhost:8080
    }
    handle {
        respond "Forbidden" 403
    }
}
```
Subir o Caddy (ele emite o certificado Let's Encrypt automaticamente):
```
systemctl enable --now caddy
systemctl restart caddy
```
Teste externo (do seu PC):
```
curl https://protheus-mcp.seudominio.com.br/health
```

## 7. Registrar no Claude

- Remova o conector antigo (tdn-protheus) que ficou com estado de OAuth.
- Adicione um conector novo com a URL: `https://protheus-mcp.seudominio.com.br/mcp`
- Sem OAuth/headers (servidor authless; o Caddy já restringe ao range da Anthropic).
- Deve listar as 10 tools. Teste com "liste as condições de pagamento do Protheus".

## Alternativa sem domínio — Cloudflare Tunnel

Se não tiver subdomínio para apontar, instale o `cloudflared` na VPS e crie um tunnel para
`http://localhost:8080`. O Cloudflare fornece a URL HTTPS pública (ou liga ao seu domínio no
Cloudflare) sem abrir portas. Depois registre `https://<url-do-tunnel>/mcp` no Claude.

## Manutenção

- Atualizar após mudança de código: `git pull` (ou reenviar tar) e `docker compose up -d --build`.
- Ver logs: `docker compose logs -f`.
- O token OAuth do Protheus é renovado automaticamente pelo conector.
```

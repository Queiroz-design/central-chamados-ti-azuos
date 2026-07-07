# Central de Chamados TI — Grupo Azuos

Sistema web para abrir e acompanhar chamados de suporte de TI, com painel
administrativo que reúne **chamados**, **inventário automático de computadores**,
**monitoramento de desempenho em tempo real** e **alertas de rede (UniFi)**.

- Site público: `https://central-chamados-ti-azuos.vercel.app/`
- Painel do TI: `.../admin.html` (requer login)

---

## 1. Arquitetura (visão geral)

O sistema tem três camadas:

- **Frontend estático** — páginas HTML + CSS + JavaScript puro (sem framework),
  servidas pela Vercel. Falam com o Supabase pela biblioteca oficial e com as
  funções serverless do próprio projeto.
- **Backend serverless (Vercel) + Supabase** — o banco é o Supabase (PostgreSQL).
  Operações sensíveis passam por funções em `api/`, que usam a *service key*
  (guardada só no servidor).
- **Agentes (PowerShell)** — scripts instalados nas máquinas Windows que enviam
  inventário e telemetria, sempre através da função proxy `api/coletor.js`.

Fluxo resumido:

```
Colaborador  →  index.html  →  api/chamado.js  →  Supabase (tabela chamados)
Máquina TI   →  coletor/monitor .ps1  →  api/coletor.js  →  Supabase (inventário/telemetria)
UniFi        →  api/unifi-webhook.js  →  Supabase (network_alerts)
TI (login)   →  admin.html  →  Supabase (leitura autenticada) + Realtime
```

---

## 2. Estrutura de arquivos

> ⚠️ **Não mover os arquivos marcados com 🔒** — eles são servidos por URL fixa.
> Mover quebraria o site ou a atualização automática dos agentes.

**Frontend (raiz, 🔒):**
- `index.html` — página pública (abrir e consultar chamado)
- `login.html` / `login.js` — login do painel (Supabase Auth)
- `admin.html` / `admin.js` — painel do TI
- `app.js` — lógica da página pública
- `config.js` — URL e chave pública (anon) do Supabase
- `style.css` — estilos (inclui as regras responsivas)
- `logo-azuos.svg` — logo

**Funções serverless (`api/`, 🔒):**
- `api/chamado.js` — abrir/consultar chamado (usa service key)
- `api/coletor.js` — proxy que grava inventário/telemetria (usa service key)
- `api/unifi-webhook.js` — recebe alertas do UniFi

**Agentes Windows (raiz, 🔒 — baixados por URL):**
- `instalar-inventario-azuos.bat` — instalador (rodar 1x por máquina)
- `desinstalar-inventario-azuos.bat` — remove os agentes de uma máquina
- `executar-coletor-azuos.bat` — coleta avulsa (teste manual)
- `agente-inventario-azuos.ps1` / `agente-desempenho-azuos.ps1` — baixam e rodam os coletores
- `coletor-hardware-azuos.ps1` — coleta o inventário de hardware
- `monitor-desempenho-azuos.ps1` — telemetria de CPU/memória/disco em tempo real

**Banco de dados (SQL — rodar no Supabase, não são usados em tempo real):**
- `supabase-hardware-inventory.sql` — tabela de inventário
- `supabase-performance-monitoring.sql` — tabelas de telemetria
- `supabase-network-alerts.sql` — tabela de alertas de rede
- `supabase-rls-seguranca.sql` — fecha a RLS (segurança)
- `supabase-rls-fechar-coletores.sql` — fecha telemetria ao público (após o proxy)
- `supabase-rls-fechar-chamados.sql` — fecha a tabela de chamados ao público

**Documentação (`.txt`):** instruções de ativação (UniFi, coletor de hardware).

---

## 3. Como publicar (deploy)

O site é publicado pela **Vercel**, conectada ao repositório do **GitHub**.

1. Envie os arquivos alterados para o GitHub (botão **Add file → Upload files**,
   arrastando os arquivos; arquivos da pasta `api/` vão em `.../upload/main/api`).
2. A Vercel detecta o commit e republica sozinha (~1 min).
3. Ao testar, use **Ctrl+Shift+R** para ignorar o cache do navegador.

---

## 4. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Para que serve |
|---|---|
| `SUPABASE_URL` | URL base do projeto (ex.: `https://xxxx.supabase.co`, **sem** barra final nem `/rest/v1`) |
| `SUPABASE_SECRET_KEY` | *Service/secret key* do Supabase — **poderosa, só aqui**, nunca em arquivo do site |
| `COLETOR_SECRET` | Segredo que os coletores usam para falar com `api/coletor.js` |
| `UNIFI_WEBHOOK_SECRET` | Segredo do webhook do UniFi |

> Depois de criar/alterar variáveis, faça um **Redeploy** para que passem a valer.

---

## 5. Banco de dados — ordem de execução dos SQLs

Rodar no **Supabase → SQL Editor**, nesta ordem:

1. `supabase-hardware-inventory.sql`
2. `supabase-performance-monitoring.sql`
3. `supabase-network-alerts.sql`
4. `supabase-rls-seguranca.sql` (depois de já existir 1 usuário no Auth)
5. `supabase-rls-fechar-coletores.sql` (depois do proxy publicado e testado)
6. `supabase-rls-fechar-chamados.sql` (depois do `api/chamado.js` publicado e testado)

**Tabelas:** `chamados`, `hardware_inventory`, `hardware_live_status`,
`hardware_performance_history`, `hardware_performance_alerts`, `network_alerts`.

---

## 6. Modelo de segurança

- **Login** do painel via **Supabase Auth** (usuários em Authentication → Users;
  loga-se com `usuario` → `usuario@azuos.local`).
- **RLS fechada:** ler inventário/telemetria/rede e ler/editar chamados exige
  usuário autenticado.
- **Coletores** gravam pelo **proxy** (`api/coletor.js`) com `COLETOR_SECRET`; a
  service key fica só no servidor.
- **Abrir/consultar chamado** passa por `api/chamado.js` (service key), então a
  tabela `chamados` não fica exposta ao público.
- Toda saída de dados no HTML é **escapada** (proteção contra XSS).

---

## 7. Agentes (inventário e desempenho)

- **Instalar numa máquina:** enviar e rodar `instalar-inventario-azuos.bat`
  **uma vez**. Ele faz a 1ª coleta, liga o monitor em tempo real e agenda para
  rodar a cada login + verificação diária ao meio-dia.
- **Remover de uma máquina:** rodar `desinstalar-inventario-azuos.bat`.
- Os agentes **se auto-atualizam**: baixam a versão mais nova dos `.ps1` do site
  a cada execução.

---

## 8. Manutenção e próximos passos

- **Não mover** os arquivos servidos por URL (ver seção 2).
- Ao editar `app.js`/`admin.js`, mantenha o **escape** (`escapeHtml`) em qualquer
  dado exibido.
- `admin.js` é grande e concentra várias telas; se crescer muito, considere
  dividir por seção (chamados / inventário / rede) no futuro.
- Ideias de evolução já mapeadas: botão de excluir chamado/máquina no painel,
  avisos (toasts) no lugar de `alert`, campo de contato do solicitante,
  token por máquina nos coletores (endurecimento extra).

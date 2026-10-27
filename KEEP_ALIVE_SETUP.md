# GestãoPro — Guia Definitivo do Sistema Keep-Alive Anti-Pausa (PHASE 16)

> **Objetivo:** Garantir que o projeto Supabase (`fujgtzxzspqhvvbzmqzv`) **nunca mais entre em pausa**, mesmo que você fique meses ou anos de férias sem abrir o aplicativo ou sem mexer no código.

---

## 🏗️ Como Funciona a Proteção em 7 Camadas

O Supabase Free Tier exige **atividade real no banco PostgreSQL** (não basta apenas listar arquivos do Storage ou receber 404). Por isso, criamos uma estrutura blindada:

1. **Camada 1 (GitHub Actions 3x ao dia):** Executa às **08:17, 14:17 e 20:17 BRT** todos os dias. Faz um `UPSERT` real na tabela `_keep_alive_heartbeat` através da RPC `rpc_keep_alive` e lista o bucket de fotos.
2. **Camada 2 (cron-job.org redundante):** Bate direto na API do Supabase nos mesmos horários. **Não depende do GitHub nem do seu computador.**
3. **Camada 3 (App Desktop / PWA):** Sempre que alguém abre o app, ele também envia um ping RPC leve (com limite de 1 a cada 12h para não gerar tráfego redundante).
4. **Camada 4 (Watchdog com Auto-Restore):** Se por qualquer motivo o Supabase pausar (ex: mudança de regra da plataforma), o robô detecta e aciona automaticamente a restauração via Supabase Management API.
5. **Camada 5 (Anti-60 dias do GitHub):** O GitHub desativa agendamentos em repositórios sem atividade após 60 dias. Nosso workflow re-habilita a si mesmo via API e faz um heartbeat em branch isolado (`keepalive-heartbeat`) a cada 10 dias, mantendo o cron eternamente vivo sem sujar o histórico da branch `main`.
6. **Camada 6 (Alarme Gratuito healthchecks.io):** Se o sistema ficar 36 horas sem conseguir pingar o Supabase, você recebe um e-mail ou notificação no Telegram.
7. **Camada 7 (App Resiliente a Quedas):** Se o Supabase estiver fora ou pausado, os cadastros e fotos continuam funcionando normalmente offline no computador/celular. Elas ficam salvas no IndexedDB local e nunca mais geram o erro de "falha(s) sync".

---

## 📋 Passo a Passo de Ativação (Tempo estimado: 5 minutos)

### Passo 1: Despausar o Supabase e Rodar o SQL de Heartbeat

1. Acesse o painel do Supabase: [https://supabase.com/dashboard/project/fujgtzxzspqhvvbzmqzv](https://supabase.com/dashboard/project/fujgtzxzspqhvvbzmqzv)
2. Se o projeto estiver em pausa, clique no botão verde **"Restore project"** (leva cerca de 1 a 2 minutos para subir).
3. No menu lateral esquerdo, clique em **SQL Editor** (ícone de terminal `>_`) e clique em **New query**.
4. Copie todo o conteúdo do arquivo [`supabase/migrations/20261027000000_keep_alive_heartbeat.sql`](supabase/migrations/20261027000000_keep_alive_heartbeat.sql) e cole no editor.
5. Clique em **Run** (ou aperte `Ctrl + Enter`).
6. Você verá a mensagem `Success. No rows returned`.

*(Se você preferir que o robô faça isso sozinho no futuro, siga o Passo 2 abaixo).*

---

### Passo 2: Ativar o Auto-Restore e Auto-Cura no GitHub (Recomendado)

Com este passo, se o Supabase pausar, o GitHub Actions restaura o projeto sozinho pela API, sem você precisar entrar no painel!

1. No Supabase, clique no seu avatar (canto inferior esquerdo ou superior direito) e vá em **Account Settings** -> **Access Tokens**:
   [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Clique em **Generate new token**.
3. Dê o nome `GestaoPro-Watchdog` e copie o token gerado (começa com `sbp_...`).
4. Abra o terminal no seu computador e execute o comando abaixo (cole o seu token quando solicitado):
   ```bash
   gh secret set SUPABASE_ACCESS_TOKEN
   ```
5. Pronto! O segredo é salvo criptografado no seu repositório GitHub de forma 100% segura.

---

### Passo 3: Configurar a Redundância Externa no cron-job.org (2 minutos)

O **cron-job.org** é um serviço gratuito que vai bater direto no seu Supabase 3 vezes ao dia, independentemente do GitHub.

1. Crie uma conta gratuita em [https://cron-job.org](https://cron-job.org).
2. No painel, clique em **CREATE CRONJOB**.
3. Preencha os campos exatamente como abaixo:
   - **Title:** `GestaoPro Supabase Keep-Alive`
   - **URL:** `https://fujgtzxzspqhvvbzmqzv.supabase.co/rest/v1/rpc/rpc_keep_alive`
   - **Execution Schedule:**
     - Escolha: **User-defined** (ou cron expression)
     - Dias: Todos os dias
     - Horários: `08:00`, `14:00` e `20:00`
     - Timezone: `America/Sao_Paulo` (GMT-3)
   - **Request Method:** `POST`
   - **Headers:** Clique em *Add header* e insira:
     - Header 1: `apikey` = `sb_publishable_2PiIY1v6HWea8sqwCg2KVQ_aAKflAZh`
     - Header 2: `Content-Type` = `application/json`
   - **Request Body:**
     ```json
     {"ping_source": "cron-job.org"}
     ```
4. Clique em **CREATE**.
5. Clique no botão de teste (**Test run**) para validar: o status deve retornar `200 OK`!

---

### Passo 4: Alarme no healthchecks.io (Opcional)

Se quiser ser avisado caso todos os pings falhem por mais de 36 horas:

1. Crie uma conta gratuita em [https://healthchecks.io](https://healthchecks.io).
2. Crie um novo check com:
   - Period: `1 day`
   - Grace Time: `12 hours`
3. Copie a Ping URL fornecida (exemplo: `https://hc-ping.com/seu-uuid`).
4. No terminal, configure o secret no GitHub:
   ```bash
   gh secret set HEALTHCHECK_URL --body "https://hc-ping.com/seu-uuid"
   ```

---

## 🔍 Como Testar Localmente a Qualquer Momento

Você pode rodar um teste completo de gravação no banco a qualquer momento pelo terminal:

```bash
bun run keep-alive
```

Ele exibirá no console o status de cada serviço:
- Gravação real no PostgreSQL via RPC (com contador de pings e data/hora em horário de Brasília);
- Leitura no bucket de fotos do Supabase Storage.

Para consultar o contador diretamente no SQL Editor do Supabase:
```sql
SELECT * FROM _keep_alive_heartbeat;
```
Você verá o número total de pings acumulados e a origem da última gravação (`github-actions`, `cron-job.org` ou `app`).

# Matriz de Avaliação GO / NO-GO para Staging — GestãoPro (Fase 15.0)

**Documento:** `docs/FASE_15_STAGING_GO_NO_GO.md`  
**Versão Alvo:** `1.13.0-rc.1`  
**Status do Gate Local:** PRONTO PARA REVISÃO HUMANA (PLANEJAMENTO LOCAL CONCLUÍDO)  
**Status de Infraestrutura Remota:** AGUARDANDO PROVISIONAMENTO E AUTORIZAÇÃO  
**Data da Avaliação:** 13/10/2026  

---

## 1. Objetivo e Princípio do Gate

Este documento estabelece o **Portão de Decisão (Gate) Formal** para autorizar ou vetar o avanço do projeto **Gerenciador de Produtos — GestãoPro** para a etapa de homologação remota (*staging*).

> **REGRA FUNDAMENTAL:**  
> A aprovação **GO** nesta fase significa **exclusivamente** que:
> 1. O código, testes locais e o plano operacional de staging foram 100% auditados, documentados e aprovados localmente.
> 2. O projeto está tecnicamente estruturado para que humanos avaliem e autorizem o provisionamento de staging.
> 
> A aprovação **GO** local **NÃO autoriza** e **NÃO declara** que a infraestrutura em nuvem já está conectada, homologada ou ativa. Qualquer ação em nuvem permanece bloqueada até aprovação operacional assinada.

---

## 2. Condições Mandatórias de VETO (Critérios Automáticos de NO-GO)

Se **QUALQUER** uma das condições abaixo for verdadeira, o status da homologação é obrigatoriamente **NO-GO**:

| # | Condição de Veto | Status da Condição | Verificação / Evidência |
| :---: | :--- | :---: | :--- |
| **V-01** | Não há prova de que os recursos pertencem exclusivamente a um projeto isolado de staging | **NÃO ACIONADO** (Verificado localmente) | `firebaseConfigValidator.js` bloqueia qualquer ID de produção. Project ID canônico: `gerenciador-produtos-staging`. *(A existência real no Google Cloud permanece não verificada remotamente).* |
| **V-02** | A configuração de staging depende de segredos cuja origem ou validade não foi confirmada | **NÃO ACIONADO** (Verificado localmente) | Nenhuma credencial de produção é exigida; staging usará chaves públicas geradas no projeto de testes. *(Validação das chaves reais aguarda criação no painel).* |
| **V-03** | As regras de segurança remotas não foram auditadas ou testadas localmente | **NÃO ACIONADO** (Verificado localmente) | `database.rules.json` e `storage.rules` testadas com 212 testes no RTDB Emulator e 21 testes no Storage Emulator (100% pass). |
| **V-04** | O isolamento multi-tenant não possui testes verificáveis de bloqueio | **NÃO ACIONADO** (Verificado localmente) | Testes adversariais provaram rejeição de leitura e escrita cross-tenant com `assertFails` (Fase 14.26, cenário 4.2). |
| **V-05** | Existem divergências não resolvidas entre a documentação e os contratos de código | **NÃO ACIONADO** (Verificado localmente) | Claims canônicas padronizadas em `tenantId`, `appRole` e `role: 'authenticated'` em todos os documentos e serviços. |
| **V-06** | O procedimento de teste pode alterar dados, contas ou bancos de produção | **NÃO ACIONADO** (Verificado localmente) | O ambiente de staging é 100% desacoplado. Nenhuma conexão com produção é permitida pelo código. |
| **V-07** | Os critérios de interrupção (STOP) e recuperação não estão definidos | **NÃO ACIONADO** (Verificado localmente) | Matriz de riscos e condições de parada estritas documentadas em `FASE_15_STAGING_EXECUTION_PLAN.md`. |

---

## 3. Matriz de Avaliação Multidimensional e Níveis de Decisão

A governança do projeto estabelece **três níveis de decisão independentes**:
- **Nível 1 — GO para o Plano:** Documentação operacional, matriz de risco e casos de teste estão prontos e auditados para revisão humana.
- **Nível 2 — GO para Operação Local:** Suíte de 1.101 testes automatizados, build e emuladores 100% aprovados sem flakiness.
- **Nível 3 — Autorização para Staging Remoto:** Decisão humana expressa exigindo validação manual de contas, billing e console em nuvem. *(Aprovação nos Níveis 1 e 2 NÃO concede autorização para o Nível 3).*

| Dimensão de Avaliação | Requisito Técnico Auditado | Evidência Comprovada | Nível 1: Plano | Nível 2: Local | Nível 3: Nuvem |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **1. Fidelidade da Suíte Local** | 100% de testes automatizados passando sem flakiness | 1.101 testes aprovados (0 falhas) em 43 arquivos (`bun test --parallel=1`) | **GO** | **GO** | N/A |
| **2. Build de Produção** | Compilação estrita sem erros de bundle | Vite build bem-sucedido em ~1.1s; 98 módulos; dist gerada (`bun run build`) | **GO** | **GO** | N/A |
| **3. Integridade do Ledger Append-Only** | Imutabilidade em `/inventory` contra updates, removes e duplicatas | Rejeição por regras atestada em emulador; perda de ACK recuperada por leitura sem duplicação | **GO** | **GO** | N/A |
| **4. Máquina de Estados da Outbox** | Tolerância a falhas, leases atômicos e idempotência | Prevenção de concorrência com leases; detecção de ACKs suplantados (`staleAttemptAcks`) | **GO** | **GO** | N/A |
| **5. Harmonização de Claims** | Suporte conjunto a Firebase Auth, RTDB e Supabase Storage | `appRole` de negócio + `role: 'authenticated'` técnico com fail-closed para `viewer` | **GO** | **GO** | N/A |
| **6. Hardening de Destino do Script** | Validação exata e estrita (Fase 15.2); proibição de match parcial | `scripts/provision-staging.js` valida exato; UID lookup via `accounts:lookup`; zero efeito colateral no import | **GO** | **GO** | N/A |
| **7. Homologação no Auth Emulator** | Integração real com Firebase Auth Emulator (Fase 15.3) | Endpoints admin `projects/${projectId}/accounts:lookup` e `accounts:update`; claims persistidas e validadas em JWT real emitido | **GO** | **GO** | N/A |
| **8. Isolamento de Endpoints Admin (Fase 15.4)** | Cabeçalho `Bearer owner` e endpoints admin estritamente restritos a loopback validado | Validação estrutural de `authHost` (apenas loopback `127.0.0.1`, `localhost`, `::1` na porta 9099); `redirect: 'error'`; fail-closed antes do fetch; sanitização de erros | **GO** | **GO** | N/A |
| **9. Provedor de Imagens (Fase 15.5)** | Supabase Storage com bucket privado, RLS por tenant e bloqueio de `service_role` | `SupabaseStorageProvider` com resolução de env, bloqueio fail-closed de chaves de serviço, injeção de Firebase JWT e RLS multi-tenant | **GO** | **GO** | N/A |
| **10. Plano Operacional de Execução** | Roteiro de 10 smoke tests, matriz de risco e plano de contingência | Documento detalhado aprovado em `FASE_15_STAGING_EXECUTION_PLAN.md` | **GO** | **GO** | N/A |
| **11. Infraestrutura Real de Staging** | Provisionamento formal no Google Cloud e Supabase Cloud | Identificadores documentados ainda NÃO tiveram existência remota confirmada; aguarda autorização humana | **GO** | N/A | **NÃO VERIFICADO** |
| **12. Testes de Campo com Rede WAN** | Latência real, queda de pacotes e reconexão móvel | Depende da execução em nuvem autorizada na Fase 15 | **GO** | N/A | **NÃO VERIFICADO** |

---

## 4. Checklist Pré-Execução para Revisão Humana

Antes de iniciar qualquer intervenção na nuvem de staging, o operador humano deve preencher e validar os seguintes itens:

- [ ] **1. Verificação de Billing / Custos:** Confirmar que o projeto Supabase está no plano Free ($0/mês) e o Firebase está no plano Spark ($0/mês) ou com limite de faturamento estrito.
- [ ] **2. Criação Manual do Projeto Firebase:** Confirmar no Firebase Console a existência do projeto com Project ID `gerenciador-produtos-staging`.
- [ ] **3. Criação Manual do Projeto Supabase:** Confirmar no Supabase Dashboard o projeto `gestaopro-staging-storage` na região São Paulo (`sa-east-1`).
- [ ] **4. Configuração de Third-Party Auth:** Inserir o Issuer URL e JWKS do Firebase Staging no painel de Authentication do Supabase.
- [ ] **5. Execução do Script SQL RLS:** Executar a migração `20261010000000_create_product_images_storage.sql` no SQL Editor do Supabase.
- [ ] **6. Provisionamento de Usuários de Teste:** Criar os 4 usuários sintéticos de homologação via script administrativo com custom claims completas.
- [ ] **7. Preparação das Variáveis de Ambiente:** Criar arquivo `.env.staging` local com as chaves públicas correspondentes, sem versionar no Git.
- [ ] **8. Validação de Bloqueio de Produção:** Testar a inicialização do app para certificar que `firebaseConfigValidator` não aponta alertas.

---

## 5. Deliberação e Decisão Final do Portão

### Parecer Nível 1: **GO PARA O PLANO OPERACIONAL**
> A documentação técnica, o plano de execução de staging e a bateria de smoke tests atendem com completude a todos os requisitos de planejamento da Fase 15.0/15.1.

### Parecer Nível 2: **GO PARA A BASE LOCAL DE CÓDIGO**
> O código-fonte, a arquitetura de persistência, as regras locais e os testes automatizados estão 100% aprovados e validados localmente (Fases 14.0 a 14.27).

### Parecer Nível 3: **PAUSADO / AGUARDANDO AUTORIZAÇÃO OPERACIONAL EXPRESSA**
> Nenhuma ação remota de provisionamento, migração ou deploy foi realizada. A autorização para interação com serviços reais em nuvem depende da conferência prévia do checklist acima e da autorização formal expressa do proprietário do projeto.

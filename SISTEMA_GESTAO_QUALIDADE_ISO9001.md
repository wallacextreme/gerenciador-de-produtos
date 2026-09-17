# Sistema de Gestão da Qualidade — Alinhamento à ISO 9001:2026 — GestãoPro

Data da auditoria de processos: **17/09/2026**  
Projeto auditado: **GestãoPro** (Versão comprovada: `1.13.0`)  
Norma de Referência: **ISO 9001:2026** (*Quality management systems — Requirements* — 6ª Edição, publicada em 16/09/2026)  
Objetivo: Mapeamento de processos técnicos do repositório, identificação de lacunas de governança e fornecimento de modelos padronizados para estruturação formal do Sistema de Gestão da Qualidade (SGQ) da organização.

---

## Sumário

- [1. Introdução, Escopo e Princípios da ISO 9001:2026](#1-introdução-escopo-e-princípios-da-iso-90012026)
- [2. Cláusula 4 — Contexto da Organização](#2-cláusula-4--contexto-da-organização)
  - [2.1. Fatos Técnicos e Partes Interessadas de Produto (🔧 Evidenciado)](#21-fatos-técnicos-e-partes-interessadas-de-produto--evidenciado)
  - [2.2. Considerações sobre Mudanças Climáticas (Edição 2026)](#22-considerações-sobre-mudanças-climáticas-edição-2026)
  - [2.3. Matriz de Contexto Organizacional (📝 A Definir pela Organização)](#23-matriz-de-contexto-organizacional--a-definir-pela-organização)
- [3. Cláusula 5 — Liderança, Cultura da Qualidade e Ética](#3-cláusula-5--liderança-cultura-da-qualidade-e-ética)
  - [3.1. Governança Técnica (🔧 Evidenciado)](#31-governança-técnica--evidenciado)
  - [3.2. Modelo de Política da Qualidade com Ênfase em Ética (📝 A Definir pela Organização)](#32-modelo-de-política-da-qualidade-com-ênfase-em-ética--a-definir-pela-organização)
- [4. Cláusula 6 — Planejamento — Riscos e Oportunidades](#4-cláusula-6--planejamento--riscos-e-oportunidades)
  - [4.1. Registro de Riscos Técnicos (🔧 Evidenciado no Repositório)](#41-registro-de-riscos-técnicos--evidenciado-no-repositório)
  - [4.2. Registro de Oportunidades Tecnológicas (🔧 Evidenciado no Repositório)](#42-registro-de-oportunidades-tecnológicas--evidenciado-no-repositório)
  - [4.3. Objetivos Formais da Qualidade da Organização (📝 A Definir pela Organização)](#43-objetivos-formais-da-qualidade-da-organização--a-definir-pela-organização)
- [5. Cláusula 7 — Apoio (Suporte, Competências e Informação Documentada)](#5-cláusula-7--apoio-suporte-competências-e-informação-documentada)
  - [5.1. Procedimento de Controle de Informação Documentada (🔧 Evidenciado)](#51-procedimento-de-controle-de-informação-documentada--evidenciado)
  - [5.2. Matriz de Competências e Capacitação Técnica (📝 A Definir pela Organização)](#52-matriz-de-competências-e-capacitação-técnica--a-definir-pela-organização)
- [6. Cláusula 8 — Operação (Desenvolvimento, Testes e Entrega)](#6-cláusula-8--operação-desenvolvimento-testes-e-entrega)
  - [6.1. Procedimento Operacional: Controle de Versão (POP-DEV-01)](#61-procedimento-operacional-controle-de-versão-pop-dev-01)
  - [6.2. Procedimento Operacional: Ciclo de Vida de Design e Desenvolvimento (POP-DEV-02)](#62-procedimento-operacional-ciclo-de-vida-de-design-e-desenvolvimento-pop-dev-02)
  - [6.3. Procedimento Operacional: Verificação e Testes de Software (POP-QA-01)](#63-procedimento-operacional-verificação-e-testes-de-software-pop-qa-01)
  - [6.4. Procedimento Operacional: Build, Empacotamento e Release (POP-OPS-01)](#64-procedimento-operacional-build-empacotamento-e-release-pop-ops-01)
  - [6.5. Procedimento Operacional: Tratamento de Não Conformidades / Bugs (POP-QA-02)](#65-procedimento-operacional-tratamento-de-não-conformidades--bugs-pop-qa-02)
- [7. Cláusula 9 — Avaliação de Desempenho](#7-cláusula-9--avaliação-de-desempenho)
  - [7.1. Métricas Técnicas Objetivas do Repositório (🔧 Evidenciado)](#71-métricas-técnicas-objetivas-do-repositório--evidenciado)
  - [7.2. Mecanismos Organizacionais de Avaliação (📝 A Definir pela Organização)](#72-mecanismos-organizacionais-de-avaliação--a-definir-pela-organização)
- [8. Cláusula 10 — Melhoria Contínua](#8-cláusula-10--melhoria-contínua)
  - [8.1. Histórico de Melhorias Incrementais (🔧 Evidenciado)](#81-histórico-de-melhorias-incrementais--evidenciado)
  - [8.2. Modelo Padronizado de Relatório de Não Conformidade e Ação Corretiva (RNC / CAPA)](#82-modelo-padronizado-de-relatório-de-não-conformidade-e-ação-corretiva-rnc--capa)
- [9. Matriz de Aderência e Gap Analysis (ISO 9001:2026)](#9-matriz-de-aderência-e-gap-analysis-iso-90012026)
- [10. Aviso Normativo sobre Certificação de Sistemas de Gestão](#10-aviso-normativo-sobre-certificação-de-sistemas-de-gestão)

---

## 1. Introdução, Escopo e Princípios da ISO 9001:2026

### 1.1. Propósito do Documento
A norma internacional **ISO 9001:2026** estabelece os requisitos normativos para Sistemas de Gestão da Qualidade (SGQ). Seu escopo abrange os processos organizacionais de liderança, planejamento, apoio, operação e melhoria com foco na entrega consistente de produtos que atendam aos requisitos dos clientes e requisitos legais/regulamentares aplicáveis.

Este documento tem como objetivo estruturar os processos de engenharia do software **GestãoPro** sob a ótica dos requisitos da edição 2026 da norma. Ele atua como instrumento de governança técnica que prepara e padroniza a documentação da equipe de tecnologia, servindo como alicerce para uma futura auditoria de certificação institucional.

### 1.2. O Princípio de Separação Metodológica
A ISO 9001 é uma norma sobre a **organização que desenvolve e sustenta o software**, e não apenas sobre o código-fonte executável. Um repositório Git, por si só, não comprova compromisso da diretoria, política de recursos humanos, gestão de clima ético ou pesquisas formais de satisfação do cliente.

Por essa razão, este documento aplica uma separação estrita em todas as seções:
- 🔧 **EVIDENCIADO NO REPOSITÓRIO**: Práticas de engenharia, procedimentos de versionamento, scripts de automação, suítes de teste e controles de dados comprovados diretamente por arquivos no repositório.
- 📝 **A DEFINIR PELA ORGANIZAÇÃO**: Políticas institucionais, decisões estratégicas de liderança, rotinas de auditoria interna e gestão de competências que dependem exclusivamente de definição formal pela diretoria da organização. Para estes tópicos, são disponibilizados modelos e questionários em branco para preenchimento.

---

## 2. Cláusula 4 — Contexto da Organização

### 2.1. Fatos Técnicos e Partes Interessadas de Produto (🔧 Evidenciado)

#### Identificação do Produto e Escopo Técnico
- **Produto Auditado**: GestãoPro (`gerenciador-de-produtos` v1.13.0).
- **Proposta de Valor Operacional**: Sistema de automação comercial e controle de estoques com operação autônoma sem internet (Offline-First) e sincronização assíncrona opcional com a nuvem (Google Firebase Firestore).
- **Ambientes Homologados no Código**:
  - Desktop Windows (Windows 10/11 x64 através de runtime Tauri v2 / WebView2);
  - Progressive Web App (PWA) instalável em navegadores modernos (Chromium / Edge / Chrome).

#### Partes Interessadas Identificadas no Repositório:
1. **Operadores de Caixa / Vendedores**: Demandam interface rápida de frente de caixa (PDV), validação imediata de estoque e emissão de recibo de venda.
2. **Gerentes de Estoque / Compradores**: Demandam controle de abastecimento, cotações comparativas entre fornecedores, curva ABC e auditoria de saldos físicos.
3. **Administradores / Gestores de Negócio**: Demandam relatórios gerenciais, demonstrativo DRE, segurança de backup e integridade SHA-256 dos dados contábeis.
4. **Equipe de Sustentação / TI**: Demanda código modularizado em camadas (`domain/`, `services/`, `repositories/`), testes automatizados de regressão e scripts limpos de build.

---

### 2.2. Considerações sobre Mudanças Climáticas (Edição 2026)

> [!NOTE]
> **Requisito Atualizado (ISO 9001:2026 / Amd 1:2024):**  
> A edição vigente da ISO 9001 exige explicitamente que as organizações avaliem se as **mudanças climáticas** são uma questão relevante no contexto do seu Sistema de Gestão da Qualidade e nas necessidades de suas partes interessadas.

#### 🔧 Evidências Técnicas Relevantes:
- **Resiliência a Desastres e Instabilidade de Rede**: O paradigma Offline-First do GestãoPro mitiga o impacto operacional de eventos climáticos extremos (como temporais, tempestades elétricas ou vendavais que interrompam o fornecimento de internet cabeada ou redes de telefonia celular). As operações comerciais de caixa não são paralisadas por oscilações na infraestrutura externa de telecomunicações.
- **Eficiência Energética de Software**: O software não mantém conexões persistentes via WebSockets consumindo bateria desnecessária e o runtime Rust (Tauri) consome fração reduzida de CPU/RAM em comparação a soluções pesadas em Chromium embutido (ex.: Electron), contribuindo para a redução da pegada de carbono computacional no hardware do cliente.

#### 📝 A Definir pela Organização:
- [ ] A organização deve avaliar se suas operações de escritório, servidores de CI/CD ou cadeia de suprimentos possuem riscos decorrentes de mudanças climáticas que afetem a entrega do software aos clientes.

---

### 2.3. Matriz de Contexto Organizacional (📝 A Definir pela Organização)

Este modelo deve ser preenchido pela diretoria para complementar o SGQ:

| Fator de Contexto | Categoria | Descrição da Situação Real | Impacto no SGQ | Estratégia Adotada |
| :--- | :---: | :--- | :--- | :--- |
| **Mercado Alvo** | Externo | *Preencher: Segmentos de comércio atendidos (ex.: vestuário, autopeças, mercadorias)* | Define requisitos de usabilidade e volume | Foco em simplicidade e Offline-First |
| **Legislação & Fiscal** | Externo | *Preencher: Legislação aplicável (LGPD, normas fiscais estaduais SAT/NFC-e se aplicável)* | Define compliance de dados e recibos | Preservação de dados locais e comprovantes |
| **Infraestrutura do Cliente**| Externo | *Preencher: Perfil de computadores dos clientes (ex.: máquinas Windows básicas)* | Exige leveza de memória e estabilidade | Uso de WebView2 nativo e banco leve idb |
| **Fatores Climáticos** | Externo | *Preencher: Risco de indisponibilidade de links por eventos meteorológicos na região* | Exige garantia de operação sem sinal | Arquitetura Offline-First |
| **Capacidade da Equipe** | Interno | *Preencher: Tamanho do time de desenvolvimento e sustentação do software* | Determina a capacidade de entrega e suporte | Modularidade e testes automatizados |

---

## 3. Cláusula 5 — Liderança, Cultura da Qualidade e Ética

### 3.1. Governança Técnica (🔧 Evidenciado)
- **Autor e Liderança de Engenharia Identificada**: Wallace Soares (`wallacextreme@hotmail.com`), registrado como autor no repositório (`README.md` e histórico de commits do Git).
- **Rastreabilidade de Decisões de Projeto**: Documentação modular dividida em 13 fases no `task.md` e `docs/CHANGELOG.md`, demonstrando evolução planejada e consistente de arquitetura.
- **Princípio da Transparência em Testes**: A suíte de testes registra publicamente as falhas de asserção de versão na Fase 12 sem manipulação artificial para mascarar defeitos (`EV-013`).

---

### 3.2. Modelo de Política da Qualidade com Ênfase em Ética (📝 A Definir pela Organização)

> [!IMPORTANT]
> **Requisito Novo da ISO 9001:2026:**  
> A revisão de 2026 reforça a responsabilidade da liderança em promover ativamente uma **cultura da qualidade** e um **comportamento ético** em todos os níveis da organização. Não basta declarar intenções técnicas; a liderança deve estabelecer princípios morais de proteção de dados, integridade das transações e conduta profissional transparente.

A direção da organização deve formalizar e divulgar o seguinte modelo:

```text
════════════════════════════════════════════════════════════════════════════════
POLÍTICA DA QUALIDADE — ORGANIZAÇÃO RESPONSÁVEL PELO GESTÃOPRO
(Modelo para formalização pela Liderança — ISO 9001:2026)
════════════════════════════════════════════════════════════════════════════════

A Direção da [Nome da Empresa/Organização], atuante no desenvolvimento e 
sustentação do sistema GestãoPro, assume o compromisso público de:

1. COMPROMISSO COM A CONFIABILIDADE COMERCIAL:
   Fornecer software de gestão robusto, intuitivo e com funcionamento garantido 
   mesmo sem conexão à internet, assegurando que o cliente mantenha o controle 
   ininterrupto de seus estoques e vendas.

2. CULTURA DA QUALIDADE E EXCELÊNCIA TÉCNICA:
   Incentivar o rigor na engenharia de software através da aplicação sistemática 
   de boas práticas de arquitetura (Domain-Driven, Ports & Adapters), revisão 
   contínua e execução de testes automatizados como requisito de entrega.

3. CONDUTA ÉTICA E PRIVACIDADE DE DADOS:
   Pautar todas as atividades de desenvolvimento sob padrões éticos inegociáveis:
   - Respeito integral à privacidade do comerciante e seus clientes (LGPD);
   - Os dados pertencem exclusivamente ao usuário e são mantidos sob seu controle;
   - Proibição estrita de práticas obscuras, envio de dados sem consentimento 
     ou introdução deliberada de bloqueios comerciais abusivos;
   - Transparência total quanto às limitações de segurança e capacidade do sistema.

4. MELHORIA CONTÍNUA E SUSTENTABILIDADE:
   Aprimorar continuamente a eficácia do nosso Sistema de Gestão da Qualidade, 
   ouvindo as partes interessadas, tratando não conformidades com agilidade e 
   considerando os impactos contextuais, tecnológicos e ambientais em nossas decisões.

Aprovado pela Liderança em: ___/___/______
Assinatura da Direção: ___________________________________________
```

#### Questionário Orientador para a Liderança (Autoavaliação 2026):
1. *Como a diretoria assegura que os desenvolvedores tenham tempo e autonomia para priorizar a qualidade do código em relação a prazos comerciais imediatos?*  
   `[Resposta da Organização]: _________________________________________________________________`
2. *Quais canais internos existem para que qualquer membro da equipe reporte falhas éticas ou bugs críticos sem sofrer represálias?*  
   `[Resposta da Organização]: _________________________________________________________________`
3. *Como a liderança demonstra aos clientes o compromisso com a proteção ética dos dados mercantis armazenados localmente?*  
   `[Resposta da Organização]: _________________________________________________________________`

---

## 4. Cláusula 6 — Planejamento — Riscos e Oportunidades

> [!IMPORTANT]
> **Separação Obrigatória na ISO 9001:2026:**  
> A norma exige a separação nítida e analítica entre a **Gestão de Riscos** (efeitos potenciais negativos/incertezas) e a **Gestão de Oportunidades** (circunstâncias favoráveis para aprimoramento e inovação).

---

### 4.1. Registro de Riscos Técnicos (🔧 Evidenciado no Repositório)

| ID | Risco Técnico Identificado | Causa Raiz Observável | Consequência Potencial | Ação de Mitigação Proposta | Responsável | Nível Evidência |
| :-: | :--- | :--- | :--- | :--- | :---: | :---: |
| **R-01** | **Vulnerabilidade de Script no Desktop** | `security.csp: null` no `src-tauri/tauri.conf.json` | Potencial execução de scripts maliciosos injetados na janela nativa | Definir Content Security Policy estrita no Tauri restringindo fontes | Engenharia Tauri | E1 |
| **R-02** | **Regressão não detectada em alterações** | Ausência de pipeline de CI/CD automatizado no repositório (`EV-017`) | Códigos com testes falhos ou sintaxe incorreta podem ser comitados sem barreira | Configurar GitHub Actions rodando `bun test` e `bun run build` a cada push | Sustentação / DevOps | NE |
| **R-03** | **Falhas de testes por versão fixa** | Testes da Fase 12 com assert fixo em `"1.12.0"` (`tests/platform_phase12.test.js`) | Testes acusam erro mesmo quando o build está íntegro na versão 1.13.0 | Parametrizar testes para ler dinamicamente a versão do `package.json` | QA / Dev | E2 |
| **R-04** | **Perda de dados em ambiente PWA** | Limpeza acidental de cookies/cache pelo usuário no navegador cliente | Destruição do banco IndexedDB sem possibilidade de restauração | Alertas visuais na UI e lembrete periódico para exportar arquivo `.json` | UX / Frontend | E1 |
| **R-05** | **Inconsistência de código por falta de linter** | Ausência de ESLint / Biome configurado no `package.json` (`EV-018`) | Desvio gradual de padrões de código entre arquivos do projeto | Adicionar Biome/ESLint aos scripts com verificação pré-commit | Engenharia | NE |

---

### 4.2. Registro de Oportunidades Tecnológicas (🔧 Evidenciado no Repositório)

| ID | Oportunidade Identificada | Benefício Estratégico Esperado | Ação de Aproveitamento | Responsável | Métrica de Sucesso | Nível Evidência |
| :-: | :--- | :--- | :--- | :---: | :--- | :---: |
| **O-01** | **Distribuição corporativa via pacote MSI** | Adoção do sistema por redes de lojas com instalação em massa via Active Directory / GPO | Utilizar o pacote `GestãoPro_1.13.0_x64_en-US.msi` existente para implantações corporativas | Comercial / TI | Instalação silenciosa em múltiplos pontos | E3 |
| **O-02** | **Expansão multi-dispositivo via Firebase REST** | Sincronização de catálogo e estoques entre múltiplos caixas de uma mesma loja | Divulgar a 5ª aba de configurações (Nuvem) com tutorial para ativação de auto-sync | Produto | Lojas operando 2 ou mais caixas sincronizados | E1 |
| **O-03** | **Velocidade de testes com Bun** | Ciclo de feedback ultrarrápido durante o desenvolvimento de novas funcionalidades | Manter o runner nativo Bun test em scripts de teste diários | Engenharia | Suíte executando em menos de 1 segundo | E2 |
| **O-04** | **Auditoria de estoque autônoma** | Redução substancial de chamados de suporte sobre divergência de saldos físicos | Ensinar o usuário a utilizar a ferramenta "Auditar Saldo" no manual | Suporte / Treinamento | Redução de dúvidas sobre saldos divergentes | E1 |

---

### 4.3. Objetivos Formais da Qualidade da Organização (📝 A Definir pela Organização)

Modelo a ser preenchido anualmente pela organização para cumprimento da Cláusula 6.2:

| Objetivo da Qualidade | Indicador de Medição | Meta Numérica | Prazo | Plano de Ação para Atingir | Responsável |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Estabilidade de Releases** | Taxa de aprovação na suíte de testes automatizados antes do deploy | 100% aprovados | Contínuo | Corrigir asserções de versão e criar barreira de CI | QA |
| **Satisfação dos Usuários** | Índice CSAT pós-atendimento de suporte ao comerciante | >= 90% aprovação | Trimestral | Treinar operadores e enriquecer a base de FAQ do manual | Suporte |
| **Prevenção de Falhas no PDV** | Incidentes reportados de corrupção de banco IndexedDB | Zero ocorrências | Anual | Preservar rotinas atômicas com rollback em transações | Arquitetura |

---

## 5. Cláusula 7 — Apoio (Suporte, Competências e Informação Documentada)

### 5.1. Procedimento de Controle de Informação Documentada (🔧 Evidenciado)

O repositório adota convenções rigorosas de estruturação documental comprovadas no código:

#### 1. Padronização de Nomenclatura e Versionamento (SemVer)
- O sistema adota estritamente o modelo de **Versionamento Semântico (SemVer)** no padrão `MAJOR.MINOR.PATCH` (`1.13.0` comprovado em `package.json`, `Cargo.toml` e `tauri.conf.json`).
- Cada avanço de funcionalidade é correlacionado a uma fase do roadmap com registro no changelog (`docs/CHANGELOG.md`).

#### 2. Rastreabilidade de Mudanças no Código
- O histórico de alterações técnicas é preservado através do sistema de controle de versão distribuído **Git**.
- As versões de banco de dados do IndexedDB são geridas por arquivo de migração declarativo e incremental (`src/js/db/migrations.js`), garantindo que alterações no modelo de dados não excluam bases existentes.

#### 3. Preservação de Documentação de Arquitetura
- As diretrizes de design, armazenamento de imagens, modelo de dados e regras de negócio possuem especificações dedicadas documentadas no diretório `docs/` (`ARCHITECTURE.md`, `BUSINESS_RULES.md`, `DATA_MODEL.md`, `IMAGE_STORAGE.md`, `TEST_PLAN.md`).

---

### 5.2. Matriz de Competências e Capacitação Técnica (📝 A Definir pela Organização)

A organização deve mapear e registrar formalmente as competências da equipe de tecnologia:

| Função / Papel | Competências Mínimas Requeridas | Evidência de Competência | Plano de Treinamento / Lacuna Identificada |
| :--- | :--- | :--- | :--- |
| **Desenvolvedor Frontend** | JavaScript moderno (ES Modules), Tailwind CSS v4, manipulação de Canvas API e IndexedDB via `idb` | Código em `src/js/` | *A definir pela equipe: cursos de acessibilidade web e PWA avançado* |
| **Desenvolvedor Desktop (Tauri/Rust)** | Linguagem Rust 2021, empacotamento Windows (NSIS, WiX) e permissões de IPC do Tauri v2 | Crate em `src-tauri/` | *A definir pela equipe: segurança e assinatura digital Authenticode de binários Windows* |
| **Analista de Qualidade / QA** | Elaboração de planos de teste, execução com Bun test, validação de regras contábeis/financeiras | Testes em `tests/` | *A definir pela equipe: capacitação em testes E2E com Playwright* |
| **Auditor Interno da Qualidade** | Conhecimento formal da norma ISO 9001:2026 e práticas de auditoria ISO 19011 | Certificado de curso | *Requer definição da liderança: designar auditor interno independente* |

---

## 6. Cláusula 8 — Operação (Desenvolvimento, Testes e Entrega)

Com base nas evidências comprovadas no repositório, os seguintes **Procedimentos Operacionais Padrão (POPs)** são formalizados:

---

### 6.1. Procedimento Operacional: Controle de Versão (POP-DEV-01)
- **Objetivo**: Controlar o ciclo de vida do código-fonte, branches e versionamento semântico de entregas.
- **Entradas**: Demandas de negócio, correções de defeitos ou novas funcionalidades do roadmap.
- **Etapas Operacionais Observadas no Repositório**:
  1. Utilização do repositório Git com branch principal `main`.
  2. Implementação das mudanças respeitando a modularidade das camadas arquiteturais.
  3. Atualização síncrona do número de versão nos três manifestos centrais:
     - `package.json` (`"version": "X.Y.Z"`);
     - `src-tauri/Cargo.toml` (`version = "X.Y.Z"`);
     - `src-tauri/tauri.conf.json` (`"version": "X.Y.Z"`).
  4. Registro detalhado das adições, melhorias e correções no arquivo `docs/CHANGELOG.md` com data e escopo.
  5. Commit estruturado com mensagens prefixadas por tipo (`feat:`, `fix:`, `refactor:`, `docs:`).
- **Saídas**: Repositório Git sincronizado com versão e changelog atualizados.
- **Responsável**: Engenheiro de Software / Mantenedor do Repositório.
- **Registro / Evidência**: Histórico de commits e `docs/CHANGELOG.md`.
- **Lacuna Operacional**: Inexistência de política formal de Pull Requests (PRs) com obrigatoriedade de aprovação por pares (*peer review*) documentada em arquivo `.github/PULL_REQUEST_TEMPLATE.md`.

---

### 6.2. Procedimento Operacional: Ciclo de Vida de Design e Desenvolvimento (POP-DEV-02)
- **Objetivo**: Garantir que novos requisitos sejam projetados, modelados e implementados com respeito à arquitetura Offline-First.
- **Entradas**: Requisitos funcionais, regras de cálculo mercantil ou melhorias de interface.
- **Etapas Operacionais Observadas no Repositório**:
  1. **Modelagem de Domínio**: Definição de regras financeiras isoladas em `src/js/domain/` projetadas para operar em centavos inteiros para evitar ponto flutuante.
  2. **Camada de Validações**: Criação de validadores estritos em `src/js/validators/` com rejeição de valores negativos, datas incoerentes ou textos fora de tamanho.
  3. **Persistência em Repositórios**: Implementação de métodos de persistência estendendo `BaseRepository.js`, isolando consultas IndexedDB em transações seguras.
  4. **Camada de Casos de Uso**: Orquestração transacional multi-store em `src/js/services/` com emissão de eventos no `EventBus`.
  5. **Interface do Usuário**: Criação de telas em `src/js/pages/` com componentes Tailwind CSS e roteamento SPA hash em `router.js`.
- **Saídas**: Código desacoplado, modular e aderente ao modelo de camadas.
- **Responsável**: Equipe de Desenvolvimento.
- **Registro / Evidência**: Código em `src/js/` e `docs/ARCHITECTURE.md`.

---

### 6.3. Procedimento Operacional: Verificação e Testes de Software (POP-QA-01)
- **Objetivo**: Verificar formalmente a exatidão dos cálculos, persistência e integridade das regras de negócio antes de qualquer release.
- **Entradas**: Código implementado e suítes de testes em `tests/`.
- **Etapas Operacionais Observadas no Repositório**:
  1. O desenvolvedor ou QA executa localmente o comando:
     ```bash
     bun test
     ```
  2. O runner nativo do Bun executa sequencialmente os 14 arquivos de teste.
  3. Os testes cobrem banco IndexedDB (`db.test.js`), centavos e margens (`domain.test.js`), catálogo (`products.test.js`), estoque (`stock_phase4.test.js`), vendas (`sales_phase5.test.js`), compras (`purchases_suppliers_phase6.test.js`), cotações (`quotations_phase7.test.js`), relatórios (`reports_phase10.test.js`), PWA (`pwa_phase11.test.js`), plataforma (`platform_phase12.test.js`) e sincronização nuvem (`sync_phase13.test.js`).
  4. Qualquer falha de teste deve ser investigada e sanada antes do empacotamento de produção.
- **Saídas**: Relatório de execução do Bun test com totalizadores de testes aprovados e tempos de execução.
- **Responsável**: Analista de QA / Desenvolvedor.
- **Registro / Evidência**: Suíte de 171 testes em `tests/` (`EV-013`).
- **Lacuna Operacional**: Execução atualmente manual pelo desenvolvedor; ausência de execução automática bloqueante via esteira de CI.

---

### 6.4. Procedimento Operacional: Build, Empacotamento e Release (POP-OPS-01)
- **Objetivo**: Gerar pacotes de produção otimizados para distribuição aos usuários finais nos formatos Web/PWA e Desktop Windows.
- **Entradas**: Código-fonte verificado e com testes validados.
- **Etapas Operacionais Observadas no Repositório**:
  1. **Build do Frontend**:
     ```bash
     bun run build
     ```
     O Vite compila os assets ES Modules, processa o CSS do Tailwind v4 e gera a pasta `dist/` com arquivos minificados e hashes imutáveis (`EV-014`).
  2. **Empacotamento Desktop Nativo**:
     ```bash
     bun run tauri build
     ```
     O CLI do Tauri compila o binário Rust de release com a flag de supressão de console Windows (`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` em `main.rs`) e gera os instaladores:
     - Instalador executável via NSIS (`.exe`);
     - Instalador corporativo via WiX Toolset (`.msi`).
  3. **Disponibilização**: Os instaladores são gerados no diretório `src-tauri/target/release/bundle/` para distribuição aos clientes.
- **Saídas**: Diretório `dist/` e instaladores `.exe` e `.msi` finalizados.
- **Responsável**: Engenheiro de Build / DevOps.
- **Registro / Evidência**: Artefatos gerados em `src-tauri/target/release/bundle/` (`EV-015`).
- **Lacunas Operacionais**: Falta de etapa de assinatura digital dos executáveis (Authenticode com certificado comercial) para evitar alerta do Windows SmartScreen; necessidade de instituir procedimento formal de homologação e teste funcional da instalação dos pacotes em ambiente limpo antes da liberação final ao usuário.

---

### 6.5. Procedimento Operacional: Tratamento de Não Conformidades / Bugs (POP-QA-02)
- **Objetivo**: Identificar, registrar, conter e corrigir defeitos no software e falhas de processo.
- **Entradas**: Falha em teste automatizado, relato de erro pelo usuário ou comportamento anômalo da interface.
- **Etapas Operacionais Observadas no Repositório**:
  1. **Contenção Local Imediata**: Falhas no meio de transações no banco de dados disparam `tx.abort()` automático, impedindo a gravação de dados corrompidos.
  2. **Reprodução por Teste Automatizado**: Criação ou ajuste de caso de teste específico na pasta `tests/` reproduzindo a condição de falha.
  3. **Correção no Código**: Ajuste na camada de domínio, validador ou repositório responsável.
  4. **Revalidação de Regressão**: Execução da suíte completa `bun test` para certificar que a correção não gerou efeitos colaterais.
- **Saídas**: Código corrigido com teste de regressão aprovado e registro no changelog.
- **Responsável**: Desenvolvedor / QA.
- **Registro / Evidência**: Histórico de correções no Git e changelog.

---

## 7. Cláusula 9 — Avaliação de Desempenho

### 7.1. Métricas Técnicas Objetivas do Repositório (🔧 Evidenciado)

Na auditoria executada em 17/09/2026, os seguintes indicadores técnicos foram extraídos diretamente do ambiente:

| Indicador Técnico de Desempenho | Valor Medido | Ferramenta / Método | Evidência no Repositório |
| :--- | :---: | :--- | :--- |
| **Total de Testes Automatizados** | 171 testes | Runner nativo do Bun (`bun test`) | [`tests/`](tests/) |
| **Testes Aprovados com Sucesso** | 168 testes | `bun test` em 17/09/2026 | Saída auditável de teste (`EV-013`) |
| **Testes Reprovados** | 3 testes | Falha de versão em `platform_phase12.test.js` | Saída auditável de teste (`EV-013`) |
| **Tempo de Execução dos Testes** | 923 ms (< 1 segundo) | Medição nativa do Bun | Saída auditável de teste (`EV-013`) |
| **Tempo de Build de Produção** | 1.52 segundos | Compilador Vite v8.2.1 | Saída do comando `bun run build` (`EV-014`) |
| **Tamanho do Pacote JS Principal** | 50.8 kB (13.6 kB gzip) | Análise de bundle do Vite | Pasta `dist/assets/` (`EV-014`) |
| **Tamanho do Instalador Executável** | 2.32 MB (`.exe`) | Inspeção física do sistema de arquivos | `src-tauri/target/release/bundle/nsis/` (`EV-015`) |
| **Tamanho do Pacote Corporativo MSI** | 3.32 MB (`.msi`) | Inspeção física do sistema de arquivos | `src-tauri/target/release/bundle/msi/` (`EV-015`) |

---

### 7.2. Mecanismos Organizacionais de Avaliação (📝 A Definir pela Organização)

Os seguintes processos da Cláusula 9 dependem de rotina organizacional e devem ser instituídos pela liderança:

#### 1. Pesquisa de Satisfação do Cliente (Cláusula 9.1.2)
- *Processo a implementar*: Envio semestral de questionário de satisfação (NPS / CSAT) avaliando facilidade de uso, estabilidade e atendimento de suporte.
- *Status atual*: 📝 Requer definição pela organização (não evidenciado no repositório).

#### 2. Programa de Auditoria Interna da Qualidade (Cláusula 9.2)
- *Processo a implementar*: Condução de auditoria interna anual independente cobrindo conformidade dos procedimentos operacionais e integridade documental.
- *Status atual*: 📝 Requer definição pela organização (este documento serve como relatório base para a 1ª auditoria).

#### 3. Análise Crítica pela Direção (Cláusula 9.3)
- *Processo a implementar*: Reunião formal semestral da diretoria analisando resultados de testes, reclamações de suporte, riscos e oportunidades, com ata registrada e arquivada.
- *Status atual*: 📝 Requer definição pela organização.

---

## 8. Cláusula 10 — Melhoria Contínua

### 8.1. Histórico de Melhorias Incrementais (🔧 Evidenciado)
A melhoria contínua (*Plan-Do-Check-Act*) é comprovada no repositório através da evolução planejada em 13 fases cronológicas registradas em `docs/CHANGELOG.md` e `task.md`:
- **Fases 1 e 2**: Fundação da persistência e transações atômicas com rollback;
- **Fases 3 a 7**: Implementação contínua dos módulos comerciais com regras de domínio isoladas e testes crescentes (de 45 para 102 testes);
- **Fases 8 a 10**: Introdução de dashboards executivos, rotinas criptográficas de backup com SHA-256 e emissão de DRE com compatibilidade Excel;
- **Fase 11**: Evolução para PWA com ciclo de vida de Service Worker e resiliência offline completa;
- **Fase 12**: Criação da camada multi-plataforma e empacotamento nativo Desktop Windows via Tauri v2;
- **Fase 13**: Conclusão da camada de sincronização em nuvem via Outbox pattern com resolução determinística de conflitos.

---

### 8.2. Modelo Padronizado de Relatório de Não Conformidade e Ação Corretiva (RNC / CAPA)

Este modelo deve ser adotado pela equipe técnica para tratamento formal de desvios e defeitos:

```text
════════════════════════════════════════════════════════════════════════════════
RELATÓRIO DE NÃO CONFORMIDADE E AÇÃO CORRETIVA (RNC / CAPA)
(Modelo Operacional SGQ — Alinhamento ISO 9001:2026 — Cláusula 10.2)
════════════════════════════════════════════════════════════════════════════════

1. IDENTIFICAÇÃO DO DESVIO:
   Número do RNC: RNC-2026-______
   Data de Abertura: ___/___/______
   Origem: [ ] Teste Automatizado  [ ] Falha em Build  [ ] Chamado de Cliente  [ ] Auditoria
   Módulo Afetado: [ ] Produtos  [ ] Estoque  [ ] Vendas  [ ] Tauri/Desktop  [ ] Sync/Nuvem

2. DESCRIÇÃO DA NÃO CONFORMIDADE (EVIDÊNCIA):
   Descrever claramente o desvio ocorrido com caminhos de arquivos e mensagens de erro:
   _____________________________________________________________________________
   _____________________________________________________________________________

3. AÇÃO DE CONTENÇÃO IMEDIATA (DISPOSIÇÃO):
   O que foi feito imediatamente para impedir a propagação do problema aos usuários:
   _____________________________________________________________________________

4. ANÁLISE DE CAUSA RAIZ (MÉTODO DOS 5 PORQUÊS):
   Por que 1: _________________________________________________________________
   Por que 2: _________________________________________________________________
   Por que 3: _________________________________________________________________
   Por que 4: _________________________________________________________________
   Por que 5 (Causa Raiz Fundamental): _______________________________________

5. PLANO DE AÇÃO CORRETIVA (CAPA):
   Ação preventiva para garantir que o defeito não volte a ocorrer:
   Atividade: __________________________________________________________________
   Responsável: ___________________________ Prazo Limite: ___/___/______

6. VERIFICAÇÃO DE EFICÁCIA (APÓS IMPLANTAÇÃO):
   Data da Verificação: ___/___/______
   Evidência do Teste de Regressão: ___________________________________________
   Resultado: [ ] Eficaz (RNC Encerrado)   [ ] Ineficaz (Reabrir Análise)
   Assinatura do Responsável pela Qualidade: ___________________________________
```

---

## 9. Matriz de Aderência e Gap Analysis (ISO 9001:2026)

A tabela a seguir apresenta o diagnóstico consolidado da situação do projeto frente aos requisitos temáticos da edição vigente da norma:

| Cláusula ISO 9001:2026 | Tema / Requisito Normativo | Evidência Identificada no Projeto | Situação de Aderência | Responsável | Próxima Ação Necessária |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **4.1 e 4.2** | Contexto e Partes Interessadas | Especificações técnicas em `docs/` e `README.md` | 🟡 Parcialmente evidenciado | Liderança | Preencher a Matriz de Contexto de Negócio |
| **4.3 e 4.4** | Escopo do SGQ e Processos | Processos em camadas em `src/js/` | 🟡 Parcialmente evidenciado | Liderança | Formalizar o Manual do SGQ institucional |
| **4.x (2026)** | Mudanças Climáticas no Contexto | Software Offline-First e eficiente | 🟢 Evidenciado (produto) | Liderança | Registrar declaração formal de relevância |
| **5.1 e 5.2** | Liderança e Política da Qualidade | Autor identificado no Git | 📝 Requer definição organizacional | Diretoria | Aprovar e assinar a Política da Qualidade |
| **5.x (2026)** | Cultura da Qualidade e Ética | Código limpo sem práticas abusivas | 📝 Requer definição organizacional | Diretoria | Aplicar o questionário de ética na equipe |
| **6.1** | Ações para Riscos e Oportunidades| Riscos técnicos mapeados neste laudo | 🟢 Evidenciado (técnico) | DevOps / QA | Implementar as ações corretivas R-01 a R-05 |
| **6.2** | Objetivos da Qualidade | Metas de testes no `task.md` | 🟡 Parcialmente evidenciado | Diretoria | Formalizar metas comerciais e operacionais |
| **7.1** | Recursos e Infraestrutura | Ambiente Bun, Vite, Rust e Tauri | 🟢 Evidenciado | TI | Manter ferramentas de build atualizadas |
| **7.2 e 7.3** | Competência e Conscientização | Capacidade técnica em código | 📝 Requer definição organizacional | RH / Gestão | Formalizar matriz de treinamentos da equipe |
| **7.5** | Informação Documentada | SemVer, CHANGELOG e migrations | 🟢 Evidenciado | Engenharia | Manter documentação sincronizada |
| **8.1 a 8.5** | Operação e Desenvolvimento | Camadas, POPs de 01 a 05 e testes | 🟢 Evidenciado | Engenharia | Preservar separação estrita de camadas |
| **8.6** | Liberação de Produtos | Build Vite e empacotamento Tauri | 🟢 Evidenciado | DevOps | Configurar esteira de CI/CD automatizada |
| **8.7** | Saídas Não Conformes | Rollback atômico e tratamento de erro | 🟢 Evidenciado | QA / Dev | Utilizar o modelo formal de RNC |
| **9.1** | Monitoramento e Medição | Suíte Bun test com 171 testes | 🟢 Evidenciado (técnico) | QA | Implementar pesquisa de satisfação CSAT |
| **9.2 e 9.3** | Auditoria Interna e Análise Crítica| Relatório deste documento | 📝 Requer definição organizacional | Diretoria | Agendar 1ª reunião de análise crítica formal |
| **10.1 a 10.3**| Melhoria Contínua e Ação Corretiva| 13 fases de evolução no changelog | 🟢 Evidenciado | Engenharia | Instituir ciclo formal de RNC/CAPA |

#### Legenda de Situação:
- 🟢 **Evidenciado no repositório**: Prática implementada tecnicamente e rastreável nos arquivos do projeto.
- 🟡 **Parcialmente evidenciado**: Prática existente no aspecto técnico, mas pendente de formalização gerencial.
- 🔴 **Não evidenciado**: Requisito aplicável ausente nos registros do repositório.
- 📝 **Requer definição organizacional**: Requisito de governança que compete exclusivamente à diretoria institucional e não pode ser inferido pelo código.

---

## 10. Aviso Normativo sobre Certificação de Sistemas de Gestão

> [!IMPORTANT]
> **Aviso Mandatório sobre Certificação Institucional:**  
> A existência deste documento **NÃO significa que a organização, a equipe ou o software GestãoPro sejam certificados na norma ISO 9001:2026**.  
> 
> A norma ISO 9001 atesta a maturidade, conformidade e disciplina contínua dos **processos organizacionais de uma empresa ao longo do tempo**, e não apenas as propriedades estáticas de um repositório de software.  
> 
> A obtenção de uma certificação formal ISO 9001 exige obrigatoriamente:
> 1. A implantação prática e rotineira dos procedimentos aqui descritos pela organização;
> 2. A execução documentada de auditorias internas e análises críticas pela direção;
> 3. A contratação formal de um **Organismo de Certificação de Sistemas de Gestão Acreditado** (como ABNT, DNV, Bureau Veritas, SGS ou TÜV), o qual enviará auditores externos qualificados para avaliar a prática diária de trabalho da equipe.
> 
> Este documento representa uma autoavaliação e um arcabouço técnico preliminar indispensável para organizar a engenharia de software da empresa e pavimentar o caminho rumo a uma certificação formal futura.

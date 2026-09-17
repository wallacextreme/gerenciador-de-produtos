# Manual do Usuário — GestãoPro

Versão do manual: 17/09/2026  
Aplicável à versão do sistema: **1.13.0** (Comprovada em `package.json`, `Cargo.toml` e `tauri.conf.json`)

---

## Sumário

- [1. Visão Geral do Sistema](#1-visão-geral-do-sistema)
  - [1.1. O que é o GestãoPro](#11-o-que-é-o-gestãopro)
  - [1.2. Para quem se destina](#12-para-quem-se-destina)
  - [1.3. O Paradigma Offline-First e Suas Vantagens Reais](#13-o-paradigma-offline-first-e-suas-vantagens-reais)
  - [1.4. Módulos Funcionais Disponíveis](#14-módulos-funcionais-disponíveis)
- [2. Instalação e Acesso](#2-instalação-e-acesso)
  - [2.1. Instalação no Windows (Desktop — .exe e .msi)](#21-instalação-no-windows-desktop--exe-e-msi)
  - [2.2. Acesso e Instalação via Navegador (PWA)](#22-acesso-e-instalação-via-navegador-pwa)
  - [2.3. Tratamento Seguro do Alerta do Windows SmartScreen](#23-tratamento-seguro-do-alerta-do-windows-smartscreen)
- [3. Guia de Início Rápido (Primeiros Passos)](#3-guia-de-início-rápido-primeiros-passos)
- [4. O Funcionamento Offline e a Gestão de Dados](#4-o-funcionamento-offline-e-a-gestão-de-dados)
  - [4.1. Onde e Como os Dados Ficam Armazenados](#41-onde-e-como-os-dados-ficam-armazenados)
  - [4.2. Rotina de Exportação de Backup (.json)](#42-rotina-de-exportação-de-backup-json)
  - [4.3. Rotina de Restauração de Dados](#43-rotina-de-restauração-de-dados)
  - [4.4. Alerta Crítico para a Versão PWA (Navegador)](#44-alerta-crítico-para-a-versão-pwa-navegador)
  - [4.5. Sincronização Opcional em Nuvem (Firebase / Outbox)](#45-sincronização-opcional-em-nuvem-firebase--outbox)
- [5. Manual Operacional Passo a Passo](#5-manual-operacional-passo-a-passo)
  - [5.1. Painel de Controle & Dashboard (`#/dashboard`)](#51-painel-de-controle--dashboard-dashboard)
  - [5.2. Catálogo de Produtos (`#/produtos`)](#52-catálogo-de-produtos-produtos)
  - [5.3. Cadastro e Edição de Produtos (`#/produtos/novo` e `#/produtos/editar/:id`)](#53-cadastro-e-edição-de-produtos-produtosnovo-e-produtoseditarid)
  - [5.4. Ficha Detalhada do Produto (`#/produtos/detalhes/:id`)](#54-ficha-detalhada-do-produto-produtosdetalhesid)
  - [5.5. Controle e Movimentação de Estoque (`#/estoque`)](#55-controle-e-movimentação-de-estoque-estoque)
  - [5.6. Frente de Caixa & Vendas (PDV) (`#/vendas`)](#56-frente-de-caixa--vendas-pdv-vendas)
  - [5.7. Ordens de Compra & Abastecimento (`#/compras`)](#57-ordens-de-compra--abastecimento-compras)
  - [5.8. Gestão de Fornecedores (`#/fornecedores`)](#58-gestão-de-fornecedores-fornecedores)
  - [5.9. Comparativo de Cotações por Produto (`#/cotacoes`)](#59-comparativo-de-cotações-por-produto-cotacoes)
  - [5.10. Central de Relatórios & Impressão (`#/relatorios`)](#510-central-de-relatórios--impressão-relatorios)
  - [5.11. Configurações, Backup & Nuvem (`#/configuracoes`)](#511-configurações-backup--nuvem-configuracoes)
- [6. Perguntas Frequentes (FAQ)](#6-perguntas-frequentes-faq)
- [7. Solução de Problemas (Troubleshooting)](#7-solução-de-problemas-troubleshooting)
- [8. Boas Práticas e Recomendações Operacionais](#8-boas-práticas-e-recomendações-operacionais)

---

## 1. Visão Geral do Sistema

### 1.1. O que é o GestãoPro
O **GestãoPro** é uma aplicação para gestão comercial integrada, controle de estoques, frente de caixa (PDV), ordens de compras, gestão de fornecedores, cotações comparativas de preços, relatórios operacionais (incluindo DRE gerencial e Curva ABC) e sincronização em nuvem.

O sistema foi concebido sob o modelo arquitetural híbrido:
1. **Desktop Nativo Windows**: executável local construído sobre o runtime **Tauri v2** em Rust, utilizando o componente de renderização WebView2 do Windows.
2. **Progressive Web App (PWA)**: aplicação web executável diretamente em navegadores modernos, passível de instalação no dispositivo cliente com funcionamento independente de conexão.

### 1.2. Para quem se destina
Destina-se a micro e pequenas empresas, estabelecimentos de varejo, distribuidores locais, prestadores de serviços com controle de materiais e operadores comerciais que demandam agilidade operacional no ponto de venda e controle de estoque sem dependência estrita de links externos de internet.

### 1.3. O Paradigma Offline-First e Suas Vantagens Reais
Diferente dos sistemas tradicionais baseados exclusivamente em computação em nuvem cliente-servidor (onde a indisponibilidade de sinal paralisa as operações de caixa e consulta), o GestãoPro é estruturado sob o paradigma **Offline-First**:
- **Gravação Local Imediata**: Toda e qualquer operação (cadastro de produtos, lançamento de vendas, movimentação de estoque ou alteração de configurações) é gravada diretamente no banco de dados local do seu computador (**IndexedDB**), sem requisições de rede bloqueantes.
- **Continuidade Operacional**: Quedas de internet, lentidão de link ou oscilações de sinal não interrompem o registro de vendas ou a consulta ao catálogo.
- **Independência de Provedor Externo**: O sistema opera com autonomia plena sem a necessidade de contratação obrigatória de planos de hospedagem ou servidores remotos para seu uso básico.

### 1.4. Módulos Funcionais Disponíveis
O sistema contempla os seguintes módulos integrados na navegação:
1. **Dashboard & Indicadores**: Métricas executivas consolidadas, receita bruta, CMV, margem média, giro de itens e gráficos diários.
2. **Catálogo de Produtos**: Fichas cadastrais com SKU, código de barras, fotos comprimidas em WebP, marca e cálculo de lucro/markup.
3. **Gestão de Estoque**: Kardex com rastreabilidade, entradas, saídas manuais, devoluções, auditoria com recálculo de saldo e alertas de estoque mínimo/esgotado.
4. **Vendas (PDV)**: Frente de caixa com busca de produtos, formas de pagamento, cálculo de descontos, trava de estoque negativo e emissão de comprovante.
5. **Ordens de Compra**: Registro de pedidos de compras de fornecedores com abastecimento automático do estoque e atualização do custo de catálogo.
6. **Fornecedores**: Diretório de parceiros comerciais, documento (CNPJ/CPF), contatos e histórico acumulado de fornecimento.
7. **Cotações**: Matriz comparativa de preços por produto entre até 3 fornecedores cotados simultaneamente, com marcação automática da opção de menor preço e compras diretas em um clique.
8. **Relatórios & DRE**: Emissão de relatórios tabulares com exportação para planilhas (.csv em codificação Windows-1252 / UTF-8 BOM) e impressão formatada para A4.
9. **Configurações & Backup**: Identificação da empresa para cabeçalhos, regras de negócio de estoque, exportação/restauração completa com integridade SHA-256 e sincronização com Google Firebase Firestore REST API.

---

## 2. Instalação e Acesso

### 2.1. Instalação no Windows (Desktop — .exe e .msi)

#### Requisitos do Sistema
- **Sistema Operacional**: Windows 10 (versão 1809 ou superior) ou Windows 11 (64-bit).
- **Componente de Renderização**: Microsoft Edge WebView2 Runtime (já presente de forma nativa e atualizada no Windows 10/11).
- **Memória RAM**: Mínimo de 2 GB recomendados para operação fluida.
- **Espaço em Disco**: Aproximadamente 50 MB livres.

#### Pacotes Oficiais Identificados
O projeto compila para os seguintes instaladores de distribuição Windows (identificados em `src-tauri/target/release/bundle/`):
1. **Instalador Executável Padrão**: `GestãoPro_1.13.0_x64-setup.exe` (gerado via instalador NSIS).
2. **Pacote Corporativo Windows Installer**: `GestãoPro_1.13.0_x64_en-US.msi` (gerado via WiX Toolset).

#### Passo a Passo de Instalação no Desktop
> [!NOTE]
> Os instaladores identificados existem como artefatos de release compilados no repositório. Recomenda-se a validação funcional prévia da instalação no parque de máquinas específico da organização antes da distribuição em larga escala.

1. Obtenha o arquivo oficial `GestãoPro_1.13.0_x64-setup.exe` ou `GestãoPro_1.13.0_x64_en-US.msi` disponibilizado pela equipe.
2. Dê um duplo clique sobre o instalador.
3. Siga as instruções do assistente de instalação, selecionando o diretório de destino desejado (o padrão do sistema é `C:\Program Files\GestãoPro`).
4. Ao término da instalação, o assistente criará os atalhos operacionais:
   - Atalho na **Área de Trabalho** com o ícone do sistema;
   - Entrada no **Menu Iniciar** sob o grupo "GestãoPro".
5. Clique no ícone do GestãoPro para inicializar a aplicação. Uma janela nativa de resolução inicial 1280x820 pixels será aberta imediatamente, pronta para uso sem necessidade de login em servidor externo.

---

### 2.2. Acesso e Instalação via Navegador (PWA)

#### Navegadores Compatíveis
- **Recomendados**: Google Chrome (versão 90+) e Microsoft Edge (versão 90+).
- **Suporte Adicional**: Navegadores baseados em Chromium com suporte ao padrão W3C Web App Manifest e Service Workers.

#### Como Acessar
1. Abra o navegador de sua preferência.
2. Digite ou clique no endereço local ou de rede disponibilizado onde o sistema está hospedado (por exemplo, `http://localhost:3000` em ambiente local).
3. A tela inicial carregará instantaneamente devido ao Service Worker pré-instalado.

#### Como Instalar o Aplicativo no Dispositivo pelo Navegador
O GestãoPro disponibiliza suporte a instalação direta como aplicativo local:
1. Ao navegar no sistema via Chrome ou Edge em modo web, observe o menu lateral esquerdo (Sidebar).
2. Caso o navegador atenda aos requisitos de instalação, surgirá o botão em destaque: **"Instalar Aplicativo"** (acompanhado do ícone de download).
3. Clique em **"Instalar Aplicativo"**.
4. Uma caixa de diálogo do navegador será aberta questionando: *"Instalar app GestãoPro — Gestão Comercial e Estoque?"*.
5. Clique em **"Instalar"**.
6. O sistema será adicionado à sua Área de Trabalho e lista de programas do Windows, passando a rodar em janela própria e isolada (**modo Standalone**), sem barra de endereços e sem botões de abas do navegador.

---

### 2.3. Tratamento Seguro do Alerta do Windows SmartScreen

> [!IMPORTANT]
> **Aviso de Segurança:** Nunca desative o Windows Defender ou o filtro SmartScreen do seu sistema operacional. Siga estritamente as orientações abaixo.

Caso você instale o executável em uma máquina Windows e o instalador não possua um certificado digital comercial corporativo pago (situação comum em distribuições internas ou pacotes open-source), o Windows SmartScreen poderá exibir uma tela azul de aviso com o título:
> *"O Windows protegeu o seu computador — O Microsoft Defender SmartScreen impediu a inicialização de um aplicativo não reconhecido."*

#### Como Proceder com Segurança:
1. **Verificação de Procedência**: Certifique-se previamente de que o arquivo instalador (`GestãoPro_1.13.0_x64-setup.exe`) foi fornecido diretamente pelo canal oficial do projeto ou compilado a partir do repositório da sua organização.
2. Se a origem for legítima, clique no link sublinhado **"Mais informações"** localizado abaixo do texto principal do alerta.
3. O SmartScreen exibirá o nome do aplicativo (`GestãoPro`) e o fornecedor.
4. Surgirá o botão **"Executar assim mesmo"** no canto inferior direito da janela.
5. Clique em **"Executar assim mesmo"** para permitir que o instalador continue a configuração normal do sistema.

---

## 3. Guia de Início Rápido (Primeiros Passos)

Para começar a operar seu comércio em menos de 5 minutos, siga esta sequência fundamental:

```text
[Passo 1]              [Passo 2]               [Passo 3]               [Passo 4]            [Passo 5]
Configurações  ───►  Fornecedores   ───►   Cadastrar Item   ───►   Entrada Estoque  ───►  Primeira Venda
Identificar sua      Cadastrar quem        Nome, Custo, Margem     Dar saldo físico       Faturar no PDV e
empresa/recibo       fornece produtos      e Preço de Venda        ao produto cadastrado  emitir comprovante
```

### Passo 1: Identifique sua Empresa
1. No menu lateral, acesse **Configurações** (`#/configuracoes`).
2. Na aba **"Dados da Empresa"**, informe a Razão Social, Nome Fantasia, CNPJ, Telefone e Endereço.
3. Clique em **"Salvar Dados da Empresa"**. Essas informações aparecerão nos cabeçalhos de todos os relatórios e comprovantes impressos.

### Passo 2: Cadastre um Fornecedor Parceiro
1. No menu lateral, acesse **Fornecedores** (`#/fornecedores`).
2. Clique em **"Novo Fornecedor"**.
3. Preencha o Nome Fantasia / Razão Social (obrigatório) e o documento (CNPJ de 14 dígitos ou CPF de 11 dígitos).
4. Clique em **"Salvar Fornecedor"**.

### Passo 3: Cadastre seu Primeiro Produto com Margem Automática
1. No menu lateral, acesse **Catálogo de Produtos** (`#/produtos`) e clique no botão **"Novo Produto"**.
2. Preencha o **Nome do Produto** e o **Código / SKU** (campos obrigatórios).
3. Na seção *Precificação & Lucratividade*:
   - Digite o **Preço de Custo (R$)** (ex.: `50,00`).
   - Digite a **Margem de Lucro Desejada (%)** (ex.: `40`).
   - O sistema calculará automaticamente o **Preço de Venda (R$)** (`83,33`) e o Lucro Bruto unitário.
4. Clique no botão **"Salvar Produto"** no topo da página.

### Passo 4: Dê Entrada Inicial no Estoque
1. No menu lateral, acesse **Estoque** (`#/estoque`).
2. Clique no botão azul **"Nova Movimentação"**.
3. No campo *Tipo de Movimentação*, selecione **"Entrada de Mercadoria (IN)"**.
4. Selecione o produto recém-cadastrado e informe a **Quantidade** (ex.: `20`).
5. Clique em **"Confirmar Movimentação"**. O saldo do item será atualizado imediatamente para 20 unidades.

### Passo 5: Realize sua Primeira Venda no PDV
1. No menu lateral, acesse **Vendas (PDV)** (`#/vendas`).
2. Clique no botão verde **"Nova Venda (PDV)"**.
3. No campo de produto, selecione o item cadastrado. O sistema exibirá o preço unitário e o saldo em estoque disponível.
4. Informe a quantidade vendida (ex.: `2`), selecione o método de pagamento (ex.: `PIX`) e clique em **"Concluir Venda"**.
5. O sistema deduzirá automaticamente as 2 unidades do estoque físico, registrará o lucro da operação e abrirá o comprovante pronto para impressão.

---

## 4. O Funcionamento Offline e a Gestão de Dados

### 4.1. Onde e Como os Dados Ficam Armazenados
O GestãoPro não depende de conexões ativas com bancos de dados remotos para operar suas funções de rotina.
- **Banco de Dados Local**: O sistema opera sobre o **IndexedDB** do navegador/WebView2, gravando na base de dados de nome oficial `gestaopro_db`.
- **Coleções Locais (Object Stores)**:
  - `products`: Catálogo completo de itens, preços, SKU, código de barras e marcas;
  - `productImages`: Imagens de produtos processadas e comprimidas localmente em formato WebP;
  - `suppliers`: Registro cadastral de fornecedores;
  - `productSuppliers`: Histórico de cotações e vínculos fornecedor-produto;
  - `stockMovements`: Registro cronológico imutável de todas as entradas, saídas, devoluções e balanços;
  - `sales`: Registro de vendas comerciais faturadas com histórico financeiro imutável;
  - `purchases`: Ordens de compra de mercadorias;
  - `categories`: Categorias organizacionais de produtos;
  - `settings`: Parâmetros do sistema (dados cadastrais da empresa, chave de estoque negativo, configurações de nuvem);
  - `syncQueue`: Fila transacional de sincronização com a nuvem (Padrão Outbox).
- **Atomicidade e Segurança Transacional**: Toda operação sensível (como uma venda comercial que baixa estoque ou uma ordem de compra que atualiza custos) é executada através de rotinas transacionais (`executeTransaction` em `src/js/db/transactions.js`). Caso o computador sofra um desligamento abrupto no meio de uma gravação, o IndexedDB reverte o lote incompleto (**Rollback**), preservando a integridade lógica dos saldos.

---

### 4.2. Rotina de Exportação de Backup (.json)

Como os dados residem na máquina local, a execução periódica de cópias de segurança é um procedimento operacional indispensável.

#### Passo a Passo para Gerar Backup:
1. No menu lateral, clique em **Configurações** (`#/configuracoes`).
2. Clique na aba **"Backup & Restauração"**.
3. Na seção *Exportar Snapshot do Banco de Dados*, visualize a quantidade total de registros armazenados.
4. Clique no botão azul **"Gerar e Baixar Backup Completo"**.
5. O sistema compilará todos os dados das 10 tabelas, serializará as imagens binárias e calculará uma chave de integridade criptográfica **SHA-256** (via Web Crypto API).
6. Um arquivo no formato `.json` será gerado com o padrão de nomenclatura:
   `gestaopro-backup-YYYY-MM-DD-HH-mm.json`
7. Salve este arquivo em local seguro, preferencialmente em um pendrive, disco externo ou pasta sincronizada com serviço de armazenamento corporativo.

---

### 4.3. Rotina de Restauração de Dados

A restauração permite recuperar o estado completo do sistema em caso de troca de máquina ou recuperação de contingência.

#### Passo a Passo para Restaurar:
1. Acesse **Configurações** ➔ aba **"Backup & Restauração"**.
2. Na seção *Restaurar Banco de Dados*, localize o campo de envio de arquivo.
3. Clique em **"Selecionar arquivo de backup..."** e escolha o arquivo `.json` gerado previamente.
4. O sistema lerá o arquivo, validará o formato de dados (`gestaopro_backup`), checará a compatibilidade de versão do esquema e recalculará o **checksum SHA-256**.
5. Um painel de confirmação detalhado exibirá a quantidade de produtos, fornecedores, vendas e movimentações contidas no arquivo.
6. Clique no botão vermelho **"Confirmar Restauração Completa"**.
7. O sistema substituirá as coleções locais de forma atômica e atualizará a interface sem necessidade de reiniciar o programa.

---

### 4.4. Alerta Crítico para a Versão PWA (Navegador)

> [!CAUTION]
> **Aviso Fundamental de Integridade:**  
> Se você utiliza o GestãoPro exclusivamente pelo navegador (Google Chrome ou Microsoft Edge) e NÃO pelo aplicativo Desktop instalado (.exe/.msi), os dados ficam armazenados no armazenamento local de perfil daquele navegador específico.  
> 
> **Ações de Alto Risco no PWA:**
> - Abrir o sistema em abas anônimas ou navegação privada (os dados são destruídos ao fechar a janela).
> - Clicar na opção *"Limpar dados de navegação"* / *"Limpar cookies e dados de sites"* nas opções do navegador.
> 
> **Regra de Sobrevivência:** Faça backup (`.json`) semanalmente ou ao final de cada expediente. Caso precise formatar seu computador ou limpar o navegador, gere o arquivo de backup antes de qualquer procedimento de limpeza.

---

### 4.5. Sincronização Opcional em Nuvem (Firebase / Outbox)

O GestãoPro conta com uma camada nativa de sincronização em nuvem desacoplada baseada no **Google Firebase Firestore REST API**:
- **Funcionamento em Segundo Plano**: Quando configurada, as mutações locais geradas no sistema (criação de produtos, vendas, movimentações) são enfileiradas na tabela local `syncQueue` (Padrão Outbox).
- **Indicador no Cabeçalho**: O topo da tela exibe um selo (*badge*) dinâmico com os seguintes estados observáveis:
  - `Nuvem Pronta`: Provedor configurado e aguardando mutações.
  - `Sincronizando...`: Transmissão de registros em andamento para o Firestore.
  - `X na fila`: Operações realizadas offline que aguardam reconexão de rede para envio.
  - `Sincronizado`: Todos os registros locais foram consolidados remotamente.
  - `Falha sync`: Alerta de erro na transmissão remota (com botão de retentativa manual na aba de configurações).
- **Sem Paradas**: Se o link de internet falhar durante uma venda, o registro local é concluído com sucesso e a sincronização aguardará o restabelecimento da conectividade de rede sem travar o operador.

---

## 5. Manual Operacional Passo a Passo

---

### 5.1. Painel de Controle & Dashboard (`#/dashboard`)

#### Para que serve
Apresenta uma visão executiva consolidada em tempo real da saúde comercial e financeira da empresa. Consolida faturamento bruto, Custo das Mercadorias Vendidas (CMV), Lucro Bruto, Giro de Estoque, Curva ABC de produtos e gráficos de desempenho temporal.

[LOCAL PARA CAPTURA DE TELA: DASHBOARD_OVERVIEW]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Botões de Período** | Filtram os indicadores por período pré-definido | Opções: *Hoje*, *7 dias*, *30 dias* (padrão), *90 dias*, *12 meses*, *Personalizado* | `DashboardPage.js:45-51` |
| **Filtro de Data Personalizado** | Permite definir data inicial e data final | Campos do tipo data (`YYYY-MM-DD`). Apenas visível quando "Personalizado" está ativo | `DashboardPage.js:54-59` |
| **Cards de KPIs Financeiros** | Exibem Faturamento, CMV, Lucro Bruto, Margem Média %, Pedidos, Ticket Médio e Giro | Valores calculados via `AnalyticsService`. Centavos formatados em moeda (R$) | `DashboardPage.js:150-250` |
| **Gráfico Temporal de Desempenho** | Renderiza gráfico vetorial (SVG) de barras/linhas com evolução diária de vendas e lucro | Gráfico dinâmico construído via SVG puro com tooltips reativos | `DashboardPage.js:310-410` |
| **Abas Temáticas** | Alternam entre visões analíticas | Abas: *Visão Geral*, *Curva ABC*, *Velocidade de Giro*, *Fornecedores*, *Categorias* | `DashboardPage.js:11` |
| **Botão "Atualizar" (Ícone reload)** | Recarrega e recalcula todos os agregados analíticos | Executa `loadData()` com recálculo sobre o IndexedDB | `DashboardPage.js:63-65` |
| **Botões de Atalho Rápido** | Disparam navegação imediata para novos lançamentos | Links para `#/vendas` ("Nova Venda") e `#/compras` ("Nova Compra") | `DashboardPage.js:31-38` |

#### Fluxo Prático de Análise:
1. Acesse o sistema; por padrão, o Dashboard é a tela de entrada (`#/dashboard`).
2. Selecione o período desejado (por exemplo, "Últimos 30 dias").
3. Analise o Card de Lucro Bruto e a Margem % alcançada no período.
4. Clique na aba **"Curva ABC"** para identificar quais produtos compõem a Classe A (responsáveis por até 80% da sua receita).
5. Clique na aba **"Velocidade de Giro"** para checar os itens com classificação "Estoque Parado" que demandam ações de promoção.

---

### 5.2. Catálogo de Produtos (`#/produtos`)

#### Para que serve
Listagem geral, pesquisa inteligente, filtragem categórica e consulta rápida de todos os itens cadastrados no acervo da empresa.

[LOCAL PARA CAPTURA DE TELA: PRODUTOS_LISTA]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Campo de Busca Textual** | Pesquisa instantânea na listagem | Filtra por Nome, SKU/Código do Produto, Código Interno, Código de Barras e Marca com debounce de 250ms | `ProductsPage.js:33-39` |
| **Filtro de Categorias** | Restringe os cards à categoria selecionada | Dropdown populado dinamicamente com as categorias registradas | `ProductsPage.js:54-56` |
| **Filtro de Marcas** | Restringe os cards à marca selecionada | Dropdown populado dinamicamente com as marcas registradas | `ProductsPage.js:58-61` |
| **Filtro de Status** | Filtra itens pelo estado de cadastro | Opções: *Apenas Ativos* (padrão), *Apenas Inativos*, *Todos os Produtos* | `ProductsPage.js:63-68` |
| **Botão "Novo Produto"** | Redireciona para a tela de inclusão | Rota `#/produtos/novo` | `ProductsPage.js:41-44` |
| **Cards de Produtos** | Exibem miniatura da foto, nome, SKU, saldo de estoque, preço de venda e margem calculada | Renderizados em grid responsivo de 1 a 4 colunas dependendo da largura da tela | `ProductsPage.js:77-81` |
| **Ações no Card** | Acesso rápido a detalhes ou edição | Botões "Ver Detalhes" (`#/produtos/detalhes/:id`) e "Editar" (`#/produtos/editar/:id`) | `ProductsPage.js:250-310` |

#### Fluxo Prático:
1. Acesse **Catálogo de Produtos** no menu lateral.
2. Digite parte do nome ou bipe o código de barras no campo de busca.
3. Observe os badges de situação de estoque nos cards (ex.: badge vermelho "Esgotado", amarelo "Estoque Baixo" ou verde "Normal").
4. Clique no card do produto para visualizar sua ficha completa.

---

### 5.3. Cadastro e Edição de Produtos (`#/produtos/novo` e `#/produtos/editar/:id`)

#### Para que serve
Formulário completo para criação de novos itens no catálogo ou manutenção de dados cadastrais, financeiros e imagens de itens existentes.

[LOCAL PARA CAPTURA DE TELA: PRODUTO_FORM]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Nome do Produto** | Descrição comercial do item | **Obrigatório**. Texto entre 2 e 255 caracteres | `ProductValidator.js:15-19` |
| **Código / SKU** | Código de identificação do produto | **Obrigatório**. Unicidade verificada no catálogo | `ProductValidator.js:21-25` |
| **Código Interno** | Código secundário/referência da loja | Opcional. Texto alfanumérico livre | `ProductFormPage.js:150` |
| **Código de Barras (EAN)** | Código para leitura óptica | Opcional. Suporta padrões EAN-13, UPC ou códigos proprietários | `ProductFormPage.js:160` |
| **Categoria & Marca** | Classificação mercadológica | Texto livre com sugestão ou seleção | `ProductFormPage.js:180-210` |
| **Preço de Custo (R$)** | Valor de compra pago pelo item | Numérico monetário >= 0. Convertido internamente para centavos | `MoneyService.js:10` |
| **Margem de Lucro (%)** | Percentual de lucro sobre a venda | Numérico entre 0% e 99.99%. Recalcula Preço de Venda e Markup | `MarginService.js:30` |
| **Markup (%)** | Fator multiplicador sobre o custo | Numérico >= 0%. Recalcula Preço de Venda e Margem | `MarginService.js:50` |
| **Preço de Venda (R$)** | Preço praticado na frente de caixa | **Obrigatório**. Deve ser estritamente maior que zero (`salePriceCents > 0`) | `ProductValidator.js:32-35` |
| **Estoque Mínimo** | Ponto de pedido para alertas visuais | Inteiro >= 0 | `ProductValidator.js:42-45` |
| **Estoque Máximo** | Teto operacional para alerta de excesso | Inteiro >= 0 | `ProductValidator.js:47-50` |
| **Upload de Imagens** | Adiciona fotos ao produto | Suporta seleção de arquivos, arrastar e soltar (drag & drop) e colar da área de transferência (Ctrl+V) | `ProductFormPage.js:400-520` |
| **Botão "Salvar Produto"** | Valida e persiste no IndexedDB | Validação de domínio ativada. Exibe mensagens de erro em caso de dados inválidos | `ProductFormPage.js:83-86` |

#### Fluxo Prático para Cadastrar Produto:
1. Acesse `#/produtos/novo`.
2. Preencha Nome e Código SKU.
3. Informe o Custo (ex.: `100,00`) e defina a Margem desejada em 50%. Verifique que o Preço de Venda foi ajustado automaticamente para `R$ 200,00` (Margem sobre a venda: `(200 - 100) / 200 = 50%`).
4. Arraste uma imagem JPG/PNG para a área de upload (a imagem será automaticamente redimensionada e comprimida para WebP).
5. Clique em **"Salvar Produto"**.

---

### 5.4. Ficha Detalhada do Produto (`#/produtos/detalhes/:id`)

#### Para que serve
Painel centralizado 360° de um item específico. Reúne fotos ampliadas, indicadores de lucratividade unitária, saldos físicos e quatro históricos integrados: movimentações de estoque, vendas já efetuadas, ordens de compra e cotações de fornecedores.

[LOCAL PARA CAPTURA DE TELA: PRODUTO_DETALHES]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Galeria de Imagens** | Visualizador de fotos do produto | Imagem principal em alta resolução com miniaturas navegáveis | `ProductDetailPage.js:80-92` |
| **Resumo Financeiro** | Exibe Custo, Venda, Lucro Bruto Unitário, Margem % e Markup % | Calculado em tempo real com base nos centavos gravados | `ProductDetailPage.js:140-190` |
| **Painel de Estoque** | Exibe Saldo Atual, Nível Mínimo e Badge de Situação | Badges: *Normal*, *Estoque Baixo*, *Esgotado* ou *Excesso* | `StockService.js:15` |
| **Tabela: Movimentações** | 5 movimentações mais recentes do item | Exibe Data, Tipo (`IN`, `OUT`, `SALE`, `PURCHASE`), Quantidade e Saldo | `ProductDetailPage.js:270-320` |
| **Tabela: Vendas Recentes** | Histórico de saídas de caixa deste item | Exibe Data, ID da Venda, Cliente e Total Faturado | `ProductDetailPage.js:330-380` |
| **Tabela: Compras Recentes**| Entradas de compras efetuadas deste item | Exibe Fornecedor, Data, Qtd Comprada e Custo Unitário pago | `ProductDetailPage.js:390-440` |
| **Card: Cotações Ativas** | Resumo dos fornecedores cotados para o item | Identifica cotação com Menor Preço e Fornecedor Preferido | `ProductDetailPage.js:450-500` |
| **Botão "Editar Produto"** | Abre o formulário de alteração | Rota `#/produtos/editar/:id` | `ProductDetailPage.js:120` |

---

### 5.5. Controle e Movimentação de Estoque (`#/estoque`)

#### Para que serve
Gestão física do armazém, auditoria de integridade do estoque físico, registro de entradas e saídas manuais, controle de perdas/avarias e balanço de inventário.

[LOCAL PARA CAPTURA DE TELA: ESTOQUE_GERAL]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Cards de Topo** | Métricas de Itens Cadastrados, Unidades Totais, Valor do Estoque a Custo e Alertas | Totalizadores calculados sobre todo o catálogo ativo | `StockPage.js:33-35` |
| **Botão "Auditar Saldo"** | Recalcula e sincroniza os saldos de todos os produtos com base na somatória histórica do Kardex | Executa `StockService.recalculateAllStock()`. Corrige descompassos e apresenta sumário | `StockPage.js:51-54` |
| **Botão "Nova Movimentação"** | Abre modal para registrar Entrada, Saída ou Devolução | Abre modal com seleção de produto, tipo, quantidade e motivo | `StockPage.js:56-59` |
| **Pills de Filtro de Estoque** | Filtra a tabela pela situação do saldo | Filtros: *Todos*, *Estoque Baixo*, *Esgotados*, *Normais*, *Excesso* | `StockPage.js:67-81` |
| **Ação "Ajustar Balanço"** | Permite definir diretamente o saldo contado fisicamente na prateleira | Gera movimentação do tipo `ADJUSTMENT` com a diferença calculada automaticamente | `StockPage.js:450-490` |
| **Ação "Histórico (Kardex)"**| Exibe timeline de todas as movimentações já ocorridas no produto | Abre modal com lista completa de movimentações, datas e referências | `StockPage.js:500-580` |

#### Fluxo de Registro de Movimentação Manual:
1. Na página de Estoque, clique em **"Nova Movimentação"**.
2. Selecione o Produto.
3. Escolha o Tipo:
   - **Entrada (IN)**: Recebimento de mercadorias avulsas;
   - **Saída Manual (OUT)**: Perda, avaria, consumo interno ou descarte (exige preenchimento de justificativa/motivo);
   - **Devolução (RETURN)**: Retorno de mercadorias.
4. Digite a quantidade inteira positiva.
5. Clique em **"Confirmar Movimentação"**. O saldo é atualizado de imediato.

---

### 5.6. Frente de Caixa & Vendas (PDV) (`#/vendas`)

#### Para que serve
Módulo operacional de ponto de venda comercial. Permite lançar vendas com rapidez, calcular descontos, registrar meios de pagamento, emitir comprovantes e estornar transações quando necessário.

[LOCAL PARA CAPTURA DE TELA: VENDAS_PDV]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Cards de Topo** | Faturamento do Período, Total de Vendas, Lucro Bruto Total e Ticket Médio | Consolidação financeira instantânea baseada nas vendas registradas | `SalesPage.js:31-33` |
| **Filtros Temporais** | Seleção rápida de horizonte de vendas | Opções: *Todas*, *Hoje*, *Últimos 7 dias*, *Este Mês* | `SalesPage.js:56-69` |
| **Filtro por Forma de Pagamento** | Filtra vendas pelo meio liquidado | Opções: *Dinheiro*, *PIX*, *Cartão de Crédito*, *Cartão de Débito*, *Boleto*, *Outro* | `SalesPage.js:74-83` |
| **Botão "Nova Venda (PDV)"**| Abre o modal de lançamento de venda | Abre modal responsivo com atalho de cálculo | `SalesPage.js:48-51` |
| **Ação "Ver Recibo"** | Exibe recibo detalhado para conferência e impressão | Permite acionar `window.print()` com layout otimizado | `SalesPage.js:420-460` |
| **Ação "Cancelar / Estornar"**| Cancela a venda e estorna o estoque | Transacional: cancela a venda e gera movimentação `RETURN` repondo o saldo | `SaleService.js:80-115` |

#### Formulário do Modal de Nova Venda:
| Campo / Botão | Função | Regras de Validação |
| :--- | :--- | :--- |
| **Selecionar Produto** | Identifica o item a ser faturado | **Obrigatório**. Exibe saldo atual em estoque |
| **Quantidade** | Unidades a vender | **Obrigatório**. Inteiro positivo. Se a opção "Permitir estoque negativo" estiver desabilitada nas configurações e a quantidade superar o saldo, a venda é bloqueada com aviso em tela |
| **Preço Unitário (R$)**| Preço praticado no item | Preenchido automaticamente com o Preço de Venda do catálogo. Permite edição pontual se necessário |
| **Desconto (R$)** | Abatimento financeiro no pedido | Valor monetário >= 0. Não pode superar o valor total do item |
| **Forma de Pagamento** | Meio de liquidação financeira | **Obrigatório**. Seleção entre Dinheiro, PIX, Cartão Crédito/Débito, Boleto ou Outro |
| **Identificação do Cliente** | Nome e CPF/documento do comprador | Opcional. Utilizado para emissão nominal no recibo |
| **Observações** | Notas sobre a venda | Opcional. Texto livre |
| **Botão "Concluir Venda"** | Executa a transação multi-store | Grava a venda, abate o estoque e preserva o custo de compra histórico do item para fins de apuração de lucro |

---

### 5.7. Ordens de Compra & Abastecimento (`#/compras`)

#### Para que serve
Gestão de aquisição de mercadorias com fornecedores. Permite formalizar pedidos de compras, alimentar estoques de forma automatizada e recalibrar o preço de custo dos produtos no catálogo.

[LOCAL PARA CAPTURA DE TELA: COMPRAS_GERAL]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Cards de Topo** | Total Investido em Compras, Quantidade de Pedidos e Itens Adquiridos | Indicadores consolidados via `PurchaseService.getPurchasesOverview()` | `PurchasesPage.js:29-31` |
| **Botão "Nova Ordem de Compra"** | Abre o formulário de emissão de compra | Abre modal de vinculação fornecedor-produto | `PurchasesPage.js:46-49` |
| **Modal: Fornecedor** | Fornecedor parceiro de quem se comprou | **Obrigatório**. Seleção entre os fornecedores cadastrados | `PurchaseValidator.js:15` |
| **Modal: Produto** | Item adquirido | **Obrigatório**. Seleção no catálogo | `PurchaseValidator.js:10` |
| **Modal: Quantidade & Custo** | Volume adquirido e custo unitário pago na nota | Quantidade inteira > 0; Custo unitário >= 0 | `PurchaseValidator.js:20-25` |
| **Checkbox "Atualizar custo no catálogo"** | Calibra o custo do produto automaticamente | Se marcado, atualiza o campo `purchasePriceCents` do produto no catálogo | `PurchaseService.js:45-50` |
| **Ação "Estornar Compra"** | Cancela o pedido de compra | Deduz as unidades do estoque físico (bloqueado se deixar estoque negativo com trava ativa) | `PurchaseService.js:75-110` |

---

### 5.8. Gestão de Fornecedores (`#/fornecedores`)

#### Para que serve
Cadastro completo de parceiros comerciais, registro de canais de contato (telefone, e-mail, endereço), dados fiscais (CNPJ/CPF) e consulta do histórico acumulado de compras realizadas com cada fornecedor.

[LOCAL PARA CAPTURA DE TELA: FORNECEDORES_GERAL]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Botão "Novo Fornecedor"** | Abre formulário de cadastro de parceiro | Modal responsivo com validação cadastral | `SuppliersPage.js:45` |
| **Razão Social / Nome Fantasia** | Identificação do fornecedor | **Obrigatório**. Texto entre 2 e 255 caracteres | `SupplierValidator.js:10-14` |
| **CNPJ ou CPF** | Registro documental oficial | Validação de quantidade de caracteres (11 dígitos para CPF ou 14 dígitos para CNPJ). Unicidade verificada na base | `SupplierValidator.js:20-30` |
| **E-mail & Telefone** | Canais de contato | Validação de formato de e-mail | `SupplierValidator.js:35-40` |
| **Ação "Histórico de Compras"** | Abre o histórico financeiro com o fornecedor | Exibe listagem de todas as ordens de compras emitidas para aquele parceiro | `SuppliersPage.js:180-230` |

---

### 5.9. Comparativo de Cotações por Produto (`#/cotacoes`)

#### Para que serve
Matriz analítica de tomada de decisão em compras. Permite cadastrar e comparar cotações de preços entre até 3 fornecedores simultâneos por produto, destacando automaticamente quem oferece o menor preço unitário e permitindo disparar ordens de compra imediatas.

[LOCAL PARA CAPTURA DE TELA: COTACOES_COMPARATIVO]

#### Elementos da Tela
| Elemento | Função | Regra/Validação | Evidência |
| :--- | :--- | :--- | :--- |
| **Seletor de Produto** | Seleciona o item para exibição das cotações | Dropdown com todos os produtos do catálogo | `QuotationsPage.js:38-41` |
| **Cards de Comparação Lado a Lado** | Exibe até 3 fornecedores ativos para o item | Apresenta Preço Unitário, Condições de Pagamento, Pedido Mínimo e Prazo em dias | `QuotationsPage.js:120-210` |
| **Badge "Menor Preço"** | Destaque visual verde automático | Calculado pelo sistema comparando o `unitCostCents` das cotações ativas | `QuotationService.js:85-95` |
| **Badge "Fornecedor Preferido"** | Destaque visual azul | Definido pelo usuário por critérios de confiança ou pontualidade | `QuotationService.js:100` |
| **Botão de Ação Rápida "Comprar"** | Dispara o fluxo de compra em 1 clique | Abre o modal de Ordem de Compra já preenchido com o produto, fornecedor e preço cotado | `QuotationsPage.js:195-205` |
| **Painel de Histórico Completo** | Histórico colapsável de cotações desativadas | Permite avaliar evolução de preços ao longo do tempo | `QuotationsPage.js:220-270` |

---

### 5.10. Central de Relatórios & Impressão (`#/relatorios`)

#### Para que serve
Geração de relatórios operacionais, demonstrativos contábeis gerenciais (DRE), balanços físicos de inventário, exportação de planilhas eletrônicas compatíveis nativamente com Microsoft Excel e relatórios formatados para impressão física ou PDF em folha A4.

[LOCAL PARA CAPTURA DE TELA: CENTRAL_RELATORIOS]

#### Os 7 Relatórios Gerenciais Disponíveis:
1. **Relatório de Vendas (PDV)**: Consolida transações de saída, faturamento bruto, descontos, lucro bruto apurado e meio de liquidação.
2. **Relatório de Compras**: Ordens de compras emitidas por período, identificação do fornecedor e capital investido em abastecimento.
3. **Balanço Físico de Estoque**: Inventário completo do almoxarifado com quantidade disponível, custo unitário e valor total imobilizado em estoque.
4. **DRE Gerencial (Demonstrativo de Resultados)**: Receita Bruta de Vendas deduzida do Custo das Mercadorias Vendidas (CMV), apurando o Lucro Bruto Operacional e a Margem Bruta percentual no período.
5. **Curva ABC de Produtos**: Classificação de Pareto dos itens por faturamento gerado (Classe A: 80%, Classe B: 15%, Classe C: 5%).
6. **Curva ABC de Fornecedores**: Classificação dos parceiros comerciais por volume financeiro de compras realizadas.
7. **Movimentações Físicas (Kardex)**: Livro de movimentações detalhado de entradas e saídas com datas, tipos e referências.

#### Recursos de Exportação:
- **Botão "Exportar CSV (.csv)"**: Gera planilha eletrônica no formato CSV com delimitador de ponto e vírgula (`;`).
  - *Compatibilidade com Excel*: O arquivo é gerado com codificação padrão **Windows-1252 / ANSI** e cabeçalho especial **UTF-8 BOM**, permitindo abrir diretamente no Microsoft Excel sem palavras desconfiguradas ou perda de caracteres acentuados da língua portuguesa (`ReportService.js:43-70`).
- **Botão "Imprimir / PDF"**: Abre a caixa de diálogo de impressão do sistema operacional com folha em formato A4, cabeçalho institucional contendo os dados da empresa e tabelas com zebrado legível.

---

### 5.11. Configurações, Backup & Nuvem (`#/configuracoes`)

#### Para que serve
Manutenção central das preferências da empresa, regras de negócio do motor de estoque, integridade dos dados locais, diagnóstico do ambiente de execução e parametrização da sincronização em nuvem.

[LOCAL PARA CAPTURA DE TELA: CONFIGURACOES_GERAIS]

#### As 5 Abas de Configuração:
1. **Dados da Empresa (`company`)**: Razão Social, Nome Fantasia, CNPJ, Telefone, E-mail e Endereço. Esses dados são impressos nos cabeçalhos de relatórios e comprovantes de venda.
2. **Preferências Operacionais (`operation`)**:
   - **Permitir Estoque Negativo**: Chave liga/desliga (`allowNegativeStock`). Quando desativada (padrão recomendado), o sistema bloqueia tentativas de realizar vendas ou registrar saídas manuais superiores ao saldo existente no armazém.
   - **Estoque Mínimo Padrão**: Nível de unidades para disparo de alerta visual de estoque baixo quando o produto não tiver um valor específico definido.
3. **Backup & Restauração (`backup`)**:
   - Resumo das estatísticas de registros gravados no banco local;
   - Botão para exportação do snapshot completo em JSON com hash SHA-256;
   - Área para seleção e restauração de arquivos de backup prévios com rollback transacional.
4. **Manutenção & Diagnóstico (`maintenance`)**:
   - Indicador do runtime em execução: *Desktop (Windows Tauri)*, *PWA Standalone* ou *Navegador Web*;
   - Status da permissão de armazenamento persistente do navegador (`navigator.storage.persist()`);
   - Botão de higienização de base (limpeza de dados com confirmação dupla de segurança).
5. **Sincronização & Nuvem (`cloud`)**:
   - Painel para inserção de credenciais do Google Firebase Firestore (API Key, Project ID, Auth Domain, App ID);
   - Botão **"Testar Conexão em Tempo Real"** com medição de latência em milissegundos;
   - Tabela de monitoramento e inspeção dos registros na fila Outbox (`syncQueue`);
   - Botões de ação direta: "Processar Fila Agora", "Tentar Novamente Falhas" e "Limpar Concluídos".

---

## 6. Perguntas Frequentes (FAQ)

### 1. Preciso de conexão ativa com a internet para usar o sistema?
**Não.** O GestãoPro é uma aplicação puramente Offline-First. Todas as operações fundamentais (cadastrar produtos, consultar preços, realizar vendas no PDV, movimentar estoques e emitir relatórios) são executadas localmente no banco de dados IndexedDB do seu computador. Você pode trabalhar normalmente em locais sem sinal de rede ou durante quedas de internet da sua operadora.

### 2. Se a internet cair ou a energia acabar, eu perco o que fiz?
**Não.** Como as informações são salvas no disco local do computador a cada confirmação de clique, a falta de internet não afeta em nada os dados já gravados. Além disso, todas as transações críticas operam sob o padrão de atomicidade transacional: caso a máquina desligue no exato instante de uma venda, a transação incompleta é abortada automaticamente sem deixar registros pela metade ou saldos corrompidos.

### 3. Qual a diferença prática entre usar o programa instalado (.exe/.msi) e o PWA pelo navegador?
- **Versão Desktop Instalada (.exe ou .msi)**: Roda através do runtime nativo Tauri/Rust com renderizador WebView2. Opera com diretório de dados dedicado e isolado do perfil de navegação do browser, mitigando substancialmente o risco de perdas por limpeza de cache de navegadores convencionais, ficando instalada no diretório de programas do Windows e não dependendo de abas abertas. É a opção recomendada para caixas de frente de loja e operações permanentes.
- **Versão PWA (Navegador)**: Permite utilizar o sistema instantaneamente pelo Google Chrome ou Microsoft Edge sem instalar pacotes pesados no Windows, funcionando offline graças ao Service Worker. Contudo, seus dados ficam vinculados ao perfil daquele navegador, exigindo maior rigor com backups periódicos.

### 4. O Windows SmartScreen bloqueou o instalador dizendo que o arquivo é desconhecido. O que fazer?
Isso ocorre porque o instalador é distribuído internamente sem a assinatura digital comercial corporativa da Microsoft. Conforme detalhado na seção 2.3 deste manual, verifique se você obteve o instalador a partir do canal oficial do projeto, clique em **"Mais informações"** na janela azul do aviso e, em seguida, clique em **"Executar assim mesmo"**.

### 5. Como faço para levar meus dados para outro computador?
O procedimento é simples e seguro:
1. No computador de origem, acesse **Configurações** ➔ aba **"Backup & Restauração"** e clique em **"Gerar e Baixar Backup Completo"**.
2. Copie o arquivo `.json` gerado para um pendrive ou pasta compartilhada.
3. No novo computador, com o GestãoPro instalado, acesse a mesma aba de configurações.
4. Na seção *Restaurar Banco de Dados*, selecione o arquivo `.json` do pendrive e clique em **"Confirmar Restauração Completa"**. O sistema restaurará todo o acervo de produtos, fotos, estoques e histórico de vendas.

### 6. Por que o sistema bloqueou a minha venda avisando "Estoque insuficiente"?
Isso significa que a quantidade vendida é maior do que o saldo físico registrado e a opção de segurança **"Permitir Estoque Negativo"** está desabilitada nas Configurações Operacionais. Trata-se de uma proteção contra faturamento de itens que não existem fisicamente na loja. Se a sua empresa opera com faturamento antecipado antes do recebimento, basta acessar **Configurações** ➔ aba **"Preferências Operacionais"** e marcar a opção **"Permitir Estoque Negativo"**.

### 7. Como o sistema calcula o Preço de Venda quando eu informo a Margem de Lucro?
O GestãoPro adota o conceito financeiro correto de **Margem sobre a Venda (Margem Real)** e não markup simples.  
A fórmula aplicada é:  
$$\text{Preço de Venda} = \frac{\text{Preço de Custo}}{1 - \left(\frac{\text{Margem \%}}{100}\right)}$$  
*Exemplo:* Para um item com custo de R$ 50,00 e Margem de 40%, o Preço de Venda é R$ 83,33, resultando em um Lucro Bruto de R$ 33,33 (que representa exatamente 40% dos R$ 83,33 faturados). Caso você prefira basear sua precificação em Markup sobre o custo, basta preencher o campo Markup % que o sistema recalculará a margem equivalente automaticamente.

### 8. Como funciona a sincronização em nuvem se eu ativar o Firebase?
Quando as credenciais do Firebase Firestore são configuradas na aba de nuvem, o sistema passa a utilizar o **Padrão Outbox**: cada venda ou produto alterado é marcado na fila local `syncQueue`. Quando o computador tem acesso à internet, o motor de sincronização (`SyncEngine`) envia os lotes para o Firestore em segundo plano sem travar a tela. Se a internet cair, as operações acumulam na fila e são enviadas automaticamente assim que a conexão retornar.

---

## 7. Solução de Problemas (Troubleshooting)

| Sintoma Observado | Causa Comprovada / Provável | Evidência Técnica | Solução Segura |
| :--- | :--- | :--- | :--- |
| **Alerta azul do Windows SmartScreen ao abrir o instalador** | Ausência de certificado digital comercial corporativo pago no binário | Pacotes em `src-tauri/target/release/bundle/` compilados com chave de teste padrão | Verificar procedência do arquivo, clicar em "Mais informações" e selecionar "Executar assim mesmo". |
| **Tela em branco na inicialização da versão Desktop** | Componente Microsoft Edge WebView2 ausente, corrompido ou desatualizado no Windows | Configuração Tauri dependente do runtime WebView2 (`src-tauri/tauri.conf.json`) | Baixar e instalar o runtime oficial atualizado do Microsoft Edge WebView2 Evergreen diretamente no portal da Microsoft. |
| **Dados cadastrados sumiram após fechar o navegador (PWA)** | Acesso efetuado em Janela Anônima / Privada ou limpeza manual de dados do site | Políticas padrão do navegador descartam IndexedDB em modo anônimo | Evitar abrir o sistema em modo anônimo. Restaurar o último arquivo `.json` de backup gerado. |
| **Erro "Estoque insuficiente para o produto..." ao vender** | Regra de validação de estoque negativo ativa no sistema (`allowNegativeStock: false`) | Bloqueio atômico disparado em `SaleService.js:41-45` | Realizar a entrada física de estoque do produto ou habilitar "Permitir Estoque Negativo" em Configurações. |
| **Selo "Falha sync" no cabeçalho** | Credenciais do Firebase incorretas, regras de segurança do Firestore restritivas ou ausência de internet | Monitoramento da fila Outbox em `SyncEngine.js` e `FirebaseProvider.js` | Acessar Configurações ➔ Nuvem, clicar em "Testar Conexão", checar o Project ID/API Key e verificar as regras de segurança no console do Firebase. |
| **Caracteres acentuados estranhos ao abrir o CSV no Excel** | Excel configurado para abrir arquivos CSV em padrão diferente de UTF-8 | Tratamento de codificação em `ReportService.js:43-70` | O sistema já gera CSV com Windows-1252 / UTF-8 BOM. Utilize a opção "Exportar CSV" nativa do GestãoPro e abra com duplo clique no Excel. |
| **Saldos da tela de produtos diferentes da soma das movimentações** | Descompasso pontual decorrente de importações parciais ou interrupções de hardware | Rotina de integridade prevista em `StockService.recalculateAllStock` | Acessar a tela de Estoque (`#/estoque`) e clicar no botão "Auditar Saldo". O sistema somará todas as entradas e saídas do histórico e calibrará a base. |

---

## 8. Boas Práticas e Recomendações Operacionais

1. **Rotina de Backup Diária**: Ao encerrar o expediente de vendas, acesse Configurações e baixe o arquivo de backup `.json`. Guarde uma cópia fora do computador do caixa (ex.: em um pendrive ou nuvem corporativa).
2. **Auditoria Periódica de Saldos**: Uma vez por semana ou antes de emitir balanços contábeis, clique no botão **"Auditar Saldo"** na tela de Estoque para conferir a congruência matemática entre as vendas e os saldos físicos.
3. **Navegação Rápida W3C (PWA)**: Caso utilize o sistema como PWA instalado no Windows, você pode clicar com o botão direito do mouse no ícone do GestãoPro na barra de tarefas para abrir atalhos diretos para: *Painel de Controle*, *Registrar Venda (PDV)* ou *Consultar Estoque* (definidos em `public/manifest.json`).
4. **Nota Técnica sobre Atalhos de Teclado**: O sistema atualmente opera por interação gráfica através de cliques e navegação por teclado nos formulários padrão (tecla `Tab` para avançar campos e `Enter` para submeter). Não existem atalhos de combinação global (como `F1` ou `Ctrl+K`) mapeados no código-fonte nesta versão.

# Política de Segurança — GestãoPro

A segurança da informação, a privacidade de dados e a integridade de sistemas são pilares fundamentais no desenvolvimento do **GestãoPro**.

---

## 1. Escopo do Repositório Público

Este repositório é disponibilizado publicamente para fins de demonstração técnica, avaliação de engenharia de software e portfólio profissional.

- **Dados 100% Sintéticos**: Todos os produtos, clientes, fornecedores, números de documentos e valores financeiros exibidos na demonstração pública são fictícios e gerados programmaticamente por rotinas de seed (`src/js/demo/demoSeed.js`).
- **Ausência de Conexões com Ambientes de Produção**: A versão pública não se conecta a bancos de produção e utiliza provedores emulados em memória (`MockCloudProvider`) para simulação de sincronização em nuvem.
- **Zero Segredos**: Nenhuma chave privada, token administrativo, credencial de service account ou dado operacional real está incluído ou versionado neste repositório.

---

## 2. Como Reportar Vulnerabilidades

Caso você identifique uma potencial vulnerabilidade de segurança, falha de isolamento ou exposição acidental neste projeto:

1. **Não abra uma issue pública** contendo detalhes exploráveis da vulnerabilidade.
2. Utilize o recurso oficial de **Divulgação Privada de Vulnerabilidade (Private Vulnerability Reporting)** do GitHub diretamente na aba [Security / Advisories](https://github.com/wallacextreme/gerenciador-de-produtos/security/advisories/new) deste repositório.
3. Caso a opção de advisory privado não esteja habilitada, abra uma issue simples solicitando um canal de contato seguro para reporte de segurança, sem incluir o payload ou a prova de conceito pública.

Agradecemos o apoio da comunidade de segurança e nos comprometemos a analisar e tratar reportes responsáveis com prontidão.

---

## 3. Diretrizes para Contribuidores e Avaliadores

- **Nunca comite credenciais reais**: Arquivos `.env`, `.env.*` (com exceção de `.env.example`), certificados, chaves privadas e dumps de banco de dados estão explicitamente incluídos no `.gitignore`.
- **Prevenção de Segredos**: Nunca utilize dados reais de empresas, clientes ou parceiros em testes automatizados, fixtures ou documentações.
- **Armazenamento no Navegador**: Em ambientes PWA, o IndexedDB opera sob a política de mesma origem (*Same-Origin Policy*). Nenhuma credencial com privilégios de escrita irrestrita deve ser persistida sem criptografia ou controles de acesso adequados.

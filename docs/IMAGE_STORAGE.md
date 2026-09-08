# Arquitetura de Armazenamento de Imagens — GestãoPro

Este documento formaliza a avaliação arquitetural sobre o armazenamento de imagens de produtos no **GestãoPro**, comparando **IndexedDB**, **SQLite** e **Armazenamento em Sistema de Arquivos (Filesystem)** para os ambientes **Web**, **PWA** e **Desktop Tauri**.

---

## 1. Diagnóstico da Arquitetura Atual

A implementação atual do GestãoPro adota práticas modernas de processamento e isolamento de imagens no frontend:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Upload de Imagem (File / Drag & Drop / Clipboard Paste)               │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ImageService.js (Processamento e Otimização Local)                    │
│  - Decodificação via createImageBitmap / Fallback                      │
│  - Redimensionamento proporcional (OffscreenCanvas / Canvas)           │
│  - Compressão WebP Q0.85 (Max 1920px) -> Blob Principal (~250 KB)     │
│  - Compressão WebP Q0.70 (Max 320px) -> ThumbnailBlob (~20 KB)        │
│  - Fechamento de ImageBitmap (liberação imediata de memória GPU)       │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ProductImageRepository.js (Store Dedicada: productImages)             │
│  - Entidade desacoplada da store products                              │
│  - Chaves: id, productId, blob, thumbnailBlob, width, height, isPrimary│
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Consumo na Interface (Páginas e Componentes)                          │
│  - Listagens (Produtos, Estoque, PDV, Compras): consome ThumbnailBlob  │
│  - Detalhes do Produto / Edição: consome Blob Principal                │
│  - Ciclo de Vida: URL.createObjectURL() com URL.revokeObjectURL()      │
└────────────────────────────────────────────────────────────────────────┘
```

### Pontos Fortes da Arquitetura Atual:
1. **Desacoplamento de Stores**: A store `products` armazena apenas metadados textuais e numéricos rápidos ($O(1)$). As fotos ficam na store `productImages`, evitando overhead de leitura nas consultas do catálogo.
2. **Dupla Resolução Nativa**: Cada foto é armazenada com uma versão original otimizada (WebP 1920px) e uma versão de baixa latência (Thumbnail WebP 320px).
3. **Gestão Limpa de Memória**: O sistema revoga sistematicamente os Object URLs na desmontagem de views, impedindo vazamentos de memória na RAM.
4. **Independência de Backend**: 100% funcional offline em qualquer navegador moderno.

---

## 2. Cenários de Escala e Dimensionamento de Armazenamento

Considerando a compressão WebP do `ImageService`:
- **Thumbnail (320px WebP Q0.70)**: Média de **20 KB**.
- **Original Otimizada (1920px WebP Q0.85)**: Média de **250 KB**.
- **Total por Foto Armazenada**: Média de **~270 KB** (Thumbnail + Original).

Projeção para um catálogo com **3 imagens por produto**:

| Cenário | Produtos | Fotos Totais | Tamanho Médio (300 KB/foto) | Tamanho Médio (500 KB/foto) | Tamanho Médio (1 MB/foto) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pequeno Porte** | 500 | 1.500 | **~450 MB** | **~750 MB** | **~1.5 GB** |
| **Médio Porte** | 1.000 | 3.000 | **~900 MB** | **~1.5 GB** | **~3.0 GB** |
| **Grande Porte** | 5.000 | 15.000 | **~4.5 GB** | **~7.5 GB** | **~15.0 GB** |
| **Massivo (Enterprise)** | 10.000 | 30.000 | **~9.0 GB** | **~15.0 GB** | **~30.0 GB** |

---

## 3. Análise dos Limites Técnicos e Riscos

### A. Limites de Armazenamento no IndexedDB
- **Web / PWA**:
  - Os motores Chromium (Chrome, Edge) alocam até **60% do espaço livre em disco** para a origem.
  - Para persistência garantida, a API `navigator.storage.persist()` (já integrada em `src/js/utils/storage.js`) impede que o navegador descarte os dados sob pressão de armazenamento.
  - Para volumes de até 2.000 produtos (~1.8 GB), o IndexedDB opera com folga e excelente performance.
- **Desktop Tauri (WebView2)**:
  - O WebView2 mantém o IndexedDB no disco do usuário em `%LOCALAPPDATA%/<app_id>/EBWebView/`.
  - Não há restrição de quota arbitrária do navegador; o limite é o espaço físico do disco rígido/SSD.

### B. O Gargalo Real: Backup & Restauração Monolítica
- Ao realizar o backup em JSON, converter Blobs binários para strings Base64 gera um overhead de **+33%** no tamanho do arquivo.
- Um catálogo de 3.000 fotos (~900 MB) resultaria em um arquivo JSON de **~1.2 GB**.
- Tentar serializar ou fazer parse de uma string JSON única de 1.2 GB na memória JavaScript causará erro de `RangeError: Invalid string length` ou estouro de heap no motor V8.
- **Solução Arquitetural**:
  1. Manter a exportação atual para catálogos normais.
  2. Implementar opção de **Backup Leve** (apenas dados cadastrais e financeiros sem imagens) para transferências rápidas.
  3. Para catálogos massivos, implementar no futuro backup segmentado (JSON para dados + arquivo ZIP para imagens).

---

## 4. Comparativo de Soluções de Armazenamento

| Critério | Opção A: IndexedDB Puro (Atual) | Opção B: SQLite para Tudo | Opção C: Metadata no Banco + Filesystem Nativo (Tauri) |
| :--- | :--- | :--- | :--- |
| **Compatibilidade Web & PWA** | ⭐⭐⭐⭐⭐ Nativo e imediato | ❌ Requer SQLite-WASM pesado | ⭐⭐⭐⭐⭐ Fallback automático para IndexedDB |
| **Compatibilidade Tauri** | ⭐⭐⭐⭐⭐ Nativo via WebView2 | ⭐⭐⭐⭐ Requer binding Rust | ⭐⭐⭐⭐⭐ Arquivos salvos em pasta do app |
| **Armazenamento de Binários Grandes** | ⭐⭐⭐⭐ Eficiente via Blobs | ⚠️ BLOBs pesados degradam SQLite | ⭐⭐⭐⭐⭐ Leitura direta do disco via streaming |
| **Complexidade e Manutenção** | ⭐⭐⭐⭐⭐ Simples, testado (149 testes) | ❌ Reescrita de todos os repositórios | ⭐⭐⭐⭐ Abstração limpa na camada de storage |
| **Risco de Quebra / Regressão** | ✅ Zero | ❌ Altíssimo | ✅ Zero (aplicado progressivamente) |

---

## 5. Avaliação do SQLite

1. **O que o SQLite resolveria?**
   - No Tauri, permitiria queries relacionais complexas em SQL puro.
2. **O que o SQLite NÃO resolveria?**
   - **Armazenamento de Imagens**: Armazenar milhares de Blobs de 300KB–1MB em tabelas SQLite infla o arquivo do banco, causa fragmentação de páginas B-Tree e torna as operações de lock/vacuum extremamente lentas. As melhores práticas para SQLite recomendam armazenar apenas o caminho/metadado no banco e os arquivos de mídia no sistema de arquivos.
   - **Incompatibilidade Web**: O SQLite não roda nativamente no navegador sem carregar um binário WebAssembly de vários megabytes, o que prejudicaria o tempo de inicialização do PWA.
3. **Custo de Migração Imediata**: Injustificável no momento atual do projeto.

---

## 6. Arquitetura Recomendada

### Decisão Técnica: **Opção A com Preparação de Abstração para Opção C**

1. **Manter IndexedDB para a FASE 12**:
   - O IndexedDB atende plenamente aos requisitos de performance, resiliência offline e simplicidade para Web, PWA e Desktop Tauri.
   - O código existente é sólido, testado e desacoplado.
2. **Abstração Futura na Camada de Plataforma (`ImageStorageAdapter`)**:
   - Garantir que a UI obtenha a URL de exibição de imagens através de um helper padronizado (ex: `ImageService.resolveImageUrl(imageRecord)`).
   - No ambiente Web/PWA, esse helper resolve `URL.createObjectURL(imageRecord.blob)`.
   - No futuro, caso uma versão corporativa do Tauri necessite salvar dezenas de gigabytes de imagens no disco, o adapter poderá salvar arquivos em `%APPDATA%/gestaopro/images/<id>.webp` e resolver caminhos de arquivo locais, sem alterar nenhuma linha da interface ou das regras de negócio.

---

## 7. Monitoramento de Quota no Painel de Configurações

Para oferecer transparência operacional ao usuário, podemos expor na tela de Configurações (`#/configuracoes`):
- `navigator.storage.estimate()`: Espaço em disco utilizado vs quota total disponível.
- Indicador visual do volume estimado ocupado pelo catálogo e fotos.
- Status do armazenamento persistente (`navigator.storage.persisted()`).

---

## 8. Conclusão

- **A arquitetura atual baseada em IndexedDB é adequada, robusta e escalável para o escopo do GestãoPro.**
- **Nenhuma migração para SQLite é recomendada ou necessária nesta fase.**
- **A FASE 12 (Tauri + Windows EXE + MSI) pode prosseguir com segurança total utilizando a persistência IndexedDB nativa do WebView2.**

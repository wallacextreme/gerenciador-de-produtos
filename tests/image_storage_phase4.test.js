import { describe, it, expect, beforeEach } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { ImageStorageProvider } from '../src/js/sync/ImageStorageProvider.js';
import { MockImageStorageProvider } from '../src/js/sync/MockImageStorageProvider.js';
import { FirebaseStorageProvider } from '../src/js/sync/FirebaseStorageProvider.js';
import { CloudinaryImageProvider } from '../src/js/sync/CloudinaryImageProvider.js';

describe('Image Storage Strategy — Provedores e Gestão de Mídia Remota (PHASE 04)', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = new MockImageStorageProvider({
      tenantId: 'tenant_loja_01',
      maxSizeBytes: 5 * 1024 * 1024 // 5MB para teste
    });
  });

  // Helper para criar Blob de teste
  const createTestBlob = (content = 'fake_webp_bytes', mimeType = 'image/webp') => {
    return new Blob([content], { type: mimeType });
  };

  describe('IMG-01: Inicialização do Provedor', () => {
    it('deve inicializar MockImageStorageProvider, FirebaseStorageProvider e CloudinaryImageProvider', () => {
      expect(mockStorage).toBeInstanceOf(ImageStorageProvider);
      expect(mockStorage.getProviderName()).toBe('MockImageStorageProvider');
      expect(mockStorage.isConfigured()).toBe(true);

      const fbStorage = new FirebaseStorageProvider({
        storageBucket: 'gestaopro-demo.appspot.com',
        projectId: 'gestaopro-demo'
      });
      expect(fbStorage).toBeInstanceOf(ImageStorageProvider);
      expect(fbStorage.getProviderName()).toBe('Firebase Cloud Storage');
      expect(fbStorage.isConfigured()).toBe(true);

      const cloudStorage = new CloudinaryImageProvider({
        cloudName: 'demo-cloud',
        uploadPreset: 'gestaopro_preset'
      });
      expect(cloudStorage).toBeInstanceOf(ImageStorageProvider);
      expect(cloudStorage.getProviderName()).toBe('Cloudinary Image Storage');
      expect(cloudStorage.isConfigured()).toBe(true);
    });

    it('ImageStorageProvider base deve lançar erro se métodos abstratos forem chamados diretamente', async () => {
      const base = new ImageStorageProvider();
      expect(base.getProviderName()).toBe('BaseImageStorageProvider');
      expect(base.isConfigured()).toBe(false);

      expect(base.upload(null)).rejects.toThrow('deve ser implementado');
      expect(base.replace('id', null)).rejects.toThrow('deve ser implementado');
      expect(base.delete('id')).rejects.toThrow('deve ser implementado');
      expect(() => base.getUrl('id')).toThrow('deve ser implementado');
      expect(base.getMetadata('id')).rejects.toThrow('deve ser implementado');
      expect(base.exists('id')).rejects.toThrow('deve ser implementado');
    });
  });

  describe('IMG-02: Upload Bem-Sucedido', () => {
    it('deve enviar Blob e retornar registro com photoId, url, hash SHA-256 e versão 1', async () => {
      const blob = createTestBlob('imagem_produto_cafe_1080p');
      const res = await mockStorage.upload(blob, {
        productId: 'prod_cafe_gourmet',
        label: 'Foto Principal da Embalagem'
      });

      expect(res).toBeDefined();
      expect(res.photoId).toBeDefined();
      expect(res.url).toContain(res.photoId);
      expect(res.version).toBe(1);
      expect(res.hash).toBeDefined();
      expect(typeof res.hash).toBe('string');
      expect(res.sizeBytes).toBe(blob.size);
      expect(res.mimeType).toBe('image/webp');
      expect(res.uploadedAt).toBeDefined();
    });
  });

  describe('IMG-03: Upload Inválido (Blob Nulo)', () => {
    it('deve rejeitar tentativa de upload sem blob de imagem', async () => {
      expect(mockStorage.upload(null, { productId: 'p1' })).rejects.toThrow('Blob de imagem é obrigatório');
      expect(mockStorage.upload(undefined, { productId: 'p1' })).rejects.toThrow('Blob de imagem é obrigatório');
    });
  });

  describe('IMG-04: Tamanho Inválido (Excedendo Limite Máximo)', () => {
    it('deve rejeitar arquivo que exceda o tamanho máximo configurado', async () => {
      // Cria blob simulando 6MB (limite configurado no beforeEach: 5MB)
      const bigBlob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/webp' });

      expect(mockStorage.upload(bigBlob, { productId: 'p1' })).rejects.toThrow('excede o limite máximo permitido');
    });
  });

  describe('IMG-05: MIME Type Inválido', () => {
    it('deve rejeitar arquivos que não sejam imagens válidas', async () => {
      const pdfBlob = new Blob(['%PDF-1.4 fake pdf'], { type: 'application/pdf' });
      expect(mockStorage.upload(pdfBlob, { productId: 'p1' })).rejects.toThrow('Tipo de arquivo não permitido');

      const exeBlob = new Blob(['MZ fake exe'], { type: 'application/x-msdownload' });
      expect(mockStorage.upload(exeBlob, { productId: 'p1' })).rejects.toThrow('Tipo de arquivo não permitido');
    });
  });

  describe('IMG-06: Consulta de Metadados (getMetadata)', () => {
    it('deve retornar metadados completos da imagem armazenada', async () => {
      const blob = createTestBlob('dados_imagem_mouse');
      const uploadRes = await mockStorage.upload(blob, {
        productId: 'prod_mouse_01',
        label: 'Visão Superior',
        isPrimary: true
      });

      const meta = await mockStorage.getMetadata(uploadRes.photoId);
      expect(meta).toBeDefined();
      expect(meta.photoId).toBe(uploadRes.photoId);
      expect(meta.productId).toBe('prod_mouse_01');
      expect(meta.label).toBe('Visão Superior');
      expect(meta.isPrimary).toBe(true);
      expect(meta.sizeBytes).toBe(blob.size);
    });
  });

  describe('IMG-07: Resolução de URL (getUrl)', () => {
    it('deve retornar a URL pública/CDN correta para a imagem', async () => {
      const blob = createTestBlob('imagem_url_check');
      const uploadRes = await mockStorage.upload(blob, { productId: 'p_url' });

      const url = mockStorage.getUrl(uploadRes.photoId);
      expect(url).toBe(uploadRes.url);
      expect(url).toContain('https://');
    });
  });

  describe('IMG-08: Substituição de Imagem (replace)', () => {
    it('deve substituir imagem incrementando a versão e recalculando o hash', async () => {
      const blobV1 = createTestBlob('foto_antiga_angulo_1');
      const uploadV1 = await mockStorage.upload(blobV1, { productId: 'prod_teclado' });
      expect(uploadV1.version).toBe(1);

      const blobV2 = createTestBlob('foto_nova_alta_resolucao');
      const uploadV2 = await mockStorage.replace(uploadV1.photoId, blobV2);

      expect(uploadV2.photoId).toBe(uploadV1.photoId);
      expect(uploadV2.version).toBe(2);
      expect(uploadV2.hash).not.toBe(uploadV1.hash);

      const meta = await mockStorage.getMetadata(uploadV1.photoId);
      expect(meta.version).toBe(2);
    });
  });

  describe('IMG-09: Exclusão de Imagem (delete)', () => {
    it('deve remover fisicamente a imagem remota e retornar false em exists', async () => {
      const blob = createTestBlob('foto_para_deletar');
      const res = await mockStorage.upload(blob, { productId: 'prod_delete' });

      expect(await mockStorage.exists(res.photoId)).toBe(true);

      const deleted = await mockStorage.delete(res.photoId);
      expect(deleted).toBe(true);

      expect(await mockStorage.exists(res.photoId)).toBe(false);
      expect(await mockStorage.getMetadata(res.photoId)).toBeNull();
    });
  });

  describe('IMG-10: Tratamento de Arquivo Inexistente (Not Found)', () => {
    it('deve retornar null em getMetadata e false em delete para ID inexistente', async () => {
      expect(await mockStorage.getMetadata('photo_fantasma')).toBeNull();
      expect(await mockStorage.delete('photo_fantasma')).toBe(false);
      expect(await mockStorage.exists('photo_fantasma')).toBe(false);
    });
  });

  describe('IMG-11: Simulação de Timeout / Falha de Rede', () => {
    it('deve capturar e propagar erro quando o serviço de storage falhar', async () => {
      mockStorage.setShouldFail(true, 'Conexão interrompida com o servidor de fotos', 'TIMEOUT');

      const blob = createTestBlob('foto_teste_timeout');
      expect(mockStorage.upload(blob, { productId: 'p1' })).rejects.toThrow('Conexão interrompida');
    });
  });

  describe('IMG-12: Recuperação e Retry após Falha Temporária', () => {
    it('deve permitir novo upload após falha temporária e concluir com sucesso', async () => {
      const blob = createTestBlob('foto_teste_retry');

      // 1. Simula falha temporária
      mockStorage.setShouldFail(true, 'Erro temporário de CDN', 'NETWORK_ERR');
      expect(mockStorage.upload(blob, { productId: 'p1' })).rejects.toThrow();

      // 2. Restaura serviço e retenta
      mockStorage.setShouldFail(false);
      const res = await mockStorage.upload(blob, { productId: 'p1' });

      expect(res.photoId).toBeDefined();
      expect(await mockStorage.exists(res.photoId)).toBe(true);
    });
  });

  describe('IMG-13: Isolamento do Mock Storage em Memória', () => {
    it('mockStorage deve executar instantaneamente sem gerar requisições de rede reais', async () => {
      const start = Date.now();
      const blob = createTestBlob('conteudo_rapido');
      const res = await mockStorage.upload(blob, { productId: 'p1' });

      expect(Date.now() - start).toBeLessThan(100);
      expect(res.photoId).toBeDefined();
    });
  });

  describe('IMG-14: Integridade e Cálculo de Checksum SHA-256', () => {
    it('mesmo binário deve gerar o mesmo hash SHA-256 e binários distintos devem divergir', async () => {
      const blobA = createTestBlob('conteudo_exato_123');
      const resA1 = await mockStorage.upload(blobA, { productId: 'pA1' });

      mockStorage.clear();
      const resA2 = await mockStorage.upload(blobA, { productId: 'pA2' });

      expect(resA1.hash).toBe(resA2.hash);

      const blobB = createTestBlob('conteudo_diferente_456');
      const resB = await mockStorage.upload(blobB, { productId: 'pB' });

      expect(resA1.hash).not.toBe(resB.hash);
    });
  });

  describe('IMG-15: Versionamento Sequencial de Ativos', () => {
    it('substituições consecutivas devem incrementar monotonicamente a versão', async () => {
      const resV1 = await mockStorage.upload(createTestBlob('v1'), { productId: 'p_seq' });
      expect(resV1.version).toBe(1);

      const resV2 = await mockStorage.replace(resV1.photoId, createTestBlob('v2'));
      expect(resV2.version).toBe(2);

      const resV3 = await mockStorage.replace(resV1.photoId, createTestBlob('v3'));
      expect(resV3.version).toBe(3);
    });
  });

  describe('IMG-16: Isolamento Multi-Tenant por Caminho (Tenant Path)', () => {
    it('o remotePath gerado deve isolar o diretório do tenant', async () => {
      mockStorage = new MockImageStorageProvider({ tenantId: 'tenant_filial_sp' });

      const res = await mockStorage.upload(createTestBlob('foto_sp'), { productId: 'p_sp' });
      expect(res.remotePath).toContain('tenants/tenant_filial_sp/');
    });
  });

  describe('IMG-17: Associação de Diretório por Produto (Product Path)', () => {
    it('o remotePath gerado deve agrupar fotos sob o ID do produto', async () => {
      const res = await mockStorage.upload(createTestBlob('foto_prod_xyz'), {
        productId: 'prod_smartphone_5g'
      });
      expect(res.remotePath).toContain('/products/prod_smartphone_5g/');
    });
  });

  describe('IMG-18: Upload Idempotente / Consistência', () => {
    it('upload com photoId explícito sobrescreve o registro de forma controlada', async () => {
      const photoIdFixo = 'photo_custom_uuid_777';
      const res1 = await mockStorage.upload(createTestBlob('dados_1'), {
        photoId: photoIdFixo,
        productId: 'p_dup'
      });
      expect(res1.photoId).toBe(photoIdFixo);

      const res2 = await mockStorage.upload(createTestBlob('dados_2'), {
        photoId: photoIdFixo,
        productId: 'p_dup'
      });
      expect(res2.photoId).toBe(photoIdFixo);
      expect(mockStorage.storage.size).toBe(1);
    });
  });

  describe('IMG-19: Proteção de Sobrescrita em Replace', () => {
    it('replace deve falhar se o photoId fornecido não existir previamente no storage', async () => {
      expect(mockStorage.replace('photo_inexistente', createTestBlob('conteudo'))).rejects.toThrow(
        'não encontrada para substituição'
      );
    });
  });

  describe('IMG-20: Limite de Segurança e Regras Declarativas (storage.rules)', () => {
    it('arquivo storage.rules deve existir e aplicar regras por tenant e limites de tamanho', () => {
      const rulesPath = join(process.cwd(), 'storage.rules');
      expect(existsSync(rulesPath)).toBe(true);

      const content = readFileSync(rulesPath, 'utf-8');
      expect(content).toContain('rules_version = \'2\';');
      expect(content).toContain('request.auth != null');
      expect(content).toContain('request.auth.token.tenantId == tenantId');
      expect(content).toContain('request.resource.size < 10 * 1024 * 1024');
      expect(content).toContain('request.resource.contentType.matches(\'image/.*\')');
    });
  });
});

/**
 * GestãoPro — Contrato Abstrato de Provedor de Armazenamento de Imagens (PHASE 04)
 * Define a interface padrão para qualquer backend de fotos (Firebase Storage, Cloudinary, Supabase, Mock).
 */
export class ImageStorageProvider {
  /**
   * Nome identificador do provedor.
   * @returns {string}
   */
  getProviderName() {
    return 'BaseImageStorageProvider';
  }

  /**
   * Verifica se o provedor possui credenciais/configurações válidas.
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * Faz upload de uma imagem binária (Blob) para o armazenamento remoto.
   * @param {Blob|File} blob Binário comprimido (preferencialmente WebP)
   * @param {Object} metadata Metadados do ativo
   * @param {string} metadata.productId ID do produto proprietário
   * @param {string} [metadata.photoId] ID único da foto (ou gerado automaticamente)
   * @param {string} [metadata.tenantId] ID do tenant da empresa
   * @param {string} [metadata.label] Rótulo da foto (ex: 'Foto Principal')
   * @param {number} [metadata.version] Versão sequencial da foto
   * @param {string} [metadata.hash] Checksum SHA-256
   * @returns {Promise<{ photoId: string, url: string, remotePath: string, version: number, hash: string, sizeBytes: number, mimeType: string, uploadedAt: string }>}
   */
  async upload(blob, metadata = {}) {
    throw new Error('upload() deve ser implementado pela subclasse.');
  }

  /**
   * Substitui uma foto existente, incrementando a versão e atualizando o hash.
   * @param {string} photoId 
   * @param {Blob|File} blob 
   * @param {Object} metadata 
   * @returns {Promise<Object>}
   */
  async replace(photoId, blob, metadata = {}) {
    throw new Error('replace() deve ser implementado pela subclasse.');
  }

  /**
   * Remove fisicamente a imagem do armazenamento remoto.
   * @param {string} photoId 
   * @param {string} [remotePath] Caminho relativo ou URL remota
   * @returns {Promise<boolean>}
   */
  async delete(photoId, remotePath = '') {
    throw new Error('delete() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna a URL pública/CDN para acesso direto à imagem.
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<string>|string}
   */
  getUrl(photoId, remotePath = '') {
    throw new Error('getUrl() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna metadados técnicos do arquivo remoto (tamanho, content-type, timestamps).
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<Object|null>}
   */
  async getMetadata(photoId, remotePath = '') {
    throw new Error('getMetadata() deve ser implementado pela subclasse.');
  }

  /**
   * Baixa o Blob da imagem a partir do armazenamento remoto.
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<Blob>}
   */
  async download(photoId, remotePath = '') {
    throw new Error('download() deve ser implementado pela subclasse.');
  }

  /**
   * Verifica se o arquivo existe no armazenamento remoto.
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<boolean>}
   */
  async exists(photoId, remotePath = '') {
    throw new Error('exists() deve ser implementado pela subclasse.');
  }
}

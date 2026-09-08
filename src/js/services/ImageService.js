/**
 * Application Service para processamento local de imagens.
 * Gerencia validação, decodificação, redimensionamento proporcional,
 * compressão WebP/JPEG e geração de thumbnails otimizados para IndexedDB.
 */
export class ImageService {
  static MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

  /**
   * Processa um arquivo/Blob de imagem e retorna o Blob comprimido e seu Thumbnail.
   * @param {File|Blob} file 
   * @returns {Promise<{blob: Blob, thumbnailBlob: Blob, width: number, height: number, mimeType: string, sizeBytes: number}>}
   */
  static async processImage(file) {
    // 1. Validações preliminares
    if (!file || (!file.type.startsWith('image/') && !file.name?.match(/\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i))) {
      throw new Error('O arquivo selecionado não é uma imagem válida.');
    }

    if (file.size > this.MAX_FILE_SIZE_BYTES) {
      const maxMb = (this.MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(`A imagem selecionada excede o limite máximo permitido de ${maxMb}MB.`);
    }

    // 2. Extrair ImageBitmap ou Carregar via Fallback
    let bitmap;
    try {
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(file);
      } else {
        bitmap = await this._fallbackLoadImage(file);
      }
    } catch (e) {
      bitmap = await this._fallbackLoadImage(file);
    }

    // 3. Processar Imagem Principal (Max 1920px, Qualidade 0.85)
    const { blob: mainBlob, width: mainW, height: mainH } = await this._resizeAndCompress(bitmap, 1920, 0.85);

    // 4. Processar Thumbnail (Max 320px, Qualidade 0.70)
    const { blob: thumbBlob } = await this._resizeAndCompress(bitmap, 320, 0.70);

    // Fechar bitmap se o método existir para liberar memória GPU/RAM imediatamente
    if (bitmap.close) {
      try { bitmap.close(); } catch (err) {}
    }

    return {
      blob: mainBlob,
      thumbnailBlob: thumbBlob,
      width: mainW,
      height: mainH,
      mimeType: mainBlob.type,
      sizeBytes: mainBlob.size
    };
  }

  /**
   * Redimensiona mantendo aspect ratio e comprime para WebP (com fallback para JPEG).
   */
  static async _resizeAndCompress(bitmap, maxSize, quality) {
    let width = bitmap.width;
    let height = bitmap.height;

    if (width > maxSize || height > maxSize) {
      if (width > height) {
        height = Math.round((height * maxSize) / width);
        width = maxSize;
      } else {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }
    }

    // Evitar dimensões menores que 1px
    width = Math.max(1, width);
    height = Math.max(1, height);

    let canvas;
    let ctx;

    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d');
      } catch (e) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d');
      }
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext('2d');
    }

    // Preencher fundo branco caso a imagem original tenha transparência para JPEG
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    let finalBlob = null;

    if (canvas.convertToBlob) {
      // OffscreenCanvas API
      try {
        finalBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
      } catch (e) {
        finalBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      }
    } else {
      // HTMLCanvasElement API
      finalBlob = await new Promise(resolve => {
        canvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            canvas.toBlob(resolve, 'image/jpeg', quality);
          }
        }, 'image/webp', quality);
      });
    }

    if (!finalBlob) {
      throw new Error('Falha ao processar e comprimir a imagem.');
    }

    return { blob: finalBlob, width, height };
  }

  static _fallbackLoadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível decodificar o arquivo de imagem. Formato corrompido ou incompatível.'));
      };
      img.src = url;
    });
  }

  /**
   * Extrai arquivos de imagem de um evento de colar do Clipboard.
   * @param {ClipboardEvent} clipboardEvent 
   * @returns {File[]}
   */
  static extractImagesFromClipboard(clipboardEvent) {
    const items = clipboardEvent.clipboardData?.items;
    if (!items) return [];

    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }
}

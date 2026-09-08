import { CloudProvider } from './CloudProvider.js';

/**
 * GestãoPro — Firebase Firestore Cloud Provider (FASE 13)
 * Integração robusta e desacoplada com Google Firebase Firestore utilizando REST API nativa.
 * Não requer SDKs pesados de terceiros, operando com máxima performance em Web, PWA e Tauri.
 */
export class FirebaseProvider extends CloudProvider {
  constructor(config = null) {
    super();
    this.config = config || {
      apiKey: '',
      projectId: '',
      authDomain: '',
      appId: ''
    };
  }

  getProviderName() {
    return 'Firebase Firestore';
  }

  isConfigured() {
    return !!(this.config && this.config.apiKey && this.config.projectId);
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig() {
    return { ...this.config };
  }

  /**
   * Converte um objeto JavaScript plano para a estrutura de campos do Firestore REST API.
   * @param {Object} data 
   * @returns {Object} { fields: { ... } }
   */
  _encodeFirestoreDocument(data) {
    const fields = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('_')) continue; // Ignora campos de controle interno
      if (value === null || value === undefined) {
        fields[key] = { nullValue: null };
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fields[key] = { integerValue: String(value) };
        } else {
          fields[key] = { doubleValue: value };
        }
      } else if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (value instanceof Date) {
        fields[key] = { timestampValue: value.toISOString() };
      } else if (Array.isArray(value)) {
        fields[key] = {
          arrayValue: {
            values: value.map(v => typeof v === 'object' ? { stringValue: JSON.stringify(v) } : { stringValue: String(v) })
          }
        };
      } else if (typeof value === 'object') {
        fields[key] = { stringValue: JSON.stringify(value) };
      }
    }
    return { fields };
  }

  /**
   * Converte a estrutura de campos do Firestore REST API de volta para um objeto JavaScript plano.
   * @param {Object} doc { name, fields, createTime, updateTime }
   * @returns {Object}
   */
  _decodeFirestoreDocument(doc) {
    if (!doc || !doc.fields) return {};
    const result = {};
    for (const [key, valObj] of Object.entries(doc.fields)) {
      if ('stringValue' in valObj) {
        try {
          // Tenta parse de JSON se for objeto serializado
          if (valObj.stringValue.startsWith('{') || valObj.stringValue.startsWith('[')) {
            result[key] = JSON.parse(valObj.stringValue);
          } else {
            result[key] = valObj.stringValue;
          }
        } catch {
          result[key] = valObj.stringValue;
        }
      } else if ('integerValue' in valObj) {
        result[key] = parseInt(valObj.integerValue, 10);
      } else if ('doubleValue' in valObj) {
        result[key] = parseFloat(valObj.doubleValue);
      } else if ('booleanValue' in valObj) {
        result[key] = valObj.booleanValue;
      } else if ('timestampValue' in valObj) {
        result[key] = valObj.timestampValue;
      } else if ('nullValue' in valObj) {
        result[key] = null;
      } else if ('arrayValue' in valObj) {
        result[key] = (valObj.arrayValue.values || []).map(v => v.stringValue || v.integerValue || v);
      }
    }
    return result;
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Firebase não configurado. Informe API Key e Project ID nas configurações.'
      };
    }

    const startTime = Date.now();
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents?pageSize=1&key=${encodeURIComponent(this.config.apiKey)}`;
      const response = await fetch(url, { method: 'GET' });
      const latencyMs = Date.now() - startTime;

      if (response.ok || response.status === 404) {
        return {
          success: true,
          message: 'Conexão com Firebase Firestore estabelecida com sucesso.',
          latencyMs
        };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          message: errorData.error?.message || `Erro HTTP ${response.status} ao conectar com Firebase.`,
          latencyMs
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `Falha de rede ou timeout: ${err.message}`
      };
    }
  }

  async pushChange(changeItem) {
    if (!this.isConfigured()) {
      throw new Error('Firebase não configurado com Project ID e API Key.');
    }

    const { entityType, entityId, action, payload } = changeItem;
    const documentPath = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?key=${encodeURIComponent(this.config.apiKey)}`;

    if (action === 'DELETE') {
      const response = await fetch(documentPath, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Erro ao deletar documento no Firestore (${response.status})`);
      }
      return { success: true, remoteId: entityId };
    }

    // CREATE ou UPDATE -> PATCH no Firestore REST (cria se não existir)
    const firestoreDoc = this._encodeFirestoreDocument({
      ...payload,
      id: entityId,
      _syncedAt: new Date().toISOString()
    });

    const response = await fetch(documentPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firestoreDoc)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Erro ao salvar documento no Firestore (${response.status})`);
    }

    const responseData = await response.json();
    return {
      success: true,
      remoteId: entityId,
      remoteVersion: responseData.updateTime || new Date().toISOString()
    };
  }

  async pullChanges(entityType, sinceTimestamp = null) {
    if (!this.isConfigured()) {
      throw new Error('Firebase não configurado com Project ID e API Key.');
    }

    const collectionUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/${encodeURIComponent(entityType)}?key=${encodeURIComponent(this.config.apiKey)}`;

    const response = await fetch(collectionUrl, { method: 'GET' });
    if (!response.ok) {
      if (response.status === 404) {
        return { items: [], latestTimestamp: new Date().toISOString() };
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Erro ao buscar documentos no Firestore (${response.status})`);
    }

    const data = await response.json();
    const rawDocuments = data.documents || [];
    let items = rawDocuments.map(doc => this._decodeFirestoreDocument(doc));

    if (sinceTimestamp) {
      const sinceDate = new Date(sinceTimestamp);
      items = items.filter(doc => new Date(doc.updatedAt || doc.createdAt || 0) > sinceDate);
    }

    return {
      items,
      latestTimestamp: new Date().toISOString()
    };
  }
}

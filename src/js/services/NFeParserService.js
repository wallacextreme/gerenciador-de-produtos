/**
 * Serviço responsável por receber uma string XML, fazer o parsing e
 * normalizar os dados da NFe para o formato interno do ERP.
 * Utiliza DOMParser nativo.
 */
export class NFeParserService {
  /**
   * Faz o parse do XML e retorna a NFe normalizada.
   * Lança erro caso o XML seja inválido ou não seja uma NFe reconhecida.
   * @param {string} xmlString 
   * @returns {Object} Dados normalizados da NFe
   */
  static parse(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    // 1. Validar parsererror
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Falha ao interpretar o XML. O arquivo está malformado ou corrompido.');
    }

    // 2. Localizar raiz (NFe ou nfeProc)
    // Utilizamos localName para contornar namespaces como <nfe:NFe>
    let nfeElement = this._findElement(doc, 'NFe');
    if (!nfeElement) {
      throw new Error('Documento não reconhecido como NFe válida. Tag raiz não encontrada.');
    }

    const infNFe = this._findElement(nfeElement, 'infNFe');
    if (!infNFe) {
      throw new Error('Estrutura da NFe inválida: tag <infNFe> não encontrada.');
    }

    // 3. Extrair dados fiscais (cStat, dhRecbto, etc - presentes em protNFe)
    const protNFe = this._findElement(doc, 'protNFe');
    const infProt = protNFe ? this._findElement(protNFe, 'infProt') : null;
    const cStat = infProt ? this._getText(infProt, 'cStat') : null;
    const xMotivo = infProt ? this._getText(infProt, 'xMotivo') : null;

    // 4. Extrair Cabeçalho (ide)
    const ide = this._findElement(infNFe, 'ide');
    if (!ide) throw new Error('Estrutura da NFe inválida: tag <ide> não encontrada.');

    // Chave de Acesso extraída do ID (ex: "NFe3520...")
    let chaveAcesso = infNFe.getAttribute('Id') || '';
    if (chaveAcesso.startsWith('NFe')) {
      chaveAcesso = chaveAcesso.substring(3);
    }

    const cabecalho = {
      chaveAcesso,
      numero: this._getText(ide, 'nNF'),
      serie: this._getText(ide, 'serie'),
      modelo: this._getText(ide, 'mod'),
      dataEmissao: this._getText(ide, 'dhEmi') || this._getText(ide, 'dEmi'),
      naturezaOperacao: this._getText(ide, 'natOp'),
      tipoOperacao: this._getText(ide, 'tpNF') // 0 = Entrada, 1 = Saída
    };

    // 5. Extrair Emitente
    const emit = this._findElement(infNFe, 'emit');
    if (!emit) throw new Error('Estrutura da NFe inválida: tag <emit> não encontrada.');

    const emitente = {
      cnpj: this._getText(emit, 'CNPJ') || this._getText(emit, 'CPF'),
      razaoSocial: this._getText(emit, 'xNome'),
      nomeFantasia: this._getText(emit, 'xFant'),
      inscricaoEstadual: this._getText(emit, 'IE')
    };

    // 6. Extrair Destinatário
    const dest = this._findElement(infNFe, 'dest');
    const destinatario = dest ? {
      cnpj: this._getText(dest, 'CNPJ') || this._getText(dest, 'CPF'),
      razaoSocial: this._getText(dest, 'xNome'),
      inscricaoEstadual: this._getText(dest, 'IE')
    } : null;

    // 7. Extrair Itens (det)
    const itens = [];
    const detElements = this._findElements(infNFe, 'det');
    
    detElements.forEach((det, index) => {
      const prod = this._findElement(det, 'prod');
      if (prod) {
        // vUnCom (Valor Unitário) e vProd (Valor Produto) e qCom (Quantidade)
        const qCom = this._getFloat(prod, 'qCom');
        const vUnCom = this._getFloat(prod, 'vUnCom');
        const vProd = this._getFloat(prod, 'vProd');
        const vFrete = this._getFloat(prod, 'vFrete');
        const vDesc = this._getFloat(prod, 'vDesc');
        const vOutro = this._getFloat(prod, 'vOutro');

        itens.push({
          numeroItem: det.getAttribute('nItem') || (index + 1).toString(),
          codigoFornecedor: this._getText(prod, 'cProd'),
          ean: this._getText(prod, 'cEAN') !== 'SEM GTIN' ? this._getText(prod, 'cEAN') : '',
          descricao: this._getText(prod, 'xProd'),
          ncm: this._getText(prod, 'NCM'),
          cfop: this._getText(prod, 'CFOP'),
          unidade: this._getText(prod, 'uCom'),
          quantidade: qCom,
          valorUnitario: vUnCom,
          valorTotal: vProd,
          desconto: vDesc,
          frete: vFrete,
          outros: vOutro,
          
          // Propriedades resolvidas posteriormente no Motor De-Para
          idProdutoInterno: null,
          fatorConversao: 1,
          statusDePara: 'PENDING'
        });
      }
    });

    // 8. Extrair Totais
    const total = this._findElement(infNFe, 'total');
    const icmsTot = total ? this._findElement(total, 'ICMSTot') : null;
    const totais = icmsTot ? {
      valorProdutos: this._getFloat(icmsTot, 'vProd'),
      valorDesconto: this._getFloat(icmsTot, 'vDesc'),
      valorFrete: this._getFloat(icmsTot, 'vFrete'),
      valorOutros: this._getFloat(icmsTot, 'vOutro'),
      valorTotalNota: this._getFloat(icmsTot, 'vNF')
    } : {};

    // 9. Status Fiscal
    const statusFiscal = {
      cStat,
      xMotivo
    };

    return {
      cabecalho,
      emitente,
      destinatario,
      itens,
      totais,
      statusFiscal,
      xmlOriginal: xmlString
    };
  }

  /**
   * Helper para encontrar um elemento independente do namespace (usando localName).
   * @param {Element|Document} parent 
   * @param {string} localName 
   * @returns {Element|null}
   */
  static _findElement(parent, localName) {
    if (!parent) return null;
    const children = parent.children || (parent.documentElement ? [parent.documentElement] : []);
    for (let i = 0; i < children.length; i++) {
      if (children[i].localName === localName) {
        return children[i];
      }
      // Buscar também no primeiro nível dos filhos
      const found = this._findElement(children[i], localName);
      if (found) return found;
    }
    
    // Fallback lento caso não esteja logo na raiz ou seja documento inteiro
    const all = parent.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === localName) return all[i];
    }
    return null;
  }

  /**
   * Helper para encontrar todos os elementos com determinado localName filhos do parent.
   */
  static _findElements(parent, localName) {
    const results = [];
    if (!parent) return results;
    const all = parent.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === localName) {
        results.push(all[i]);
      }
    }
    return results;
  }

  /**
   * Retorna o textContent de uma tag filha (localName).
   */
  static _getText(parent, localName) {
    if (!parent) return '';
    const el = this._findElement(parent, localName);
    return el ? (el.textContent || '').trim() : '';
  }

  /**
   * Extrai o float (em XML os números usam '.')
   */
  static _getFloat(parent, localName) {
    const text = this._getText(parent, localName);
    if (!text) return 0;
    const val = parseFloat(text);
    return isNaN(val) ? 0 : val;
  }
}

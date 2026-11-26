// Leitor simples de .xlsx (primeira aba) usando JSZip + DOMParser.
// Sem dependências externas além do JSZip.
(function (g) {
  'use strict';
  const MAX_BYTES = 15 * 1024 * 1024;

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function tags(no, nome) { return Array.from(no.getElementsByTagNameNS('*', nome)); }
  function textoDe(no) { return tags(no, 't').map(function (t) { return t.textContent; }).join(''); }

  async function lerPlanilha(arrayBuffer) {
    if (arrayBuffer.byteLength > MAX_BYTES) throw new Error('Arquivo grande demais.');
    const zip = await g.JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();
    const xml = async function (caminho) {
      const f = zip.file(caminho);
      if (!f) return null;
      const txt = await f.async('string');
      if (txt.length > 40 * 1024 * 1024) throw new Error('Planilha grande demais.');
      return parser.parseFromString(txt, 'application/xml');
    };

    // descobre a primeira aba
    let caminhoAba = 'xl/worksheets/sheet1.xml';
    const wb = await xml('xl/workbook.xml');
    const rels = await xml('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const primeira = tags(wb, 'sheet')[0];
      if (primeira) {
        const rid = primeira.getAttribute('r:id') || primeira.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const rel = tags(rels, 'Relationship').find(function (r) { return r.getAttribute('Id') === rid; });
        if (rel) {
          let alvo = rel.getAttribute('Target');
          alvo = alvo.charAt(0) === '/' ? alvo.slice(1) : 'xl/' + alvo;
          caminhoAba = alvo.replace(/\/\.\//g, '/');
        }
      }
    }

    const ss = await xml('xl/sharedStrings.xml');
    const compartilhadas = ss ? tags(ss, 'si').map(textoDe) : [];
    const aba = await xml(caminhoAba);
    if (!aba) throw new Error('Não encontrei a planilha dentro do arquivo.');
    if (tags(aba, 'parsererror').length) throw new Error('Arquivo de planilha inválido.');

    const linhas = [];
    tags(aba, 'row').forEach(function (row) {
      const r = Number(row.getAttribute('r')) - 1;
      const linha = [];
      tags(row, 'c').forEach(function (c, i) {
        const ci = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : i;
        if (ci < 0 || ci > 200) return;
        const t = c.getAttribute('t');
        const vNo = tags(c, 'v')[0];
        let v = vNo ? vNo.textContent : '';
        if (t === 's') v = compartilhadas[Number(v)] || '';
        else if (t === 'inlineStr') v = textoDe(c);
        else if (t === 'b') v = v === '1' ? 'VERDADEIRO' : 'FALSO';
        linha[ci] = v;
      });
      linhas[r >= 0 ? r : linhas.length] = linha;
    });
    return linhas.map(function (l) { return l || []; });
  }

  function norm(s) {
    return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  /** Converte as linhas da lista de destinação em veículos. */
  function extrairVeiculos(linhas) {
    let cab = -1;
    for (let i = 0; i < Math.min(linhas.length, 30); i++) {
      if ((linhas[i] || []).some(function (c) { return norm(c) === 'NRO'; })) { cab = i; break; }
    }
    if (cab < 0) throw new Error('Não encontrei a coluna NRO na planilha.');
    const h = linhas[cab].map(norm);
    const col = function () {
      for (let k = 0; k < arguments.length; k++) {
        const nome = arguments[k];
        const i = h.findIndex(function (x) { return x === nome; });
        if (i >= 0) return i;
      }
      for (let k = 0; k < arguments.length; k++) {
        const nome = arguments[k];
        const i = h.findIndex(function (x) { return x.indexOf(nome) >= 0; });
        if (i >= 0) return i;
      }
      return -1;
    };
    const C = {
      nro: col('NRO'), dest: col('DT DESTINACAO'), placa: col('PLACA'), uf: col('UF'),
      modelo: col('MARCA / MODELO', 'MARCA/MODELO', 'MODELO'), cor: col('COR'), chassi: col('CHASSI'),
      porte: col('PORTE'), motivo: col('DT DESCARACTERIZACAO')
    };
    const val = function (l, i) { return i >= 0 && l[i] !== undefined ? String(l[i]).trim() : ''; };
    const veiculos = [];
    const avisos = [];
    const vistos = {};
    for (let i = cab + 1; i < linhas.length; i++) {
      const l = linhas[i] || [];
      const nroBruto = val(l, C.nro);
      if (!nroBruto) continue;
      if (!/^\d+(\.0+)?$/.test(nroBruto)) { avisos.push('Linha ' + (i + 1) + ': NRO "' + nroBruto + '" ignorado (não é número).'); continue; }
      const nro = String(parseInt(nroBruto, 10));
      if (vistos[nro]) { avisos.push('Linha ' + (i + 1) + ': NRO ' + nro + ' repetido — mantida a primeira ocorrência.'); continue; }
      vistos[nro] = true;
      const naoDestinar = l.some(function (c) { return norm(c).indexOf('NAO DESTINAR') >= 0; });
      let motivo = val(l, C.motivo);
      if (/^\d+(\.\d+)?$/.test(motivo)) motivo = ''; // é data, não motivo
      veiculos.push({
        nro: nro, placa: val(l, C.placa).toUpperCase(), uf: val(l, C.uf).toUpperCase(),
        modelo: val(l, C.modelo), cor: val(l, C.cor), chassi: val(l, C.chassi), porte: val(l, C.porte),
        naoDestinar: naoDestinar, motivo: naoDestinar ? motivo : ''
      });
    }
    return { veiculos: veiculos, avisos: avisos };
  }

  function categoria(porte) {
    const p = norm(porte);
    if (p.indexOf('MOTO') >= 0) return 'motos';
    if (p.indexOf('GERAL') >= 0 || p.indexOf('CARRO') >= 0 || p.indexOf('AUTOMOVEL') >= 0) return 'carros';
    return 'outros';
  }

  /** Tenta tirar lote e pátio do nome do arquivo: ..._DESTINACAO_3910_IVOTI_... */
  function infoDoNome(nome) {
    const base = String(nome || '').replace(/\.[^.]+$/, '');
    let m = /DESTINA[CÇ][AÃ]O[_\s-]+(\d{2,7})[_\s-]+([A-Za-zÀ-ú]+(?:\s(?!PRATIK)[A-Za-zÀ-ú]+)*)/i.exec(base);
    if (!m) m = /[_\s](\d{3,5})[_\s]+([A-Za-zÀ-ú]{3,})/.exec(base);
    return m ? { numeroLote: m[1], patio: m[2].replace(/-/g, ' ').toUpperCase() } : { numeroLote: '', patio: '' };
  }

  g.LeitorXlsx = { lerPlanilha: lerPlanilha, extrairVeiculos: extrairVeiculos, categoria: categoria, infoDoNome: infoDoNome };
})(self);

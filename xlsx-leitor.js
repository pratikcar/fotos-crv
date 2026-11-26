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

  function letra(i) {
    let s = ''; i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // Colunas esperadas na lista de destinação. nivel: bloqueio = sem ela não dá para criar o pátio.
  const CAMPOS = [
    { campo: 'nro', nomes: ['NRO'], rotulo: 'NRO (ID do veículo)', nivel: 'bloqueio' },
    { campo: 'porte', nomes: ['PORTE'], rotulo: 'PORTE (separa carros, motos e outros)', nivel: 'bloqueio' },
    { campo: 'dest', nomes: ['DT DESTINACAO'], rotulo: 'DT DESTINAÇÃO (marca o NÃO DESTINAR)', nivel: 'aviso' },
    { campo: 'placa', nomes: ['PLACA'], rotulo: 'PLACA', nivel: 'aviso' },
    { campo: 'modelo', nomes: ['MARCA / MODELO', 'MARCA/MODELO', 'MODELO'], rotulo: 'MARCA / MODELO', nivel: 'aviso' },
    { campo: 'cor', nomes: ['COR'], rotulo: 'COR', nivel: 'aviso' },
    { campo: 'chassi', nomes: ['CHASSI'], rotulo: 'CHASSI', nivel: 'aviso' },
    { campo: 'uf', nomes: ['UF'], rotulo: 'UF', nivel: 'info' },
    { campo: 'motivo', nomes: ['DT DESCARACTERIZACAO'], rotulo: 'Motivo do NÃO DESTINAR', nivel: 'info' }
  ];
  const PORTE_CONHECIDO = /MOTO|GERAL|CARRO|AUTOMOVEL|PESADO|CAMINH|ONIBUS|BICICLETA|REBOQUE|TRATOR|UTILITARIO/;

  /**
   * Converte as linhas da lista de destinação em veículos e verifica se a planilha é compatível.
   * Retorna { veiculos, bloqueios, avisos, colunas, portes }. Com bloqueios, o pátio não pode ser criado.
   */
  function extrairVeiculos(linhas) {
    const bloqueios = [], avisos = [], infos = [], colunas = [];
    let cab = -1;
    for (let i = 0; i < Math.min(linhas.length, 30); i++) {
      if ((linhas[i] || []).some(function (c) { return norm(c) === 'NRO'; })) { cab = i; break; }
    }
    if (cab < 0) {
      bloqueios.push('Não encontrei a linha de cabeçalho com a coluna NRO nas 30 primeiras linhas. Esta planilha não está no formato da lista de destinação.');
      return { veiculos: [], bloqueios: bloqueios, avisos: avisos, colunas: colunas, portes: [] };
    }
    const h = linhas[cab].map(norm);
    const usadas = {};
    const C = {};
    CAMPOS.forEach(function (def) {
      let idx = -1;
      def.nomes.forEach(function (n) { if (idx < 0) idx = h.findIndex(function (x, i) { return !usadas[i] && x === n; }); });
      def.nomes.forEach(function (n) { if (idx < 0) idx = h.findIndex(function (x, i) { return !usadas[i] && x && x.indexOf(n) >= 0; }); });
      if (idx >= 0) usadas[idx] = true;
      C[def.campo] = idx;
      colunas.push({ rotulo: def.rotulo, coluna: idx >= 0 ? letra(idx) : null, titulo: idx >= 0 ? String(linhas[cab][idx]) : null, nivel: def.nivel });
      if (idx < 0 && def.nivel === 'bloqueio') bloqueios.push('Falta a coluna ' + def.rotulo + '.');
      if (idx < 0 && def.nivel === 'aviso') avisos.push('Falta a coluna ' + def.rotulo + ' — essa informação não vai aparecer no app.');
    });
    if (C.nro < 0) return { veiculos: [], bloqueios: bloqueios, avisos: avisos, colunas: colunas, portes: [] };

    const val = function (l, i) { return i >= 0 && l[i] !== undefined ? String(l[i]).trim() : ''; };
    const veiculos = [];
    const vistos = {};
    const invalidos = [], repetidos = [];
    const portes = {};
    for (let i = cab + 1; i < linhas.length; i++) {
      const l = linhas[i] || [];
      const nroBruto = val(l, C.nro);
      if (!nroBruto) continue;
      if (!/^\d+(\.0+)?$/.test(nroBruto)) { invalidos.push('linha ' + (i + 1) + ' ("' + nroBruto.slice(0, 20) + '")'); continue; }
      const nro = String(parseInt(nroBruto, 10));
      if (vistos[nro]) { repetidos.push(nro + ' (linha ' + (i + 1) + ')'); continue; }
      vistos[nro] = true;
      const naoDestinar = l.some(function (c) { return norm(c).indexOf('NAO DESTINAR') >= 0; });
      let motivo = val(l, C.motivo);
      if (/^\d+(\.\d+)?$/.test(motivo)) motivo = ''; // é data, não motivo
      const porte = val(l, C.porte);
      const chave = porte || '(vazio)';
      if (!portes[chave]) portes[chave] = { valor: chave, qtd: 0, categoria: categoria(porte), conhecido: PORTE_CONHECIDO.test(norm(porte)) };
      portes[chave].qtd++;
      veiculos.push({
        nro: nro, placa: val(l, C.placa).toUpperCase(), uf: val(l, C.uf).toUpperCase(),
        modelo: val(l, C.modelo), cor: val(l, C.cor), chassi: val(l, C.chassi), porte: porte,
        naoDestinar: naoDestinar, motivo: naoDestinar ? motivo : ''
      });
    }
    const listaPortes = C.porte < 0 ? [] : Object.keys(portes).map(function (k) { return portes[k]; });
    if (!veiculos.length) bloqueios.push('Nenhum veículo com NRO numérico foi encontrado abaixo do cabeçalho.');
    if (invalidos.length) avisos.push(invalidos.length + ' linha(s) com NRO que não é número foram ignoradas: ' + invalidos.slice(0, 5).join(', ') + (invalidos.length > 5 ? '…' : '') + '.');
    if (repetidos.length) avisos.push(repetidos.length + ' NRO(s) repetido(s) — mantida a primeira ocorrência: ' + repetidos.slice(0, 5).join(', ') + (repetidos.length > 5 ? '…' : '') + '.');
    const desconhecidos = listaPortes.filter(function (p) { return !p.conhecido; });
    if (C.porte >= 0 && desconhecidos.length) {
      avisos.push('PORTE não reconhecido (vai para "Outros"): ' + desconhecidos.map(function (p) { return '"' + p.valor + '" × ' + p.qtd; }).join(', ') + '.');
    }
    if (C.porte >= 0 && veiculos.length && desconhecidos.reduce(function (a, p) { return a + p.qtd; }, 0) > veiculos.length / 2) {
      bloqueios.push('Mais da metade dos veículos tem PORTE não reconhecido — a coluna PORTE parece estar com outro conteúdo.');
    }
    if (C.placa >= 0 && veiculos.length >= 10 && veiculos.filter(function (v) { return !v.placa; }).length > veiculos.length / 2) {
      avisos.push('Mais da metade dos veículos está sem placa — confira se a coluna PLACA está certa.');
    }
    const reboques = veiculos.filter(function (v) { return norm(v.modelo).indexOf('REBOQUE') >= 0; }).length;
    if (reboques) infos.push(reboques + ' reboque(s) identificado(s) pelo modelo — vão para "Outros".');
    if (veiculos.length && !veiculos.some(function (v) { return v.naoDestinar; })) {
      avisos.push('Nenhum veículo NÃO DESTINAR foi encontrado. Se a lista tiver algum, a marcação está num formato diferente.');
    }
    return { veiculos: veiculos, bloqueios: bloqueios, avisos: avisos, infos: infos, colunas: colunas, portes: listaPortes };
  }

  function categoria(porte, modelo) {
    const p = norm(porte);
    if (norm(modelo).indexOf('REBOQUE') >= 0) return 'outros'; // reboques e semirreboques vão para Outros
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

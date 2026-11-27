// Núcleo compartilhado entre a página e o service worker:
// banco local (IndexedDB), chamada da API e envio da fila de fotos.
(function (g) {
  'use strict';
  const DB_NOME = 'fotos-patio-crv';
  const DB_VER = 1;
  let dbPromessa = null;

  function abrirDB() {
    if (dbPromessa) return dbPromessa;
    dbPromessa = new Promise(function (ok, falha) {
      const r = indexedDB.open(DB_NOME, DB_VER);
      r.onupgradeneeded = function () {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'uuid' });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { dbPromessa = null; falha(r.error); };
    });
    return dbPromessa;
  }

  function tx(store, modo, fn) {
    return abrirDB().then(function (db) {
      return new Promise(function (ok, falha) {
        const t = db.transaction(store, modo);
        const s = t.objectStore(store);
        let res;
        const req = fn(s);
        if (req) req.onsuccess = function () { res = req.result; };
        t.oncomplete = function () { ok(res); };
        t.onerror = function () { falha(t.error); };
        t.onabort = function () { falha(t.error || new Error('Transação abortada')); };
      });
    });
  }

  const kvGet = function (k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); };
  const kvSet = function (k, v) { return tx('kv', 'readwrite', function (s) { return s.put(v, k); }); };
  const kvDel = function (k) { return tx('kv', 'readwrite', function (s) { return s.delete(k); }); };
  const filaTodos = function () { return tx('fila', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return a.criadoEm < b.criadoEm ? -1 : 1; }); }); };
  const filaPut = function (item) { return tx('fila', 'readwrite', function (s) { return s.put(item); }); };
  const filaDel = function (uuid) { return tx('fila', 'readwrite', function (s) { return s.delete(uuid); }); };
  const filaContar = function () { return tx('fila', 'readonly', function (s) { return s.count(); }); };

  function ErroRede(msg) { const e = new Error(msg || 'Sem conexão'); e.code = 'REDE'; return e; }

  async function chamarApi(action, dados, token) {
    const corpo = Object.assign({}, dados || {}, { action: action });
    if (token) corpo.token = token;
    let r;
    try {
      r = await fetch(g.CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corpo),
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (e) { throw ErroRede(); }
    if (!r.ok) throw ErroRede('Servidor respondeu ' + r.status);
    let j;
    try { j = await r.json(); } catch (e) { throw ErroRede('Resposta inválida do servidor'); }
    if (!j.ok) { const e = new Error(j.error || 'Erro'); e.code = j.code || 'ERRO'; throw e; }
    return j.data;
  }

  async function shaBlob(blob) {
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function blobParaBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /** Atualiza o cache local da lista quando uma foto chega ao servidor. */
  async function marcarEnviadoLocal(item) {
    if (item.apagadaCampo || item.substituida) return; // vai só para a gestão
    const dados = await kvGet('dadosCampo');
    if (!dados || !dados.lotes) return;
    const lote = dados.lotes.find(function (l) { return l.loteId === item.loteId; });
    if (!lote) return;
    let v = lote.veiculos.find(function (x) { return x.nro === item.nro; });
    if (!v) { v = { nro: item.nro, categoria: item.categoria, foraDaLista: true, fotos: 0, naoDestinar: false }; lote.veiculos.push(v); }
    v.status = 'fotografado';
    v.fotos = (Number(v.fotos) || 0) + 1;
    v.dificil = false; // foto nova tira o "difícil acesso"
    if (v.marcacao === 'pendente') v.marcacao = '';
    await kvSet('dadosCampo', dados);
  }

  /** Difícil acesso confirmado no servidor: grava no cache local da lista. */
  async function marcarAcaoLocal(item) {
    const dados = await kvGet('dadosCampo');
    if (!dados || !dados.lotes) return;
    const lote = dados.lotes.find(function (l) { return l.loteId === item.loteId; });
    const v = lote && lote.veiculos.find(function (x) { return x.nro === item.nro; });
    if (!v) return;
    v.dificil = !!item.dificil; v.dificilMotivo = item.motivo || '';
    if (item.dificil) { v.status = 'fotografado'; if (v.marcacao === 'pendente') v.marcacao = ''; }
    else if (!(Number(v.fotos) > 0) && v.marcacao !== 'fotografado') v.status = 'pendente';
    await kvSet('dadosCampo', dados);
  }

  /**
   * Envia a fila. Para na primeira falha de rede (tenta de novo depois).
   * Retorna { enviadas, restantes, motivo } — motivo: 'ok' | 'rede' | 'login' | 'ocupado'
   */
  async function sincronizarFila(aoProgresso) {
    const executar = async function () {
      const token = await kvGet('token');
      if (!token) return { enviadas: 0, restantes: await filaContar(), motivo: 'login' };
      const fila = await filaTodos();
      let enviadas = 0;
      for (const item of fila) {
        if (item.travada) continue; // erro permanente, aguarda ação do usuário
        try {
          if (item.tipo === 'acao') {
            await chamarApi(item.acao, { loteId: item.loteId, nro: item.nro, dificil: !!item.dificil, motivo: item.motivo || '' }, token);
            await filaDel(item.uuid);
            await marcarAcaoLocal(item);
            continue;
          }
          const imagem = await blobParaBase64(item.blob);
          const hash = await shaBlob(item.blob);
          const resp = await chamarApi('enviarFoto', {
            uuid: item.uuid, loteId: item.loteId, nro: item.nro, categoria: item.categoria,
            tiradaEm: item.tiradaEm, foraDaLista: !!item.foraDaLista, imagem: imagem, sha256: hash, ocultaCampo: !!item.apagadaCampo,
            substituida: !!item.substituida, substituirAntes: item.substituirAntes || undefined
          }, token);
          // só apaga do celular se o servidor confirmar a mesma impressão digital
          const confere = resp && (resp.sha256 === hash || (resp.duplicado && !resp.sha256));
          if (!confere) { const e = new Error('Servidor não confirmou a integridade da foto.'); e.code = 'VERIFICACAO'; throw e; }
          await filaDel(item.uuid);
          await marcarEnviadoLocal(item);
          enviadas++;
          if (aoProgresso) aoProgresso({ enviadas: enviadas, total: fila.length });
        } catch (e) {
          if (e.code === 'REDE') return { enviadas: enviadas, restantes: await filaContar(), motivo: 'rede' };
          if (e.code === 'AUTH') { await kvDel('token'); return { enviadas: enviadas, restantes: await filaContar(), motivo: 'login' }; }
          if (e.code === 'LIMITE') return { enviadas: enviadas, restantes: await filaContar(), motivo: 'rede' };
          item.tentativas = (item.tentativas || 0) + 1;
          item.erro = e.message;
          if (e.code === 'BLOQUEADO' || e.code === 'PERMISSAO' || item.tentativas >= 5) item.travada = true;
          await filaPut(item);
        }
      }
      return { enviadas: enviadas, restantes: await filaContar(), motivo: 'ok' };
    };
    if (g.navigator && g.navigator.locks) {
      return g.navigator.locks.request('fotos-patio-sync', { ifAvailable: true }, function (lock) {
        if (!lock) return { enviadas: 0, restantes: -1, motivo: 'ocupado' };
        return executar();
      });
    }
    return executar();
  }

  g.Nucleo = { abrirDB, kvGet, kvSet, kvDel, filaTodos, filaPut, filaDel, filaContar, chamarApi, sincronizarFila, blobParaBase64, shaBlob };
})(self);

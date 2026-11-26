// Página de gestão — enviar planilha, acompanhar e baixar o .zip.
(function () {
  'use strict';
  const N = self.Nucleo, X = self.LeitorXlsx;
  const $ = function (id) { return document.getElementById(id); };
  const CHAVE_TOKEN = 'tokenGestor';
  const POR_VEZ = 10; // fotos por chamada de download
  const st = { token: null, sessao: null, previa: null, arquivo: '', bloqueado: true };

  function el(tag, cls, texto) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  function data(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } }
  function hojeArquivo() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  async function api(acao, dados) {
    try { return await N.chamarApi(acao, dados, st.token); }
    catch (e) {
      if (e.code === 'AUTH') { await sair(true); throw new Error('Sessão expirada. Entre novamente.'); }
      if (e.code === 'REDE') throw new Error('Sem conexão com o servidor. Verifique a internet.');
      throw e;
    }
  }

  // ---------- login ----------
  $('btnEntrar').addEventListener('click', entrar);
  $('loginSenha').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
  async function entrar() {
    $('loginErro').textContent = '';
    $('btnEntrar').disabled = true;
    try {
      const r = await N.chamarApi('login', { usuario: $('loginUsuario').value.trim(), senha: $('loginSenha').value, dispositivo: 'gestor ' + navigator.userAgent.slice(0, 90) });
      if (r.papel !== 'gestor' && r.papel !== 'admin') {
        await N.chamarApi('logout', {}, r.token).catch(function () {});
        throw new Error('Este usuário não tem acesso à gestão.');
      }
      st.token = r.token; st.sessao = r;
      await N.kvSet(CHAVE_TOKEN, r.token);
      $('loginSenha').value = '';
      abrirApp();
    } catch (e) {
      $('loginErro').textContent = e.code === 'REDE' ? 'Sem conexão com o servidor.' : e.message;
    } finally { $('btnEntrar').disabled = false; }
  }

  async function sair(expirou) {
    if (!expirou && st.token) N.chamarApi('logout', {}, st.token).catch(function () {});
    st.token = null; st.sessao = null;
    await N.kvDel(CHAVE_TOKEN);
    $('telaApp').classList.add('oculto'); $('telaLogin').classList.remove('oculto');
    $('btnSair').classList.add('oculto'); $('quem').textContent = '';
    if (expirou) $('loginErro').textContent = 'Sessão expirada. Entre novamente.';
  }
  $('btnSair').addEventListener('click', function () { sair(false); });

  function abrirApp() {
    $('telaLogin').classList.add('oculto'); $('telaApp').classList.remove('oculto');
    $('btnSair').classList.remove('oculto');
    $('quem').textContent = st.sessao.nome || st.sessao.usuario;
    $('botaoAbaUsuarios').classList.toggle('oculto', st.sessao.papel !== 'admin');
    trocarAba('abaLotes');
  }

  // ---------- abas ----------
  document.querySelectorAll('.abas button').forEach(function (b) { b.addEventListener('click', function () { trocarAba(b.dataset.aba); }); });
  function trocarAba(id) {
    ['abaLotes', 'abaNovo', 'abaUsuarios', 'abaConta'].forEach(function (a) { $(a).classList.toggle('oculto', a !== id); });
    document.querySelectorAll('.abas button').forEach(function (b) { b.classList.toggle('ativo', b.dataset.aba === id); });
    if (id === 'abaLotes') carregarLotes();
    if (id === 'abaUsuarios') carregarUsuarios();
  }

  // ---------- lotes ----------
  $('btnRecarregar').addEventListener('click', carregarLotes);
  async function carregarLotes() {
    const box = $('listaLotes');
    box.textContent = '';
    box.appendChild(el('p', 'suave', 'Carregando…'));
    let lotes;
    try { lotes = await api('listarLotes', { incluirEncerrados: true }); }
    catch (e) { box.textContent = ''; box.appendChild(el('p', 'erro', e.message)); return; }
    box.textContent = '';
    if (!lotes.length) { box.appendChild(el('p', 'suave', 'Nenhum pátio ainda. Use "+ Novo pátio" para enviar a planilha.')); return; }
    lotes.forEach(function (l) { box.appendChild(cartaoLote(l)); });
  }

  function cartaoLote(l) {
    const c = el('div', 'cartao');
    const t = el('h3', null, l.patio + (l.numeroLote ? ' · lista ' + l.numeroLote : '') + ' ');
    t.appendChild(el('span', 'tag ' + (l.ativo ? 'verde' : ''), l.ativo ? 'ativo' : 'encerrado'));
    c.appendChild(t);
    c.appendChild(el('div', 'suave', 'Criado em ' + data(l.criadoEm) + (l.arquivo ? ' · ' + l.arquivo : '')));
    const nums = el('div', 'resumo-num');
    [[l.fotografados + ' / ' + l.destinaveis, 'fotografados'], [l.total - l.destinaveis, 'não destinar'], [l.fotos, 'fotos'],
      [l.naoBaixadas, 'fotos novas p/ baixar'], [l.foraDaLista, 'fora da lista']].forEach(function (n) {
      const d = el('div'); d.appendChild(el('b', null, String(n[0]))); d.appendChild(document.createTextNode(n[1])); nums.appendChild(d);
    });
    c.appendChild(nums);
    const barra = el('div', 'barra'); const p = el('div'); p.style.width = (l.destinaveis ? Math.round(100 * l.fotografados / l.destinaveis) : 0) + '%';
    barra.appendChild(p); c.appendChild(barra);
    const status = el('div', 'suave');
    const btns = el('div', 'linha-btns');
    const bNovas = el('button', 'btn pequeno verde', '⬇ Baixar novas (' + l.naoBaixadas + ')');
    bNovas.disabled = !l.naoBaixadas;
    bNovas.addEventListener('click', function () { baixar(l, true, status, btns); });
    const bTodas = el('button', 'btn pequeno', '⬇ Baixar todas (' + l.fotos + ')');
    bTodas.disabled = !l.fotos;
    bTodas.addEventListener('click', function () { baixar(l, false, status, btns); });
    const bIds = el('button', 'btn pequeno cinza', 'Ver IDs');
    const detalhe = el('div');
    bIds.addEventListener('click', function () { verIds(l, detalhe); });
    const bAtivo = el('button', 'btn pequeno ' + (l.ativo ? 'vermelho' : 'cinza'), l.ativo ? 'Encerrar pátio' : 'Reabrir pátio');
    bAtivo.addEventListener('click', async function () {
      if (l.ativo && !confirm('Encerrar o pátio ' + l.patio + (l.numeroLote ? ' (lista ' + l.numeroLote + ')' : '') + '? Ele some do app de campo. Fotos já guardadas no celular ainda serão enviadas.')) return;
      try { await api('definirAtivo', { loteId: l.loteId, ativo: !l.ativo }); carregarLotes(); } catch (e) { alert(e.message); }
    });
    [bNovas, bTodas, bIds, bAtivo].forEach(function (b) { btns.appendChild(b); });
    c.appendChild(btns); c.appendChild(status); c.appendChild(detalhe);
    return c;
  }

  async function verIds(l, box) {
    if (box.childNodes.length) { box.textContent = ''; return; }
    box.appendChild(el('p', 'suave', 'Carregando…'));
    let vs;
    try { vs = await api('veiculosLote', { loteId: l.loteId }); } catch (e) { box.textContent = ''; box.appendChild(el('p', 'erro', e.message)); return; }
    box.textContent = '';
    const filtro = el('select');
    [['todos', 'Todos'], ['pendente', 'Pendentes'], ['fotografado', 'Fotografados'], ['bloq', 'Não destinar'], ['fora', 'Fora da lista']].forEach(function (o) {
      const op = el('option', null, o[1]); op.value = o[0]; filtro.appendChild(op);
    });
    box.appendChild(filtro);
    const wrap = el('div', 'rolagem'); const tab = el('table'); wrap.appendChild(tab); box.appendChild(wrap);
    const desenhar = function () {
      tab.textContent = '';
      const cab = el('tr');
      ['NRO', 'Categoria', 'Placa', 'Modelo', 'Cor', 'Situação', 'Fotos'].forEach(function (h) { cab.appendChild(el('th', null, h)); });
      tab.appendChild(cab);
      vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
        const f = filtro.value;
        if (f === 'pendente' && (v.status !== 'pendente' || v.naoDestinar)) return;
        if (f === 'fotografado' && v.status !== 'fotografado') return;
        if (f === 'bloq' && !v.naoDestinar) return;
        if (f === 'fora' && !v.foraDaLista) return;
        const tr = el('tr');
        [v.nro, v.categoria, v.placa, v.modelo, v.cor].forEach(function (x) { tr.appendChild(el('td', null, x || '—')); });
        const td = el('td');
        if (v.naoDestinar) td.appendChild(el('span', 'tag vermelho', 'NÃO DESTINAR'));
        else if (v.foraDaLista) td.appendChild(el('span', 'tag amarelo', 'fora da lista'));
        else td.appendChild(el('span', 'tag ' + (v.status === 'fotografado' ? 'verde' : ''), v.status));
        tr.appendChild(td);
        tr.appendChild(el('td', null, String(v.fotos)));
        tab.appendChild(tr);
      });
    };
    filtro.addEventListener('change', desenhar);
    desenhar();
  }

  // ---------- download .zip ----------
  async function baixar(l, somenteNovas, status, btns) {
    const botoes = btns.querySelectorAll('button');
    botoes.forEach(function (b) { b.disabled = true; });
    status.className = 'suave';
    try {
      status.textContent = 'Buscando lista de fotos…';
      const fotos = await api('listarFotos', { loteId: l.loteId, somenteNaoBaixadas: somenteNovas });
      if (!fotos.length) { status.textContent = 'Nenhuma foto nova.'; return; }
      const zip = new JSZip();
      for (let i = 0; i < fotos.length; i += POR_VEZ) {
        const parte = fotos.slice(i, i + POR_VEZ);
        status.textContent = 'Baixando fotos ' + (i + 1) + '–' + (i + parte.length) + ' de ' + fotos.length + '…';
        let r, tentativa = 0;
        for (;;) {
          try { r = await api('baixarFotos', { fileIds: parte.map(function (f) { return f.fileId; }) }); break; }
          catch (e) { if (++tentativa >= 3) throw e; await new Promise(function (ok) { setTimeout(ok, 2000 * tentativa); }); }
        }
        const porId = {};
        r.forEach(function (x) { porId[x.fileId] = x.base64; });
        parte.forEach(function (f) { zip.file(caminhoSeguro(f.caminho), porId[f.fileId], { base64: true, binary: true }); });
      }
      // planilha-resumo do lote
      status.textContent = 'Montando resumo…';
      const vs = await api('veiculosLote', { loteId: l.loteId });
      zip.file(nomeSeguro(l.patio) + '/resumo_' + nomeSeguro(l.patio) + (l.numeroLote ? '_lista' + nomeSeguro(l.numeroLote) : '') + '.csv', csvResumo(vs));
      status.textContent = 'Gerando o .zip…';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const nome = 'FOTOS_' + nomeSeguro(l.patio) + (l.numeroLote ? '_lista' + nomeSeguro(l.numeroLote) : '') + '_' + hojeArquivo() + (somenteNovas ? '_novas' : '_todas') + '.zip';
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      await api('marcarBaixadas', { uuids: fotos.map(function (f) { return f.uuid; }) });
      status.className = 'ok';
      status.textContent = '✅ ' + fotos.length + ' foto(s) baixada(s) em ' + nome + ' (' + (blob.size / 1048576).toFixed(1) + ' MB).';
      setTimeout(carregarLotes, 2500);
    } catch (e) {
      status.className = 'erro';
      status.textContent = 'Falhou: ' + e.message + ' Nada foi marcado como baixado — pode tentar de novo.';
    } finally {
      botoes.forEach(function (b) { b.disabled = false; });
    }
  }

  function nomeSeguro(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'sem-nome'; }
  function caminhoSeguro(c) { return String(c).split('/').map(function (p) { return p === '..' || p === '.' ? '_' : nomeSeguro(p); }).join('/'); }
  function csvResumo(vs) {
    const esc = function (v) {
      let s = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const linhas = [['NRO', 'Categoria', 'Placa', 'UF', 'Modelo', 'Cor', 'Chassi', 'Situação', 'Fotos'].map(esc).join(';')];
    vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
      const sit = v.naoDestinar ? 'NÃO DESTINAR' : (v.foraDaLista ? 'fora da lista' : v.status);
      linhas.push([v.nro, v.categoria, v.placa, v.uf, v.modelo, v.cor, v.chassi, sit, v.fotos].map(esc).join(';'));
    });
    return '﻿' + linhas.join('\r\n');
  }

  // ---------- novo lote ----------
  const soltar = $('soltar');
  soltar.addEventListener('click', function () { $('inputXlsx').click(); });
  soltar.addEventListener('dragover', function (e) { e.preventDefault(); soltar.classList.add('sobre'); });
  soltar.addEventListener('dragleave', function () { soltar.classList.remove('sobre'); });
  soltar.addEventListener('drop', function (e) { e.preventDefault(); soltar.classList.remove('sobre'); if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]); });
  $('inputXlsx').addEventListener('change', function () { if (this.files[0]) lerArquivo(this.files[0]); this.value = ''; });

  async function lerArquivo(f) {
    $('novoErro').textContent = ''; $('previa').classList.add('oculto'); st.previa = null; st.bloqueado = true;
    if (!/\.xlsx$/i.test(f.name)) { $('novoErro').textContent = 'Envie um arquivo .xlsx (Excel).'; return; }
    try {
      const linhas = await X.lerPlanilha(await f.arrayBuffer());
      const r = X.extrairVeiculos(linhas);
      st.previa = r.veiculos; st.arquivo = f.name; st.bloqueado = r.bloqueios.length > 0;
      const info = X.infoDoNome(f.name);
      $('novoPatio').value = info.patio; $('novoLote').value = info.numeroLote;
      mostrarPrevia(r);
    } catch (e) { $('novoErro').textContent = 'Não consegui abrir o arquivo como planilha Excel: ' + e.message; }
  }

  function linhaVerif(icone, texto, cls) {
    const d = el('div', cls || ''); d.textContent = icone + ' ' + texto; return d;
  }

  function mostrarVerificacao(r) {
    const box = $('verificacao'); box.textContent = '';
    const c = el('div', 'cartao verif');
    const ok = !r.bloqueios.length;
    c.appendChild(el('h3', ok ? 'ok' : 'erro', ok ? (r.avisos.length ? '⚠️ Planilha compatível, com avisos' : '✅ Planilha compatível') : '❌ Planilha NÃO compatível — o pátio não pode ser criado'));
    r.bloqueios.forEach(function (b) { c.appendChild(linhaVerif('❌', b, 'erro')); });
    r.avisos.forEach(function (a) { c.appendChild(linhaVerif('⚠️', a, 'aviso')); });
    (r.infos || []).forEach(function (a) { c.appendChild(linhaVerif('ℹ️', a, 'suave')); });
    if (r.colunas.length) {
      c.appendChild(el('div', 'suave', 'Colunas reconhecidas:'));
      const t = el('table');
      r.colunas.forEach(function (col) {
        const tr = el('tr');
        tr.appendChild(el('td', null, col.coluna ? '✅' : (col.nivel === 'bloqueio' ? '❌' : (col.nivel === 'aviso' ? '⚠️' : '—'))));
        tr.appendChild(el('td', null, col.rotulo));
        tr.appendChild(el('td', 'suave', col.coluna ? 'coluna ' + col.coluna + ' ("' + col.titulo + '")' : 'não encontrada'));
        t.appendChild(tr);
      });
      c.appendChild(t);
    }
    if (r.portes.length) {
      c.appendChild(el('div', 'suave', 'Valores de PORTE: ' + r.portes.map(function (p) {
        return p.valor + ' × ' + p.qtd + ' → ' + p.categoria + (p.conhecido ? '' : ' (não reconhecido)');
      }).join(' · ')));
    }
    box.appendChild(c);
  }

  function mostrarPrevia(r) {
    mostrarVerificacao(r);
    const vs = r.veiculos;
    const cont = { carros: 0, motos: 0, outros: 0 };
    let bloq = 0, semPlaca = 0;
    vs.forEach(function (v) { if (v.naoDestinar) bloq++; else cont[X.categoria(v.porte, v.modelo)]++; if (!v.placa) semPlaca++; });
    const nums = $('previaNums'); nums.textContent = '';
    [[vs.length, 'veículos na planilha'], [vs.length - bloq, 'para fotografar'], [cont.carros, 'carros'], [cont.motos, 'motos'],
      [cont.outros, 'outros'], [bloq, 'NÃO DESTINAR'], [semPlaca, 'sem placa']].forEach(function (n) {
      const d = el('div'); d.appendChild(el('b', null, String(n[0]))); d.appendChild(document.createTextNode(n[1])); nums.appendChild(d);
    });
    $('previaAvisos').textContent = '';
    const tab = $('previaTabela'); tab.textContent = '';
    const cab = el('tr');
    ['NRO', 'Categoria', 'Placa', 'Modelo', 'Cor', 'Situação'].forEach(function (h) { cab.appendChild(el('th', null, h)); });
    tab.appendChild(cab);
    vs.forEach(function (v) {
      const tr = el('tr');
      [v.nro, X.categoria(v.porte, v.modelo), v.placa, v.modelo, v.cor].forEach(function (x) { tr.appendChild(el('td', null, x || '—')); });
      const td = el('td'); if (v.naoDestinar) td.appendChild(el('span', 'tag vermelho', 'NÃO DESTINAR')); tr.appendChild(td);
      tab.appendChild(tr);
    });
    $('previa').classList.remove('oculto');
    $('btnCriarLote').disabled = st.bloqueado;
    $('btnCriarLote').textContent = st.bloqueado ? 'Planilha incompatível — corrija e envie de novo' : 'Criar pátio e liberar para o campo';
  }

  $('btnCriarLote').addEventListener('click', async function () {
    if (!st.previa || st.bloqueado) return;
    const patio = $('novoPatio').value.trim(), lote = $('novoLote').value.trim();
    if (!patio) { $('novoErro').textContent = 'Informe o nome do pátio CRV (não deu para identificar pelo nome do arquivo).'; $('novoPatio').focus(); return; }
    $('btnCriarLote').disabled = true; $('novoErro').textContent = '';
    try {
      const r = await api('criarLote', { patio: patio, numeroLote: lote, arquivo: st.arquivo, veiculos: st.previa });
      alert('Pátio criado: ' + r.total + ' veículos (' + r.destinaveis + ' para fotografar). O pátio já aparece no app de campo.');
      st.previa = null; $('previa').classList.add('oculto');
      trocarAba('abaLotes');
    } catch (e) { $('novoErro').textContent = e.message; }
    finally { $('btnCriarLote').disabled = false; }
  });

  // ---------- usuários (admin) ----------
  async function carregarUsuarios() {
    const tab = $('tabelaUsuarios'); tab.textContent = '';
    let us;
    try { us = await api('listarUsuarios', {}); } catch (e) { $('uErro').textContent = e.message; return; }
    const cab = el('tr'); ['Usuário', 'Nome', 'Acesso', 'Situação', ''].forEach(function (h) { cab.appendChild(el('th', null, h)); }); tab.appendChild(cab);
    us.forEach(function (u) {
      const tr = el('tr');
      [u.usuario, u.nome, u.papel].forEach(function (x) { tr.appendChild(el('td', null, x)); });
      const td = el('td'); td.appendChild(el('span', 'tag ' + (u.ativo ? 'verde' : 'vermelho'), u.ativo ? 'ativo' : 'inativo')); tr.appendChild(td);
      const tdb = el('td'); const b = el('button', 'btn pequeno cinza', 'Editar');
      b.addEventListener('click', function () { $('uUsuario').value = u.usuario; $('uNome').value = u.nome; $('uPapel').value = u.papel; $('uSenha').value = ''; $('uAtivo').checked = u.ativo; window.scrollTo(0, 0); });
      tdb.appendChild(b); tr.appendChild(tdb); tab.appendChild(tr);
    });
  }
  $('btnSalvarUsuario').addEventListener('click', async function () {
    $('uErro').textContent = '';
    try {
      await api('salvarUsuario', { usuario: $('uUsuario').value.trim(), nome: $('uNome').value.trim(), papel: $('uPapel').value, senha: $('uSenha').value, ativo: $('uAtivo').checked });
      ['uUsuario', 'uNome', 'uSenha'].forEach(function (i) { $(i).value = ''; });
      $('uErro').className = 'ok'; $('uErro').textContent = 'Usuário salvo.';
      setTimeout(function () { $('uErro').className = 'erro'; $('uErro').textContent = ''; }, 3000);
      carregarUsuarios();
    } catch (e) { $('uErro').className = 'erro'; $('uErro').textContent = e.message; }
  });

  // ---------- minha senha ----------
  $('btnTrocarSenha').addEventListener('click', async function () {
    $('sErro').className = 'erro'; $('sErro').textContent = '';
    try {
      await api('trocarSenha', { senhaAtual: $('sAtual').value, novaSenha: $('sNova').value });
      $('sAtual').value = ''; $('sNova').value = '';
      $('sErro').className = 'ok'; $('sErro').textContent = 'Senha trocada.';
    } catch (e) { $('sErro').textContent = e.message; }
  });

  // ---------- início ----------
  (async function () {
    if (self.CONFIG.API_URL.indexOf('COLE_AQUI') === 0) { document.querySelector('main').textContent = 'Configure a API_URL no arquivo config.js.'; return; }
    st.token = await N.kvGet(CHAVE_TOKEN);
    if (st.token) {
      try { st.sessao = await N.chamarApi('me', {}, st.token); if (st.sessao.papel === 'campo') throw new Error(); abrirApp(); return; }
      catch (e) { if (e.code !== 'REDE') await N.kvDel(CHAVE_TOKEN); }
    }
    $('telaLogin').classList.remove('oculto');
  })();
})();

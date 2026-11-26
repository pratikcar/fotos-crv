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
    lotes.slice().sort(function (a, b) { return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0); })
      .forEach(function (l) { box.appendChild(cartaoLote(l)); });
  }

  function cartaoLote(l) {
    const c = el('div', 'cartao');
    const t = el('h3', null, l.patio + (l.numeroLote ? ' · lista ' + l.numeroLote : '') + ' ');
    t.appendChild(el('span', 'tag ' + (l.ativo ? 'verde' : ''), l.ativo ? 'ativo' : 'encerrado'));
    t.className = 'titulo-patio'; t.title = 'Ver a lista de veículos';
    c.appendChild(t);
    c.appendChild(el('div', 'suave', 'Criado em ' + data(l.criadoEm) + (l.arquivo ? ' · ' + l.arquivo : '')));
    const nums = el('div', 'resumo-num');
    [[l.fotografados + ' / ' + l.destinaveis, 'fotografados'], [l.total - l.destinaveis, 'não destinar'], [l.fotos, 'fotos'],
      [l.naoBaixadas, 'fotos ainda não baixadas'], [l.foraDaLista, 'fora da lista']].forEach(function (n) {
      const d = el('div'); d.appendChild(el('b', null, String(n[0]))); d.appendChild(document.createTextNode(n[1])); nums.appendChild(d);
    });
    c.appendChild(nums);
    const barra = el('div', 'barra'); const p = el('div'); p.style.width = (l.destinaveis ? Math.round(100 * l.fotografados / l.destinaveis) : 0) + '%';
    barra.appendChild(p); c.appendChild(barra);
    const status = el('div', 'suave');
    const btns = el('div', 'linha-btns');
    const detalhe = el('div');
    const bBaixar = el('button', 'btn pequeno verde', '⬇ Baixar fotos' + (l.naoBaixadas ? ' (' + l.naoBaixadas + ' ainda não baixadas)' : ''));
    bBaixar.disabled = !l.fotos;
    bBaixar.addEventListener('click', function () { painelBaixar(l, detalhe, status); });
    const bIds = el('button', 'btn pequeno cinza', '📋 Lista de veículos');
    bIds.addEventListener('click', function () { verIds(l, detalhe); });
    t.addEventListener('click', function () { verIds(l, detalhe); });
    const bAtivo = el('button', 'btn pequeno ' + (l.ativo ? 'vermelho' : 'cinza'), l.ativo ? 'Encerrar pátio' : 'Reabrir pátio');
    bAtivo.addEventListener('click', async function () {
      if (l.ativo && !confirm('Encerrar o pátio ' + l.patio + (l.numeroLote ? ' (lista ' + l.numeroLote + ')' : '') + '? Ele some do app de campo. Fotos já guardadas no celular ainda serão enviadas.')) return;
      try { await api('definirAtivo', { loteId: l.loteId, ativo: !l.ativo }); carregarLotes(); } catch (e) { alert(e.message); }
    });
    const bEditar = el('button', 'btn pequeno cinza', '✏️ Editar');
    bEditar.addEventListener('click', function () { painelEditar(l, detalhe); });
    [bBaixar, bIds, bEditar, bAtivo].forEach(function (b) { btns.appendChild(b); });
    if (!l.ativo) {
      const bExcluir = el('button', 'btn pequeno vermelho', '🗑 Excluir');
      bExcluir.addEventListener('click', function () { painelExcluir(l, detalhe); });
      btns.appendChild(bExcluir);
    }
    c.appendChild(btns); c.appendChild(status); c.appendChild(detalhe);
    return c;
  }

  async function verIds(l, box) {
    if (box.dataset.painel === 'ids') { box.textContent = ''; box.dataset.painel = ''; return; }
    box.textContent = ''; box.dataset.painel = 'ids';
    box.appendChild(el('p', 'suave', 'Carregando…'));
    let vs, fotos;
    try {
      vs = await api('veiculosLote', { loteId: l.loteId });
      fotos = await api('listarFotos', { loteId: l.loteId, somenteNaoBaixadas: false });
    } catch (e) { box.textContent = ''; box.appendChild(el('p', 'erro', e.message)); return; }
    box.textContent = '';
    const fotosPorNro = {};
    fotos.forEach(function (f) { const nro = String(f.caminho).split('/')[3]; (fotosPorNro[nro] = fotosPorNro[nro] || []).push(f); });
    const sit = function (v) {
      if (v.naoDestinar) return 'bloq';
      if (v.refazer) return 'refazer';
      if (v.foraDaLista) return 'fora';
      return v.status === 'fotografado' ? 'fotografado' : 'pendente';
    };
    const FILTROS = [['pendente', 'Pendentes'], ['fotografado', 'Fotografados'], ['refazer', 'Refazer'], ['fora', 'Fora da lista'], ['bloq', 'Não destinar'], ['todos', 'Todos']];
    const cont = { todos: vs.length };
    vs.forEach(function (v) { const k = sit(v); cont[k] = (cont[k] || 0) + 1; });
    let filtro = 'pendente';
    const barra = el('div', 'filtros filtros-gestao');
    const busca = el('input'); busca.type = 'search'; busca.placeholder = 'Buscar NRO, placa ou modelo';
    const wrap = el('div', 'rolagem'); const tab = el('table'); wrap.appendChild(tab);
    FILTROS.forEach(function (fo) {
      if (fo[0] !== 'todos' && fo[0] !== 'pendente' && fo[0] !== 'fotografado' && !cont[fo[0]]) return;
      const b = el('button', fo[0] === filtro ? 'ativo' : '', fo[1] + ' (' + (cont[fo[0]] || 0) + ')');
      b.addEventListener('click', function () { filtro = fo[0]; barra.querySelectorAll('button').forEach(function (x) { x.classList.toggle('ativo', x === b); }); desenhar(); });
      barra.appendChild(b);
    });
    box.appendChild(barra); box.appendChild(busca); box.appendChild(wrap);
    const norm = function (t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };

    const desenhar = function () {
      tab.textContent = '';
      const cab = el('tr');
      ['NRO', 'Categoria', 'Placa', 'Modelo', 'Cor', 'Situação', 'Fotos'].forEach(function (h) { cab.appendChild(el('th', null, h)); });
      tab.appendChild(cab);
      const q = norm(busca.value.trim());
      vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
        const k = sit(v);
        if (filtro !== 'todos' && k !== filtro) return;
        if (q && norm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor).indexOf(q) < 0) return;
        const tr = el('tr', (fotosPorNro[v.nro] || []).length ? 'linha-clicavel' : '');
        [v.nro, v.categoria, v.placa, v.modelo, v.cor].forEach(function (x) { tr.appendChild(el('td', null, x || '—')); });
        const td = el('td');
        const rot = { bloq: ['vermelho', 'NÃO DESTINAR'], refazer: ['amarelo', '⚠️ refazer'], fora: ['amarelo', 'fora da lista'], fotografado: ['verde', 'fotografado'], pendente: ['', 'pendente'] }[k];
        td.appendChild(el('span', 'tag ' + rot[0], rot[1])); tr.appendChild(td);
        const nf = (fotosPorNro[v.nro] || []).length;
        tr.appendChild(el('td', null, nf ? '🖼 ' + nf + (v.apagadasCampo ? ' (' + v.apagadasCampo + ' apagada(s) pelo campo)' : '') : '0'));
        tab.appendChild(tr);
        if (nf) tr.addEventListener('click', function () { abrirFotos(tr, v); });
      });
    };

    const abrirFotos = function (tr, v) {
      const prox = tr.nextSibling;
      if (prox && prox.classList && prox.classList.contains('linha-fotos')) { prox.remove(); return; }
      const linha = el('tr', 'linha-fotos'); const td = el('td'); td.colSpan = 7; linha.appendChild(td);
      const gal = el('div', 'galeria galeria-gestao'); td.appendChild(gal);
      tr.after(linha);
      (fotosPorNro[v.nro] || []).forEach(function (f) {
        const c = el('div', 'foto-cartao');
        const img = el('img'); img.alt = f.caminho;
        img.addEventListener('click', function () {
          api('miniatura', { uuid: f.uuid, grande: true }).then(function (m) { ampliar('data:' + m.tipo + ';base64,' + m.base64); }).catch(function (e) { alert(e.message); });
        });
        c.appendChild(img);
        const nome = String(f.caminho).split('/').pop();
        c.appendChild(el('div', 'suave', nome + (f.baixada ? ' · já baixada' : '')));
        const b = el('button', 'btn pequeno vermelho', '🗑 Excluir (foto ruim)');
        b.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          if (!confirm('Excluir a foto ' + nome + ' do NRO ' + v.nro + '?\n\nEla vai para a lixeira do Drive (30 dias) e o NRO volta a ficar PENDENTE para o campo tirar foto nova.')) return;
          b.disabled = true;
          try {
            await api('excluirFotoGestao', { uuid: f.uuid });
            fotosPorNro[v.nro] = fotosPorNro[v.nro].filter(function (x) { return x.uuid !== f.uuid; });
            v.refazer = true;
            desenhar();
          } catch (e) { alert(e.message); b.disabled = false; }
        });
        c.appendChild(b);
        gal.appendChild(c);
        api('miniatura', { uuid: f.uuid }).then(function (m) { img.src = 'data:' + m.tipo + ';base64,' + m.base64; }).catch(function () { img.alt = 'não carregou'; });
      });
    };

    busca.addEventListener('input', desenhar);
    desenhar();
  }

  function ampliar(src) {
    const fundo = el('div', 'modal-fundo');
    const img = el('img', 'foto-grande'); img.src = src; img.alt = 'Foto ampliada';
    fundo.appendChild(img);
    fundo.addEventListener('click', function () { fundo.remove(); });
    document.body.appendChild(fundo);
  }

  // ---------- editar / excluir pátio ----------
  function abrirPainel(box, nome) {
    if (box.dataset.painel === nome) { box.textContent = ''; box.dataset.painel = ''; return false; }
    box.textContent = ''; box.dataset.painel = nome; return true;
  }

  function painelEditar(l, box) {
    if (!abrirPainel(box, 'editar')) return;
    const p = el('div', 'cartao painel-baixar');
    p.appendChild(el('h3', null, 'Editar pátio'));
    p.appendChild(el('label', null, 'Nome do pátio CRV'));
    const iPatio = el('input'); iPatio.type = 'text'; iPatio.maxLength = 60; iPatio.value = l.patio; p.appendChild(iPatio);
    p.appendChild(el('label', null, 'Número da lista (opcional)'));
    const iLista = el('input'); iLista.type = 'text'; iLista.maxLength = 30; iLista.value = l.numeroLote || ''; p.appendChild(iLista);
    p.appendChild(el('p', 'suave', 'As fotos já tiradas passam a aparecer com o nome novo no .zip. No celular, o nome muda na próxima atualização da lista.'));
    const msg = el('div', 'erro'); p.appendChild(msg);
    const b = el('button', 'btn verde', 'Salvar alterações'); p.appendChild(b);
    b.addEventListener('click', async function () {
      msg.className = 'erro'; msg.textContent = '';
      if (!iPatio.value.trim()) { msg.textContent = 'Informe o nome do pátio.'; return; }
      b.disabled = true;
      try {
        await api('editarLote', { loteId: l.loteId, patio: iPatio.value.trim(), numeroLote: iLista.value.trim() });
        msg.className = 'ok'; msg.textContent = 'Alterações salvas.';
        setTimeout(carregarLotes, 1200);
      } catch (e) { msg.textContent = e.message; b.disabled = false; }
    });
    box.appendChild(p);
    iPatio.focus();
  }

  function painelExcluir(l, box) {
    if (!abrirPainel(box, 'excluir')) return;
    const p = el('div', 'cartao painel-baixar painel-perigo');
    p.appendChild(el('h3', 'erro', '🗑 Excluir o pátio ' + l.patio));
    p.appendChild(el('p', null, 'Isto remove o pátio, a lista de ' + l.total + ' veículos e as ' + l.fotos + ' foto(s) dele. As fotos vão para a lixeira do Google Drive e podem ser recuperadas por 30 dias.'));
    if (l.naoBaixadas) p.appendChild(el('p', 'aviso', '⚠️ ' + l.naoBaixadas + ' foto(s) deste pátio ainda NÃO foram baixadas. Baixe antes de excluir se precisar delas.'));
    p.appendChild(el('p', 'suave', 'Fotos ainda guardadas em celulares para este pátio não poderão mais ser enviadas.'));
    p.appendChild(el('label', null, 'Para confirmar, digite o nome do pátio: ' + l.patio));
    const i = el('input'); i.type = 'text'; i.autocomplete = 'off'; p.appendChild(i);
    const msg = el('div', 'erro'); p.appendChild(msg);
    const b = el('button', 'btn vermelho', 'Excluir definitivamente'); b.disabled = true; p.appendChild(b);
    i.addEventListener('input', function () { b.disabled = i.value.trim().toUpperCase() !== String(l.patio).trim().toUpperCase(); });
    b.addEventListener('click', async function () {
      b.disabled = true; msg.textContent = '';
      try {
        const r = await api('excluirLote', { loteId: l.loteId, confirmacao: i.value.trim() });
        msg.className = 'ok'; msg.textContent = 'Pátio excluído. ' + r.fotosNaLixeira + ' foto(s) foram para a lixeira do Drive.';
        setTimeout(carregarLotes, 1500);
      } catch (e) { msg.className = 'erro'; msg.textContent = e.message; b.disabled = false; }
    });
    box.appendChild(p);
    i.focus();
  }

  // ---------- download .zip ----------
  function dataBR(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function dataDaFoto(f) { return String(f.caminho).split('/')[1] || ''; }

  async function painelBaixar(l, box, status) {
    if (!abrirPainel(box, 'baixar')) return;
    box.appendChild(el('p', 'suave', 'Carregando fotos…'));
    let fotos;
    try { fotos = await api('listarFotos', { loteId: l.loteId, somenteNaoBaixadas: false }); }
    catch (e) { box.textContent = ''; box.appendChild(el('p', 'erro', e.message)); return; }
    box.textContent = '';
    const naoBaixadas = fotos.filter(function (f) { return !f.baixada; });
    const porData = {};
    fotos.forEach(function (f) {
      const d = dataDaFoto(f);
      if (!porData[d]) porData[d] = { total: 0, ja: 0 };
      porData[d].total++; if (f.baixada) porData[d].ja++;
    });
    const datas = Object.keys(porData).sort().reverse();

    const p = el('div', 'cartao painel-baixar');
    p.appendChild(el('h3', null, 'Baixar fotos'));
    p.appendChild(el('div', 'suave', fotos.length + ' foto(s) no total · ' + naoBaixadas.length + ' ainda não baixada(s) · ' + datas.length + ' dia(s) com fotos'));
    const nome = 'mod-' + l.loteId;
    const opcao = function (valor, texto, desab) {
      const lab = el('label', 'opcao');
      const r = el('input'); r.type = 'radio'; r.name = nome; r.value = valor; r.disabled = !!desab;
      lab.appendChild(r); lab.appendChild(document.createTextNode(' ' + texto));
      p.appendChild(lab); return r;
    };
    const rNovas = opcao('novas', 'Só as que ainda não foram baixadas (' + naoBaixadas.length + ')', !naoBaixadas.length);
    const rData = opcao('data', 'Fotos de uma data:', !datas.length);
    const sel = el('select', 'sel-data');
    datas.forEach(function (d) {
      const o = el('option', null, dataBR(d) + ' — ' + porData[d].total + ' foto(s)' + (porData[d].ja ? ' (' + porData[d].ja + ' já baixada(s))' : ''));
      o.value = d; sel.appendChild(o);
    });
    p.appendChild(sel);
    const rTodas = opcao('todas', 'Todas as fotos do pátio (' + fotos.length + ')', !fotos.length);
    (naoBaixadas.length ? rNovas : rData).checked = true;

    const aviso = el('div', 'aviso');
    const bOk = el('button', 'btn verde', '');
    p.appendChild(aviso); p.appendChild(bOk);
    box.appendChild(p);

    const escolha = function () {
      const modo = rNovas.checked ? 'novas' : (rData.checked ? 'data' : 'todas');
      let lista, rotulo, sufixo;
      if (modo === 'novas') { lista = naoBaixadas; rotulo = 'ainda não baixada(s)'; sufixo = 'nao-baixadas_' + hojeArquivo(); }
      else if (modo === 'data') { lista = fotos.filter(function (f) { return dataDaFoto(f) === sel.value; }); rotulo = 'de ' + dataBR(sel.value); sufixo = 'dia_' + sel.value; }
      else { lista = fotos; rotulo = 'do pátio (todas)'; sufixo = 'todas_' + hojeArquivo(); }
      return { lista: lista, rotulo: rotulo, sufixo: sufixo };
    };
    const atualizar = function () {
      const e = escolha();
      sel.disabled = !rData.checked;
      const ja = e.lista.filter(function (f) { return f.baixada; }).length;
      bOk.textContent = '⬇ Baixar ' + e.lista.length + ' foto(s) ' + e.rotulo;
      bOk.disabled = !e.lista.length;
      aviso.textContent = ja ? '⚠️ ' + ja + ' destas fotos já foram baixadas antes. Os nomes dos arquivos são os mesmos: extraindo na mesma pasta, elas são substituídas — não ficam duplicadas.' : '';
    };
    [rNovas, rData, rTodas, sel].forEach(function (x) { x.addEventListener('change', atualizar); });
    atualizar();
    bOk.addEventListener('click', function () { const e = escolha(); baixar(l, e.lista, e.sufixo, status, p); });
  }

  async function baixar(l, fotos, sufixo, status, painel) {
    const botoes = painel.querySelectorAll('button, input, select');
    botoes.forEach(function (b) { b.disabled = true; });
    status.className = 'suave';
    try {
      if (!fotos.length) { status.textContent = 'Nenhuma foto para baixar.'; return; }
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
      // planilha-resumo do pátio
      status.textContent = 'Montando resumo…';
      const vs = await api('veiculosLote', { loteId: l.loteId });
      zip.file(nomeSeguro(l.patio) + '/resumo_' + nomeSeguro(l.patio) + (l.numeroLote ? '_lista' + nomeSeguro(l.numeroLote) : '') + '.csv', csvResumo(vs));
      status.textContent = 'Gerando o .zip…';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const nome = 'FOTOS_' + nomeSeguro(l.patio) + (l.numeroLote ? '_lista' + nomeSeguro(l.numeroLote) : '') + '_' + sufixo + '.zip';
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
    const linhas = [['NRO', 'Categoria', 'Placa', 'UF', 'Modelo', 'Cor', 'Chassi', 'Situação', 'Fotos', 'Apagadas pelo campo'].map(esc).join(';')];
    vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
      const sit = v.naoDestinar ? 'NÃO DESTINAR' : (v.refazer ? 'refazer' : (v.foraDaLista ? 'fora da lista' : v.status));
      linhas.push([v.nro, v.categoria, v.placa, v.uf, v.modelo, v.cor, v.chassi, sit, v.fotos, v.apagadasCampo || 0].map(esc).join(';'));
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

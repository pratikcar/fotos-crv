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

  // ---------- pátios (3 colunas: pátios | veículos | fotos) ----------
  $('btnRecarregar').addEventListener('click', function () { carregarLotes(); });
  st.loteSel = null; st.lotes = [];
  const norm = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  function vazio(box, texto) { box.textContent = ''; box.appendChild(el('p', 'vazio', texto)); }

  async function carregarLotes() {
    const box = $('listaLotes');
    if (!st.lotes.length) vazio(box, 'Carregando…');
    let lotes;
    try { lotes = await api('listarLotes', { incluirEncerrados: true }); }
    catch (e) { box.textContent = ''; box.appendChild(el('p', 'erro', e.message)); return; }
    st.lotes = lotes;
    desenharPatios();
    const l = lotes.find(function (x) { return x.loteId === st.loteSel; });
    if (l) abrirPatio(l, true);
    else { st.loteSel = null; vazio($('colLista'), 'Escolha um pátio à esquerda para ver os veículos e as fotos.'); vazio($('colDetalhe'), 'As fotos do veículo aparecem aqui.'); }
  }

  function desenharPatios() {
    const box = $('listaLotes'); box.textContent = '';
    if (!st.lotes.length) { vazio(box, 'Nenhum pátio ainda. Use "+ Novo pátio" para enviar a planilha.'); return; }
    const ordem = st.lotes.slice().sort(function (a, b) { return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0); });
    let titEncerrados = false;
    ordem.forEach(function (l) {
      if (!l.ativo && !titEncerrados) { box.appendChild(el('div', 'col-sub', 'Encerrados')); titEncerrados = true; }
      const b = el('button', 'patio-item' + (l.ativo ? '' : ' encerrado') + (l.loteId === st.loteSel ? ' sel' : ''));
      b.dataset.lote = l.loteId;
      b.appendChild(el('div', 'nome', l.patio));
      b.appendChild(el('div', 'info', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + (l.ativo ? l.fotografados + ' de ' + l.destinaveis : 'encerrado')));
      if (l.ativo) {
        const barra = el('div', 'barra'); const p = el('div');
        p.style.width = (l.destinaveis ? Math.round(100 * l.fotografados / l.destinaveis) : 0) + '%';
        barra.appendChild(p); b.appendChild(barra);
      }
      if (l.naoBaixadas) b.appendChild(el('span', 'tag azul', l.naoBaixadas + ' nova(s)'));
      b.addEventListener('click', function () { abrirPatio(l, false); });
      box.appendChild(b);
    });
  }

  function situacao(v) {
    if (v.naoDestinar) return 'bloq';
    if (v.refazer) return 'refazer';
    if (v.foraDaLista) return 'fora';
    return v.status === 'fotografado' ? 'fotografado' : 'pendente';
  }
  const ROTULO = { bloq: ['vermelho', 'NÃO DESTINAR'], refazer: ['amarelo', '⚠️ refazer'], fora: ['amarelo', 'fora da lista'], fotografado: ['verde', 'fotografado'], pendente: ['', 'pendente'] };

  async function abrirPatio(l, recarga) {
    const mudou = st.loteSel !== l.loteId;
    st.loteSel = l.loteId;
    document.querySelectorAll('#listaLotes .patio-item').forEach(function (b) { b.classList.toggle('sel', b.dataset.lote === l.loteId); });
    const col = $('colLista');
    const filtroAntes = !mudou && st.filtro, buscaAntes = !mudou && st.busca, nroAntes = !mudou && st.nroSel;
    if (mudou) { st.filtro = null; st.busca = ''; st.nroSel = null; vazio($('colDetalhe'), 'Toque em um NRO para ver as fotos.'); }
    if (!recarga) vazio(col, 'Carregando…');
    let vs, fotos;
    try {
      vs = await api('veiculosLote', { loteId: l.loteId });
      fotos = await api('listarFotos', { loteId: l.loteId, somenteNaoBaixadas: false });
    } catch (e) { col.textContent = ''; col.appendChild(el('p', 'erro', e.message)); return; }
    if (st.loteSel !== l.loteId) return;
    col.textContent = '';
    const fotosPorNro = {};
    fotos.forEach(function (f) { const nro = String(f.caminho).split('/')[3]; (fotosPorNro[nro] = fotosPorNro[nro] || []).push(f); });

    // cabeçalho do pátio com as ações (só aparecem depois de escolher o pátio)
    const cab = el('div', 'patio-cab');
    const h = el('h2', null, l.patio + ' ');
    h.appendChild(el('span', 'tag ' + (l.ativo ? 'verde' : ''), l.ativo ? 'ativo' : 'encerrado'));
    cab.appendChild(h);
    cab.appendChild(el('div', 'suave', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + 'criado em ' + data(l.criadoEm) + ' · ' + l.fotos + ' foto(s)' + (l.foraDaLista ? ' · ' + l.foraDaLista + ' fora da lista' : '')));
    const btns = el('div', 'linha-btns');
    const status = el('div', 'suave status-patio');
    const det = $('colDetalhe');
    const bBaixar = el('button', 'btn pequeno verde', '⬇ Baixar fotos' + (l.naoBaixadas ? ' (' + l.naoBaixadas + ' novas)' : ''));
    bBaixar.disabled = !l.fotos;
    bBaixar.addEventListener('click', function () { marcarNro(null); painelBaixar(l, det, status); });
    const bEditar = el('button', 'btn pequeno cinza', '✏️ Editar');
    bEditar.addEventListener('click', function () { marcarNro(null); painelEditar(l, det); });
    const bAtivo = el('button', 'btn pequeno ' + (l.ativo ? 'vermelho' : 'cinza'), l.ativo ? 'Encerrar' : 'Reabrir');
    bAtivo.addEventListener('click', async function () {
      if (l.ativo && !confirm('Encerrar o pátio ' + l.patio + (l.numeroLote ? ' (lista ' + l.numeroLote + ')' : '') + '? Ele some do app de campo. Fotos já guardadas no celular ainda serão enviadas.')) return;
      try { await api('definirAtivo', { loteId: l.loteId, ativo: !l.ativo }); carregarLotes(); } catch (e) { alert(e.message); }
    });
    [bBaixar, bEditar, bAtivo].forEach(function (b) { btns.appendChild(b); });
    if (!l.ativo) {
      const bExcluir = el('button', 'btn pequeno vermelho', '🗑 Excluir');
      bExcluir.addEventListener('click', function () { marcarNro(null); painelExcluir(l, det); });
      btns.appendChild(bExcluir);
    }
    cab.appendChild(btns); cab.appendChild(status);
    col.appendChild(cab);

    // filtros + busca
    const cont = { todos: vs.length };
    vs.forEach(function (v) { const k = situacao(v); cont[k] = (cont[k] || 0) + 1; });
    st.filtro = filtroAntes || (cont.fotografado ? 'fotografado' : 'pendente');
    const FILTROS = [['pendente', 'Pendentes'], ['fotografado', 'Fotografados'], ['refazer', 'Refazer'], ['fora', 'Fora da lista'], ['bloq', 'Não destinar'], ['todos', 'Todos']];
    const barra = el('div', 'filtros filtros-gestao');
    const opcional = function (f) { return f !== 'todos' && f !== 'pendente' && f !== 'fotografado'; };
    FILTROS.forEach(function (fo) {
      const b = el('button', fo[0] === st.filtro ? 'ativo' : '', fo[1] + ' ' + (cont[fo[0]] || 0));
      if (opcional(fo[0]) && !cont[fo[0]]) b.classList.add('oculto');
      b.dataset.filtro = fo[0];
      b.addEventListener('click', function () { st.filtro = fo[0]; barra.querySelectorAll('button').forEach(function (x) { x.classList.toggle('ativo', x === b); }); desenhar(); });
      barra.appendChild(b);
    });
    const busca = el('input'); busca.type = 'search'; busca.placeholder = 'Buscar NRO, placa ou modelo'; busca.value = buscaAntes || '';
    busca.addEventListener('input', function () { st.busca = busca.value; desenhar(); });
    col.appendChild(barra); col.appendChild(busca);
    const lista = el('div', 'lista-nros'); col.appendChild(lista);

    function marcarNro(nro) {
      st.nroSel = nro;
      lista.querySelectorAll('.item').forEach(function (x) { x.classList.toggle('sel', x.dataset.nro === nro); });
    }

    function desenhar() {
      lista.textContent = '';
      const q = norm(busca.value.trim());
      let n = 0;
      vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
        const k = situacao(v);
        if (st.filtro !== 'todos' && k !== st.filtro) return;
        if (q && norm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor).indexOf(q) < 0) return;
        n++;
        const nf = (fotosPorNro[v.nro] || []).length;
        const b = el('button', 'item ' + (k === 'fotografado' ? 'feito' : k === 'bloq' ? 'bloq' : k === 'refazer' ? 'local' : '') + (v.nro === st.nroSel ? ' sel' : ''));
        b.dataset.nro = v.nro;
        b.appendChild(el('div', 'nro', v.nro));
        const d = el('div', 'desc');
        d.appendChild(el('div', 'placa', v.placa || (v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
        d.appendChild(el('div', 'mod', [v.modelo, v.cor, v.categoria].filter(Boolean).join(' · ') || '—'));
        b.appendChild(d);
        b.appendChild(el('div', 'st', k === 'fotografado' || nf ? '🖼 ' + nf : (k === 'refazer' ? '⚠️ refazer' : (k === 'bloq' ? '⛔' : ''))));
        b.addEventListener('click', function () { marcarNro(v.nro); abrirVeiculo(l, v, fotosPorNro, desenharTudo); });
        lista.appendChild(b);
      });
      if (!n) lista.appendChild(el('p', 'vazio', 'Nenhum veículo neste filtro.'));
    }
    function desenharTudo() { // após excluir foto: recontar filtros e redesenhar
      const novo = { todos: vs.length };
      vs.forEach(function (v) { const k = situacao(v); novo[k] = (novo[k] || 0) + 1; });
      barra.querySelectorAll('button').forEach(function (b) {
        const f = b.dataset.filtro;
        b.textContent = b.textContent.replace(/\s\d+$/, '') + ' ' + (novo[f] || 0);
        b.classList.toggle('oculto', opcional(f) && !novo[f] && st.filtro !== f);
      });
      desenhar();
    }
    desenhar();
    if (nroAntes) {
      const v = vs.find(function (x) { return x.nro === nroAntes; });
      if (v && det.dataset.painel === 'veiculo') abrirVeiculo(l, v, fotosPorNro, desenharTudo);
    }
  }

  function abrirVeiculo(l, v, fotosPorNro, aoMudar) {
    const box = $('colDetalhe');
    box.textContent = ''; box.dataset.painel = 'veiculo';
    const k = situacao(v);
    const cab = el('div', 'veiculo-cab');
    const t = el('h2', null, 'NRO ' + v.nro + ' ');
    t.appendChild(el('span', 'tag ' + ROTULO[k][0], ROTULO[k][1]));
    cab.appendChild(t);
    cab.appendChild(el('div', 'placa-grande', v.placa || (v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
    cab.appendChild(el('div', 'suave', [v.modelo, v.cor, v.categoria, v.chassi ? 'chassi ' + v.chassi : ''].filter(Boolean).join(' · ')));
    if (v.apagadasCampo) cab.appendChild(el('div', 'suave', v.apagadasCampo + ' foto(s) apagada(s) pelo campo — vão no .zip marcadas como _APAGADA-PELO-CAMPO'));
    box.appendChild(cab);
    const fs = fotosPorNro[v.nro] || [];
    if (!fs.length) { box.appendChild(el('p', 'vazio', k === 'bloq' ? 'Veículo NÃO DESTINAR — não é fotografado.' : 'Nenhuma foto deste NRO ainda.')); return; }
    const gal = el('div', 'galeria galeria-gestao'); box.appendChild(gal);
    fs.forEach(function (f) {
      const c = el('div', 'foto-cartao');
      const img = el('img'); img.alt = 'Foto ' + String(f.caminho).split('/').pop(); img.title = 'Clique para ampliar';
      img.addEventListener('click', function () {
        api('miniatura', { uuid: f.uuid, grande: true }).then(function (m) { ampliar('data:' + m.tipo + ';base64,' + m.base64); }).catch(function (e) { alert(e.message); });
      });
      c.appendChild(img);
      const nome = String(f.caminho).split('/').pop();
      c.appendChild(el('div', 'suave', nome + (f.baixada ? ' · já baixada' : ' · nova')));
      const b = el('button', 'btn pequeno vermelho', '🗑 Excluir (pedir refazer)');
      b.addEventListener('click', async function () {
        if (!confirm('Excluir a foto ' + nome + ' do NRO ' + v.nro + '?\n\nEla vai para a lixeira do Drive (30 dias) e o NRO volta a ficar PENDENTE para o campo tirar foto nova.')) return;
        b.disabled = true;
        try {
          await api('excluirFotoGestao', { uuid: f.uuid });
          fotosPorNro[v.nro] = fotosPorNro[v.nro].filter(function (x) { return x.uuid !== f.uuid; });
          v.refazer = true;
          aoMudar();
          abrirVeiculo(l, v, fotosPorNro, aoMudar);
        } catch (e) { alert(e.message); b.disabled = false; }
      });
      c.appendChild(b);
      gal.appendChild(c);
      const cache = st.minis[f.uuid];
      if (cache) img.src = cache;
      else api('miniatura', { uuid: f.uuid }).then(function (m) { img.src = st.minis[f.uuid] = 'data:' + m.tipo + ';base64,' + m.base64; }).catch(function () { img.alt = 'não carregou'; });
    });
  }
  st.minis = {};

  function ampliar(src) {
    const fundo = el('div', 'modal-fundo');
    const img = el('img', 'foto-grande'); img.src = src; img.alt = 'Foto ampliada';
    fundo.appendChild(img);
    fundo.addEventListener('click', function () { fundo.remove(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { fundo.remove(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(fundo);
  }

  // ---------- editar / excluir pátio ----------
  function abrirPainel(box, nome) {
    box.textContent = ''; box.dataset.painel = nome; return true;
  }

  function painelEditar(l, box) {
    if (!abrirPainel(box, 'editar')) return;
    const p = el('div', 'painel-baixar');
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
    const p = el('div', 'painel-baixar painel-perigo');
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

    const p = el('div', 'painel-baixar');
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

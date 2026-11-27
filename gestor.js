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
    fecharGaveta();
    ['abaLotes', 'abaNovo', 'abaUsuarios', 'abaConta'].forEach(function (a) { $(a).classList.toggle('oculto', a !== id); });
    document.querySelectorAll('.abas button').forEach(function (b) { b.classList.toggle('ativo', b.dataset.aba === id); });
    if (id === 'abaLotes') carregarLotes();
    if (id === 'abaUsuarios') carregarUsuarios();
  }

  // ---------- pátios (layout D: escolher pátio → painel com indicadores, tabela e gaveta) ----------
  $('btnRecarregar').addEventListener('click', function () { carregarLotes(); });
  $('btnFecharGaveta').addEventListener('click', fecharGaveta);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.modal-fundo')) fecharGaveta(); });
  st.lotes = []; st.minis = {};
  st.loteSel = (function () { try { return localStorage.getItem('fotosCrvPatio'); } catch (e) { return null; } })();
  const norm = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  const ehAdmin = function () { return st.sessao && st.sessao.papel === 'admin'; };
  const CAT = { carros: 'Carros', motos: 'Motos', outros: 'Outros' };
  function vazio(box, texto) { box.textContent = ''; box.appendChild(el('p', 'vazio', texto)); }
  function guardarPatio(id) { st.loteSel = id; try { if (id) localStorage.setItem('fotosCrvPatio', id); else localStorage.removeItem('fotosCrvPatio'); } catch (e) { /* sem armazenamento */ } }
  function mostrarGaveta() { $('gaveta').classList.remove('oculto'); document.body.classList.add('com-gaveta'); }
  function fecharGaveta() {
    $('gaveta').classList.add('oculto'); document.body.classList.remove('com-gaveta'); $('gavetaConteudo').textContent = ''; $('gavetaConteudo').dataset.painel = '';
    st.nroSel = null;
    document.querySelectorAll('#painelPatio tr.sel').forEach(function (x) { x.classList.remove('sel'); });
  }

  async function carregarLotes() {
    if (!st.lotes.length) vazio($('listaLotes'), 'Carregando…');
    let lotes;
    try { lotes = await api('listarLotes', { incluirEncerrados: true }); }
    catch (e) { $('listaLotes').textContent = ''; $('listaLotes').appendChild(el('p', 'erro', e.message)); return; }
    st.lotes = lotes;
    desenharPatios();
    const l = lotes.find(function (x) { return x.loteId === st.loteSel; });
    if (l && !st.escolhendo) abrirPatio(l);
    else { if (!l) guardarPatio(null); mostrarSeletor(); }
  }

  function mostrarSeletor() {
    st.escolhendo = true;
    fecharGaveta();
    $('seletorPatios').classList.remove('oculto'); $('painelPatio').classList.add('oculto');
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
      b.appendChild(el('div', 'info', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + (l.ativo ? l.fotografados + ' de ' + l.destinaveis + ' fotografados' : 'encerrado · ' + l.fotos + ' foto(s)')));
      const barra = el('div', 'barra'); const p = el('div');
      p.style.width = (l.destinaveis ? Math.round(100 * l.fotografados / l.destinaveis) : 0) + '%';
      barra.appendChild(p); b.appendChild(barra);
      if (l.naoBaixadas) b.appendChild(el('span', 'tag azul', l.naoBaixadas + ' foto(s) nova(s)'));
      b.addEventListener('click', function () { st.escolhendo = false; guardarPatio(l.loteId); abrirPatio(l); });
      box.appendChild(b);
    });
  }

  function situacao(v) {
    if (v.naoDestinar) return 'bloq';
    if (v.foraDaLista) return 'fora';
    return v.fotos ? 'fotografado' : 'pendente';
  }
  const ROTULO = { bloq: ['vermelho', 'NÃO DESTINAR'], fora: ['amarelo', 'fora da lista'], fotografado: ['verde', 'fotografado'], pendente: ['', 'pendente'] };

  async function abrirPatio(l) {
    const mudou = st.patioAberto !== l.loteId;
    st.patioAberto = l.loteId;
    $('seletorPatios').classList.add('oculto');
    const pp = $('painelPatio'); pp.classList.remove('oculto');
    if (mudou) { st.filtro = null; st.busca = ''; fecharGaveta(); vazio(pp, 'Carregando ' + l.patio + '…'); }
    let vs, fotos;
    try {
      vs = await api('veiculosLote', { loteId: l.loteId });
      fotos = await api('listarFotos', { loteId: l.loteId, somenteNaoBaixadas: false });
    } catch (e) { pp.textContent = ''; pp.appendChild(el('p', 'erro', e.message)); return; }
    if (st.patioAberto !== l.loteId) return;
    st.ctx = { l: l, vs: vs, fotosPorNro: {} };
    fotos.forEach(function (f) { const nro = String(f.caminho).split('/')[3]; (st.ctx.fotosPorNro[nro] = st.ctx.fotosPorNro[nro] || []).push(f); });
    pp.textContent = '';

    // linha fina do pátio escolhido (a lista de pátios fica escondida)
    const faixa = el('div', 'faixa-patio');
    faixa.appendChild(el('span', 'faixa-nome', '📍 ' + l.patio));
    faixa.appendChild(el('span', 'suave', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + 'criado em ' + data(l.criadoEm)));
    faixa.appendChild(el('span', 'tag ' + (l.ativo ? 'verde' : ''), l.ativo ? 'ativo' : 'encerrado'));
    const bTrocar = el('button', 'btn pequeno cinza', '⇄ Trocar pátio');
    bTrocar.addEventListener('click', function () { desenharPatios(); mostrarSeletor(); });
    faixa.appendChild(bTrocar);
    pp.appendChild(faixa);

    // ações do pátio
    const acoes = el('div', 'linha-btns acoes-patio');
    const status = el('div', 'suave status-patio');
    const det = $('gavetaConteudo');
    const bBaixar = el('button', 'btn pequeno verde', '⬇ Baixar fotos' + (l.naoBaixadas ? ' (' + l.naoBaixadas + ' novas)' : ''));
    bBaixar.disabled = !l.fotos;
    bBaixar.addEventListener('click', function () { marcarLinha(null); painelBaixar(l, det, status); });
    const bEditar = el('button', 'btn pequeno cinza', '✏️ Editar pátio');
    bEditar.addEventListener('click', function () { marcarLinha(null); painelEditar(l, det); });
    const bAtivo = el('button', 'btn pequeno ' + (l.ativo ? 'vermelho' : 'cinza'), l.ativo ? 'Encerrar' : 'Reabrir');
    bAtivo.addEventListener('click', async function () {
      if (l.ativo && !confirm('Encerrar o pátio ' + l.patio + (l.numeroLote ? ' (lista ' + l.numeroLote + ')' : '') + '? Ele some do app de campo. Fotos já guardadas no celular ainda serão enviadas.')) return;
      try { await api('definirAtivo', { loteId: l.loteId, ativo: !l.ativo }); carregarLotes(); } catch (e) { alert(e.message); }
    });
    [bBaixar, bEditar, bAtivo].forEach(function (b) { acoes.appendChild(b); });
    if (!l.ativo) {
      const bExcluir = el('button', 'btn pequeno vermelho', '🗑 Excluir pátio');
      bExcluir.addEventListener('click', function () { marcarLinha(null); painelExcluir(l, det); });
      acoes.appendChild(bExcluir);
    }
    if (ehAdmin()) {
      const bReset = el('button', 'btn pequeno vermelho', '♻ Resetar pátio');
      bReset.title = 'Só admin';
      bReset.addEventListener('click', function () { marcarLinha(null); painelResetar(l, det); });
      acoes.appendChild(bReset);
    }
    pp.appendChild(acoes); pp.appendChild(status);

    // indicadores (clicar filtra a tabela)
    const cont = { todos: vs.length, pendente: 0, fotografado: 0, bloq: 0, fora: 0 };
    vs.forEach(function (v) { cont[situacao(v)]++; });
    st.filtro = st.filtro || (cont.fotografado ? 'fotografado' : 'pendente');
    const kpis = el('div', 'kpis');
    const KPI = [['pendente', 'Pendentes', ''], ['fotografado', 'Fotografados', 'verde'], ['bloq', 'Não destinar', 'vermelho'], ['fora', 'Fora da lista', 'amarelo'], ['todos', 'Todos', '']];
    KPI.forEach(function (k) {
      if (k[0] === 'fora' && !cont.fora) return;
      const b = el('button', 'kpi ' + k[2] + (st.filtro === k[0] ? ' ativo' : ''));
      b.dataset.filtro = k[0];
      b.appendChild(el('div', 'kpi-rot', k[1])); b.appendChild(el('div', 'kpi-num', String(cont[k[0]])));
      b.addEventListener('click', function () { st.filtro = k[0]; kpis.querySelectorAll('.kpi[data-filtro]').forEach(function (x) { x.classList.toggle('ativo', x === b); }); desenhar(); });
      kpis.appendChild(b);
    });
    const kNovas = el('button', 'kpi azul');
    kNovas.appendChild(el('div', 'kpi-rot', 'Fotos não baixadas')); kNovas.appendChild(el('div', 'kpi-num', String(l.naoBaixadas)));
    kNovas.title = 'Abrir "Baixar fotos"';
    kNovas.addEventListener('click', function () { if (l.fotos) { marcarLinha(null); painelBaixar(l, det, status); } });
    kpis.appendChild(kNovas);
    pp.appendChild(kpis);

    const busca = el('input', 'busca-tabela'); busca.type = 'search'; busca.placeholder = 'Buscar NRO, placa ou modelo'; busca.value = st.busca || '';
    busca.addEventListener('input', function () { st.busca = busca.value; desenhar(); });
    pp.appendChild(busca);
    const wrap = el('div', 'tabela-wrap'); pp.appendChild(wrap);
    const tab = el('table', 'tabela-veiculos'); wrap.appendChild(tab);

    function marcarLinha(nro) {
      st.nroSel = nro;
      tab.querySelectorAll('tr[data-nro]').forEach(function (x) { x.classList.toggle('sel', x.dataset.nro === nro); });
    }
    st.ctx.marcarLinha = marcarLinha;

    function desenhar() {
      tab.textContent = '';
      const cab = el('tr');
      ['NRO', 'Placa', 'Veículo', 'Categoria', 'Fotos', 'Situação'].forEach(function (c) { cab.appendChild(el('th', null, c)); });
      tab.appendChild(cab);
      const q = norm(busca.value.trim());
      let n = 0;
      vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
        const k = situacao(v);
        if (st.filtro !== 'todos' && k !== st.filtro) return;
        if (q && norm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor).indexOf(q) < 0) return;
        n++;
        const tr = el('tr', v.nro === st.nroSel ? 'sel' : '');
        tr.dataset.nro = v.nro; tr.tabIndex = 0;
        tr.appendChild(el('td', 'td-nro', v.nro));
        tr.appendChild(el('td', null, v.placa ? v.placa + (v.uf ? ' · ' + v.uf : '') : '—'));
        tr.appendChild(el('td', null, [v.modelo, v.cor].filter(Boolean).join(' · ') || '—'));
        tr.appendChild(el('td', null, CAT[v.categoria] || v.categoria));
        tr.appendChild(el('td', null, String((st.ctx.fotosPorNro[v.nro] || []).length)));
        const td = el('td'); td.appendChild(el('span', 'tag ' + ROTULO[k][0], ROTULO[k][1])); tr.appendChild(td);
        const abrir = function () { marcarLinha(v.nro); abrirVeiculo(v); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(); });
        tab.appendChild(tr);
      });
      if (!n) { const tr = el('tr'); const td = el('td', 'vazio', 'Nenhum veículo neste filtro.'); td.colSpan = 6; tr.appendChild(td); tab.appendChild(tr); }
    }
    desenhar();
    if (st.nroSel && $('gavetaConteudo').dataset.painel === 'veiculo') {
      const v = vs.find(function (x) { return x.nro === st.nroSel; });
      if (v) abrirVeiculo(v); else fecharGaveta();
    }
  }

  // recarrega o pátio aberto mantendo filtro, busca e a gaveta
  async function recarregarPatio() {
    let lotes;
    try { lotes = await api('listarLotes', { incluirEncerrados: true }); } catch (e) { alert(e.message); return; }
    st.lotes = lotes;
    const l = lotes.find(function (x) { return x.loteId === st.patioAberto; });
    if (l) abrirPatio(l); else carregarLotes();
  }

  function abrirVeiculo(v) {
    const l = st.ctx.l;
    const box = $('gavetaConteudo');
    box.textContent = ''; box.dataset.painel = 'veiculo';
    mostrarGaveta();
    const k = situacao(v);
    const cab = el('div', 'veiculo-cab');
    const t = el('h2', null, 'NRO ' + v.nro + ' ');
    t.appendChild(el('span', 'tag ' + ROTULO[k][0], ROTULO[k][1]));
    cab.appendChild(t);
    cab.appendChild(el('div', 'placa-grande', v.placa ? v.placa + (v.uf ? ' · ' + v.uf : '') : (v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
    cab.appendChild(el('div', 'suave', [v.modelo, v.cor, CAT[v.categoria], v.chassi ? 'chassi ' + v.chassi : ''].filter(Boolean).join(' · ')));
    if (v.apagadasCampo) cab.appendChild(el('div', 'suave', v.apagadasCampo + ' foto(s) apagada(s) pelo campo — vão no .zip marcadas como _APAGADA-PELO-CAMPO'));
    box.appendChild(cab);

    const fs = st.ctx.fotosPorNro[v.nro] || [];
    if (!fs.length) box.appendChild(el('p', 'vazio', k === 'bloq' ? 'Veículo NÃO DESTINAR — não é fotografado.' : 'Nenhuma foto deste NRO ainda.'));
    else {
      st.fotoSel = fs.some(function (f) { return f.uuid === st.fotoSel; }) ? st.fotoSel : fs[0].uuid;
      const grande = el('img', 'foto-visor'); grande.alt = 'Foto selecionada'; grande.title = 'Clique para ampliar';
      box.appendChild(grande);
      const legenda = el('div', 'suave'); box.appendChild(legenda);
      const tira = el('div', 'tira-fotos'); box.appendChild(tira);
      const acoesFoto = el('div', 'linha-btns'); box.appendChild(acoesFoto);
      const area = el('div', 'area-acao'); box.appendChild(area);

      const selecionar = function (f) {
        st.fotoSel = f.uuid;
        tira.querySelectorAll('img').forEach(function (i) { i.classList.toggle('sel', i.dataset.uuid === f.uuid); });
        const nome = String(f.caminho).split('/').pop();
        legenda.textContent = 'Foto ' + (fs.indexOf(f) + 1) + ' de ' + fs.length + ' · ' + nome + (f.baixada ? ' · já baixada' : ' · ainda não baixada');
        grande.src = st.minis[f.uuid] || '';
        grande.onclick = function () { api('miniatura', { uuid: f.uuid, grande: true }).then(function (m) { ampliar('data:' + m.tipo + ';base64,' + m.base64); }).catch(function (e) { alert(e.message); }); };
        acoesFoto.textContent = ''; area.textContent = '';
        const bEx = el('button', 'btn pequeno vermelho', '🗑 Excluir esta foto');
        bEx.addEventListener('click', async function () {
          const ultima = fs.length === 1;
          if (!confirm('Excluir a foto ' + nome + ' do NRO ' + v.nro + '?\n\nEla vai para a lixeira do Drive (30 dias).' + (ultima ? ' É a única foto: o NRO volta a ficar PENDENTE para o campo.' : ''))) return;
          bEx.disabled = true;
          try { await api('excluirFotoGestao', { uuid: f.uuid }); recarregarPatio(); }
          catch (e) { alert(e.message); bEx.disabled = false; }
        });
        const bMov = el('button', 'btn pequeno cinza', '↪ Mover para outro NRO');
        bMov.addEventListener('click', function () { formMover(area, f, v); });
        acoesFoto.appendChild(bEx); acoesFoto.appendChild(bMov);
      };
      fs.forEach(function (f) {
        const img = el('img'); img.alt = 'Miniatura ' + String(f.caminho).split('/').pop(); img.dataset.uuid = f.uuid;
        img.addEventListener('click', function () { selecionar(f); });
        tira.appendChild(img);
        const pronto = function (src) { img.src = src; if (st.fotoSel === f.uuid) grande.src = src; };
        if (st.minis[f.uuid]) pronto(st.minis[f.uuid]);
        else api('miniatura', { uuid: f.uuid }).then(function (m) { pronto(st.minis[f.uuid] = 'data:' + m.tipo + ';base64,' + m.base64); }).catch(function () { img.alt = 'não carregou'; });
      });
      selecionar(fs.find(function (f) { return f.uuid === st.fotoSel; }));
    }

    // ações do veículo (gestão e admin)
    box.appendChild(el('div', 'titulo-secao', 'Veículo'));
    const av = el('div', 'linha-btns'); box.appendChild(av);
    const areaV = el('div', 'area-acao'); box.appendChild(areaV);
    const bEd = el('button', 'btn pequeno cinza', '✏️ Editar veículo');
    bEd.addEventListener('click', function () { formEditarVeiculo(areaV, v); });
    av.appendChild(bEd);
    if (fs.length) {
      const bRes = el('button', 'btn pequeno vermelho', '♻ Resetar NRO');
      bRes.addEventListener('click', async function () {
        if (!confirm('Resetar o NRO ' + v.nro + '?\n\nAs ' + fs.length + ' foto(s) dele vão para a lixeira do Drive (30 dias) e ele volta a ficar PENDENTE para o campo.' + (v.foraDaLista ? '\nComo é um NRO fora da lista, ele sai da lista.' : ''))) return;
        bRes.disabled = true;
        try { await api('resetarVeiculo', { loteId: l.loteId, nro: v.nro }); recarregarPatio(); }
        catch (e) { alert(e.message); bRes.disabled = false; }
      });
      av.appendChild(bRes);
    }
  }

  function formMover(area, f, v) {
    area.textContent = '';
    const p = el('div', 'painel-baixar');
    p.appendChild(el('h3', null, 'Mover ' + String(f.caminho).split('/').pop() + ' para outro NRO'));
    p.appendChild(el('label', null, 'Pátio'));
    const sel = el('select');
    st.lotes.forEach(function (x) { const o = el('option', null, x.patio + (x.numeroLote ? ' · lista ' + x.numeroLote : '') + (x.ativo ? '' : ' (encerrado)')); o.value = x.loteId; sel.appendChild(o); });
    sel.value = st.ctx.l.loteId; p.appendChild(sel);
    p.appendChild(el('label', null, 'NRO de destino'));
    const i = el('input'); i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = 12; p.appendChild(i);
    p.appendChild(el('p', 'suave', 'A foto muda de pasta no Drive, ganha o nome do novo NRO e volta a contar como "não baixada".'));
    const msg = el('div', 'erro'); p.appendChild(msg);
    const b = el('button', 'btn verde', 'Mover foto'); p.appendChild(b);
    b.addEventListener('click', async function () {
      const nro = i.value.trim();
      if (!nro) { msg.textContent = 'Informe o NRO.'; return; }
      b.disabled = true; msg.textContent = '';
      try {
        const r = await api('moverFoto', { uuid: f.uuid, loteId: sel.value, nro: nro });
        msg.className = 'ok'; msg.textContent = 'Foto movida para o NRO ' + nro + ' como ' + r.nome + '.';
        setTimeout(recarregarPatio, 900);
      } catch (e) { msg.className = 'erro'; msg.textContent = e.message; b.disabled = false; }
    });
    area.appendChild(p); i.focus();
  }

  function formEditarVeiculo(area, v) {
    area.textContent = '';
    const p = el('div', 'painel-baixar');
    p.appendChild(el('h3', null, 'Editar NRO ' + v.nro));
    const campo = function (rot, valor, max) { p.appendChild(el('label', null, rot)); const i = el('input'); i.type = 'text'; i.maxLength = max; i.value = valor || ''; p.appendChild(i); return i; };
    p.appendChild(el('label', null, 'Categoria'));
    const cat = el('select');
    ['carros', 'motos', 'outros'].forEach(function (c) { const o = el('option', null, CAT[c]); o.value = c; cat.appendChild(o); });
    cat.value = v.categoria; p.appendChild(cat);
    const iPlaca = campo('Placa', v.placa, 10), iUf = campo('UF', v.uf, 2), iMod = campo('Modelo', v.modelo, 80), iCor = campo('Cor', v.cor, 30);
    const lab = el('label', 'opcao'); const nd = el('input'); nd.type = 'checkbox'; nd.checked = !!v.naoDestinar;
    lab.appendChild(nd); lab.appendChild(document.createTextNode(' NÃO DESTINAR (não pode sair do CRV)')); p.appendChild(lab);
    const fs = st.ctx.fotosPorNro[v.nro] || [];
    if (fs.length) p.appendChild(el('p', 'suave', 'Trocando a categoria, as ' + fs.length + ' foto(s) mudam de pasta e voltam a contar como "não baixadas".'));
    const msg = el('div', 'erro'); p.appendChild(msg);
    const b = el('button', 'btn verde', 'Salvar'); p.appendChild(b);
    b.addEventListener('click', async function () {
      b.disabled = true; msg.textContent = '';
      try {
        await api('editarVeiculo', { loteId: st.ctx.l.loteId, nro: v.nro, categoria: cat.value, placa: iPlaca.value.trim(), uf: iUf.value.trim(), modelo: iMod.value.trim(), cor: iCor.value.trim(), naoDestinar: nd.checked });
        msg.className = 'ok'; msg.textContent = 'Salvo.';
        setTimeout(recarregarPatio, 700);
      } catch (e) { msg.className = 'erro'; msg.textContent = e.message; b.disabled = false; }
    });
    area.appendChild(p);
  }

  function painelResetar(l, box) {
    abrirPainel(box, 'resetar');
    const p = el('div', 'painel-baixar painel-perigo');
    p.appendChild(el('h3', 'erro', '♻ Resetar o pátio ' + l.patio));
    p.appendChild(el('p', null, 'Todas as ' + l.fotos + ' foto(s) deste pátio vão para a lixeira do Google Drive (recuperáveis por 30 dias) e todos os NROs voltam a ficar PENDENTES. A lista de veículos continua igual; NROs digitados fora da lista são removidos.'));
    if (l.naoBaixadas) p.appendChild(el('p', 'aviso', '⚠️ ' + l.naoBaixadas + ' foto(s) ainda NÃO foram baixadas. Baixe antes se precisar delas.'));
    p.appendChild(el('label', null, 'Para confirmar, digite o nome do pátio: ' + l.patio));
    const i = el('input'); i.type = 'text'; i.autocomplete = 'off'; p.appendChild(i);
    const msg = el('div', 'erro'); p.appendChild(msg);
    const b = el('button', 'btn vermelho', 'Resetar pátio'); b.disabled = true; p.appendChild(b);
    i.addEventListener('input', function () { b.disabled = i.value.trim().toUpperCase() !== String(l.patio).trim().toUpperCase(); });
    b.addEventListener('click', async function () {
      b.disabled = true; msg.textContent = '';
      try {
        const r = await api('resetarLote', { loteId: l.loteId, confirmacao: i.value.trim() });
        msg.className = 'ok'; msg.textContent = 'Pátio resetado. ' + r.fotosNaLixeira + ' foto(s) foram para a lixeira do Drive.';
        setTimeout(recarregarPatio, 1500);
      } catch (e) { msg.className = 'erro'; msg.textContent = e.message; b.disabled = false; }
    });
    box.appendChild(p); i.focus();
  }

  function ampliar(src) {
    const fundo = el('div', 'modal-fundo');
    const img = el('img', 'foto-grande'); img.src = src; img.alt = 'Foto ampliada';
    fundo.appendChild(img);
    const fechar = function () { fundo.remove(); document.removeEventListener('keydown', esc); };
    const esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    fundo.addEventListener('click', fechar);
    document.addEventListener('keydown', esc, true);
    document.body.appendChild(fundo);
  }

  // ---------- editar / excluir pátio ----------
  function abrirPainel(box, nome) {
    box.textContent = ''; box.dataset.painel = nome; mostrarGaveta(); return true;
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
        setTimeout(recarregarPatio, 1200);
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
      const sit = v.naoDestinar ? 'NÃO DESTINAR' : (v.foraDaLista ? 'fora da lista' : v.status);
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

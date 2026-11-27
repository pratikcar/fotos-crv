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
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    ['abaLotes', 'abaNovo', 'abaUsuarios', 'abaConta'].forEach(function (a) { $(a).classList.toggle('oculto', a !== id); });
    document.querySelectorAll('.abas button').forEach(function (b) { b.classList.toggle('ativo', b.dataset.aba === id); });
    if (id === 'abaLotes') carregarLotes();
    if (id === 'abaUsuarios') carregarUsuarios();
  }

  // ---------- pátios (layout D: escolher pátio → painel com indicadores, tabela e gaveta) ----------
  $('btnRecarregar').addEventListener('click', function () { carregarLotes(); });
  $('btnFecharGaveta').addEventListener('click', fecharGaveta);
  $('gaveta').addEventListener('click', function (e) { if (e.target === $('gaveta') && $('gaveta').classList.contains('janela')) fecharGaveta(); });
  document.addEventListener('keydown', function (e) {
    if (document.querySelector('.modal-fundo')) return;
    if (e.key === 'Escape') fecharGaveta();
    const digitando = /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '');
    if (!digitando && $('gavetaConteudo').dataset.painel === 'veiculo' && st.navGaveta) {
      if (e.key === 'ArrowRight') st.navGaveta(1);
      if (e.key === 'ArrowLeft') st.navGaveta(-1);
    }
  });
  st.lotes = []; st.minis = {};
  st.loteSel = (function () { try { return localStorage.getItem('fotosCrvPatio'); } catch (e) { return null; } })();
  const norm = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  const ehAdmin = function () { return st.sessao && st.sessao.papel === 'admin'; };
  const CAT = { carros: 'Carros', motos: 'Motos', outros: 'Outros' };
  function toast(msg) {
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    const t = el('div', 'toast'); t.appendChild(ic('check', 'p')); t.appendChild(document.createTextNode(' ' + msg)); t.setAttribute('role', 'status'); document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }
  // confirmação própria (no lugar do confirm() do navegador)
  function confirmar(titulo, texto, rotulo, perigo) {
    return new Promise(function (ok) {
      const fundo = el('div', 'modal-fundo'); const m = el('div', 'modal'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.appendChild(el('h2', null, titulo));
      String(texto).split('\n').filter(Boolean).forEach(function (p) { m.appendChild(el('p', null, p)); });
      const linha = el('div', 'linha-btns');
      const sim = botao('btn pequeno ' + (perigo ? 'vermelho' : ''), perigo ? 'lixo' : 'check', rotulo);
      const nao = botao('btn pequeno cinza', null, 'Cancelar');
      const fim = function (v) { fundo.remove(); document.removeEventListener('keydown', esc, true); ok(v); };
      const esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); fim(false); } };
      sim.addEventListener('click', function () { fim(true); }); nao.addEventListener('click', function () { fim(false); });
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fim(false); });
      document.addEventListener('keydown', esc, true);
      linha.appendChild(sim); linha.appendChild(nao); m.appendChild(linha); fundo.appendChild(m); document.body.appendChild(fundo);
      nao.focus();
    });
  }
  document.querySelectorAll('.ver-senha').forEach(function (b) {
    b.addEventListener('click', function () {
      const i = $(b.dataset.alvo); const ver = i.type === 'password'; i.type = ver ? 'text' : 'password';
      b.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha'); b.textContent = ''; b.appendChild(ic(ver ? 'olhofechado' : 'olho'));
    });
  });
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function vazio(box, texto, icone) { box.textContent = ''; const v = el('div', 'vazio'); if (icone) v.appendChild(ic(icone)); v.appendChild(el('div', null, texto)); box.appendChild(v); }
  function botao(cls, icone, texto) { const b = el('button', cls); if (icone) b.appendChild(ic(icone, 'p')); b.appendChild(document.createTextNode(texto)); return b; }
  function etiqueta(k) { const r = ROTULO[k]; const t = el('span', 'tag ' + r[0]); t.appendChild(ic(r[2])); t.appendChild(document.createTextNode(r[1])); return t; }
  function anel(feitos, total) {
    const pct = total ? Math.round(100 * feitos / total) : 0;
    const a = el('div', 'anel'); a.style.setProperty('--p', pct); a.appendChild(el('span', null, pct + '%'));
    a.setAttribute('aria-label', pct + '% fotografado'); return a;
  }
  // placa: antiga com hífen (ABC-1234); Mercosul sem hífen (ABC1D23)
  function fmtPlaca(p) { p = String(p || '').toUpperCase(); return /^[A-Z]{3}\d{4}$/.test(p) ? p.slice(0, 3) + '-' + p.slice(3) : p; }
  function ehMercosul(p) { return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(String(p || '').toUpperCase()); }
  function placaVis(placa, uf, peq) {
    const p = el('div', 'placa-vis' + (peq ? ' peq' : '') + (placa ? (ehMercosul(placa) ? ' mercosul' : '') : ' sem'));
    p.appendChild(el('b', null, placa ? fmtPlaca(placa) : 'sem placa'));
    if (uf) p.title = 'UF ' + uf;
    return p;
  }
  function guardarPatio(id) { st.loteSel = id; try { if (id) localStorage.setItem('fotosCrvPatio', id); else localStorage.removeItem('fotosCrvPatio'); } catch (e) { /* sem armazenamento */ } }
  function mostrarGaveta() { $('gaveta').classList.remove('oculto', 'janela'); document.body.classList.add('com-gaveta'); }
  function fecharGaveta() {
    $('gaveta').classList.add('oculto'); $('gaveta').classList.remove('janela'); document.body.classList.remove('com-gaveta'); $('gavetaConteudo').textContent = ''; $('gavetaConteudo').dataset.painel = '';
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
    if (!st.lotes.length) { vazio(box, 'Nenhum pátio ainda. Use "Novo pátio (Excel)" para enviar a planilha.', 'planilha'); return; }
    const ordem = st.lotes.slice().sort(function (a, b) { return ((b.ativo ? 1 : 0) - (a.ativo ? 1 : 0)) || (b.naoBaixadas - a.naoBaixadas); });
    let titEncerrados = false;
    if (ordem[0] && ordem[0].ativo) box.appendChild(el('div', 'col-sub', 'Ativos'));
    ordem.forEach(function (l) {
      if (!l.ativo && !titEncerrados) { box.appendChild(el('div', 'col-sub', 'Encerrados')); titEncerrados = true; }
      const b = el('button', 'patio-item' + (l.ativo ? '' : ' encerrado') + (l.loteId === st.loteSel ? ' sel' : ''));
      b.dataset.lote = l.loteId;
      const icb = el('div', 'kpi-ic'); icb.appendChild(ic('pin')); b.appendChild(icb);
      const corpo = el('div', 'corpo');
      const pct = l.destinaveis ? Math.round(100 * l.fotografados / l.destinaveis) : 0;
      const ln = el('div', 'nome-linha'); ln.appendChild(el('div', 'nome', l.patio)); ln.appendChild(el('span', 'pct', pct + '%')); corpo.appendChild(ln);
      corpo.appendChild(el('div', 'info', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + 'criado em ' + data(l.criadoEm).split(',')[0]));
      const pr = el('div', 'progresso-txt'); pr.appendChild(el('b', null, l.fotografados + ' de ' + l.destinaveis)); pr.appendChild(document.createTextNode(' fotografados · ' + plural(l.fotos, 'foto', 'fotos')));
      corpo.appendChild(pr);
      const barraP = el('div', 'barra'); const bpp = el('div'); bpp.style.width = (l.destinaveis ? Math.max(l.fotografados ? 2 : 0, Math.round(100 * l.fotografados / l.destinaveis)) : 0) + '%'; barraP.appendChild(bpp); corpo.appendChild(barraP);
      const tags = el('div', 'linha-btns'); tags.style.marginTop = '2px';
      const te = el('span', 'tag ' + (l.ativo ? 'verde' : '')); te.appendChild(l.ativo ? el('span', 'ponto') : ic('cadeado')); te.appendChild(document.createTextNode(l.ativo ? 'Ativo' : 'Encerrado')); tags.appendChild(te);
      if (l.naoBaixadas) { const tn = el('span', 'tag azul'); tn.appendChild(ic('download')); tn.appendChild(document.createTextNode(plural(l.naoBaixadas, 'foto nova para baixar', 'fotos novas para baixar'))); tags.appendChild(tn); }
      corpo.appendChild(tags);
      b.appendChild(corpo);
      b.appendChild(ic('seta'));
      b.addEventListener('click', function () { st.escolhendo = false; guardarPatio(l.loteId); abrirPatio(l); });
      box.appendChild(b);
    });
  }

  function situacao(v) {
    if (v.naoDestinar) return 'bloq';
    if (v.foraDaLista) return 'fora';
    return v.status === 'fotografado' ? 'fotografado' : 'pendente';
  }
  const ROTULO = { bloq: ['vermelho', 'NÃO DESTINAR', 'bloq'], fora: ['amarelo', 'Fora da lista', 'alerta'], fotografado: ['verde', 'Fotografado', 'check'], pendente: ['', 'Pendente', 'pendente'] };

  async function abrirPatio(l) {
    const mudou = st.patioAberto !== l.loteId;
    st.patioAberto = l.loteId;
    $('seletorPatios').classList.add('oculto');
    const pp = $('painelPatio'); pp.classList.remove('oculto');
    if (mudou) { st.filtro = null; st.busca = ''; st.soDificil = false; fecharGaveta(); vazio(pp, 'Carregando ' + l.patio + '…'); }
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
    const fn = el('span', 'faixa-nome'); fn.appendChild(ic('pin')); fn.appendChild(document.createTextNode(l.patio)); faixa.appendChild(fn);
    const te = el('span', 'tag ' + (l.ativo ? 'verde' : '')); te.appendChild(l.ativo ? el('span', 'ponto') : ic('cadeado')); te.appendChild(document.createTextNode(l.ativo ? 'Ativo' : 'Encerrado')); faixa.appendChild(te);
    faixa.appendChild(el('span', 'meta', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + 'criado em ' + data(l.criadoEm)));
    const bTrocar = botao('btn pequeno cinza', 'trocar', 'Trocar pátio');
    bTrocar.addEventListener('click', function () { desenharPatios(); mostrarSeletor(); });
    faixa.appendChild(bTrocar);
    pp.appendChild(faixa);

    // ações do pátio
    const acoes = el('div', 'linha-btns acoes-patio');
    const status = el('div', 'suave status-patio');
    const det = $('gavetaConteudo');
    const bBaixar = botao('btn pequeno verde', 'download', 'Baixar fotos' + (l.naoBaixadas ? ' (' + l.naoBaixadas + ' novas)' : ''));
    bBaixar.disabled = !l.fotos;
    bBaixar.addEventListener('click', function () { marcarLinha(null); painelBaixar(l, det, status); });
    const bEditar = botao('btn pequeno cinza', 'editar', 'Editar pátio');
    bEditar.addEventListener('click', function () { marcarLinha(null); painelEditar(l, det); });
    const bAtivo = botao('btn pequeno ' + (l.ativo ? 'contorno-vermelho' : 'cinza'), l.ativo ? 'cadeado' : 'aberto', l.ativo ? 'Encerrar pátio' : 'Reabrir pátio');
    bAtivo.addEventListener('click', async function () {
      mais.open = false;
      if (l.ativo && !(await confirmar('Encerrar o pátio ' + l.patio + '?', 'Ele some do app de campo.\nFotos já guardadas nos celulares ainda serão enviadas.', 'Encerrar pátio', true))) return;
      try { await api('definirAtivo', { loteId: l.loteId, ativo: !l.ativo }); carregarLotes(); } catch (e) { alert(e.message); }
    });
    [bBaixar, bEditar].forEach(function (b) { acoes.appendChild(b); });
    // ações raras/destrutivas ficam num menu separado
    const mais = el('details', 'menu-mais');
    const sm = el('summary', 'btn pequeno cinza'); sm.appendChild(ic('pontos', 'p')); sm.appendChild(document.createTextNode('Mais ações')); mais.appendChild(sm);
    const itens = el('div', 'itens'); mais.appendChild(itens);
    bAtivo.className = 'btn pequeno';
    itens.appendChild(bAtivo);
    const bExcluir = botao('btn pequeno perigo', 'lixo', 'Excluir pátio');
    if (l.ativo) { bExcluir.appendChild(el('small', 'dica', 'Encerre o pátio antes')); bExcluir.title = 'Encerre o pátio antes de excluir'; }
    bExcluir.disabled = l.ativo;
    bExcluir.addEventListener('click', function () { mais.open = false; marcarLinha(null); painelExcluir(l, det); });
    itens.appendChild(bExcluir);
    if (ehAdmin()) {
      itens.appendChild(el('div', 'sep-menu', 'Só administrador'));
      const bReset = botao('btn pequeno perigo', 'resetar', 'Resetar pátio');
      bReset.title = 'Só administrador: zera as fotos do pátio';
      bReset.addEventListener('click', function () { mais.open = false; marcarLinha(null); painelResetar(l, det); });
      itens.appendChild(bReset);
    }
    document.addEventListener('click', function (e) { if (mais.open && !mais.contains(e.target)) mais.open = false; });
    acoes.appendChild(mais);
    pp.appendChild(acoes); pp.appendChild(status);

    // indicadores (clicar filtra a tabela)
    const cont = { todos: vs.length, pendente: 0, fotografado: 0, bloq: 0, fora: 0 };
    vs.forEach(function (v) { cont[situacao(v)]++; });
    st.filtro = st.filtro || (cont.fotografado ? 'fotografado' : 'pendente');
    // progresso geral do pátio
    const dest = vs.filter(function (v) { return !v.naoDestinar && !v.foraDaLista; }).length;
    const prog = el('div', 'progresso-patio');
    const pl = el('div', 'linha');
    const pct = dest ? Math.round(100 * cont.fotografado / dest) : 0;
    const pb = el('b', null, pct + '% fotografado'); pl.appendChild(pb);
    pl.appendChild(el('span', 'suave', cont.fotografado + ' de ' + dest + ' veículos para fotografar · ' + plural(l.fotos, 'foto recebida', 'fotos recebidas')));
    prog.appendChild(pl);
    const barraP = el('div', 'barra'); const bp = el('div'); bp.style.width = pct + '%'; barraP.appendChild(bp); prog.appendChild(barraP);
    pp.appendChild(prog);
    pp.appendChild(el('div', 'rotulo-filtro', 'Filtrar por situação'));
    const kpis = el('div', 'kpis');
    const KPI = [['pendente', 'Pendentes', '', 'pendente'], ['fotografado', 'Fotografados', 'verde', 'check'], ['bloq', 'NÃO DESTINAR', 'vermelho', 'bloq'], ['fora', 'Fora da lista', 'amarelo', 'alerta'], ['todos', 'Todos', '', 'lista']];
    KPI.forEach(function (k) {
      if (k[0] === 'fora' && !cont.fora) return;
      const b = el('button', 'kpi ' + k[2] + (st.filtro === k[0] ? ' ativo' : ''));
      b.dataset.filtro = k[0];
      b.setAttribute('aria-pressed', st.filtro === k[0] ? 'true' : 'false');
      const ki = el('div', 'kpi-ic'); ki.appendChild(ic(k[3])); b.appendChild(ki);
      b.appendChild(el('div', 'kpi-rot', k[1])); b.appendChild(el('div', 'kpi-num', String(cont[k[0]])));
      b.addEventListener('click', function () { st.filtro = k[0]; kpis.querySelectorAll('.kpi[data-filtro]').forEach(function (x) { x.classList.toggle('ativo', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); desenhar(); });
      kpis.appendChild(b);
    });
    const kNovas = el('button', 'kpi azul');
    const kni = el('div', 'kpi-ic'); kni.appendChild(ic('download')); kNovas.appendChild(kni);
    kNovas.className = 'kpi azul kpi-novas'; kNovas.appendChild(el('div', 'kpi-rot', 'Para baixar')); kNovas.appendChild(el('div', 'kpi-num', String(l.naoBaixadas)));
    kNovas.title = 'Abrir "Baixar fotos"';
    kNovas.addEventListener('click', function () { if (l.fotos) { marcarLinha(null); painelBaixar(l, det, status); } });
    kpis.appendChild(kNovas);
    pp.appendChild(kpis);

    const bt = el('div', 'barra-tabela');
    const cb = el('div', 'campo-busca'); cb.appendChild(ic('busca'));
    const busca = el('input', 'busca-tabela'); busca.type = 'search'; busca.placeholder = 'Buscar NRO, placa ou modelo'; busca.value = st.busca || ''; busca.setAttribute('aria-label', 'Buscar veículo');
    busca.addEventListener('input', function () { st.busca = busca.value; desenhar(); });
    cb.appendChild(busca); bt.appendChild(cb);
    const selCat = el('select', 'filtro-cat'); selCat.setAttribute('aria-label', 'Categoria');
    [['', 'Todas as categorias'], ['carros', 'Carros'], ['motos', 'Motos'], ['outros', 'Outros']].forEach(function (o) { const op = el('option', null, o[1]); op.value = o[0]; selCat.appendChild(op); });
    selCat.value = st.cat || '';
    selCat.addEventListener('change', function () { st.cat = selCat.value; desenhar(); });
    bt.appendChild(selCat);
    const contagem = el('span', 'contagem'); bt.appendChild(contagem);
    pp.appendChild(bt);
    st.ordem = st.ordem || { col: 'nro', dir: 1 };
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
      const COLS = [['nro', 'NRO'], ['placa', 'Placa'], ['modelo', 'Veículo'], ['categoria', 'Categoria'], ['fotos', 'Fotos'], ['sit', 'Situação']];
      COLS.forEach(function (c) {
        const th = el('th'); const b = el('button', null, c[1]);
        if (st.ordem.col === c[0]) { b.appendChild(document.createTextNode(st.ordem.dir > 0 ? ' ▲' : ' ▼')); th.setAttribute('aria-sort', st.ordem.dir > 0 ? 'ascending' : 'descending'); }
        else b.appendChild(ic('ordenar'));
        b.title = 'Ordenar por ' + c[1];
        b.addEventListener('click', function () { st.ordem = { col: c[0], dir: st.ordem.col === c[0] ? -st.ordem.dir : 1 }; desenhar(); });
        th.appendChild(b); cab.appendChild(th);
      });
      cab.appendChild(el('th', 'td-seta'));
      tab.appendChild(cab);
      const q = norm(busca.value.trim());
      const nf = function (v) { return (st.ctx.fotosPorNro[v.nro] || []).length; };
      const ORD_SIT = { pendente: 0, fora: 1, fotografado: 2, bloq: 3 };
      const chave = function (v) {
        const c = st.ordem.col;
        if (c === 'nro') return Number(v.nro);
        if (c === 'fotos') return nf(v);
        if (c === 'sit') return ORD_SIT[situacao(v)];
        return norm(v[c]);
      };
      let n = 0;
      st.ctx.visiveis = [];
      vs.slice().sort(function (a, b) {
        const x = chave(a), y = chave(b);
        return (x < y ? -1 : x > y ? 1 : Number(a.nro) - Number(b.nro)) * st.ordem.dir;
      }).forEach(function (v) {
        const k = situacao(v);
        if (st.filtro !== 'todos' && k !== st.filtro) return;
        if (st.filtro === 'fotografado' && st.soDificil && !v.dificil) return;
        if (st.cat && v.categoria !== st.cat) return;
        if (q && norm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor).indexOf(q) < 0) return;
        n++;
        st.ctx.visiveis.push(v);
        const tr = el('tr', v.nro === st.nroSel ? 'sel' : '');
        tr.dataset.nro = v.nro; tr.tabIndex = 0;
        tr.appendChild(el('td', 'td-nro', v.nro));
        const tdp = el('td'); tdp.appendChild(placaVis(v.placa, v.uf, true)); tr.appendChild(tdp);
        tr.appendChild(el('td', null, [v.modelo, v.cor].filter(Boolean).join(' · ') || '—'));
        const tdc = el('td'); const sc = el('span', 'td-fotos'); sc.appendChild(ic(v.categoria === 'motos' ? 'moto' : v.categoria === 'carros' ? 'carro' : 'outros', 'p')); sc.appendChild(document.createTextNode(CAT[v.categoria] || v.categoria)); tdc.appendChild(sc); tr.appendChild(tdc);
        const tdf = el('td'); const sf = el('span', 'td-fotos'); sf.appendChild(ic('foto', 'p')); sf.appendChild(document.createTextNode(String(nf(v)))); tdf.appendChild(sf); tr.appendChild(tdf);
        const td = el('td'); td.appendChild(etiqueta(k)); if (v.marcacao) td.appendChild(el('div', 'sub-sit', 'marcado pela gestão')); tr.appendChild(td);
        const ts = el('td', 'td-seta'); ts.appendChild(ic('seta', 'p')); tr.appendChild(ts);
        const abrir = function () { marcarLinha(v.nro); abrirVeiculo(v); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(); });
        tab.appendChild(tr);
      });
      const NOMEF = { pendente: 'Pendentes', fotografado: 'Fotografados', bloq: 'NÃO DESTINAR', fora: 'Fora da lista', todos: 'Todos' };
      contagem.textContent = 'Mostrando ' + plural(n, 'veículo', 'veículos');
      if (st.filtro !== 'todos' || st.cat) {
        const chip = botao('btn pequeno chip-filtro', 'x', 'Filtro: ' + (st.filtro !== 'todos' ? NOMEF[st.filtro] : '') + (st.filtro !== 'todos' && st.cat ? ' · ' : '') + (st.cat ? CAT[st.cat] : ''));
        chip.title = 'Limpar filtro';
        chip.addEventListener('click', function () { st.filtro = 'todos'; st.cat = ''; selCat.value = ''; kpis.querySelectorAll('.kpi[data-filtro]').forEach(function (x) { x.classList.toggle('ativo', x.dataset.filtro === 'todos'); }); desenhar(); });
        contagem.appendChild(document.createTextNode(' ')); contagem.appendChild(chip);
      }
      const nDif = vs.filter(function (v) { return v.dificil && situacao(v) === 'fotografado'; }).length;
      if (st.filtro === 'fotografado' && nDif) {
        const bd = botao('btn pequeno chip-filtro' + (st.soDificil ? ' ativo' : ''), 'alerta', (st.soDificil ? 'Só difícil acesso ×' : 'Só difícil acesso (' + nDif + ')'));
        bd.setAttribute('aria-pressed', st.soDificil ? 'true' : 'false');
        bd.addEventListener('click', function () { st.soDificil = !st.soDificil; desenhar(); });
        contagem.appendChild(document.createTextNode(' ')); contagem.appendChild(bd);
      }
      if (!n) { const tr = el('tr'); const td = el('td', 'vazio', 'Nenhum veículo neste filtro.'); td.colSpan = 7; tr.appendChild(td); tab.appendChild(tr); }
    }
    desenhar();
    if (st.nroSel && $('gavetaConteudo').dataset.painel === 'veiculo') {
      const v = vs.find(function (x) { return x.nro === st.nroSel; });
      if (v) abrirVeiculo(v); else fecharGaveta();
    }
  }

  // recarrega o pátio aberto mantendo filtro, busca e a gaveta
  async function recarregarPatio() {
    if ($('gaveta').classList.contains('janela') && /^(resetar|editar|excluir)$/.test($('gavetaConteudo').dataset.painel)) {
      const m = $('gavetaConteudo').querySelector('.ok'); if (m && m.textContent) toast(m.textContent);
      fecharGaveta();
    }
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
    const lista = st.ctx.visiveis || [];
    const idx = lista.findIndex(function (x) { return x.nro === v.nro; });
    const nav = el('div', 'nav-gaveta');
    const irPara = function (d) { const alvo = lista[idx + d]; if (alvo) { st.ctx.marcarLinha(alvo.nro); abrirVeiculo(alvo); } };
    const bAnt = botao('btn pequeno cinza', 'anterior', 'Anterior'); bAnt.disabled = idx <= 0; bAnt.addEventListener('click', function () { irPara(-1); });
    const bPro = botao('btn pequeno cinza', 'seta', 'Próximo'); bPro.disabled = idx < 0 || idx >= lista.length - 1; bPro.addEventListener('click', function () { irPara(1); });
    bAnt.title = 'Veículo anterior (seta ←)'; bPro.title = 'Próximo veículo (seta →)';
    nav.appendChild(bAnt);
    if (idx >= 0) nav.appendChild(el('span', 'nav-pos', (idx + 1) + ' de ' + lista.length));
    nav.appendChild(bPro);
    const resumo = el('div', 'nav-resumo'); resumo.appendChild(el('b', null, 'NRO ' + v.nro)); resumo.appendChild(placaVis(v.placa, v.uf, true));
    resumo.classList.add('oculto');
    nav.appendChild(resumo); box.appendChild(nav);
    setTimeout(function () {
      const alvoCab = box.querySelector('.veiculo-cab .placa-vis') || box.querySelector('.veiculo-cab h2');
      if (!alvoCab || !('IntersectionObserver' in window)) return;
      const alt = nav.getBoundingClientRect().height || 68;
      new IntersectionObserver(function (es) { resumo.classList.toggle('oculto', es[0].isIntersecting); }, { root: $('gaveta'), rootMargin: '-' + Math.round(alt) + 'px 0px 0px 0px', threshold: 0 }).observe(alvoCab);
    }, 0);
    st.navGaveta = irPara;
    const k = situacao(v);
    const cab = el('div', 'veiculo-cab');
    const t = el('h2', null, 'NRO ' + v.nro + ' ');
    t.appendChild(etiqueta(k));
    cab.appendChild(t);
    const lp = el('div', 'linha-btns'); lp.style.marginTop = '0'; lp.appendChild(placaVis(v.placa, v.uf)); if (v.uf) lp.appendChild(el('span', 'tag', 'UF ' + v.uf)); cab.appendChild(lp);
    cab.appendChild(el('div', null, [v.modelo, v.cor].filter(Boolean).join(' · ') || 'Modelo não informado'));
    cab.appendChild(el('div', 'suave', [CAT[v.categoria], v.chassi ? 'chassi ' + v.chassi : ''].filter(Boolean).join(' · ')));
    if (v.apagadasCampo) cab.appendChild(el('div', 'suave', v.apagadasCampo + ' foto(s) apagada(s) ou substituída(s) pelo campo — vão no .zip com _APAGADA-PELO-CAMPO ou _SUBSTITUIDA'));
    if (v.dificil) {
      const nd = el('div', 'nota-dificil'); nd.appendChild(ic('alerta', 'p'));
      nd.appendChild(document.createTextNode(' Difícil acesso' + (v.dificilMotivo ? ': ' + v.dificilMotivo : '') + ' · conta como fotografado sem foto'));
      cab.appendChild(nd);
    }
    if (v.marcacao) cab.appendChild(el('div', 'suave', 'Situação marcada à mão pelo administrador (' + (v.marcacao === 'fotografado' ? 'fotografado' : 'pendente') + ').'));
    box.appendChild(cab);

    const fs = st.ctx.fotosPorNro[v.nro] || [];
    if (!fs.length) box.appendChild(el('p', 'vazio', k === 'bloq' ? 'Veículo NÃO DESTINAR — não é fotografado.' : 'Nenhuma foto deste NRO ainda.'));
    else {
      st.fotoSel = fs.some(function (f) { return f.uuid === st.fotoSel; }) ? st.fotoSel : fs[0].uuid;
      const grande = el('img', 'foto-visor'); grande.alt = 'Foto selecionada'; grande.title = 'Clique para ampliar';
      box.appendChild(grande);
      const legenda = el('div', 'leg-gaveta'); box.appendChild(legenda);
      const tira = el('div', 'tira-fotos'); box.appendChild(tira);
      const grupoF = el('div', 'grupo-acoes'); grupoF.appendChild(el('h4', null, 'Esta foto'));
      const acoesFoto = el('div', 'linha-btns'); acoesFoto.style.marginTop = '0'; grupoF.appendChild(acoesFoto);
      const area = el('div', 'area-acao'); grupoF.appendChild(area);
      box.appendChild(grupoF);

      const selecionar = function (f) {
        st.fotoSel = f.uuid;
        tira.querySelectorAll('img').forEach(function (i) { i.classList.toggle('sel', i.dataset.uuid === f.uuid); });
        const nome = String(f.caminho).split('/').pop();
        const ordem = Number((/_(\d+)/.exec(nome) || [])[1] || 0) - 1;
        legenda.textContent = '';
        legenda.appendChild(el('b', null, (ordem === 0 ? 'Veículo' : ordem === 1 ? 'Placa' : 'Extra') + ' · foto ' + (fs.indexOf(f) + 1) + ' de ' + fs.length));
        const tb = el('span', 'tag ' + (f.baixada ? '' : 'azul')); tb.appendChild(ic(f.baixada ? 'check' : 'download')); tb.appendChild(document.createTextNode(f.baixada ? 'Já baixada' : 'Nova')); legenda.appendChild(tb);
        legenda.appendChild(el('span', 'suave', nome + ' · clique na foto para ampliar'));
        grande.src = st.minis[f.uuid] || '';
        grande.onclick = function () { api('miniatura', { uuid: f.uuid, grande: true }).then(function (m) { ampliar('data:' + m.tipo + ';base64,' + m.base64); }).catch(function (e) { alert(e.message); }); };
        acoesFoto.textContent = ''; area.textContent = '';
        const bEx = botao('btn pequeno contorno-vermelho', 'lixo', 'Excluir foto');
        bEx.addEventListener('click', async function () {
          const ultima = fs.length === 1;
          if (!(await confirmar('Excluir a foto ' + nome + '?', 'NRO ' + v.nro + '. Ela vai para a lixeira do Drive (recuperável por 30 dias).' + (ultima ? '\nÉ a única foto: o NRO volta a ficar PENDENTE para o campo.' : ''), 'Excluir foto', true))) return;
          bEx.disabled = true;
          try { await api('excluirFotoGestao', { uuid: f.uuid }); recarregarPatio(); }
          catch (e) { alert(e.message); bEx.disabled = false; }
        });
        const bMov = botao('btn pequeno cinza', 'mover', 'Mover para outro NRO');
        bMov.addEventListener('click', function () { formMover(area, f, v); });
        bEx.classList.add('perigo-dir');
        acoesFoto.appendChild(bMov); acoesFoto.appendChild(bEx);
      };
      fs.forEach(function (f) {
        const img = el('img'); img.alt = 'Miniatura ' + String(f.caminho).split('/').pop(); img.dataset.uuid = f.uuid;
        img.addEventListener('click', function () { selecionar(f); });
        const fig = el('figure', 'mini-fig'); fig.appendChild(img);
        const ord = Number((/_(\d+)/.exec(String(f.caminho).split('/').pop()) || [])[1] || 0) - 1;
        fig.appendChild(el('figcaption', null, ord === 0 ? 'Veículo' : ord === 1 ? 'Placa' : 'Extra'));
        tira.appendChild(fig);
        const pronto = function (src) { img.src = src; if (st.fotoSel === f.uuid) grande.src = src; };
        if (st.minis[f.uuid]) pronto(st.minis[f.uuid]);
        else api('miniatura', { uuid: f.uuid }).then(function (m) { pronto(st.minis[f.uuid] = 'data:' + m.tipo + ';base64,' + m.base64); }).catch(function () { img.alt = 'não carregou'; });
      });
      selecionar(fs.find(function (f) { return f.uuid === st.fotoSel; }));
    }

    // ações do veículo (gestão e admin)
    const grupoV = el('div', 'grupo-acoes'); grupoV.appendChild(el('h4', null, 'Veículo'));
    const av = el('div', 'linha-btns'); av.style.marginTop = '0'; grupoV.appendChild(av);
    const areaV = el('div', 'area-acao'); grupoV.appendChild(areaV);
    box.appendChild(grupoV);
    const bEd = botao('btn pequeno cinza', 'editar', 'Editar veículo');
    bEd.addEventListener('click', function () { formEditarVeiculo(areaV, v); });
    av.appendChild(bEd);
    if (v.dificil && !v.naoDestinar) {
      const bDf = botao('btn pequeno cinza', 'resetar', 'Desfazer difícil acesso');
      bDf.addEventListener('click', async function () {
        if (!(await confirmar('Desfazer difícil acesso do NRO ' + v.nro + '?', 'Ele volta a ser ' + (fs.length ? 'fotografado pelas fotos que tem.' : 'PENDENTE para o campo.'), 'Desfazer'))) return;
        bDf.disabled = true;
        try { await api('dificilAcesso', { loteId: l.loteId, nro: v.nro, dificil: false }); toast('Difícil acesso desfeito'); recarregarPatio(); }
        catch (e) { alert(e.message); bDf.disabled = false; }
      });
      av.appendChild(bDf);
    }
    if (ehAdmin() && !v.naoDestinar && !v.foraDaLista) {
      const paraFoto = situacao(v) !== 'fotografado';
      const bMs = botao('btn pequeno cinza', paraFoto ? 'check' : 'pendente', paraFoto ? 'Marcar como fotografado' : 'Voltar para pendente');
      bMs.title = 'Só administrador';
      bMs.addEventListener('click', async function () {
        const txt = paraFoto
          ? 'O NRO ' + v.nro + ' passa para Fotografados mesmo ' + (fs.length ? 'com as fotos que tem.' : 'sem fotos.')
          : 'O NRO ' + v.nro + ' volta para Pendentes e aparece de novo para o campo.' + (fs.length ? ' As ' + fs.length + ' foto(s) continuam guardadas e baixáveis.' : '');
        if (!(await confirmar(paraFoto ? 'Marcar como fotografado?' : 'Voltar para pendente?', txt, paraFoto ? 'Marcar como fotografado' : 'Voltar para pendente'))) return;
        bMs.disabled = true;
        try { await api('marcarSituacao', { loteId: l.loteId, nro: v.nro, situacao: paraFoto ? 'fotografado' : 'pendente' }); toast('NRO ' + v.nro + (paraFoto ? ' marcado como fotografado' : ' voltou para pendente')); recarregarPatio(); }
        catch (e) { alert(e.message); bMs.disabled = false; }
      });
      av.appendChild(bMs);
    }
    if (fs.length) {
      const bRes = botao('btn pequeno contorno-vermelho perigo-dir', 'resetar', 'Resetar NRO');
      bRes.addEventListener('click', async function () {
        if (!(await confirmar('Resetar o NRO ' + v.nro + '?', (fs.length === 1 ? 'A foto dele vai' : 'As ' + fs.length + ' fotos dele vão') + ' para a lixeira do Drive (30 dias) e ele volta a ficar PENDENTE para o campo.' + (v.foraDaLista ? '\nComo é um NRO fora da lista, ele sai da lista.' : ''), 'Resetar NRO', true))) return;
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
    const h = el('h3'); h.appendChild(ic('resetar')); h.appendChild(document.createTextNode('Resetar o pátio ' + l.patio)); p.appendChild(h);
    p.appendChild(el('p', null, 'Todas as fotos deste pátio vão para a lixeira do Google Drive (recuperáveis por 30 dias) e todos os NROs voltam a ficar PENDENTES. A lista de veículos continua igual; NROs digitados fora da lista são removidos.'));
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
    box.textContent = ''; box.dataset.painel = nome;
    document.querySelectorAll('#painelPatio tr.sel').forEach(function (x) { x.classList.remove('sel'); });
    st.nroSel = null;
    $('gaveta').classList.add('janela'); $('gaveta').classList.remove('oculto'); document.body.classList.remove('com-gaveta');
    return true;
  }

  function painelEditar(l, box) {
    if (!abrirPainel(box, 'editar')) return;
    const p = el('div', 'painel-baixar');
    const he = el('h3'); he.appendChild(ic('editar')); he.appendChild(document.createTextNode('Editar pátio')); p.appendChild(he);
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
    const hx = el('h3'); hx.appendChild(ic('lixo')); hx.appendChild(document.createTextNode('Excluir o pátio ' + l.patio)); p.appendChild(hx);
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
    const hb = el('h3'); hb.appendChild(ic('download')); hb.appendChild(document.createTextNode('Baixar fotos')); p.appendChild(hb);
    p.appendChild(el('div', 'suave', plural(naoBaixadas.length, 'nova', 'novas') + ' · ' + fotos.length + ' no total · o .zip vem com uma pasta por NRO'));
    const nome = 'mod-' + l.loteId;
    const opcao = function (valor, texto, desab) {
      const lab = el('label', 'opcao');
      const r = el('input'); r.type = 'radio'; r.name = nome; r.value = valor; r.disabled = !!desab;
      lab.appendChild(r); lab.appendChild(document.createTextNode(' ' + texto));
      p.appendChild(lab); return r;
    };
    const rNovas = opcao('novas', 'Só as novas, ainda não baixadas (' + naoBaixadas.length + ')', !naoBaixadas.length);
    const rData = opcao('data', 'Fotos de uma data:', !datas.length);
    const sel = el('select', 'sel-data');
    datas.forEach(function (d) {
      const o = el('option', null, dataBR(d) + ' — ' + plural(porData[d].total, 'foto', 'fotos') + (porData[d].ja ? ' (' + porData[d].ja + ' já baixada' + (porData[d].ja === 1 ? '' : 's') + ')' : ''));
      o.value = d; sel.appendChild(o);
    });
    rData.parentNode.appendChild(sel);
    const rTodas = opcao('todas', 'Todas as fotos do pátio (' + fotos.length + ')', !fotos.length);
    sel.addEventListener('mousedown', function () { if (!rData.disabled) { rData.checked = true; atualizar(); } });
    (naoBaixadas.length ? rNovas : rData).checked = true;

    const aviso = el('div', 'aviso');
    const bOk = el('button', 'btn verde', '');
    p.appendChild(aviso); p.appendChild(bOk);
    box.appendChild(p);

    const escolha = function () {
      const modo = rNovas.checked ? 'novas' : (rData.checked ? 'data' : 'todas');
      let lista, rotulo, sufixo;
      if (modo === 'novas') { lista = naoBaixadas; rotulo = 'novas'; sufixo = 'nao-baixadas_' + hojeArquivo(); }
      else if (modo === 'data') { lista = fotos.filter(function (f) { return dataDaFoto(f) === sel.value; }); rotulo = 'de ' + dataBR(sel.value); sufixo = 'dia_' + sel.value; }
      else { lista = fotos; rotulo = 'do pátio (todas)'; sufixo = 'todas_' + hojeArquivo(); }
      return { lista: lista, rotulo: rotulo, sufixo: sufixo };
    };
    const atualizar = function () {
      const e = escolha();
      sel.disabled = !rData.checked;
      const ja = e.lista.filter(function (f) { return f.baixada; }).length;
      const mb = e.lista.reduce(function (t, f) { return t + (Number(f.bytes) || 0); }, 0) / 1048576;
      bOk.textContent = ''; bOk.appendChild(ic('download')); const tam = !mb ? '' : (mb < 0.1 ? ' (< 0,1 MB)' : ' (≈ ' + mb.toLocaleString('pt-BR', { maximumFractionDigits: mb < 10 ? 1 : 0 }) + ' MB)');
      bOk.appendChild(document.createTextNode('Baixar ' + plural(e.lista.length, 'foto', 'fotos') + ' ' + e.rotulo + tam));
      bOk.disabled = !e.lista.length;
      aviso.textContent = ja ? (ja === 1 ? '1 destas fotos já foi baixada' : ja + ' destas fotos já foram baixadas') + ' antes. Extraindo na mesma pasta, elas são substituídas (não duplicam).' : '';
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
    const linhas = [['NRO', 'Categoria', 'Placa', 'UF', 'Modelo', 'Cor', 'Chassi', 'Situação', 'Fotos', 'Apagadas/substituídas pelo campo', 'Difícil acesso', 'Marcado à mão'].map(esc).join(';')];
    vs.slice().sort(function (a, b) { return Number(a.nro) - Number(b.nro); }).forEach(function (v) {
      const sit = v.naoDestinar ? 'NÃO DESTINAR' : (v.foraDaLista ? 'fora da lista' : v.status);
      linhas.push([v.nro, v.categoria, v.placa, v.uf, v.modelo, v.cor, v.chassi, sit, v.fotos, v.apagadasCampo || 0, v.dificil ? ('sim' + (v.dificilMotivo ? ' - ' + v.dificilMotivo : '')) : '', v.marcacao ? 'sim' : ''].map(esc).join(';'));
    });
    return '﻿' + linhas.join('\r\n');
  }

  // ---------- novo lote ----------
  const soltar = $('soltar');
  soltar.addEventListener('click', function () { $('inputXlsx').click(); });
  soltar.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('inputXlsx').click(); } });
  function passo(n) { $('passos').querySelectorAll('div').forEach(function (d, i) { d.className = i + 1 < n ? 'feito' : (i + 1 === n ? 'atual' : ''); d.querySelector('span').textContent = i + 1 < n ? '✓' : String(i + 1); }); }
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

  const IC_VERIF = { '❌': 'x', '⚠️': 'alerta', 'ℹ️': 'lista', '✅': 'check' };
  function linhaVerif(icone, texto, cls) {
    const d = el('div', 'linha-verif ' + (cls || '')); d.appendChild(ic(IC_VERIF[icone] || 'lista', 'p')); d.appendChild(document.createTextNode(texto)); return d;
  }

  function mostrarVerificacao(r) {
    const box = $('verificacao'); box.textContent = '';
    const c = el('div', 'cartao verif');
    const ok = !r.bloqueios.length;
    const h = el('h3', ok ? 'ok' : 'erro'); h.appendChild(ic(ok ? (r.avisos.length ? 'alerta' : 'check') : 'x'));
    h.appendChild(document.createTextNode(ok ? (r.avisos.length ? 'Planilha compatível, com avisos' : 'Planilha compatível') : 'Planilha NÃO compatível — o pátio não pode ser criado'));
    c.appendChild(h);
    r.bloqueios.forEach(function (b) { c.appendChild(linhaVerif('❌', b, 'erro')); });
    r.avisos.forEach(function (a) { c.appendChild(linhaVerif('⚠️', a, 'aviso')); });
    (r.infos || []).forEach(function (a) { c.appendChild(linhaVerif('ℹ️', a, 'suave')); });
    if (r.colunas.length) {
      const det = el('details', 'colunas');
      const faltando = r.colunas.filter(function (col) { return !col.coluna && col.nivel !== 'info'; }).length;
      det.open = faltando > 0;
      const sm = el('summary'); sm.appendChild(ic(faltando ? 'alerta' : 'check', 'p'));
      sm.appendChild(document.createTextNode(faltando ? plural(faltando, 'coluna não encontrada', 'colunas não encontradas') + ' — ver detalhes' : plural(r.colunas.filter(function (col) { return col.coluna; }).length, 'coluna reconhecida', 'colunas reconhecidas') + ' (ver detalhes)'));
      det.appendChild(sm);
      const t = el('table');
      r.colunas.forEach(function (col) {
        const tr = el('tr');
        const ti = el('td'); ti.appendChild(ic(col.coluna ? 'check' : (col.nivel === 'bloqueio' ? 'x' : (col.nivel === 'aviso' ? 'alerta' : 'pendente')), 'p')); tr.appendChild(ti);
        tr.appendChild(el('td', null, col.rotulo));
        tr.appendChild(el('td', 'suave', col.coluna ? 'coluna ' + col.coluna + ' ("' + col.titulo + '")' : 'não encontrada'));
        t.appendChild(tr);
      });
      det.appendChild(t); c.appendChild(det);
    }
    if (r.portes.length) {
      c.appendChild(el('div', 'suave', 'Valores de PORTE: ' + r.portes.map(function (p) {
        return p.valor + ' (' + p.qtd + ' na planilha) → ' + (CAT[p.categoria] || p.categoria) + (p.conhecido ? '' : ' (não reconhecido)');
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
    [[vs.length, 'veículos na planilha'], [vs.length - bloq, 'para fotografar'], [cont.carros, 'carros a fotografar'], [cont.motos, 'motos a fotografar'],
      [cont.outros, 'outros a fotografar'], [bloq, 'NÃO DESTINAR'], [semPlaca, 'sem placa']].forEach(function (n) {
      const d = el('div'); d.appendChild(el('b', null, String(n[0]))); d.appendChild(document.createTextNode(n[1])); nums.appendChild(d);
    });
    $('previaAvisos').textContent = '';
    $('previaAvisos').appendChild(el('div', 'suave', 'Prévia: ' + plural(vs.length, 'veículo', 'veículos') + ' (role a tabela para ver todos).'));
    const tab = $('previaTabela'); tab.textContent = '';
    const cab = el('tr');
    ['NRO', 'Categoria', 'Placa', 'Modelo', 'Cor', 'Situação'].forEach(function (h) { cab.appendChild(el('th', null, h)); });
    tab.appendChild(cab);
    vs.forEach(function (v) {
      const tr = el('tr');
      [v.nro, CAT[X.categoria(v.porte, v.modelo)], v.placa, v.modelo, v.cor].forEach(function (x) { tr.appendChild(el('td', null, x || '—')); });
      const td = el('td'); if (v.naoDestinar) td.appendChild(etiqueta('bloq')); else { const tf = el('span', 'tag azul'); tf.appendChild(ic('camera')); tf.appendChild(document.createTextNode('Fotografar')); td.appendChild(tf); } tr.appendChild(td);
      tab.appendChild(tr);
    });
    $('previa').classList.remove('oculto'); passo(st.bloqueado ? 1 : 2);
    ['btnCriarLote'].forEach(function (id) {
      $(id).disabled = st.bloqueado;
      $(id).textContent = ''; $(id).appendChild(ic(st.bloqueado ? 'x' : 'check'));
      $(id).appendChild(document.createTextNode(st.bloqueado ? 'Planilha incompatível — corrija e envie de novo' : 'Criar pátio e liberar para o campo'));
    });
    const ae = $('arquivoEscolhido'); ae.textContent = '';
    ae.appendChild(ic('arquivo')); ae.appendChild(document.createTextNode(st.arquivo + ' · ' + plural(vs.length, 'veículo', 'veículos')));
    const troca = botao('btn pequeno cinza', 'trocar', 'Trocar arquivo'); troca.addEventListener('click', function () { $('inputXlsx').click(); });
    ae.appendChild(troca);
    ae.classList.remove('oculto'); soltar.classList.add('oculto');
  }

  $('btnCriarLote').addEventListener('click', async function () {
    if (!st.previa || st.bloqueado) return;
    const patio = $('novoPatio').value.trim(), lote = $('novoLote').value.trim();
    if (!patio) { $('novoErro').textContent = 'Informe o nome do pátio CRV (não deu para identificar pelo nome do arquivo).'; $('novoPatio').focus(); return; }
    $('btnCriarLote').disabled = true; $('novoErro').textContent = '';
    try {
      const r = await api('criarLote', { patio: patio, numeroLote: lote, arquivo: st.arquivo, veiculos: st.previa });
      alert('Pátio criado: ' + r.total + ' veículos (' + r.destinaveis + ' para fotografar). O pátio já aparece no app de campo.');
      st.previa = null; $('previa').classList.add('oculto'); passo(1);
      $('arquivoEscolhido').classList.add('oculto'); soltar.classList.remove('oculto');
      trocarAba('abaLotes');
    } catch (e) { $('novoErro').textContent = e.message; }
    finally { $('btnCriarLote').disabled = false; }
  });

  // ---------- usuários (admin) ----------
  async function carregarUsuarios() {
    const tab = $('tabelaUsuarios');
    const meu = st.seqUsuarios = (st.seqUsuarios || 0) + 1;
    let us;
    try { us = await api('listarUsuarios', {}); } catch (e) { $('uErro').textContent = e.message; return; }
    if (meu !== st.seqUsuarios) return; // outra carga mais nova já está desenhando
    tab.textContent = '';
    const cab = el('tr'); ['Usuário', 'Nome', 'Acesso', 'Situação', ''].forEach(function (h) { cab.appendChild(el('th', null, h)); }); tab.appendChild(cab);
    us.forEach(function (u) {
      const tr = el('tr', st.usuarioSalvo === u.usuario ? 'linha-salva' : '');
      [u.usuario, u.nome, PAPEL[u.papel] || u.papel].forEach(function (x, i) {
        const td0 = el('td', i === 2 ? 'papel' : null, x);
        if (i === 0 && st.usuarioSalvo === u.usuario) { const ts = el('span', 'tag verde'); ts.appendChild(ic('check')); ts.appendChild(document.createTextNode('salvo agora')); td0.appendChild(document.createTextNode(' ')); td0.appendChild(ts); }
        tr.appendChild(td0);
      });
      const td = el('td'); const t = el('span', 'tag ' + (u.ativo ? 'verde' : 'vermelho')); t.appendChild(ic(u.ativo ? 'check' : 'bloq')); t.appendChild(document.createTextNode(u.ativo ? 'Ativo' : 'Inativo')); td.appendChild(t); tr.appendChild(td);
      const tdb = el('td'); const b = botao('btn pequeno cinza', 'editar', 'Editar');
      b.addEventListener('click', function () {
        $('uUsuario').value = u.usuario; $('uUsuario').readOnly = true; $('uNome').value = u.nome; $('uPapel').value = u.papel; $('uSenha').value = ''; $('uAtivo').checked = u.ativo;
        $('uTitulo').textContent = 'Editando: ' + u.usuario; $('btnCancelarEdicao').lastChild.textContent = 'Cancelar edição'; ajudaPapel(); window.scrollTo(0, 0); $('uNome').focus();
      });
      tdb.appendChild(b); tr.appendChild(tdb); tab.appendChild(tr);
    });
  }
  const PAPEL = { admin: 'Administrador', gestor: 'Gestão', campo: 'Campo' };
  const AJUDA_PAPEL = { campo: 'Tira as fotos no pátio (celular).', gestor: 'Envia planilhas, revisa e baixa as fotos.', admin: 'Tudo da gestão + usuários e resetar pátio.' };
  function ajudaPapel() {
    $('uPapelAjuda').textContent = AJUDA_PAPEL[$('uPapel').value] || '';
    $('uSenhaAjuda').textContent = $('uUsuario').readOnly ? 'Mínimo 8 caracteres. Em branco mantém a senha atual.' : 'Mínimo 8 caracteres.';
  }
  $('uPapel').addEventListener('change', ajudaPapel);
  function limparFormUsuario() {
    ['uUsuario', 'uNome', 'uSenha'].forEach(function (i) { $(i).value = ''; });
    $('uUsuario').readOnly = false; $('uPapel').value = 'campo'; $('uAtivo').checked = true; ajudaPapel();
    $('uTitulo').textContent = 'Novo usuário'; $('btnCancelarEdicao').lastChild.textContent = 'Limpar';
  }
  $('btnCancelarEdicao').addEventListener('click', limparFormUsuario);
  $('btnSalvarUsuario').addEventListener('click', async function () {
    $('uErro').textContent = '';
    try {
      await api('salvarUsuario', { usuario: $('uUsuario').value.trim(), nome: $('uNome').value.trim(), papel: $('uPapel').value, senha: $('uSenha').value, ativo: $('uAtivo').checked });
      const nomeSalvo = $('uUsuario').value.trim();
      limparFormUsuario();
      toast('Usuário "' + nomeSalvo + '" salvo');
      st.usuarioSalvo = nomeSalvo;
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

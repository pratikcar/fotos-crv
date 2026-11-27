// App de campo — fotos no pátio, funcionando sem sinal.
(function () {
  'use strict';
  const N = self.Nucleo;
  const $ = function (id) { return document.getElementById(id); };
  const CAT_NOMES = { carros: 'Carros', motos: 'Motos', outros: 'Outros' };
  const CAT_INFO = { carros: 'Veículos gerais', motos: 'Motocicletas', outros: 'Pesados, reboques, bicicletas e demais' };
  const MAX_LADO = 1600;
  const QUALIDADE = 0.82;

  const st = {
    sessao: null, dados: null, pendLocal: {}, filaTotal: 0,
    tela: null, loteId: null, categoria: null, filtro: 'pendentes', sel: null, minis: {}, envCache: null, galSeq: 0,
    camStream: null, camFotos: [], imageCapture: null, enviando: false
  };

  // ---------- utilidades de interface ----------
  function el(tag, cls, texto) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  // avisos curtos aparecem na faixa de status (não cobrem a tela); sem faixa (login), aviso flutuante
  function toast(msg, ms) {
    if (st.sessao && st.tela !== 'telaLogin' && !$('seloPend').classList.contains('oculto') && $('camera').classList.contains('oculto')) {
      st.aviso = { msg: msg, ate: Date.now() + (ms || 3500) };
      atualizarSelos();
      clearTimeout(st.avisoTimer); st.avisoTimer = setTimeout(atualizarSelos, (ms || 3500) + 50);
      return;
    }
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    const t = el('div', 'toast', msg); t.criado = Date.now(); t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2800);
  }
  function modal(titulo, conteudo, botoes) {
    return new Promise(function (resolver) {
      const fundo = el('div', 'modal-fundo');
      const m = el('div', 'modal');
      m.appendChild(el('h2', null, titulo));
      if (typeof conteudo === 'string') m.appendChild(el('p', null, conteudo)); else if (conteudo) m.appendChild(conteudo);
      const linha = el('div', 'grade');
      botoes.forEach(function (b) {
        const bt = el('button', 'btn ' + (b.cls || ''));
        if (b.icone) bt.appendChild(ic(b.icone));
        bt.appendChild(document.createTextNode(b.texto));
        bt.addEventListener('click', function () {
          if (b.validar && !b.validar()) return;
          fundo.remove(); resolver(b.valor);
        });
        linha.appendChild(bt);
      });
      m.appendChild(linha);
      fundo.appendChild(m);
      fundo.addEventListener('click', function (e) { if (e.target === fundo) { fundo.remove(); resolver(null); } });
      document.body.appendChild(fundo);
      const inp = m.querySelector('input'); if (inp) setTimeout(function () { inp.focus(); }, 50);
    });
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function hora(iso) {
    try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  // ---------- navegação ----------
  // Celular: uma tela por vez (pátios → NROs → veículo). Tela larga (tablet/celular deitado/PC): 3 colunas lado a lado.
  const TELAS = ['telaLogin', 'telaPatios', 'telaCategorias', 'telaLista', 'telaFila', 'telaVeiculo'];
  const COLUNAS = ['telaPatios', 'telaCategorias', 'telaLista', 'telaVeiculo'];
  const mqLargo = window.matchMedia('(min-width: 900px)');
  function largo() { return document.body.classList.contains('campo-largo'); }
  if (mqLargo.addEventListener) mqLargo.addEventListener('change', function () { if (st.tela) mostrar(st.tela, false); });

  function estadoHist(tela, extra) {
    const e = { tela: tela, loteId: st.loteId, categoria: st.categoria, nro: st.sel ? st.sel.nro : null, fora: st.sel && st.sel.foraDaLista ? st.sel : null };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function selDe(v) { return { nro: v.nro, categoria: v.categoria, placa: v.placa, uf: v.uf, modelo: v.modelo, cor: v.cor, foraDaLista: false }; }
  function selDoEstado(s) {
    if (!s) return null;
    if (s.fora) return s.fora;
    if (!s.nro) return null;
    const l = loteAtual(); const v = l && l.veiculos.find(function (x) { return x.nro === s.nro; });
    return v ? selDe(v) : null;
  }

  function mostrar(tela, empilhar) {
    st.tela = tela;
    const L = !!(mqLargo.matches && st.sessao && COLUNAS.indexOf(tela) >= 0);
    document.body.classList.toggle('campo-largo', L);
    TELAS.forEach(function (t) { $(t).classList.toggle('oculto', !(t === tela || (L && COLUNAS.indexOf(t) >= 0))); });
    $('btnVoltar').classList.toggle('oculto', L || tela === 'telaLogin' || tela === 'telaPatios');
    $('btnMenu').classList.toggle('oculto', tela === 'telaLogin');
    if (empilhar) history.pushState(estadoHist(tela), '');
    if (st.tela !== tela || empilhar) { st.aviso = null; }
    if (st.tela !== tela || empilhar) document.querySelectorAll('.toast').forEach(function (t) { if (Date.now() - (t.criado || 0) > 1500) t.remove(); });
    desenhar();
    if (!L) window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (e) {
    if (!$('camera').classList.contains('oculto')) { fecharCamera(true); return; }
    const s = e.state;
    if (!s || !st.sessao) { mostrar(st.sessao ? 'telaPatios' : 'telaLogin', false); return; }
    st.loteId = s.loteId; st.categoria = s.categoria || null;
    st.sel = selDoEstado(s);
    if (st.selAposCamera) { // voltando da câmera: no veículo, mostra o NRO que acabou de ser fotografado
      if (s.tela === 'telaVeiculo') { st.sel = st.selAposCamera; history.replaceState(estadoHist('telaVeiculo'), ''); }
      st.selAposCamera = null;
    }
    mostrar(s.tela, false);
  });
  $('btnVoltar').addEventListener('click', function () { history.back(); });

  function desenhar() {
    atualizarSelos();
    if (largo()) {
      desenharPatios(); desenharCategorias(); desenharLista(); desenharVeiculo();
      const lt = loteAtual();
      $('titulo').textContent = lt ? (st.categoria ? CAT_NOMES[st.categoria] + ' · ' : '') + lt.patio : 'Fotos Pátio CRV' + (st.sessao ? ' · ' + (st.sessao.nome || st.sessao.usuario) : '');
      return;
    }
    if (st.tela === 'telaPatios') desenharPatios();
    else if (st.tela === 'telaCategorias') desenharCategorias();
    else if (st.tela === 'telaLista') desenharLista();
    else if (st.tela === 'telaFila') desenharFila();
    else if (st.tela === 'telaVeiculo') desenharVeiculo();
    else $('titulo').textContent = 'Fotos Pátio CRV';
  }

  // ---------- estado local ----------
  function loteAtual() { return st.dados && st.dados.lotes.find(function (l) { return l.loteId === st.loteId; }); }
  async function recarregarFila() {
    const fila = await N.filaTodos();
    const mapa = {}, acoes = {};
    let fotos = 0;
    fila.forEach(function (f) {
      const k = f.loteId + '|' + f.nro;
      if (f.tipo === 'acao') { acoes[k] = f; return; }
      fotos++;
      if (f.apagadaCampo || f.substituida) return;
      mapa[k] = (mapa[k] || 0) + 1;
    });
    st.pendLocal = mapa;
    st.acoesPend = acoes;
    st.acoesLista = fila.filter(function (f) { return f.tipo === 'acao'; });
    st.filaTotal = fotos;
    st.acoesTotal = fila.length - fotos;
    return fila.filter(function (f) { return f.tipo !== 'acao'; });
  }
  // difícil acesso: vale o que ainda está na fila do celular; senão, o que veio do servidor
  function dificilDe(lote, v) {
    const a = st.acoesPend && st.acoesPend[lote.loteId + '|' + v.nro];
    return a ? !!a.dificil : !!v.dificil;
  }
  function estadoVeiculo(lote, v) {
    if (v.naoDestinar) return 'bloq';
    if (st.pendLocal[lote.loteId + '|' + v.nro]) return 'local';
    const d = dificilDe(lote, v);
    if (d) return 'feito';
    // "fotografado" só por causa do difícil acesso que acabou de ser desfeito → volta a pendente
    if (v.status === 'fotografado' && !(v.dificil && !d && !(Number(v.fotos) > 0) && v.marcacao !== 'fotografado')) return 'feito';
    return 'pendente';
  }
  function contar(lote, categoria) {
    let total = 0, feitos = 0;
    lote.veiculos.forEach(function (v) {
      if (categoria && v.categoria !== categoria) return;
      if (v.naoDestinar || v.foraDaLista) return;
      total++;
      const e = estadoVeiculo(lote, v);
      if (e === 'feito' || e === 'local') feitos++;
    });
    return { total: total, feitos: feitos };
  }

  function atualizarSelos() {
    const on = navigator.onLine;
    const sp = $('seloPend');
    let cls, icone, texto;
    const nf = plural(st.filaTotal, 'foto', 'fotos');
    const aviso = st.aviso && Date.now() < st.aviso.ate ? st.aviso.msg : null;
    const na = st.acoesTotal || 0;
    if (st.enviando && st.filaTotal) { cls = 'envio'; icone = 'sync'; texto = 'Enviando ' + nf + '…'; }
    else if (st.filaTotal) { cls = 'pend'; icone = on ? 'upload' : 'semsinal'; texto = on ? nf + ' para enviar · toque para ver' : 'Sem sinal · ' + nf + ' no celular'; }
    else if (!on) { cls = 'off'; icone = 'semsinal'; texto = 'Sem sinal · pode continuar fotografando'; }
    else if (na && !st.enviando) { cls = 'pend'; icone = 'upload'; texto = plural(na, 'marcação', 'marcações') + ' de difícil acesso para enviar · toque para ver'; }
    else { cls = 'ok'; icone = 'check'; texto = 'Tudo enviado'; }
    if (aviso) { texto = aviso; if (cls === 'ok') icone = 'check'; }
    sp.className = 'faixa-sync ' + cls + (aviso ? ' com-aviso' : '');
    sp.textContent = '';
    sp.appendChild(ic(icone, cls === 'envio' ? 'p girar' : 'p'));
    sp.appendChild(el('span', 'txt', texto));
    sp.title = texto;
    sp.setAttribute('aria-label', (on ? '' : 'Sem internet. ') + (st.filaTotal ? plural(st.filaTotal, 'foto guardada', 'fotos guardadas') + ' no celular' : texto) + '. Ver fila de envio.');
    sp.classList.toggle('oculto', !st.sessao || st.tela === 'telaLogin');
  }

  // ---------- login ----------
  $('btnEntrar').addEventListener('click', entrar);
  $('btnVerSenha').addEventListener('click', function () {
    const i = $('loginSenha'); const ver = i.type === 'password';
    i.type = ver ? 'text' : 'password';
    this.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha');
    this.textContent = ''; this.appendChild(ic(ver ? 'olhofechado' : 'olho'));
  });
  $('loginSenha').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
  async function entrar() {
    const usuario = $('loginUsuario').value.trim();
    const senha = $('loginSenha').value;
    $('loginErro').textContent = '';
    if (!usuario || !senha) { $('loginErro').textContent = 'Preencha usuário e senha.'; return; }
    $('btnEntrar').disabled = true;
    try {
      const r = await N.chamarApi('login', { usuario: usuario, senha: senha, dispositivo: 'campo ' + navigator.userAgent.slice(0, 90) });
      if (r.papel !== 'campo' && r.papel !== 'admin') {
        await N.chamarApi('logout', {}, r.token).catch(function () {});
        throw new Error('Este usuário não tem acesso ao app de fotos.');
      }
      st.sessao = { usuario: r.usuario, nome: r.nome, papel: r.papel };
      await N.kvSet('token', r.token);
      await N.kvSet('sessao', st.sessao);
      $('loginSenha').value = '';
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      await atualizarListas(true);
      abrirInicio();
      enviarFila();
    } catch (e) {
      $('loginErro').textContent = e.code === 'REDE' ? 'Sem internet. O primeiro login precisa de conexão.' : e.message;
    } finally {
      $('btnEntrar').disabled = false;
    }
  }

  async function exigirLogin(msg) {
    st.sessao = null;
    await N.kvDel('sessao');
    history.replaceState({ tela: 'telaLogin' }, '');
    mostrar('telaLogin', false);
    if (msg) $('loginErro').textContent = msg;
  }

  // ---------- listas ----------
  async function atualizarListas(silencioso) {
    const token = await N.kvGet('token');
    if (!token) return exigirLogin();
    try {
      const d = await N.chamarApi('dadosCampo', {}, token);
      st.dados = d;
      await N.kvSet('dadosCampo', d);
      if (!silencioso) toast('Listas atualizadas');
    } catch (e) {
      if (e.code === 'AUTH') { await N.kvDel('token'); return exigirLogin('Sessão expirada. Entre de novo — as fotos guardadas no celular não se perdem.'); }
      if (!silencioso) toast(e.code === 'REDE' ? 'Sem sinal — usando a última lista salva.' : e.message);
    }
    desenhar();
  }

  // o pátio escolhido fica guardado: na próxima vez o app abre direto nele
  function guardarPatio(id) { try { if (id) localStorage.setItem('fotosCrvPatioCampo', id); else localStorage.removeItem('fotosCrvPatioCampo'); } catch (e) { /* sem armazenamento */ } }
  function patioGuardado() { try { return localStorage.getItem('fotosCrvPatioCampo'); } catch (e) { return null; } }
  function abrirInicio() {
    const id = patioGuardado();
    const existe = id && st.dados && st.dados.lotes.some(function (l) { return l.loteId === id; });
    history.replaceState({ tela: 'telaPatios' }, '');
    if (existe) { st.loteId = id; st.categoria = null; st.sel = null; mostrar('telaCategorias', true); }
    else { guardarPatio(null); mostrar('telaPatios', false); }
  }

  function progresso(feitos, total) {
    const w = el('div', 'progresso');
    const t = el('div', 'progresso-txt');
    t.appendChild(el('b', null, String(total - feitos)));
    t.appendChild(document.createTextNode(' a fotografar')); t.appendChild(el('span', 'sep', ' · ')); t.appendChild(el('span', 'nw', feitos + '/' + total + ' feitos'));
    w.appendChild(t);
    const barra = el('div', 'barra'); const p = el('div'); p.style.width = (total ? Math.max(feitos ? 2 : 0, Math.round(100 * feitos / total)) : 0) + '%';
    barra.appendChild(p); w.appendChild(barra);
    return w;
  }
  function anel(feitos, total) {
    const pct = total ? Math.round(100 * feitos / total) : 0;
    const a = el('div', 'anel'); a.style.setProperty('--p', pct);
    a.appendChild(el('span', null, pct + '%'));
    a.setAttribute('aria-label', pct + '% fotografado');
    return a;
  }
  function faixaPatio(l, aoTrocar, rotulo) {
    const f = el('div', 'faixa-patio');
    const n = el('span', 'faixa-nome'); n.appendChild(ic('pin', 'p')); n.appendChild(document.createTextNode(l.patio));
    f.appendChild(n);
    const bt = el('button', 'btn pequeno cinza'); bt.appendChild(ic('trocar', 'p')); bt.appendChild(document.createTextNode(rotulo || 'Trocar pátio'));
    bt.addEventListener('click', aoTrocar);
    f.appendChild(bt);
    return f;
  }

  $('btnAtualizarListas').addEventListener('click', async function () {
    if (!navigator.onLine) { toast('Sem sinal agora. A lista salva continua valendo.'); return; }
    await atualizarListas(false); enviarFila();
  });

  function desenharPatios() {
    $('titulo').textContent = 'Olá, ' + (st.sessao ? st.sessao.nome : '');
    const box = $('listaPatios');
    box.textContent = '';
    const lotes = (st.dados && st.dados.lotes) || [];
    const atual = lotes.find(function (l) { return l.loteId === st.loteId; });
    $('telaPatios').querySelector('.titulo-secao').textContent = largo() && atual && !st.trocandoPatio ? 'Pátio' : 'Escolha o pátio';
    if (largo() && atual && !st.trocandoPatio) { // tela larga: só o pátio atual, numa linha
      box.appendChild(faixaPatio(atual, function () { st.trocandoPatio = true; desenharPatios(); }, 'Trocar'));
      $('atualizadoEm').textContent = st.dados ? 'Lista de ' + hora(st.dados.geradoEm) : '';
      return;
    }
    if (!lotes.length) {
      const c = el('div', 'vazio');
      c.appendChild(ic('lista'));
      c.appendChild(el('div', null, 'Nenhum pátio ativo no momento.'));
      c.appendChild(el('div', 'suave', 'Quando a gestão enviar a planilha, o pátio aparece aqui. Toque em ☰ › Atualizar listas.'));
      box.appendChild(c);
    }
    lotes.forEach(function (l) {
      const c = contar(l);
      const b = el('button', 'botao-grande' + (largo() && l.loteId === st.loteId ? ' sel' : ''));
      const icb = el('div', 'icone-cat'); icb.appendChild(ic('pin')); b.appendChild(icb);
      const corpo = el('div', 'corpo');
      const pct = c.total ? Math.floor(100 * c.feitos / c.total) : 0;
      const ln = el('div', 'nome-linha'); ln.appendChild(el('div', 'nome', l.patio)); ln.appendChild(el('span', 'pct' + (pct >= 100 ? ' completo' : ''), pct + '%')); corpo.appendChild(ln);
      if (l.numeroLote) corpo.appendChild(el('div', 'info', 'Lista ' + l.numeroLote));
      corpo.appendChild(progresso(c.feitos, c.total));
      b.appendChild(corpo);
      b.appendChild(ic('seta', 'seta'));
      b.addEventListener('click', function () { st.trocandoPatio = false; guardarPatio(l.loteId); st.loteId = l.loteId; st.categoria = null; st.sel = null; $('busca').value = ''; mostrar('telaCategorias', true); });
      box.appendChild(b);
    });
    $('atualizadoEm').textContent = st.dados ? 'Lista de ' + hora(st.dados.geradoEm) : '';
  }

  function desenharCategorias() {
    const l = loteAtual();
    const box = $('listaCategorias');
    box.textContent = '';
    if (!l) {
      if (largo()) { $('telaCategorias').classList.add('oculto'); return; }
      mostrar('telaPatios', false); return;
    }
    if (largo()) { $('telaCategorias').classList.remove('oculto'); $('faixaCat').textContent = ''; }
    else {
      $('titulo').textContent = l.patio;
      $('faixaCat').textContent = '';
    }
    ['carros', 'motos', 'outros'].forEach(function (cat) {
      const c = contar(l, cat);
      const b = el('button', 'botao-grande' + (largo() && st.categoria === cat ? ' sel' : ''));
      const icb = el('div', 'icone-cat'); icb.appendChild(ic({ carros: 'carro', motos: 'moto', outros: 'outros' }[cat])); b.appendChild(icb);
      const corpo = el('div', 'corpo');
      corpo.appendChild(el('div', 'nome', CAT_NOMES[cat]));
      corpo.appendChild(el('div', 'info desc-cat', CAT_INFO[cat]));
      if (c.total) corpo.appendChild(progresso(c.feitos, c.total));
      else corpo.appendChild(el('div', 'info', 'Nenhum veículo nesta lista'));
      b.appendChild(corpo);
      b.appendChild(ic('seta', 'seta'));
      b.addEventListener('click', function () {
        st.categoria = cat; st.sel = null; $('busca').value = '';
        st.filtro = 'pendentes';
        if (largo()) { history.replaceState(estadoHist('telaLista'), ''); mostrar('telaLista', false); }
        else mostrar('telaLista', true);
      });
      box.appendChild(b);
    });
  }

  // filtros e busca
  document.querySelectorAll('#filtros button').forEach(function (b) {
    b.addEventListener('click', function () { st.filtro = b.dataset.filtro; desenharLista(); });
  });
  $('busca').addEventListener('input', function () { desenharLista(); });

  function textoNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }


  function desenharLista() {
    const l = loteAtual();
    const box = $('listaIds');
    if (!l || !st.categoria) {
      if (largo()) {
        box.textContent = '';
        const v = el('div', 'vazio'); v.appendChild(ic('lista')); v.appendChild(el('div', null, l ? 'Escolha Carros, Motos ou Outros.' : 'Escolha um pátio para ver a lista de NROs.'));
        box.appendChild(v);
        $('telaLista').querySelector('.busca').classList.add('oculto'); $('btnManual').classList.add('oculto');
        return;
      }
      mostrar(l ? 'telaCategorias' : 'telaPatios', false); return;
    }
    $('telaLista').querySelector('.busca').classList.remove('oculto'); $('btnManual').classList.remove('oculto');
    if (!largo()) $('titulo').textContent = CAT_NOMES[st.categoria] + ' · ' + l.patio;

    const q = textoNorm($('busca').value.trim());
    box.textContent = '';
    const itens = l.veiculos.filter(function (v) { return v.categoria === st.categoria; })
      .sort(function (a, b) { return Number(a.nro) - Number(b.nro); });
    const cont = { pendentes: 0, feitos: 0, todos: 0 };
    itens.forEach(function (v) {
      const e = estadoVeiculo(l, v);
      cont.todos++;
      if (e === 'bloq') { cont.bloq = (cont.bloq || 0) + 1; return; }
      if (e === 'pendente') cont.pendentes++;
      if (e === 'feito' || e === 'local') cont.feitos++;
    });
    const NOMES_F = { pendentes: 'Pendentes', feitos: 'Fotografados', todos: 'Todos' };
    document.querySelectorAll('#filtros button').forEach(function (x) {
      const f = x.dataset.filtro;
      if (!NOMES_F[f]) { x.remove(); return; } // botão de versão antiga
      x.textContent = '';
      x.appendChild(el('b', null, String(cont[f])));
      x.appendChild(document.createTextNode(NOMES_F[f]));
      x.classList.toggle('ativo', f === st.filtro);
      x.setAttribute('aria-pressed', f === st.filtro ? 'true' : 'false');
    });
    $('notaBloq').classList.add('oculto');

    const ICONE = { pendente: 'pendente', feito: 'check', local: 'celular', bloq: 'bloq' };
    box.classList.toggle('so-pendentes', st.filtro === 'pendentes');
    let mostrados = 0;
    itens.forEach(function (v) {
      const e = estadoVeiculo(l, v);
      if (st.filtro === 'pendentes' && (e === 'feito' || e === 'local')) return;
      if (st.filtro === 'pendentes' && e === 'bloq' && !(q && q === textoNorm(v.nro))) return; // só aparece se buscar o NRO exato
      if (st.filtro === 'feitos' && !(e === 'feito' || e === 'local')) return;
      if (q && textoNorm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor + ' ' + v.chassi).indexOf(q) < 0) return;
      mostrados++;
      const linha = el('div', 'item ' + (e === 'pendente' ? '' : e) + (st.sel && st.sel.nro === v.nro ? ' sel' : ''));
      linha.setAttribute('role', 'button'); linha.tabIndex = 0;
      const est = el('div', 'estado'); est.appendChild(ic(ICONE[e])); linha.appendChild(est);
      linha.appendChild(el('div', 'nro', v.nro));
      const d = el('div', 'desc');
      d.appendChild(el('div', 'placa' + (v.placa ? '' : ' sem'), v.placa ? fmtPlaca(v.placa) + (v.uf ? ' · ' + v.uf : '') : (v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
      d.appendChild(el('div', 'mod', [v.modelo, v.cor].filter(Boolean).join(' · ') || '—'));
      let stx = '';
      if (e === 'bloq') stx = 'NÃO DESTINAR — não fotografar';
      else if (e === 'local') stx = plural(st.pendLocal[l.loteId + '|' + v.nro], 'foto no celular', 'fotos no celular');
      else if (e === 'feito') stx = Number(v.fotos) > 0 ? plural(v.fotos, 'foto enviada', 'fotos enviadas') : 'Fotografado';
      else if (st.filtro !== 'pendentes') stx = 'Pendente';
      if (stx) d.appendChild(el('div', 'st', stx));
      linha.appendChild(d);
      const abrir = function () {
        if (e === 'bloq') { toast('NRO ' + v.nro + ': NÃO DESTINAR — não pode sair do CRV.' + (v.motivo ? ' (' + v.motivo + '…)' : '')); return; }
        abrirVeiculo(selDe(v));
      };
      linha.addEventListener('click', abrir);
      linha.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') abrir(); });
      if (e !== 'bloq') {
        const cam = el('button', 'cam' + (e === 'pendente' ? '' : ' leve'));
        cam.setAttribute('aria-label', 'Fotografar NRO ' + v.nro);
        cam.appendChild(ic('camera', 'g'));
        cam.addEventListener('click', function (ev) { ev.stopPropagation(); st.sel = selDe(v); abrirCamera(); });
        linha.appendChild(cam);
      }
      box.appendChild(linha);
    });
    if (!mostrados) {
      const vz = el('div', 'vazio');
      vz.appendChild(ic(st.filtro === 'pendentes' && !q ? 'check' : 'busca'));
      vz.appendChild(el('div', null, st.filtro === 'pendentes' && !q ? 'Nenhum pendente nesta categoria. 🎉' : 'Nada encontrado.'));
      box.appendChild(vz);
    }
  }

  function abrirVeiculo(sel) {
    st.sel = sel;
    if (largo() && st.tela === 'telaVeiculo') { history.replaceState(estadoHist('telaVeiculo'), ''); desenhar(); }
    else mostrar('telaVeiculo', true);
  }

  $('btnManual').addEventListener('click', async function () {
    const l = loteAtual(); if (!l) return;
    const caixa = el('div');
    caixa.appendChild(el('label', null, 'NRO do veículo'));
    const inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '1';
    caixa.appendChild(inp);
    const msg = el('div', 'erro'); caixa.appendChild(msg);
    const r = await modal('Digitar NRO', caixa, [
      { texto: 'Continuar', valor: 'ok', validar: function () { if (!/^\d{1,7}$/.test(inp.value.trim())) { msg.textContent = 'Digite só números.'; return false; } return true; } },
      { texto: 'Cancelar', cls: 'cinza', valor: null }
    ]);
    if (r !== 'ok') return;
    const nro = String(Number(inp.value.trim()));
    const v = l.veiculos.find(function (x) { return x.nro === nro; });
    if (v) {
      if (v.naoDestinar) { await modal('NÃO DESTINAR', 'O NRO ' + nro + ' está marcado como NÃO DESTINAR e não pode sair do CRV.', [{ texto: 'Entendi', valor: 1 }]); return; }
      abrirVeiculo(selDe(v));
      return;
    }
    const ok = await modal('Fora da lista', 'O NRO ' + nro + ' não está na planilha do pátio ' + l.patio + '. Fotografar mesmo assim? Ele vai ficar marcado como "fora da lista" para a gestão conferir.',
      [{ texto: 'Fotografar mesmo assim', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
    if (!ok) return;
    const cat = st.categoria;
    abrirVeiculo({ nro: nro, categoria: cat, foraDaLista: true });
    abrirCamera();
  });

  // ---------- tela do veículo (dados + fotos tiradas + câmera) ----------

  function cartaoFoto(src, legenda) {
    const c = el('div', 'foto-cartao');
    const img = el('img'); img.alt = legenda; if (src) img.src = src;
    img.addEventListener('click', function () { if (img.src) ampliar(img.src); });
    c.appendChild(img);
    c.appendChild(el('div', 'leg-foto', legenda));
    return { cartao: c, img: img };
  }

  // ---------- difícil acesso (funciona sem sinal: vai pela fila) ----------
  async function marcarDificil(l, v, marcar) {
    let motivo = '';
    if (marcar) {
      const r = await modal('Difícil acesso?', 'O NRO ' + v.nro + ' vai para Fotografados sem precisar de foto. Qual o motivo? (opcional)', [
        { texto: 'Bloqueado por outros veículos', valor: 'Bloqueado por outros veículos' },
        { texto: 'Local perigoso', valor: 'Local perigoso' },
        { texto: 'Outro / sem motivo', cls: 'cinza', valor: '-' },
        { texto: 'Cancelar', cls: 'cinza', valor: null }
      ]);
      if (!r) return;
      motivo = r === '-' ? '' : r;
    } else {
      const r = await modal('Desfazer difícil acesso?', 'O NRO ' + v.nro + ' volta para Pendentes.', [{ texto: 'Desfazer', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
      if (!r) return;
    }
    // uma ação por NRO na fila: a última vale
    const ant = st.acoesPend[l.loteId + '|' + v.nro];
    if (ant) await N.filaDel(ant.uuid);
    if (ant && marcar === !!v.dificil) { /* voltou ao que o servidor já tem: não precisa enviar */ }
    else await N.filaPut({ uuid: crypto.randomUUID(), tipo: 'acao', acao: 'dificilAcesso', loteId: l.loteId, nro: v.nro, dificil: marcar, motivo: motivo, criadoEm: new Date().toISOString(), tentativas: 0 });
    await recarregarFila();
    toast(marcar ? 'NRO ' + v.nro + ' em Fotografados · difícil acesso' : 'NRO ' + v.nro + ' voltou para Pendentes');
    desenhar();
    enviarFila();
  }

  // miniaturas das fotos enviadas ficam guardadas no celular (até 400) para ver sem internet
  async function miniGuardada(uuid) { const m = (await N.kvGet('minisCampo')) || {}; return m[uuid] ? m[uuid].src : null; }
  async function guardarMini(uuid, src) {
    try {
      const m = (await N.kvGet('minisCampo')) || {};
      m[uuid] = { src: src, t: Date.now() };
      const ks = Object.keys(m);
      if (ks.length > 400) ks.sort(function (a, b) { return m[a].t - m[b].t; }).slice(0, ks.length - 400).forEach(function (k) { delete m[k]; });
      await N.kvSet('minisCampo', m);
    } catch (e) { /* sem espaço: segue sem guardar */ }
  }
  function tipoFoto(i) { return i === 0 ? 'Veículo' : i === 1 ? 'Placa' : 'Extra ' + (i - 1); }
  // placa: antiga com hífen (ABC-1234); Mercosul sem hífen (ABC1D23)
  function fmtPlaca(p) { p = String(p || '').toUpperCase(); return /^[A-Z]{3}\d{4}$/.test(p) ? p.slice(0, 3) + '-' + p.slice(3) : p; }
  function ehMercosul(p) { return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(String(p || '').toUpperCase()); }
  function placaVis(placa, uf, fora) {
    const p = el('div', 'placa-vis' + (placa ? (ehMercosul(placa) ? ' mercosul' : '') : ' sem'));
    p.appendChild(el('b', null, placa ? fmtPlaca(placa) : (fora ? 'Fora da lista' : 'Sem placa')));
    p.setAttribute('aria-label', 'Placa ' + (placa || 'não informada') + (uf ? ' ' + uf : ''));
    if (uf) p.title = uf;
    return p;
  }

  function ampliar(src) {
    const fundo = el('div', 'modal-fundo');
    const img = el('img', 'foto-grande'); img.src = src; img.alt = 'Foto ampliada';
    fundo.appendChild(img);
    fundo.addEventListener('click', function () { fundo.remove(); });
    document.body.appendChild(fundo);
  }

  async function desenharVeiculo() {
    const l = loteAtual();
    const temSel = !!(l && st.sel);
    $('veiculoVazio').classList.toggle('oculto', temSel);
    $('veiculoConteudo').classList.toggle('oculto', !temSel);
    if (!temSel) {
      $('veiculoVazio').textContent = l ? 'Toque em um NRO para ver as fotos e fotografar.' : 'Escolha um pátio e depois um NRO.';
      if (!largo()) mostrar(l ? 'telaLista' : 'telaPatios', false);
      return;
    }
    const nro = st.sel.nro;
    const meu = ++st.galSeq;
    const v = l.veiculos.find(function (x) { return x.nro === nro; }) || st.sel;
    if (!largo()) $('titulo').textContent = (CAT_NOMES[v.categoria] || 'Veículo') + ' · ' + l.patio;

    // fotos ainda no celular
    const fila = (await N.filaTodos()).filter(function (f) { return f.tipo !== 'acao' && f.loteId === l.loteId && f.nro === nro && !f.apagadaCampo && !f.substituida; });
    if (meu !== st.galSeq) return;
    const topo = $('veiculoTopo'); topo.textContent = '';
    const e = v.naoDestinar ? 'bloq' : (fila.length ? 'local' : estadoVeiculo(l, v));
    const dificil = e === 'feito' && dificilDe(l, v);
    const linha = el('div', 'linha');
    linha.appendChild(el('div', 'nro-grande', 'NRO ' + nro));
    const ROT = { local: ['amarelo', 'upload', plural(fila.length, 'foto', 'fotos') + ' aguardando envio'], feito: ['verde', 'check', 'Fotografado' + (Number(v.fotos) > 0 ? ' · ' + plural(v.fotos, 'foto', 'fotos') : '')], pendente: ['', 'pendente', 'Pendente'], bloq: ['vermelho', 'bloq', 'NÃO DESTINAR'] }[e];
    const tg = el('span', 'tag ' + ROT[0]); tg.appendChild(ic(ROT[1])); tg.appendChild(document.createTextNode(ROT[2])); linha.appendChild(tg);
    if (dificil) {
      const td = el('span', 'tag laranja'); td.appendChild(ic('alerta')); td.appendChild(document.createTextNode('Difícil acesso')); linha.appendChild(td);
    }
    topo.appendChild(linha);
    const lp = el('div', 'linha-placa');
    lp.appendChild(placaVis(v.placa, v.uf, st.sel.foraDaLista || v.foraDaLista));
    if (v.uf) lp.appendChild(el('span', 'uf', v.uf));
    topo.appendChild(lp);
    if (dificil) {
      const a = st.acoesPend[l.loteId + '|' + nro];
      const mot = a ? a.motivo : v.dificilMotivo;
      topo.appendChild(el('div', 'nota-dificil', 'Marcado como difícil acesso' + (mot ? ': ' + mot : '') + '. Não precisa de foto.'));
    }
    if (v.marcacao && !dificil && e !== 'local') topo.appendChild(el('div', 'suave', 'Situação marcada pela gestão.'));
    topo.appendChild(el('div', 'modelo', [v.modelo, v.cor].filter(Boolean).join(' · ') || 'Modelo não informado'));
    topo.appendChild(el('div', 'suave', CAT_NOMES[v.categoria] + (v.chassi ? ' · chassi ' + v.chassi : '')));
    // ações: pendente → fotografar; com fotos → voltar à lista, mais fotos, refazer
    const temFoto = e === 'local' || (e === 'feito' && Number(v.fotos) > 0);
    const feito = e === 'local' || e === 'feito';
    const bv = $('btnVoltarLista');
    bv.classList.toggle('oculto', !feito || largo());
    $('btnTirarFotos').className = feito ? 'btn cinza' : 'btn';
    $('btnTirarFotos').textContent = ''; $('btnTirarFotos').appendChild(ic(feito ? 'mais' : 'camera', feito ? 'p' : 'g'));
    $('btnTirarFotos').appendChild(document.createTextNode(temFoto ? 'Mais fotos deste NRO' : 'Fotografar NRO ' + nro));
    $('btnRefazer').classList.toggle('oculto', !temFoto);
    const bd = $('btnDificil');
    bd.classList.toggle('oculto', e === 'bloq' || e === 'local' || (e === 'feito' && !dificil));
    bd.textContent = ''; bd.appendChild(ic(dificil ? 'resetar' : 'alerta', 'p'));
    bd.appendChild(document.createTextNode(dificil ? 'Desfazer difícil acesso' : 'Difícil acesso (sem foto)'));
    bd.onclick = function () { marcarDificil(l, v, !dificil); };

    const boxL = $('galeriaLocais'), boxE = $('galeriaEnviadas');
    boxL.querySelectorAll('img').forEach(function (i) { if (i.src.indexOf('blob:') === 0) URL.revokeObjectURL(i.src); });
    boxL.textContent = ''; $('galeriaAviso').textContent = '';
    $('tituloLocais').classList.toggle('oculto', !fila.length);
    fila.forEach(function (f, i) {
      const r = cartaoFoto(URL.createObjectURL(f.blob), tipoFoto(i) + ' · ' + hora(f.tiradaEm));
      r.cartao.classList.add(f.travada ? 'falhou' : 'aguardando');
      const t = el('span', 'tag ' + (f.travada ? 'vermelho' : 'amarelo'));
      t.appendChild(ic(f.travada ? 'alerta' : 'upload'));
      t.appendChild(document.createTextNode(f.travada ? 'Falhou · tenta de novo' : 'Aguardando envio'));
      r.cartao.appendChild(t);
      boxL.appendChild(r.cartao);
    });

    // fotos já enviadas (precisa de internet; guardadas por 30 s para não repetir a busca a cada redesenho)
    const chave = l.loteId + '|' + nro;
    const token = await N.kvGet('token');
    const guardadas = (await N.kvGet('enviadasCampo')) || {};
    let enviadas, deCache = false;
    if (st.envCache && st.envCache.chave === chave && Date.now() - st.envCache.t < 30000) enviadas = st.envCache.lista;
    else if (!navigator.onLine) { enviadas = guardadas[chave] || []; deCache = true; }
    else {
      try {
        enviadas = await N.chamarApi('fotosVeiculo', { loteId: l.loteId, nro: nro }, token);
        guardadas[chave] = enviadas; N.kvSet('enviadasCampo', guardadas).catch(function () {});
      } catch (e) { enviadas = guardadas[chave] || []; deCache = true; }
      if (!deCache) st.envCache = { chave: chave, t: Date.now(), lista: enviadas };
    }
    if (deCache && meu === st.galSeq) {
      if (enviadas.length) $('galeriaAviso').textContent = 'Sem internet: fotos enviadas guardadas neste celular.';
      else if (v.fotos) $('galeriaAviso').textContent = plural(v.fotos, 'foto enviada aparece', 'fotos enviadas aparecem') + ' quando houver internet.';
    }
    if (meu !== st.galSeq) return;
    boxE.textContent = '';
    $('tituloEnviadas').classList.toggle('oculto', !enviadas.length);
    if (!enviadas.length && !fila.length) $('galeriaAviso').textContent = 'Nenhuma foto deste NRO.';
    enviadas.forEach(function (f) {
      const ordem = Number((/_(\d+)/.exec(f.nome) || [])[1] || 0) - 1;
      const r = cartaoFoto(null, tipoFoto(ordem) + ' · ' + hora(f.tiradaEm));
      const te = el('span', 'tag verde'); te.appendChild(ic('check')); te.appendChild(document.createTextNode('Enviada')); r.cartao.appendChild(te);
      boxE.appendChild(r.cartao);
      if (st.minis[f.uuid]) r.img.src = st.minis[f.uuid];
      else miniGuardada(f.uuid).then(function (src) {
        if (src) { r.img.src = st.minis[f.uuid] = src; return; }
        if (!navigator.onLine) { r.img.alt = 'aparece com internet'; return; }
        return N.chamarApi('miniatura', { uuid: f.uuid }, token).then(function (m) {
          r.img.src = st.minis[f.uuid] = 'data:' + m.tipo + ';base64,' + m.base64;
          guardarMini(f.uuid, st.minis[f.uuid]);
        });
      }).catch(function () { r.img.alt = 'não carregou'; });
    });
  }

  // ---------- câmera ----------
  $('btnTirarFotos').addEventListener('click', function () { if (st.sel) abrirCamera(); });
  $('btnVoltarLista').addEventListener('click', function () { history.back(); });
  $('btnRefazer').addEventListener('click', async function () {
    if (!st.sel) return;
    const r = await modal('Refazer as fotos do NRO ' + st.sel.nro + '?', 'A câmera abre agora. As fotos antigas só saem da sua tela quando você salvar as novas (a gestão continua com elas). Se cancelar, nada muda.', [
      { texto: 'Refazer fotos', icone: 'camera', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
    if (r) abrirCamera(true);
  });

  async function abrirCamera(refazer) {
    st.refazerEm = refazer ? new Date().toISOString() : null;
    st.camFotos = [];
    desenharMiniaturas();
    const alvo = $('camTitulo'); alvo.textContent = '';
    alvo.appendChild(el('span', 'n', st.sel.nro));
    const sub = el('div'); sub.appendChild(el('div', null, st.sel.placa ? fmtPlaca(st.sel.placa) : (st.sel.foraDaLista ? 'Fora da lista' : 'Sem placa')));
    sub.appendChild(el('div', 's', [st.sel.modelo, st.sel.cor].filter(Boolean).join(' · ') || CAT_NOMES[st.sel.categoria] || ''));
    alvo.appendChild(sub);
    $('camera').classList.remove('oculto');
    history.pushState(estadoHist(st.tela, { camera: true }), '');
    st.imageCapture = null;
    $('btnLanterna').classList.add('oculto');
    try {
      st.camStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      $('video').srcObject = st.camStream;
      const track = st.camStream.getVideoTracks()[0];
      if ('ImageCapture' in window) { try { st.imageCapture = new ImageCapture(track); } catch (e) { st.imageCapture = null; } }
      const cap = track.getCapabilities ? track.getCapabilities() : {};
      if (cap.torch) $('btnLanterna').classList.remove('oculto');
    } catch (e) {
      st.camStream = null;
      toast('Câmera direta indisponível — usando a câmera do celular.');
    }
  }

  let lanterna = false;
  $('btnLanterna').addEventListener('click', function () {
    if (!st.camStream) return;
    lanterna = !lanterna;
    st.camStream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: lanterna }] }).catch(function () {});
  });

  function pararStream() {
    if (st.camStream) st.camStream.getTracks().forEach(function (t) { t.stop(); });
    st.camStream = null; lanterna = false;
    $('video').srcObject = null;
  }

  async function fecharCamera(peloVoltar) {
    if (st.camFotos.length) {
      const r = await modal('Descartar fotos?', 'Você tirou ' + st.camFotos.length + ' foto(s) e ainda não confirmou.', [
        { texto: 'Descartar', cls: 'vermelho', valor: 'sim' }, { texto: 'Continuar fotografando', cls: 'cinza', valor: null }]);
      if (r !== 'sim') { if (peloVoltar) history.pushState(estadoHist(st.tela, { camera: true }), ''); return; }
    }
    limparCamFotos();
    pararStream();
    $('camera').classList.add('oculto');
    if (!peloVoltar) history.back();
  }
  $('btnCamCancelar').addEventListener('click', function () { fecharCamera(false); });

  function limparCamFotos() {
    st.camFotos.forEach(function (f) { URL.revokeObjectURL(f.url); });
    st.camFotos = [];
    desenharMiniaturas();
  }

  $('btnObturador').addEventListener('click', async function () {
    if (!st.camStream) { $('inputArquivo').click(); return; }
    const flash = $('flashTela'); flash.classList.add('on'); setTimeout(function () { flash.classList.remove('on'); }, 120);
    $('btnObturador').disabled = true;
    try {
      let blob = null;
      if (st.imageCapture) {
        try { blob = await reduzir(await st.imageCapture.takePhoto()); } catch (e) { blob = null; }
      }
      if (!blob) blob = await quadroDoVideo();
      adicionarFoto(blob);
    } catch (e) {
      toast('Não consegui tirar a foto. Tente de novo.');
    } finally {
      $('btnObturador').disabled = false;
    }
  });

  $('inputArquivo').addEventListener('change', async function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    try { adicionarFoto(await reduzir(f)); } catch (e) { toast('Não consegui ler a foto.'); }
  });

  function quadroDoVideo() {
    const v = $('video');
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return Promise.reject(new Error('vídeo sem imagem'));
    const esc = Math.min(1, MAX_LADO / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * esc); c.height = Math.round(h * esc);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return paraJpeg(c);
  }

  async function reduzir(blob) {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const esc = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return paraJpeg(c);
  }

  function paraJpeg(canvas) {
    return new Promise(function (ok, falha) {
      canvas.toBlob(function (b) { b ? ok(b) : falha(new Error('falha ao gerar JPEG')); }, 'image/jpeg', QUALIDADE);
    });
  }

  function adicionarFoto(blob) {
    st.camFotos.push({ blob: blob, url: URL.createObjectURL(blob), tiradaEm: new Date().toISOString() });
    desenharMiniaturas();
  }

  function desenharMiniaturas() {
    const box = $('miniaturas');
    box.textContent = '';
    st.camFotos.forEach(function (f, i) {
      const m = el('div', 'mini');
      const img = el('img'); img.src = f.url; img.alt = 'Foto ' + (i + 1);
      const x = el('button', 'x'); x.appendChild(ic('x')); x.setAttribute('aria-label', 'Apagar a foto ' + (i + 1));
      x.addEventListener('click', async function () {
        const ok = await modal('Apagar a foto ' + (i + 1) + '?', 'Ela ainda não foi salva. Você pode tirar outra.', [{ texto: 'Apagar foto', cls: 'vermelho', icone: 'lixo', valor: 1 }, { texto: 'Manter', cls: 'cinza', valor: null }]);
        if (!ok) return;
        URL.revokeObjectURL(f.url); st.camFotos.splice(i, 1); desenharMiniaturas();
      });
      m.appendChild(img); m.appendChild(x); m.appendChild(el('span', 'leg', (i + 1) + ' · ' + tipoFoto(i))); box.appendChild(m);
    });
    if (!st.camFotos.length) box.appendChild(el('span', 'suave', 'Fotografe o veículo e a placa inutilizada.'));
    $('btnCamConfirmar').disabled = !st.camFotos.length;
    $('btnCamConfirmar').textContent = '';
    $('btnCamConfirmar').appendChild(document.createTextNode(st.camFotos.length ? 'Salvar ' + plural(st.camFotos.length, 'foto', 'fotos') : 'Salvar'));
    const ps = $('camPassos'); ps.textContent = '';
    [['Veículo inteiro', 1], ['Placa inutilizada', 2]].forEach(function (pa) {
      const ok = st.camFotos.length >= pa[1];
      const agora = st.camFotos.length === pa[1] - 1;
      const d = el('div', ok ? 'feito' : (agora ? 'agora' : '')); d.appendChild(ic(ok ? 'check' : (agora ? 'camera' : 'pendente'), 'p')); d.appendChild(document.createTextNode((agora ? 'Agora: ' : pa[1] + '. ') + pa[0]));
      ps.appendChild(d);
    });
  }

  $('btnCamConfirmar').addEventListener('click', async function () {
    if (!st.camFotos.length || !st.sel) return;
    const nroFeito = st.sel.nro;
    $('btnCamConfirmar').disabled = true;
    const qtd = st.camFotos.length;
    const refazerEm = st.refazerEm;
    try {
      if (refazerEm) {
        // fotos antigas ainda no celular: sobem marcadas como substituídas
        const antigas = (await N.filaTodos()).filter(function (f) { return f.tipo !== 'acao' && f.loteId === st.loteId && f.nro === st.sel.nro && !f.substituida; });
        for (const f of antigas) { f.substituida = true; await N.filaPut(f); }
      }
      for (const f of st.camFotos) {
        await N.filaPut({
          uuid: crypto.randomUUID(), loteId: st.loteId, nro: st.sel.nro, categoria: st.sel.categoria,
          foraDaLista: !!st.sel.foraDaLista, tiradaEm: f.tiradaEm, criadoEm: new Date().toISOString(),
          blob: f.blob, tentativas: 0, substituirAntes: refazerEm || undefined
        });
      }
      if (refazerEm) {
        // some da tela na hora: zera as enviadas deste NRO no celular
        const l = loteAtual(); const v = l && l.veiculos.find(function (x) { return x.nro === st.sel.nro; });
        if (v) { v.fotos = 0; await N.kvSet('dadosCampo', st.dados); }
        const guard = (await N.kvGet('enviadasCampo')) || {}; guard[st.loteId + '|' + st.sel.nro] = []; await N.kvSet('enviadasCampo', guard);
      }
      st.refazerEm = null;
    } catch (e) {
      $('btnCamConfirmar').disabled = false;
      await modal('Erro ao salvar', 'Não consegui guardar as fotos no celular (' + e.message + '). Verifique o espaço livre.', [{ texto: 'OK', valor: 1 }]);
      return;
    }
    st.selAposCamera = st.sel; // antes do "voltar": o popstate usa isso
    limparCamFotos();
    pararStream();
    $('camera').classList.add('oculto');
    history.back();
    st.envCache = null;
    await recarregarFila();
    toast('NRO ' + nroFeito + ' salvo' + (navigator.onLine ? ' · enviando ' + plural(qtd, 'foto', 'fotos') : ' no celular · envia com sinal'));
    desenhar();
    pedirSyncSegundoPlano();
    enviarFila();
  });

  // ---------- envio ----------
  async function pedirSyncSegundoPlano() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('enviar-fotos');
    } catch (e) { /* sem suporte: envia com o app aberto */ }
  }

  async function enviarFila(manual) {
    if (st.enviando) return;
    await recarregarFila();
    if (!st.filaTotal && !st.acoesTotal) { if (manual) toast('Nada para enviar.'); return; }
    if (!navigator.onLine) { if (manual) toast('Sem sinal. As fotos estão seguras no celular.'); atualizarSelos(); return; }
    st.enviando = true; atualizarSelos();
    try {
      const r = await N.sincronizarFila(function () { recarregarFila().then(atualizarSelos); });
      await recarregarFila();
      st.dados = (await N.kvGet('dadosCampo')) || st.dados;
      if (r.motivo === 'login') { exigirLogin('Sessão expirada. Entre de novo para enviar as fotos guardadas.'); }
      else if (r.enviadas) { st.envCache = null; toast(r.enviadas + ' foto(s) enviada(s)' + (st.filaTotal ? ' · faltam ' + st.filaTotal : ' ✅')); }
      else if (manual && r.motivo === 'rede') toast('Sem conexão com o servidor. Tento de novo depois.');
    } finally {
      st.enviando = false;
      desenhar();
    }
  }

  $('seloPend').addEventListener('click', function () { mostrar('telaFila', true); });
  $('btnEnviarAgora').addEventListener('click', function () { enviarFila(true); });

  async function desenharFila() {
    $('titulo').textContent = 'Fila de envio';
    const fila = await recarregarFila();
    atualizarSelos();
    const travadas = fila.filter(function (f) { return f.travada; }).length;
    $('filaResumo').textContent = (fila.length || st.acoesTotal)
      ? (travadas ? travadas + ' com problema · ' : '') + (navigator.onLine ? 'Enviando automaticamente.' : 'Pode continuar fotografando: o envio é automático quando o sinal voltar.')
      : 'Todas as fotos foram enviadas. ✓';
    $('btnEnviarAgora').classList.toggle('oculto', !(fila.length || st.acoesTotal) || !navigator.onLine);
    const box = $('filaItens');
    box.querySelectorAll('img').forEach(function (i) { URL.revokeObjectURL(i.src); });
    box.textContent = '';
    const nomes = {};
    ((st.dados && st.dados.lotes) || []).forEach(function (l) { nomes[l.loteId] = l.patio; });
    (st.acoesLista || []).forEach(function (a) {
      const c = el('div', 'item');
      const ib = el('div', 'estado'); ib.appendChild(ic('alerta')); c.appendChild(ib);
      const d = el('div', 'desc');
      d.appendChild(el('div', 'placa', 'NRO ' + a.nro + ' · ' + (a.dificil ? 'difícil acesso' : 'desfazer difícil acesso')));
      d.appendChild(el('div', 'mod', (nomes[a.loteId] || 'pátio encerrado') + (a.erro ? ' · ' + a.erro : '')));
      c.appendChild(d);
      if (a.travada || a.erro) {
        const col = el('div');
        const tentar = el('button', 'btn pequeno', 'Tentar');
        tentar.addEventListener('click', async function () { a.travada = false; a.tentativas = 0; a.erro = ''; await N.filaPut(a); enviarFila(true); });
        const apagar = el('button', 'btn pequeno vermelho', 'Descartar');
        apagar.addEventListener('click', async function () { await N.filaDel(a.uuid); await recarregarFila(); desenhar(); });
        col.appendChild(tentar); col.appendChild(apagar); c.appendChild(col);
      } else {
        const w = el('span', 'tag amarelo'); w.appendChild(ic('upload')); w.appendChild(document.createTextNode('Aguardando envio')); d.appendChild(w);
      }
      box.appendChild(c);
    });
    const posNro = {};
    fila.forEach(function (f) {
      const k = f.loteId + '|' + f.nro; const pos = posNro[k] = (posNro[k] === undefined ? 0 : posNro[k] + 1);
      const c = el('div', 'item');
      const img = el('img'); img.src = URL.createObjectURL(f.blob); img.alt = ''; img.height = 56;
      c.appendChild(img);
      const d = el('div', 'desc');
      d.appendChild(el('div', 'placa', 'NRO ' + f.nro + ' · ' + tipoFoto(pos)));
      d.appendChild(el('div', 'mod', (nomes[f.loteId] || 'pátio encerrado') + ' · ' + hora(f.tiradaEm) + (f.apagadaCampo ? ' · apagada por você (vai só para a gestão)' : '') + (f.substituida ? ' · substituída (vai só para a gestão)' : '') + (f.erro ? ' · ' + f.erro : '')));
      c.appendChild(d);
      if (f.travada) {
        const col = el('div');
        const tentar = el('button', 'btn pequeno', 'Tentar');
        tentar.addEventListener('click', async function () { f.travada = false; f.tentativas = 0; f.erro = ''; await N.filaPut(f); enviarFila(true); });
        const apagar = el('button', 'btn pequeno vermelho', 'Apagar');
        apagar.addEventListener('click', async function () {
          const r = await modal('Apagar foto?', 'A foto do NRO ' + f.nro + ' será apagada do celular e não poderá ser recuperada.', [{ texto: 'Apagar', cls: 'vermelho', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
          if (r) { await N.filaDel(f.uuid); desenharFila(); }
        });
        col.appendChild(tentar); col.appendChild(apagar); c.appendChild(col);
      } else {
        const enviando = st.enviando && navigator.onLine;
        const w = el('span', 'tag ' + (enviando ? 'azul' : 'amarelo')); w.appendChild(ic(enviando ? 'sync' : 'upload', enviando ? 'girar' : ''));
        w.appendChild(document.createTextNode(enviando ? 'Enviando' : 'Aguardando envio')); d.appendChild(w);
      }
      box.appendChild(c);
    });
  }

  // ---------- tema (claro para o sol, escuro para a noite) ----------
  function temaAtual() { try { return localStorage.getItem('fotosCrvTema') || 'claro'; } catch (e) { return 'claro'; } }
  function definirTema(t) {
    try { localStorage.setItem('fotosCrvTema', t); } catch (e) { /* sem armazenamento */ }
    document.documentElement.dataset.tema = t;
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'escuro' ? '#020617' : '#0b1f3a';
  }
  definirTema(temaAtual());

  // ---------- menu ----------
  $('btnMenu').addEventListener('click', async function () {
    if (!st.sessao) return;
    const estado = (st.filaTotal ? plural(st.filaTotal, 'foto para enviar', 'fotos para enviar') : 'Tudo enviado') + (navigator.onLine ? '' : ' · sem sinal');
    const info = el('div', 'menu-info');
    [['usuarios', st.sessao.nome || st.sessao.usuario], [st.filaTotal ? 'upload' : 'check', estado], ['lista', st.dados ? 'Lista de ' + hora(st.dados.geradoEm) : 'Lista ainda não baixada'], [null, 'Versão ' + self.CONFIG.VERSAO]].forEach(function (x) {
      const d = el('div', x[0] ? null : 'versao'); if (x[0]) d.appendChild(ic(x[0], 'p')); d.appendChild(document.createTextNode(' ' + x[1])); info.appendChild(d);
    });
    const r = await modal('Menu', info, [
      { texto: 'Atualizar listas', icone: 'atualizar', valor: 'atualizar' },
      { texto: 'Fila de envio (' + st.filaTotal + ')', icone: 'upload', cls: 'cinza', valor: 'fila' },
      { texto: 'Tela escura: ' + (temaAtual() === 'escuro' ? 'ligada' : 'desligada'), icone: temaAtual() === 'escuro' ? 'sol' : 'lua', cls: 'cinza', valor: 'tema' },
      { texto: 'Sair do app', icone: 'sair', cls: 'contorno-vermelho', valor: 'sair' },
      { texto: 'Fechar', cls: 'cinza', valor: null }
    ]);
    if (r === 'atualizar') { if (!navigator.onLine) toast('Sem sinal agora.'); else { await atualizarListas(false); enviarFila(); } }
    if (r === 'fila') mostrar('telaFila', true);
    if (r === 'tema') definirTema(temaAtual() === 'escuro' ? 'claro' : 'escuro');
    if (r === 'sair') {
      await recarregarFila();
      if (st.filaTotal) { await modal('Ainda há fotos no celular', 'Envie ' + (st.filaTotal === 1 ? 'a foto pendente' : 'as ' + st.filaTotal + ' fotos pendentes') + ' antes de sair, para não perder nada.', [{ texto: 'Entendi', valor: 1 }]); return; }
      const certeza = await modal('Sair do app?', 'Para entrar de novo será preciso usuário, senha e internet.', [{ texto: 'Sair', cls: 'vermelho', icone: 'sair', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
      if (!certeza) return;
      const token = await N.kvGet('token');
      if (token && navigator.onLine) N.chamarApi('logout', {}, token).catch(function () {});
      await N.kvDel('token'); await N.kvDel('dadosCampo');
      st.dados = null;
      exigirLogin();
    }
  });

  // ---------- início ----------
  // lista sempre atualizada: a cada 2 min, só com o app aberto na tela e com internet
  let ultimaAtualizacao = Date.now();
  async function atualizarSePreciso(minimoMs) {
    if (!st.sessao || !navigator.onLine || document.visibilityState !== 'visible') return;
    if (!$('camera').classList.contains('oculto')) return;
    if (Date.now() - ultimaAtualizacao < minimoMs) return;
    ultimaAtualizacao = Date.now();
    await atualizarListas(true);
  }
  setInterval(function () { atualizarSePreciso(110000); }, 120000);
  document.addEventListener('visibilitychange', function () { atualizarSePreciso(30000); });
  window.addEventListener('online', function () { atualizarSelos(); enviarFila(); atualizarSePreciso(0); });
  window.addEventListener('offline', atualizarSelos);
  setInterval(function () { if (navigator.onLine && (st.filaTotal || st.acoesTotal) && !st.enviando) enviarFila(); }, 60000);

  // versões misturadas (página antiga + código novo) → limpa o cache do app e recarrega uma vez
  const versaoPagina = (document.querySelector('meta[name=versao]') || {}).content;
  function recarregarLimpo(motivo) {
    const marca = 'fotosCrvRecarga:' + versaoPagina + ':' + self.CONFIG.VERSAO + ':' + motivo;
    try { if (sessionStorage.getItem(marca)) return; sessionStorage.setItem(marca, '1'); } catch (e) { return; }
    const limpar = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    limpar.catch(function () {}).then(function () { location.reload(); });
  }
  if (versaoPagina && self.CONFIG.VERSAO !== versaoPagina && navigator.onLine) recarregarLimpo('mistura');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    // versão nova instalada: recarrega quando for seguro (câmera fechada)
    let recarregando = false;
    let tinhaControle = !!navigator.serviceWorker.controller; // 1ª instalação não precisa recarregar
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!tinhaControle) { tinhaControle = true; return; }
      if (recarregando) return;
      const tentar = function () {
        if (!$('camera').classList.contains('oculto') || document.querySelector('.modal-fundo')) { setTimeout(tentar, 3000); return; }
        recarregando = true; location.reload();
      };
      tentar();
    });
    navigator.serviceWorker.addEventListener('message', async function (e) {
      if (e.data && e.data.tipo === 'sync') {
        st.dados = (await N.kvGet('dadosCampo')) || st.dados;
        await recarregarFila(); desenhar();
      }
    });
  }

  (async function iniciar() {
    if (self.CONFIG.API_URL.indexOf('COLE_AQUI') === 0) {
      document.querySelector('main').textContent = 'Configure a API_URL no arquivo config.js.';
      return;
    }
    st.sessao = await N.kvGet('sessao');
    st.dados = await N.kvGet('dadosCampo');
    await recarregarFila();
    const token = await N.kvGet('token');
    if (!st.sessao || !token) { history.replaceState({ tela: 'telaLogin' }, ''); mostrar('telaLogin', false); return; }
    abrirInicio();
    if (navigator.onLine) { await atualizarListas(true); enviarFila(); }
  })();
})();

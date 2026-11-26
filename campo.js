// App de campo — fotos no pátio, funcionando sem sinal.
(function () {
  'use strict';
  const N = self.Nucleo;
  const $ = function (id) { return document.getElementById(id); };
  const CAT_NOMES = { todas: 'Tudo', carros: 'Carros', motos: 'Motos', outros: 'Outros' };
  const MAX_LADO = 1600;
  const QUALIDADE = 0.82;

  const st = {
    sessao: null, dados: null, pendLocal: {}, filaTotal: 0,
    tela: null, loteId: null, categoria: 'todas', filtro: 'pendentes', sel: null, minis: {}, envCache: null, galSeq: 0,
    camStream: null, camFotos: [], imageCapture: null, enviando: false
  };

  // ---------- utilidades de interface ----------
  function el(tag, cls, texto) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  function toast(msg, ms) {
    const t = el('div', 'toast', msg);
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
        const bt = el('button', 'btn ' + (b.cls || ''), b.texto);
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
  function hora(iso) {
    try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  // ---------- navegação ----------
  // Celular: uma tela por vez (pátios → NROs → veículo). Tela larga (tablet/celular deitado/PC): 3 colunas lado a lado.
  const TELAS = ['telaLogin', 'telaPatios', 'telaLista', 'telaFila', 'telaVeiculo'];
  const COLUNAS = ['telaPatios', 'telaLista', 'telaVeiculo'];
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
    if (empilhar) history.pushState(estadoHist(tela), '');
    desenhar();
    if (!L) window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (e) {
    if (!$('camera').classList.contains('oculto')) { fecharCamera(true); return; }
    const s = e.state;
    if (!s || !st.sessao) { mostrar(st.sessao ? 'telaPatios' : 'telaLogin', false); return; }
    st.loteId = s.loteId; st.categoria = s.categoria || 'todas';
    st.sel = selDoEstado(s);
    mostrar(s.tela, false);
  });
  $('btnVoltar').addEventListener('click', function () { history.back(); });

  function desenhar() {
    atualizarSelos();
    if (largo()) {
      desenharPatios(); desenharLista(); desenharVeiculo();
      $('titulo').textContent = 'Fotos Pátio CRV' + (st.sessao ? ' · ' + (st.sessao.nome || st.sessao.usuario) : '');
      return;
    }
    if (st.tela === 'telaPatios') desenharPatios();
    else if (st.tela === 'telaLista') desenharLista();
    else if (st.tela === 'telaFila') desenharFila();
    else if (st.tela === 'telaVeiculo') desenharVeiculo();
    else $('titulo').textContent = 'Fotos Pátio CRV';
  }

  // ---------- estado local ----------
  function loteAtual() { return st.dados && st.dados.lotes.find(function (l) { return l.loteId === st.loteId; }); }
  async function recarregarFila() {
    const fila = await N.filaTodos();
    const mapa = {};
    fila.forEach(function (f) { if (f.apagadaCampo) return; const k = f.loteId + '|' + f.nro; mapa[k] = (mapa[k] || 0) + 1; });
    st.pendLocal = mapa;
    st.filaTotal = fila.length;
    return fila;
  }
  function estadoVeiculo(lote, v) {
    if (v.naoDestinar) return 'bloq';
    if (st.pendLocal[lote.loteId + '|' + v.nro]) return 'local';
    if (v.status === 'fotografado') return 'feito';
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
    const sr = $('seloRede');
    sr.textContent = on ? 'online' : 'sem sinal';
    sr.className = 'selo ' + (on ? 'on' : 'off');
    const sp = $('seloPend');
    sp.classList.toggle('oculto', !st.filaTotal);
    sp.textContent = (st.enviando ? '⏳ ' : '⬆ ') + st.filaTotal;
  }

  // ---------- login ----------
  $('btnEntrar').addEventListener('click', entrar);
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
      history.replaceState({ tela: 'telaPatios' }, '');
      mostrar('telaPatios', false);
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

  function desenharPatios() {
    $('titulo').textContent = 'Olá, ' + (st.sessao ? st.sessao.nome : '');
    const box = $('listaPatios');
    box.textContent = '';
    const lotes = (st.dados && st.dados.lotes) || [];
    if (!lotes.length) {
      const c = el('div', 'cartao');
      c.appendChild(el('p', null, 'Nenhum pátio ativo no momento.'));
      c.appendChild(el('p', 'suave', 'Quando a gestão enviar a planilha do pátio, ele aparece aqui. Toque em ☰ › Atualizar listas.'));
      box.appendChild(c);
    }
    lotes.forEach(function (l) {
      const c = contar(l);
      const b = el('button', 'botao-grande' + (largo() && l.loteId === st.loteId ? ' sel' : ''));
      b.appendChild(el('div', 'nome', l.patio));
      b.appendChild(el('div', 'info', (l.numeroLote ? 'Lista ' + l.numeroLote + ' · ' : '') + c.feitos + ' de ' + c.total + ' fotografados'));
      const barra = el('div', 'barra'); const p = el('div'); p.style.width = (c.total ? Math.round(100 * c.feitos / c.total) : 0) + '%';
      barra.appendChild(p); b.appendChild(barra);
      b.addEventListener('click', function () { st.loteId = l.loteId; st.categoria = 'todas'; st.sel = null; $('busca').value = ''; mostrar('telaLista', true); });
      box.appendChild(b);
    });
    $('atualizadoEm').textContent = st.dados ? 'Lista atualizada em ' + hora(st.dados.geradoEm) : '';
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
    if (!l) {
      if (largo()) {
        box.textContent = ''; box.appendChild(el('p', 'vazio', 'Escolha um pátio para ver a lista de NROs.'));
        $('telaLista').querySelector('.busca').classList.add('oculto'); $('btnManual').classList.add('oculto');
        return;
      }
      mostrar('telaPatios', false); return;
    }
    $('telaLista').querySelector('.busca').classList.remove('oculto'); $('btnManual').classList.remove('oculto');
    if (!largo()) $('titulo').textContent = l.patio + (st.categoria !== 'todas' ? ' · ' + CAT_NOMES[st.categoria] : '');

    // categorias (antes era uma tela separada)
    const chips = $('chipsCat'); chips.textContent = '';
    ['todas', 'carros', 'motos', 'outros'].forEach(function (cat) {
      const c = contar(l, cat === 'todas' ? null : cat);
      if (cat !== 'todas' && !c.total && st.categoria !== cat) return;
      const b = el('button', st.categoria === cat ? 'ativo' : '', CAT_NOMES[cat] + ' · ' + (c.total - c.feitos));
      b.title = (c.total - c.feitos) + ' pendentes de ' + c.total;
      b.addEventListener('click', function () { st.categoria = cat; history.replaceState(estadoHist(st.tela), ''); desenharLista(); });
      chips.appendChild(b);
    });

    const q = textoNorm($('busca').value.trim());
    box.textContent = '';
    const itens = l.veiculos.filter(function (v) { return st.categoria === 'todas' || v.categoria === st.categoria; })
      .sort(function (a, b) { return Number(a.nro) - Number(b.nro); });
    const cont = { pendentes: 0, feitos: 0, refazer: 0, todos: 0 };
    itens.forEach(function (v) {
      const e = estadoVeiculo(l, v);
      cont.todos++;
      if (e === 'pendente') cont.pendentes++;
      if (e === 'feito' || e === 'local') cont.feitos++;
      if (e === 'pendente' && v.refazer) cont.refazer++;
    });
    if (st.filtro === 'refazer' && !cont.refazer) st.filtro = 'pendentes';
    const NOMES_F = { pendentes: 'Pendentes', feitos: 'Fotografados', refazer: '⚠️ Refazer', todos: 'Todos' };
    document.querySelectorAll('#filtros button').forEach(function (x) {
      const f = x.dataset.filtro;
      x.textContent = NOMES_F[f] + ' ' + cont[f];
      x.classList.toggle('ativo', f === st.filtro);
      x.classList.toggle('oculto', f === 'refazer' && !cont.refazer);
    });

    let mostrados = 0;
    itens.forEach(function (v) {
      const e = estadoVeiculo(l, v);
      if (st.filtro === 'pendentes' && (e === 'feito' || e === 'local')) return;
      if (st.filtro === 'pendentes' && e === 'bloq' && !(q && q === textoNorm(v.nro))) return; // só aparece se buscar o NRO exato
      if (st.filtro === 'feitos' && !(e === 'feito' || e === 'local')) return;
      if (st.filtro === 'refazer' && !(e === 'pendente' && v.refazer)) return;
      if (q && textoNorm(v.nro + ' ' + v.placa + ' ' + v.modelo + ' ' + v.cor + ' ' + v.chassi).indexOf(q) < 0) return;
      mostrados++;
      const b = el('button', 'item ' + (e === 'pendente' ? '' : e) + (st.sel && st.sel.nro === v.nro ? ' sel' : ''));
      b.appendChild(el('div', 'nro', v.nro));
      const d = el('div', 'desc');
      d.appendChild(el('div', 'placa', v.placa ? v.placa + (v.uf ? ' · ' + v.uf : '') : (v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
      d.appendChild(el('div', 'mod', [v.modelo, v.cor, st.categoria === 'todas' ? CAT_NOMES[v.categoria] : ''].filter(Boolean).join(' · ') || '—'));
      b.appendChild(d);
      let stx = '';
      if (e === 'bloq') stx = '⛔ NÃO DESTINAR';
      else if (e === 'local') stx = '📱 ' + st.pendLocal[l.loteId + '|' + v.nro] + ' no celular';
      else if (e === 'feito') stx = '✅ ' + v.fotos + ' foto' + (v.fotos === 1 ? '' : 's');
      else if (v.refazer) stx = '⚠️ refazer';
      b.appendChild(el('div', 'st', stx));
      b.addEventListener('click', function () {
        if (e === 'bloq') { toast('NRO ' + v.nro + ': NÃO DESTINAR — não pode sair do CRV.' + (v.motivo ? ' (' + v.motivo + '…)' : '')); return; }
        abrirVeiculo(selDe(v));
      });
      box.appendChild(b);
    });
    if (!mostrados) box.appendChild(el('p', 'suave', st.filtro === 'pendentes' && !q ? 'Nenhum pendente aqui. 🎉' : 'Nada encontrado.'));
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
    let cat = st.categoria;
    if (cat === 'todas') {
      cat = await modal('Qual categoria?', 'O NRO ' + nro + ' é:', [
        { texto: 'Carro', valor: 'carros' }, { texto: 'Moto', valor: 'motos' }, { texto: 'Outros (pesados, reboques, bicicletas…)', valor: 'outros' }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
      if (!cat) return;
    }
    abrirVeiculo({ nro: nro, categoria: cat, foraDaLista: true });
    abrirCamera();
  });

  // ---------- tela do veículo (dados + fotos tiradas + câmera) ----------

  function cartaoFoto(src, legenda, aoApagar, bloqueada) {
    const c = el('div', 'foto-cartao');
    const img = el('img'); img.alt = legenda; if (src) img.src = src;
    img.addEventListener('click', function () { if (img.src) ampliar(img.src); });
    c.appendChild(img);
    c.appendChild(el('div', 'suave', legenda));
    if (bloqueada) c.appendChild(el('div', 'tag verde', '✔ Já baixada pela gestão'));
    else if (aoApagar) {
      const b = el('button', 'btn pequeno vermelho', '🗑 Apagar');
      b.addEventListener('click', aoApagar);
      c.appendChild(b);
    }
    return { cartao: c, img: img };
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
    if (!largo()) $('titulo').textContent = 'NRO ' + nro + ' · ' + l.patio;
    $('btnTirarFotos').textContent = '📷 Tirar fotos do NRO ' + nro;

    // fotos ainda no celular
    const fila = (await N.filaTodos()).filter(function (f) { return f.loteId === l.loteId && f.nro === nro && !f.apagadaCampo; });
    if (meu !== st.galSeq) return;
    const topo = $('veiculoTopo'); topo.textContent = '';
    const e = v.naoDestinar ? 'bloq' : (fila.length ? 'local' : (v.status === 'fotografado' ? 'feito' : 'pendente'));
    const linha = el('div', 'linha-btns'); linha.style.marginTop = '0'; linha.style.alignItems = 'center';
    linha.appendChild(el('div', 'nro-grande', 'NRO ' + nro));
    const ROT = { local: ['amarelo', '📱 ' + fila.length + ' no celular'], feito: ['verde', '✅ fotografado'], pendente: [v.refazer ? 'amarelo' : '', v.refazer ? '⚠️ refazer' : 'pendente'], bloq: ['vermelho', 'NÃO DESTINAR'] }[e];
    linha.appendChild(el('span', 'tag ' + ROT[0], ROT[1]));
    topo.appendChild(linha);
    topo.appendChild(el('div', 'placa-grande', v.placa ? v.placa + (v.uf ? ' · ' + v.uf : '') : (st.sel.foraDaLista || v.foraDaLista ? 'Fora da lista' : 'Sem placa')));
    topo.appendChild(el('div', 'suave', [v.modelo, v.cor, CAT_NOMES[v.categoria]].filter(Boolean).join(' · ')));
    if (v.refazer && e === 'pendente') topo.appendChild(el('div', 'aviso-refazer', 'A gestão pediu foto nova deste veículo.'));

    const boxL = $('galeriaLocais'), boxE = $('galeriaEnviadas');
    boxL.querySelectorAll('img').forEach(function (i) { if (i.src.indexOf('blob:') === 0) URL.revokeObjectURL(i.src); });
    boxL.textContent = ''; $('galeriaAviso').textContent = '';
    $('tituloLocais').classList.toggle('oculto', !fila.length);
    fila.forEach(function (f) {
      const r = cartaoFoto(URL.createObjectURL(f.blob), hora(f.tiradaEm), async function () {
        const ok = await modal('Apagar foto?', 'A foto sai da sua tela, mas continua sendo enviada para a gestão.', [{ texto: 'Apagar', cls: 'vermelho', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
        if (!ok) return;
        f.apagadaCampo = true; await N.filaPut(f);
        await recarregarFila(); desenhar();
      });
      boxL.appendChild(r.cartao);
    });

    // fotos já enviadas (precisa de internet; guardadas por 30 s para não repetir a busca a cada redesenho)
    const chave = l.loteId + '|' + nro;
    if (!navigator.onLine) { boxE.textContent = ''; $('tituloEnviadas').classList.add('oculto'); $('galeriaAviso').textContent = 'Sem internet: só aparecem as fotos que ainda estão no celular.'; return; }
    const token = await N.kvGet('token');
    let enviadas;
    if (st.envCache && st.envCache.chave === chave && Date.now() - st.envCache.t < 30000) enviadas = st.envCache.lista;
    else {
      try { enviadas = await N.chamarApi('fotosVeiculo', { loteId: l.loteId, nro: nro }, token); }
      catch (e) { if (meu === st.galSeq) $('galeriaAviso').textContent = e.code === 'REDE' ? 'Sem conexão com o servidor: só aparecem as fotos do celular.' : e.message; return; }
      st.envCache = { chave: chave, t: Date.now(), lista: enviadas };
    }
    if (meu !== st.galSeq) return;
    boxE.textContent = '';
    $('tituloEnviadas').classList.toggle('oculto', !enviadas.length);
    if (!enviadas.length && !fila.length) $('galeriaAviso').textContent = 'Nenhuma foto deste NRO.';
    enviadas.forEach(function (f) {
      const r = cartaoFoto(null, f.nome + ' · ' + hora(f.tiradaEm), f.baixada ? null : async function () {
        const ok = await modal('Apagar foto?', 'A foto sai da sua tela, mas continua com a gestão.', [{ texto: 'Apagar', cls: 'vermelho', valor: 1 }, { texto: 'Cancelar', cls: 'cinza', valor: null }]);
        if (!ok) return;
        try {
          await N.chamarApi('ocultarFoto', { uuid: f.uuid }, token);
          const v = l.veiculos.find(function (x) { return x.nro === nro; });
          if (v) { v.fotos = Math.max(0, (v.fotos || 0) - 1); if (!v.fotos) v.status = 'pendente'; }
          await N.kvSet('dadosCampo', st.dados);
          st.envCache = null;
          toast('Foto apagada da sua tela.');
          desenhar();
        } catch (e) { toast(e.code === 'REDE' ? 'Sem internet para apagar agora.' : e.message); }
      }, f.baixada);
      boxE.appendChild(r.cartao);
      if (st.minis[f.uuid]) r.img.src = st.minis[f.uuid];
      else N.chamarApi('miniatura', { uuid: f.uuid }, token).then(function (m) {
        r.img.src = st.minis[f.uuid] = 'data:' + m.tipo + ';base64,' + m.base64;
      }).catch(function () { r.img.alt = 'não carregou'; });
    });
  }

  // ---------- câmera ----------
  $('btnTirarFotos').addEventListener('click', function () { if (st.sel) abrirCamera(); });

  async function abrirCamera() {
    st.camFotos = [];
    desenharMiniaturas();
    $('camTitulo').textContent = 'NRO ' + st.sel.nro + (st.sel.placa ? ' · ' + st.sel.placa : '');
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
      const x = el('button', 'x', '×'); x.setAttribute('aria-label', 'Apagar foto');
      x.addEventListener('click', function () { URL.revokeObjectURL(f.url); st.camFotos.splice(i, 1); desenharMiniaturas(); });
      m.appendChild(img); m.appendChild(x); box.appendChild(m);
    });
    if (!st.camFotos.length) box.appendChild(el('span', 'suave', 'Tire as fotos do veículo e da placa inutilizada.'));
    $('btnCamConfirmar').disabled = !st.camFotos.length;
    $('btnCamConfirmar').textContent = 'Confirmar (' + st.camFotos.length + ')';
  }

  $('btnCamConfirmar').addEventListener('click', async function () {
    if (!st.camFotos.length || !st.sel) return;
    $('btnCamConfirmar').disabled = true;
    const qtd = st.camFotos.length;
    try {
      for (const f of st.camFotos) {
        await N.filaPut({
          uuid: crypto.randomUUID(), loteId: st.loteId, nro: st.sel.nro, categoria: st.sel.categoria,
          foraDaLista: !!st.sel.foraDaLista, tiradaEm: f.tiradaEm, criadoEm: new Date().toISOString(),
          blob: f.blob, tentativas: 0
        });
      }
    } catch (e) {
      $('btnCamConfirmar').disabled = false;
      await modal('Erro ao salvar', 'Não consegui guardar as fotos no celular (' + e.message + '). Verifique o espaço livre.', [{ texto: 'OK', valor: 1 }]);
      return;
    }
    limparCamFotos();
    pararStream();
    $('camera').classList.add('oculto');
    history.back();
    st.envCache = null;
    await recarregarFila();
    toast(qtd + ' foto(s) salva(s) no celular' + (navigator.onLine ? ' — enviando…' : ' — envio quando tiver sinal'));
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
    if (!st.filaTotal) { if (manual) toast('Nada para enviar.'); return; }
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
    $('titulo').textContent = 'Fotos aguardando envio';
    const fila = await recarregarFila();
    atualizarSelos();
    const travadas = fila.filter(function (f) { return f.travada; }).length;
    $('filaResumo').textContent = fila.length
      ? fila.length + ' foto(s) guardada(s) no celular' + (travadas ? ' · ' + travadas + ' com problema' : '') + '. Elas são enviadas sozinhas quando houver sinal.'
      : 'Todas as fotos foram enviadas. ✅';
    const box = $('filaItens');
    box.querySelectorAll('img').forEach(function (i) { URL.revokeObjectURL(i.src); });
    box.textContent = '';
    const nomes = {};
    ((st.dados && st.dados.lotes) || []).forEach(function (l) { nomes[l.loteId] = l.patio; });
    fila.forEach(function (f) {
      const c = el('div', 'item');
      const img = el('img'); img.src = URL.createObjectURL(f.blob); img.alt = ''; img.height = 56;
      c.appendChild(img);
      const d = el('div', 'desc');
      d.appendChild(el('div', 'placa', 'NRO ' + f.nro + ' · ' + (nomes[f.loteId] || 'pátio encerrado')));
      d.appendChild(el('div', 'mod', hora(f.tiradaEm) + (f.apagadaCampo ? ' · apagada por você (vai só para a gestão)' : '') + (f.erro ? ' · ' + f.erro : '')));
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
        c.appendChild(el('div', 'st', '⏳'));
      }
      box.appendChild(c);
    });
  }

  // ---------- menu ----------
  $('btnMenu').addEventListener('click', async function () {
    if (!st.sessao) return;
    const r = await modal('Menu', (st.sessao.nome || st.sessao.usuario) + ' · versão ' + self.CONFIG.VERSAO, [
      { texto: '🔄 Atualizar listas', valor: 'atualizar' },
      { texto: '⬆ Fotos aguardando envio (' + st.filaTotal + ')', cls: 'cinza', valor: 'fila' },
      { texto: 'Sair', cls: 'cinza', valor: 'sair' },
      { texto: 'Fechar', cls: 'cinza', valor: null }
    ]);
    if (r === 'atualizar') { if (!navigator.onLine) toast('Sem sinal agora.'); else { await atualizarListas(false); enviarFila(); } }
    if (r === 'fila') mostrar('telaFila', true);
    if (r === 'sair') {
      await recarregarFila();
      if (st.filaTotal) { await modal('Ainda há fotos no celular', 'Envie as ' + st.filaTotal + ' foto(s) pendente(s) antes de sair.', [{ texto: 'OK', valor: 1 }]); return; }
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
  setInterval(function () { if (navigator.onLine && st.filaTotal && !st.enviando) enviarFila(); }, 60000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
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
    history.replaceState({ tela: 'telaPatios' }, '');
    mostrar('telaPatios', false);
    if (navigator.onLine) { await atualizarListas(true); enviarFila(); }
  })();
})();

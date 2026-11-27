// Ícones em linha (SVG próprios, sem dependência externa). Uso: ic('camera') ou <span data-ic="camera"></span>.
(function () {
  const P = {
    camera: "<path d='M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.6-2.4A1 1 0 0 1 9.4 4h5.2a1 1 0 0 1 .8.4L17 7h2.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'/><circle cx='12' cy='13' r='3.6'/>",
    check: "<path d='M5 12.5l4.5 4.5L19 7.5'/>",
    pendente: "<circle cx='12' cy='12' r='8'/>",
    celular: "<rect x='7' y='3' width='10' height='18' rx='2'/><path d='M11 17.5h2'/>",
    bloq: "<circle cx='12' cy='12' r='9'/><path d='M5.6 5.6l12.8 12.8'/>",
    upload: "<path d='M12 16V4M7 9l5-5 5 5M5 20h14'/>",
    semsinal: "<path d='M2 8.5a15 15 0 0 1 6-3.3M22 8.5a15 15 0 0 0-9.5-3.9M5 12a10 10 0 0 1 4-2.2M19 12a10 10 0 0 0-3.2-1.9M8.5 15.5a5 5 0 0 1 7 0'/><path d='M3 3l18 18'/><circle cx='12' cy='19' r='.8'/>",
    sync: "<path d='M20 11a8 8 0 0 0-14.5-4.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16M4 4v4h4M20 20v-4h-4'/>",
    seta: "<path d='M9 5l7 7-7 7'/>",
    voltar: "<path d='M15 5l-7 7 7 7'/>",
    busca: "<circle cx='11' cy='11' r='7'/><path d='M20 20l-4-4'/>",
    carro: "<path d='M5 17H4a1 1 0 0 1-1-1v-3l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v3a1 1 0 0 1-1 1h-1M3 13h18M9.5 17h5'/><circle cx='7.5' cy='17' r='2'/><circle cx='16.5' cy='17' r='2'/>",
    moto: "<circle cx='5' cy='16.5' r='3.5'/><circle cx='19' cy='16.5' r='3.5'/><path d='M5 16.5h4l3-5h4l3 5M9 11.5h5.5M15 8h3l1.5 3.5M12 11.5l-1.5-3H8'/>",
    outros: "<path d='M2 6h11v10H2zM13 9h4l4 4v3h-8'/><circle cx='6' cy='17.5' r='2'/><circle cx='17' cy='17.5' r='2'/>",
    menu: "<path d='M4 7h16M4 12h16M4 17h16'/>",
    sol: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
    lua: "<path d='M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'/>",
    download: "<path d='M12 4v12M7 11l5 5 5-5M5 20h14'/>",
    editar: "<path d='M4 20h4L19 9l-4-4L4 16z'/><path d='M13.5 6.5l4 4'/>",
    lixo: "<path d='M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5'/>",
    mover: "<path d='M5 12h13M13 6l6 6-6 6'/>",
    resetar: "<path d='M4 4v6h6'/><path d='M5.6 15a7.5 7.5 0 1 0 1.8-7.8L4 10'/>",
    trocar: "<path d='M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7'/>",
    pin: "<path d='M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z'/><circle cx='12' cy='9.5' r='2.5'/>",
    lista: "<path d='M9 6h11M9 12h11M9 18h11'/><circle cx='4.5' cy='6' r='1'/><circle cx='4.5' cy='12' r='1'/><circle cx='4.5' cy='18' r='1'/>",
    foto: "<rect x='3' y='5' width='18' height='14' rx='2'/><circle cx='9' cy='10' r='2'/><path d='M21 16l-5-5-8 8'/>",
    alerta: "<path d='M12 3.5l9.5 17h-19z'/><path d='M12 10v4.5M12 17.5v.2'/>",
    mais: "<path d='M12 5v14M5 12h14'/>",
    usuarios: "<circle cx='9' cy='8' r='3.5'/><path d='M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6'/>",
    chave: "<circle cx='8' cy='15' r='4'/><path d='M11 12l9-9M17 6l3 3M15 8l2 2'/>",
    planilha: "<rect x='4' y='3' width='16' height='18' rx='2'/><path d='M4 9h16M4 15h16M10 3v18'/>",
    cadeado: "<rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>",
    aberto: "<rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 7.5-2'/>",
    x: "<path d='M6 6l12 12M18 6L6 18'/>",
    lanterna: "<path d='M8 3h8l-1 6H9zM9 9h6v12H9zM12 13v3'/>",
    sair: "<path d='M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10'/>",
    atualizar: "<path d='M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'/>",
    nuvem: "<path d='M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z'/>",
    olho: "<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'/><circle cx='12' cy='12' r='3'/>",
    olhofechado: "<path d='M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'/>",
    pontos: "<circle cx='5' cy='12' r='1.6'/><circle cx='12' cy='12' r='1.6'/><circle cx='19' cy='12' r='1.6'/>",
    anterior: "<path d='M15 5l-7 7 7 7'/>",
    ocultar: "<path d='M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6'/>",
    ordenar: "<path d='M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4'/>",
    arquivo: "<path d='M6 3h8l4 4v14H6z'/><path d='M14 3v4h4'/>",
    teclado: "<rect x='2.5' y='6' width='19' height='12' rx='2'/><path d='M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10'/>"
  };
  const NS = 'http://www.w3.org/2000/svg';
  self.ic = function (nome, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = P[nome] || ''; // conteúdo fixo deste arquivo (nunca dado do usuário)
    return s;
  };
  // botões/elementos estáticos com data-ic="nome"
  function aplicar() {
    document.querySelectorAll('[data-ic]').forEach(function (e) {
      if (e.querySelector(':scope > svg.ic')) return;
      e.insertBefore(self.ic(e.dataset.ic, e.dataset.icc || ''), e.firstChild);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar); else aplicar();
  self.aplicarIcones = aplicar;
})();

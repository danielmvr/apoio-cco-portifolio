/* Mapa principal do Apoio CCO (Leaflet + MarkerCluster, sem outras dependências).
 * Versão de portfólio: as consultas ao servidor foram trocadas pelas funções de ApoioDados (assets/js/dados.js),
 * que leem arquivos estáticos e o CSV de frota do Monitoramento de Rodovias; o resto do código é o do sistema original. */
window.ApoioDados.pronto.then(function (CFG) {
  "use strict";

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  // ---------------------------------------------------------------- mapa base
  var mapa = L.map("mapa", { zoomControl: false, preferCanvas: false }).setView(CFG.centro, CFG.zoom);
  // com o painel de ocorrências flutuando à esquerda, os controles do mapa ficam do lado direito
  var LADO_CONTROLES = (CFG.veiculos && CFG.ocorrencias) ? "right" : "left";
  L.control.zoom({ position: "top" + LADO_CONTROLES, zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(mapa);
  var osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
  }).addTo(mapa);
  var ruas = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Tiles &copy; Esri"
  });
  var satelite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Tiles &copy; Esri"
  });
  L.control.layers({ "OpenStreetMap": osm, "Ruas (Esri)": ruas, "Satélite (Esri)": satelite }, null, { position: "top" + LADO_CONTROLES }).addTo(mapa);
  L.control.scale({ imperial: false, position: "bottom" + LADO_CONTROLES }).addTo(mapa);

  // ---------------------------------------------------------------- laterais recolhíveis (setinhas)
  // painel lateral direito: aba com seta na borda do mapa; lista de ocorrências: seta no topo do painel flutuante.
  // A escolha fica guardada no navegador.
  var PAINEIS = "apoiocco.paineis";
  var paineis = { oc: window.innerWidth > 760, lateral: true };
  try {
    var salvoP = JSON.parse(localStorage.getItem(PAINEIS) || "null");
    if (salvoP && typeof salvoP.oc === "boolean") paineis.oc = salvoP.oc;
    if (salvoP && typeof salvoP.lateral === "boolean") paineis.lateral = salvoP.lateral;
  } catch (e) {}
  function guardarPaineis() { try { localStorage.setItem(PAINEIS, JSON.stringify(paineis)); } catch (e) {} }
  function aplicarLateral() {
    var layout = document.getElementById("mapa-layout"), aba = document.getElementById("aba-painel");
    if (layout) layout.classList.toggle("lateral-fechada", !paineis.lateral);
    if (aba) {
      var t = paineis.lateral ? "Recolher o painel lateral" : "Mostrar o painel lateral";
      aba.setAttribute("aria-expanded", paineis.lateral ? "true" : "false");
      aba.setAttribute("aria-label", t);
      aba.title = t;
    }
    setTimeout(function () { mapa.invalidateSize(); }, 0);
  }
  function abrirLateral() {
    if (paineis && !paineis.lateral) { paineis.lateral = true; guardarPaineis(); aplicarLateral(); }
  }
  function aplicarOc() {
    var p = document.getElementById("painel-oc"), pil = document.getElementById("pilula-oc");
    if (!p || !pil) return;
    p.hidden = !paineis.oc;
    pil.hidden = paineis.oc;
  }
  (function () {
    var aba = document.getElementById("aba-painel");
    if (aba) aba.addEventListener("click", function () { paineis.lateral = !paineis.lateral; guardarPaineis(); aplicarLateral(); });
    var rec = document.getElementById("oc-recolher"), pil = document.getElementById("pilula-oc");
    if (rec) rec.addEventListener("click", function () { paineis.oc = false; guardarPaineis(); aplicarOc(); if (pil) pil.focus(); });
    if (pil) pil.addEventListener("click", function () { paineis.oc = true; guardarPaineis(); aplicarOc(); var r = document.getElementById("oc-recolher"); if (r) r.focus(); });
    aplicarLateral();
    aplicarOc();
  })();

  // ---------------------------------------------------------------- estado
  var camadas = {};          // id -> {cfg, grupo, visivel}
  var locais = [];           // todos os locais carregados
  var marcadores = {};       // id -> marker/polygon
  var filtros = { empresa: "", uf: "", inativos: false, texto: "" };
  var marcadorAqui = null;
  var posicaoAqui = null;
  var primeiraCarga = true;

  CFG.camadas.forEach(function (c) {
    camadas[c.id] = { cfg: c, visivel: c.visivel, grupo: criaGrupo(c) };
    if (c.visivel) camadas[c.id].grupo.addTo(mapa);
  });

  function criaGrupo(c) {
    if (c.tipo === "AREA") return L.layerGroup();
    return L.markerClusterGroup({
      maxClusterRadius: 45, disableClusteringAtZoom: 11, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount();
        return L.divIcon({ html: "<div style='background:" + c.cor + "'>" + n + "</div>", className: "cluster-cco", iconSize: [40, 40] });
      }
    });
  }

  function iconePino(cor, rotulo) {
    var svg = "<svg width='30' height='40' viewBox='0 0 30 40'><path d='M15 1C7.3 1 1 7.2 1 14.8 1 25 15 39 15 39s14-14 14-24.2C29 7.2 22.7 1 15 1z' fill='" + cor + "' stroke='#fff' stroke-width='2'/>" +
      (rotulo ? "" : "<circle cx='15' cy='15' r='5' fill='#fff'/>") + "</svg>";
    return L.divIcon({ html: "<div class='marcador-pino'>" + svg + (rotulo ? "<span>" + esc(rotulo) + "</span>" : "") + "</div>", className: "", iconSize: [30, 40], iconAnchor: [15, 39], popupAnchor: [0, -34] });
  }

  // ---------------------------------------------------------------- carga
  function carregar() {
    window.ApoioDados.locais(filtros.inativos).then(function (d) {
      if (!d) return;
      locais = d.locais;
      desenhar();
      if (primeiraCarga) { primeiraCarga = false; abrirDoHash(); }
    }).catch(function () { avisar("Não foi possível carregar os locais. Verifique a conexão."); });
  }

  function passaFiltro(l) {
    if (filtros.empresa && l.e !== filtros.empresa) return false;
    if (filtros.uf && l.uf !== filtros.uf) return false;
    return true;
  }

  function desenhar() {
    Object.keys(camadas).forEach(function (id) { camadas[id].grupo.clearLayers(); });
    marcadores = {};
    locais.forEach(function (l) {
      var cam = camadas[l.c];
      if (!cam || !passaFiltro(l)) return;
      var camada = cam.cfg, obj, cor = l.co || camada.cor;
      if (l.pg) {
        obj = L.polygon(l.pg, { color: cor, weight: 2, fillColor: cor, fillOpacity: l.a ? 0.18 : 0.06, dashArray: l.a ? null : "4 4" });
        obj.bindTooltip("<span style='color:" + esc(cor) + "'>&#9632;</span> " + esc(l.n), { sticky: true });
      } else {
        obj = L.marker([l.la, l.lo], { icon: iconePino(cor, camada.rotulo), opacity: l.a ? 1 : 0.45, title: (l.s ? l.s + " - " : "") + l.n });
      }
      obj.on("click", function () { abrirDetalhe(l.id); });
      obj._local = l;
      cam.grupo.addLayer(obj);
      marcadores[l.id] = obj;
    });
    atualizarContagens();
  }

  function atualizarContagens() {
    Object.keys(camadas).forEach(function (id) {
      var n = locais.filter(function (l) { return String(l.c) === String(id) && passaFiltro(l) && l.a; }).length;
      var el = $("#total-camada-" + id);
      if (el) el.textContent = n;
    });
    montarOpcoesFiltros();
  }

  // Só oferece nos filtros os valores que existem nos dados; avisa quando não há nenhum.
  function montarOpcoesFiltros() {
    var se = $("#filtro-empresa"), su = $("#filtro-uf"), aviso = $("#filtros-aviso");
    var porEmpresa = {}, porUf = {};
    locais.forEach(function (l) {
      if (l.e) porEmpresa[l.e] = (porEmpresa[l.e] || 0) + 1;
      if (l.uf) porUf[l.uf] = (porUf[l.uf] || 0) + 1;
    });
    var nomes = {};
    CFG.empresas.forEach(function (e) { nomes[e.valor] = e.nome; });
    function preencher(sel, valores, rotulos, atual, textoTodos) {
      sel.innerHTML = "";
      var o0 = document.createElement("option"); o0.value = ""; o0.textContent = textoTodos; sel.appendChild(o0);
      Object.keys(valores).sort(function (a, b) { return (rotulos[a] || a).localeCompare(rotulos[b] || b); }).forEach(function (v) {
        var o = document.createElement("option"); o.value = v; o.textContent = (rotulos[v] || v) + " (" + valores[v] + ")"; sel.appendChild(o);
      });
      sel.value = valores[atual] ? atual : "";
      sel.disabled = Object.keys(valores).length === 0;
    }
    preencher(se, porEmpresa, nomes, filtros.empresa, "Todas as empresas");
    preencher(su, porUf, {}, filtros.uf, "Todas as UFs");
    if (!se.value) filtros.empresa = "";
    if (!su.value) filtros.uf = "";
    var faltando = [];
    if (!Object.keys(porEmpresa).length) faltando.push("empresa");
    if (!Object.keys(porUf).length) faltando.push("UF");
    if (aviso) {
      aviso.hidden = !faltando.length;
      aviso.textContent = faltando.length ? "Nenhum local tem " + faltando.join(" nem ") + " preenchida ainda. " + (CFG.podeAdmin ? "Use Administração > Ferramentas de dados (cidade/UF) e a lista de locais (empresa em lote)." : "Peça a um editor para preencher no cadastro.") : "";
    }
  }

  // ---------------------------------------------------------------- painel: camadas e filtros
  (function montarCamadas() {
    var cont = $("#lista-camadas");
    CFG.camadas.forEach(function (c) {
      var lab = document.createElement("label");
      lab.className = "camada-item";
      lab.innerHTML = "<input type='checkbox' " + (c.visivel ? "checked" : "") + " data-camada='" + c.id + "'>" +
        "<span class='bolinha' style='background:" + c.cor + "'></span><span>" + esc(c.nome) + "</span><span class='total' id='total-camada-" + c.id + "'>" + c.total + "</span>";
      cont.appendChild(lab);
    });
    var todas = $("#camadas-todas");
    function atualizarTodas() {
      if (!todas) return;
      var cbs = $$("#lista-camadas input[data-camada]"), n = cbs.filter(function (c) { return c.checked; }).length;
      todas.checked = n === cbs.length;
      todas.indeterminate = n > 0 && n < cbs.length;
    }
    cont.addEventListener("change", function (ev) {
      var cb = ev.target.closest("input[data-camada]");
      if (!cb) return;
      var cam = camadas[cb.getAttribute("data-camada")];
      cam.visivel = cb.checked;
      if (cb.checked) cam.grupo.addTo(mapa); else mapa.removeLayer(cam.grupo);
      atualizarTodas();
    });
    if (todas) {
      todas.addEventListener("change", function () {
        var ligar = todas.checked;
        $$("#lista-camadas input[data-camada]").forEach(function (cb) {
          cb.checked = ligar;
          var cam = camadas[cb.getAttribute("data-camada")];
          cam.visivel = ligar;
          if (ligar) cam.grupo.addTo(mapa); else mapa.removeLayer(cam.grupo);
        });
        todas.indeterminate = false;
      });
      atualizarTodas();
    }
    var se = $("#filtro-empresa");
    var su = $("#filtro-uf");
    se.addEventListener("change", function () { filtros.empresa = se.value; desenhar(); });
    su.addEventListener("change", function () { filtros.uf = su.value; desenhar(); });
    var si = $("#filtro-inativos");
    if (si) si.addEventListener("change", function () { filtros.inativos = si.checked; carregar(); });
  })();

  // ---------------------------------------------------------------- seções recolhíveis (estado lembrado neste navegador)
  (function secoesRecolhiveis() {
    var CHAVE = "apoiocco.secoes";
    var estado = {};
    try { estado = JSON.parse(localStorage.getItem(CHAVE) || "{}") || {}; } catch (e) { estado = {}; }
    $$("[data-recolher]").forEach(function (btn) {
      var nome = btn.getAttribute("data-recolher"), sec = btn.closest(".recolhivel");
      function aplicar(recolhido) {
        sec.classList.toggle("recolhido", recolhido);
        btn.setAttribute("aria-expanded", recolhido ? "false" : "true");
      }
      aplicar(!!estado[nome]);
      btn.addEventListener("click", function () {
        var agora = !sec.classList.contains("recolhido");
        aplicar(agora);
        estado[nome] = agora;
        try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) {}
      });
    });
  })();

  // ---------------------------------------------------------------- telas do painel
  function mostrarTela(nome) {
    ["inicial", "resultados", "detalhe"].forEach(function (t) { $("#tela-" + t).hidden = (t !== nome); });
    if (nome !== "detalhe" && veic && veic.grupoCand) limparCandidatos();
    if (nome !== "inicial") abrirLateral();   // um detalhe ou resultado precisa do painel lateral à vista
    $("#painel").classList.remove("recolhido");
    $("#painel-conteudo").scrollTop = 0;
  }
  function avisar(msg) { $("#tela-resultados").innerHTML = "<p class='vazio'>" + esc(msg) + "</p>"; mostrarTela("resultados"); }

  // ---------------------------------------------------------------- busca
  var buscaTimer = null;
  var campoBusca = $("#busca");
  campoBusca.addEventListener("input", function () {
    clearTimeout(buscaTimer);
    var q = campoBusca.value.trim();
    if (q.length < 2) { mostrarTela("inicial"); return; }
    buscaTimer = setTimeout(function () { buscar(q); }, 250);
  });
  campoBusca.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { campoBusca.value = ""; mostrarTela("inicial"); }
    if (ev.key === "Enter") { var p = $("#tela-resultados .resultado"); if (p) p.click(); }
  });

  function buscar(q) {
    // primeiro o que já está carregado (instantâneo), depois o servidor (contatos, observações)
    var ql = q.toLowerCase();
    var itemLocal = function (l) { return { id: l.id, nome: l.n, sigla: l.s, cidade: l.ci, uf: l.uf, cor: l.co || (camadas[l.c] ? camadas[l.c].cfg.cor : "#999"), camada: camadas[l.c] ? camadas[l.c].cfg.nome : "", area: !!l.pg }; };
    var veiculosAchados = (CFG.veiculos && veic.lista.length) ? veic.lista.filter(function (v) { return (v.id + " " + (v.placa || "")).toLowerCase().indexOf(ql) >= 0; }).slice(0, 10).map(function (v) {
      return { id: "v:" + v.id, nome: "Veículo " + v.id + (v.placa ? " (" + v.placa + ")" : ""), sigla: "", cidade: v.uf, uf: "", cor: v.cor, camada: v.empresa || "veículo", area: false,
        motivo: v.quando ? (v.faixa === "ok" ? idadeTexto(v.idade_min) : "última posição " + v.quando.replace(/\/\d{4} /, " ")) : "sem data da posição", chip: (v.ocorrencia ? chipOcorrencia(v.ocorrencia) + " " : "") + (v.socorro ? chipSocorro("Socorro") + " " : "") + chipGps(v.faixa) };
    }) : [];
    var locaisAchados = locais.filter(function (l) { return ((l.s || "") + " " + l.n + " " + (l.ci || "") + " " + (l.sv || "")).toLowerCase().indexOf(ql) >= 0; }).slice(0, 25);
    var titulo = "Resultados para \u201C" + q + "\u201D";
    renderResultados(veiculosAchados.concat(locaisAchados.map(itemLocal)), titulo);
    window.ApoioDados.busca(q).then(function (d) {
      if (campoBusca.value.trim() !== q) return;
      var vistos = {};
      var lista = [];
      locaisAchados.forEach(function (l) { vistos[l.id] = true; });
      d.resultados.forEach(function (r) { if (!vistos[r.id]) lista.push(r); });
      if (lista.length) renderResultados(veiculosAchados.concat(locaisAchados.map(itemLocal)).concat(lista), titulo);
    }).catch(function () {});
  }

  function renderResultados(itens, titulo, comDistancia) {
    var html = "<h2>" + esc(titulo) + "</h2>";
    if (!itens.length) html += "<p class='vazio'>Nada encontrado.</p>";
    itens.forEach(function (r) {
      html += "<div class='resultado' data-id='" + r.id + "'><span class='bolinha' style='background:" + esc(r.cor) + "'></span>" +
        "<div><div class='nome'>" + (r.sigla ? "<span class='mudo'>" + esc(r.sigla) + "</span> " : "") + esc(r.nome) + "</div>" +
        "<div class='sub'>" + esc(r.camada) + (r.cidade ? " · " + esc(r.cidade) + (r.uf ? "/" + esc(r.uf) : "") : "") + (r.motivo ? " · " + esc(r.motivo) : "") + "</div></div>" +
        (comDistancia ? "<span class='dist'>" + esc(r.distancia) + "</span>" : "") + (r.chip ? "<span class='chip-res'>" + r.chip + "</span>" : "") + "</div>";
    });
    $("#tela-resultados").innerHTML = html;
    mostrarTela("resultados");
  }

  $("#tela-resultados").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-voltar]")) { mostrarTela("inicial"); return; }
    var r = ev.target.closest(".resultado");
    if (!r) return;
    if (r.hasAttribute("data-osm")) { focarOsm(r.getAttribute("data-osm")); return; }
    var id = r.getAttribute("data-id");
    if (id.indexOf("v:") === 0) {
      var v = veic.lista.filter(function (x) { return x.id === id.slice(2); })[0];
      if (v) abrirVeiculo(v);
      return;
    }
    abrirDetalhe(parseInt(id, 10), true);
  });

  // ---------------------------------------------------------------- detalhe
  var detalheAtual = null;
  function abrirDetalhe(id, voar) {
    detalheAtual = id;
    if (veic && veic.grupoCand) limparCandidatos();
    var l = locais.filter(function (x) { return x.id === id; })[0];
    if (l) {
      var cam = camadas[l.c];
      if (cam && !cam.visivel) { // liga a camada se estiver escondida
        cam.visivel = true; cam.grupo.addTo(mapa);
        var cb = $("input[data-camada='" + l.c + "']"); if (cb) cb.checked = true;
      }
      var obj = marcadores[id];
      if (obj) {
        if (l.pg) { enquadrar(obj.getBounds(), 30); }
        else if (voar || mapa.getZoom() < 12) {
          // a partir do zoom 11 não há agrupamento, então o marcador fica visível sem zoomToShowLayer
          var z = Math.max(mapa.getZoom(), 14);
          mapa.flyTo(centroComPainel([l.la, l.lo], z), z, { duration: 0.8 });
        } else if (cam && cam.grupo.zoomToShowLayer) {
          cam.grupo.zoomToShowLayer(obj, function () {});
        }
      }
    }
    history.replaceState(null, "", "#l=" + id);
    $("#tela-detalhe").innerHTML = "<p class='vazio'>Carregando...</p>";
    mostrarTela("detalhe");
    window.ApoioDados.detalhe(id).then(function (d) { if (detalheAtual === id) renderDetalhe(d); })
      .catch(function () { $("#tela-detalhe").innerHTML = "<p class='vazio'>Não foi possível carregar os detalhes.</p>"; });
  }

  // no celular o painel cobre a metade de baixo: desloca o centro para o ponto ficar visível
  // largura que o painel flutuante de ocorrências cobre na esquerda do mapa (0 se recolhido ou no celular)
  function folgaOc() {
    var p = document.getElementById("painel-oc");
    if (!p || p.hidden || window.innerWidth <= 760) return 0;
    return p.offsetLeft + p.offsetWidth;
  }

  // enquadra sem deixar nada embaixo do painel de ocorrências
  function enquadrar(limites, folga) {
    var f = folga == null ? 20 : folga;
    mapa.fitBounds(limites, { paddingTopLeft: [folgaOc() + f, f], paddingBottomRight: [f, f] });
  }

  function centroComPainel(latlng, zoom) {
    if (window.innerWidth > 760) {
      var f = folgaOc();   // centraliza na parte do mapa que fica à vista, ao lado do painel
      return f ? mapa.unproject(mapa.project(L.latLng(latlng), zoom).subtract([f / 2, 0]), zoom) : latlng;
    }
    var painelEl = document.getElementById("painel");
    var deslocamento = painelEl.classList.contains("recolhido") ? 0 : painelEl.offsetHeight / 2;
    var p = mapa.project(L.latLng(latlng), zoom).add([0, deslocamento]);
    return mapa.unproject(p, zoom);
  }

  function linhaInfo(rotulo, valor, html) {
    if (!valor) return "";
    return "<div class='linha-info'><span class='rotulo'>" + esc(rotulo) + "</span><span>" + (html ? valor : esc(valor)) + "</span></div>";
  }

  function renderDetalhe(d) {
    var h = "<div class='detalhe-cabecalho'><button type='button' class='btn-voltar' data-voltar title='Voltar'>&#8592;</button>" +
      "<h2>" + (d.sigla ? "<span class='mudo'>" + esc(d.sigla) + "</span> " : "") + esc(d.nome) + "</h2></div>" +
      "<div style='margin:4px 0 10px'><span class='etiqueta' style='background:" + esc(d.cor) + "'>" + esc(d.camada) + "</span> " +
      (d.empresa ? "<span class='etiqueta cinza'>" + esc(d.empresa) + "</span> " : "") +
      (!d.ativo ? "<span class='etiqueta vermelha'>Inativo</span>" : "") + "</div>";

    var contatos = d.contatos || [];
    if (d.telefone) {
      contatos = [{ funcao: "Telefone do local", nome: "", telefone: d.telefone, tel: d.telefone_tel, whatsapp: "" }].concat(contatos);
    }
    h += "<div class='secao'><h3>Contatos</h3>";
    if (!contatos.length) h += "<p class='vazio'>Nenhum contato cadastrado.</p>";
    contatos.forEach(function (c) {
      h += "<div class='contato'><div class='quem'>" +
        (c.funcao ? "<div class='funcao'>" + esc(c.funcao) + "</div>" : "") +
        (c.nome ? "<div class='nome'>" + esc(c.nome) + "</div>" : "") +
        (c.telefone ? "<div class='tel'>" + esc(c.telefone) + "</div>" : "") +
        (c.obs ? "<div class='obs'>" + esc(c.obs) + "</div>" : "") + "</div>" +
        (c.whatsapp ? (CFG.demo ? "<span class='btn-icone zap demo' role='img' title='WhatsApp desativado: número fictício'>" : "<a class='btn-icone zap' href='" + esc(c.whatsapp) + "' target='_blank' rel='noopener' title='WhatsApp'>") + "<svg width='18' height='18' viewBox='0 0 24 24'><path fill='currentColor' d='M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.5 3.9 1.7.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3z'/></svg>" + (CFG.demo ? "</span>" : "</a>") : "") +
        "</div>";
    });
    h += "</div>";

    h += "<div class='secao'><h3>Informações</h3>" +
      linhaInfo("Endereço", d.endereco) + linhaInfo("Cidade", d.cidade ? d.cidade + (d.uf ? "/" + d.uf : "") : d.uf) +
      linhaInfo("Horário", d.horario) + linhaInfo("Serviços", d.servicos) +
      linhaInfo("Observações", d.observacoes ? esc(d.observacoes).replace(/\n/g, "<br>") : "", true) +
      (!d.area ? linhaInfo("Coordenadas", d.latitude.toFixed(6) + ", " + d.longitude.toFixed(6)) : "") +
      "<div class='linha-info'><span class='rotulo'>Atualizado</span><span class='mudo'>" + esc(d.atualizado_em) + (d.atualizado_por ? " por " + esc(d.atualizado_por) : "") + "</span></div></div>";

    h += "<div class='botoes-detalhe'>";
    if (!d.area) {
      h += "<a class='btn sec pequeno' target='_blank' rel='noopener' href='https://www.google.com/maps/dir/?api=1&destination=" + d.latitude + "," + d.longitude + "'>Rota (Google Maps)</a>" +
        "<a class='btn sec pequeno' target='_blank' rel='noopener' href='https://waze.com/ul?ll=" + d.latitude + "%2C" + d.longitude + "&navigate=yes'>Waze</a>" +
        "<button type='button' class='btn sec pequeno' data-proximos='" + d.id + "'>Apoios próximos</button>" +
        "<button type='button' class='btn sec pequeno' data-copiar='" + d.latitude.toFixed(6) + ", " + d.longitude.toFixed(6) + "'>Copiar coordenadas</button>";
    }
    h += "</div>";
    if (d.descricao_original) {
      h += "<details><summary>Texto original da importação</summary><div class='detalhe-original'>" + esc(d.descricao_original.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")) + "</div></details>";
    }
    $("#tela-detalhe").innerHTML = h;
  }

  $("#tela-detalhe").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-voltar]")) {
      history.replaceState(null, "", location.pathname);
      if (campoBusca.value.trim().length >= 2) buscar(campoBusca.value.trim()); else mostrarTela("inicial");
      return;
    }
    var cp = ev.target.closest("[data-copiar]");
    if (cp) {
      var txt = cp.getAttribute("data-copiar");
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { cp.textContent = "Copiado!"; setTimeout(function () { cp.textContent = "Copiar coordenadas"; }, 1500); });
      return;
    }
    var px = ev.target.closest("[data-proximos]");
    if (px) {
      var l = locais.filter(function (x) { return x.id === parseInt(px.getAttribute("data-proximos"), 10); })[0];
      if (l) listarProximos(l.la, l.lo, "Apoios próximos de " + l.n, l.id);
    }
  });

  // ---------------------------------------------------------------- proximidade
  function distanciaKm(a, b, c, d) {
    var R = 6371, dLat = (c - a) * Math.PI / 180, dLon = (d - b) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function listarProximos(lat, lon, titulo, excluirId) {
    var lista = locais.filter(function (l) { return !l.pg && l.a && l.id !== excluirId && camadas[l.c] && passaFiltro(l); }).map(function (l) {
      return { l: l, km: distanciaKm(lat, lon, l.la, l.lo) };
    }).sort(function (a, b) { return a.km - b.km; }).slice(0, 12);
    renderResultados(lista.map(function (x) {
      var cam = camadas[x.l.c].cfg;
      return { id: x.l.id, nome: x.l.n, sigla: x.l.s, cidade: x.l.ci, uf: x.l.uf, cor: x.l.co || cam.cor, camada: cam.nome, distancia: (x.km < 10 ? x.km.toFixed(1) : Math.round(x.km)) + " km" };
    }), titulo, true);
    campoBusca.value = "";
  }

  // ---------------------------------------------------------------- apoios fora do cadastro (OpenStreetMap, via servidor)
  // Mecânica, borracharia, posto, pedágio, PRF, lanche e hospital num raio a partir de um ponto (botão direito ou veículo).
  // O navegador consulta o Nominatim (1 requisição por segundo, regra do serviço); a tela pede uma categoria por vez e
  // mostra cada uma assim que chega. O mesmo painel traz atalhos "Procurar no Google Maps" para o que o OSM não tiver.
  var osm = { grupo: L.layerGroup(), centro: null, titulo: "", itens: [], marcadores: {}, raio: CFG.apoiosOsmRaioPadrao || 15, cats: {}, busca: 0, estado: null };
  var OSM_GOOGLE = { mecanica: "mecânica diesel", borracharia: "borracharia", posto: "posto de combustível", pedagio: "praça de pedágio", prf: "posto da PRF", lanche: "restaurante", hospital: "hospital" };
  var OSM_ROTULO = {};
  (CFG.apoiosOsmCategorias || []).forEach(function (c) { osm.cats[c.id] = true; OSM_ROTULO[c.id] = c.rotulo; });
  try {
    var salvoOsm = JSON.parse(localStorage.getItem("apoiocco.osm") || "null");
    if (salvoOsm && salvoOsm.cats) { osm.cats = salvoOsm.cats; osm.raio = salvoOsm.raio || osm.raio; }
  } catch (e) {}
  if ((CFG.apoiosOsmRaios || []).indexOf(osm.raio) < 0) osm.raio = CFG.apoiosOsmRaioPadrao || 15;
  if (CFG.apoiosOsm) osm.grupo.addTo(mapa);

  function guardarOsm() { try { localStorage.setItem("apoiocco.osm", JSON.stringify({ cats: osm.cats, raio: osm.raio })); } catch (e) {} }

  function abrirBuscaOsm(lat, lon, titulo) {
    osm.centro = [lat, lon]; osm.titulo = titulo;
    buscarOsm();
  }

  function categoriasAtivas() {
    return (CFG.apoiosOsmCategorias || []).filter(function (c) { return osm.cats[c.id]; }).map(function (c) { return c.id; });
  }

  function buscarOsm() {
    if (!osm.centro) return;
    var cats = categoriasAtivas();
    var token = ++osm.busca;   // uma busca nova cancela a anterior (as respostas atrasadas são ignoradas)
    osm.itens = []; osm.estado = { total: cats.length, feitas: 0, atual: "", erros: [] };
    desenharOsm();
    if (!cats.length) { osm.estado = null; renderOsm("Marque pelo menos uma categoria."); return; }
    enquadrar(L.latLng(osm.centro).toBounds(osm.raio * 2000));
    var lat = osm.centro[0], lon = osm.centro[1], fila = cats.slice();
    var proxima = function () {
      if (token !== osm.busca) return;
      var cat = fila.shift();
      if (!cat) { osm.estado.atual = ""; renderOsm(); return; }
      osm.estado.atual = OSM_ROTULO[cat] || cat;
      renderOsm();
      window.ApoioDados.apoiosOsm(lat, lon, osm.raio, cat)
        .then(function (d) {
          if (token !== osm.busca) return;
          if (d.erro) osm.estado.erros.push(d.erro);
          osm.itens = osm.itens.concat(d.itens || []).sort(function (a, b) { return a.dist_km - b.dist_km; });
          osm.estado.feitas++;
          desenharOsm();
          proxima();
        })
        .catch(function () {
          if (token !== osm.busca) return;
          osm.estado.erros.push((OSM_ROTULO[cat] || cat) + ": sem resposta do Nominatim.");
          osm.estado.feitas++;
          proxima();
        });
    };
    proxima();
  }

  function renderOsm(aviso) {
    if (!osm.centro) return;
    var lat = osm.centro[0], lon = osm.centro[1], e = osm.estado;
    var h = "<div class='detalhe-cabecalho'><button type='button' class='btn-voltar' data-voltar title='Voltar'>&#8592;</button><h2>Apoios no OpenStreetMap</h2></div>" +
      "<p class='atalhos' style='margin:0 0 6px'>" + esc(osm.titulo) + " · fora do cadastro do app; confira antes de orientar o motorista.</p>" +
      "<div class='osm-cats'>" + (CFG.apoiosOsmCategorias || []).map(function (c) {
        return "<button type='button' class='chip-cat" + (osm.cats[c.id] ? " ativa" : "") + "' data-osm-cat='" + esc(c.id) + "' style='--cor:" + esc(c.cor) + "'><span class='sigla'>" + esc(c.sigla) + "</span>" + esc(c.rotulo) + "</button>";
      }).join("") + "</div>" +
      "<div class='osm-linha'><label>Raio <select data-osm-raio>" + (CFG.apoiosOsmRaios || [5, 15, 30, 60]).map(function (r) { return "<option value='" + r + "'" + (r === osm.raio ? " selected" : "") + ">" + r + " km</option>"; }).join("") + "</select></label>" +
      "<button type='button' class='btn pequeno' data-osm-buscar>Buscar</button><button type='button' class='btn sec pequeno' data-osm-limpar>Limpar do mapa</button></div>" +
      "<p class='atalhos osm-google'>Procurar no Google Maps: " + Object.keys(OSM_GOOGLE).map(function (k) {
        return "<a target='_blank' rel='noopener' href='https://www.google.com/maps/search/" + encodeURIComponent(OSM_GOOGLE[k]) + "/@" + lat.toFixed(6) + "," + lon.toFixed(6) + ",13z'>" + esc(OSM_GOOGLE[k]) + "</a>";
      }).join(" · ") + "</p>";
    if (aviso) h += "<p class='vazio'>" + esc(aviso) + "</p>";
    if (e && e.atual) h += "<p class='osm-progresso'>Consultando o OpenStreetMap: " + esc(e.atual) + " (" + (e.feitas + 1) + " de " + e.total + ")...</p>";
    if (e && e.erros.length) h += "<p class='atalhos osm-erros'>" + e.erros.map(esc).join("<br>") + "</p>";
    if (e && !e.atual && !osm.itens.length && !aviso) h += "<p class='vazio'>Nada encontrado no OpenStreetMap num raio de " + osm.raio + " km para as categorias marcadas. Tente um raio maior ou os atalhos do Google Maps.</p>";
    var porCat = {};
    osm.itens.forEach(function (i) { (porCat[i.categoria] = porCat[i.categoria] || []).push(i); });
    (CFG.apoiosOsmCategorias || []).forEach(function (c) {
      var lista = porCat[c.id];
      if (!lista) return;
      h += "<h3 class='osm-titulo'><span class='bolinha' style='background:" + esc(c.cor) + "'></span>" + esc(c.rotulo) + " <span class='mudo'>(" + lista.length + ")</span></h3>";
      lista.forEach(function (i) {
        var sub = [i.endereco, i.detalhe, i.telefone].filter(function (x) { return x; }).join(" · ");
        h += "<div class='resultado' data-osm='" + esc(i.id) + "'><span class='bolinha' style='background:" + esc(i.cor) + "'></span><div><div class='nome'>" + esc(i.nome) + "</div>" +
          (sub ? "<div class='sub'>" + esc(sub) + "</div>" : "") + "</div><span class='dist'>" + esc(kmTexto(i.dist_km)) + "</span></div>";
      });
    });
    var tela = $("#tela-resultados"), rolagem = $("#painel-conteudo").scrollTop, mesmaTela = !tela.hidden && tela.querySelector(".osm-cats");
    tela.innerHTML = h;
    if (mesmaTela) $("#painel-conteudo").scrollTop = rolagem;   // atualização da mesma busca: não volta ao topo
    else mostrarTela("resultados");
    campoBusca.value = "";
  }

  function iconeOsm(i) {
    return L.divIcon({ html: "<div class='marcador-osm' style='background:" + esc(i.cor) + "'>" + esc(i.sigla) + "</div>", className: "", iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12], tooltipAnchor: [0, -12] });
  }

  function popupOsm(i) {
    return "<div class='popup-osm'><strong>" + esc(i.nome) + "</strong><div class='mudo'>" + esc(i.rotulo) + " · " + esc(kmTexto(i.dist_km)) + " do ponto</div>" +
      (i.endereco ? "<div>" + esc(i.endereco) + "</div>" : "") + (i.horario ? "<div>Horário: " + esc(i.horario) + "</div>" : "") + (i.telefone ? "<div>Telefone: " + esc(i.telefone) + "</div>" : "") +
      "<div class='popup-links'><a target='_blank' rel='noopener' href='" + esc(i.google_url) + "'>Google Maps</a> · <a target='_blank' rel='noopener' href='" + esc(i.waze_url) + "'>Waze</a> · <a target='_blank' rel='noopener' href='" + esc(i.osm_url) + "'>OSM</a></div></div>";
  }

  function desenharOsm() {
    osm.grupo.clearLayers(); osm.marcadores = {};
    if (!osm.centro) return;
    osm.grupo.addLayer(L.circle(osm.centro, { radius: osm.raio * 1000, color: "#546E7A", weight: 1, dashArray: "4 6", fill: false, interactive: false }));
    osm.itens.forEach(function (i) {
      var m = L.marker([i.lat, i.lon], { icon: iconeOsm(i), zIndexOffset: 700 });
      m.bindTooltip(esc(i.nome) + " <span class='mudo'>" + esc(kmTexto(i.dist_km)) + "</span>", { direction: "top", className: "tooltip-veiculo", opacity: 1 });
      m.bindPopup(popupOsm(i), { maxWidth: 280 });
      osm.grupo.addLayer(m);
      osm.marcadores[i.id] = m;
    });
  }

  function focarOsm(id) {
    var m = osm.marcadores[id];
    if (!m) return;
    var z = Math.max(mapa.getZoom(), 13);
    mapa.flyTo(centroComPainel(m.getLatLng(), z), z, { duration: 0.6 });
    setTimeout(function () { m.openPopup(); }, 650);
  }

  function limparOsm() { osm.busca++; osm.grupo.clearLayers(); osm.marcadores = {}; osm.itens = []; osm.estado = null; }

  $("#tela-resultados").addEventListener("click", function (ev) {
    var cat = ev.target.closest("[data-osm-cat]");
    if (cat) { var k = cat.getAttribute("data-osm-cat"); osm.cats[k] = !osm.cats[k]; cat.classList.toggle("ativa", !!osm.cats[k]); guardarOsm(); return; }
    if (ev.target.closest("[data-osm-buscar]")) { buscarOsm(); return; }
    if (ev.target.closest("[data-osm-limpar]")) { limparOsm(); renderOsm("Marcadores retirados do mapa."); return; }
  });
  $("#tela-resultados").addEventListener("change", function (ev) {
    var sel = ev.target.closest("[data-osm-raio]");
    if (sel) { osm.raio = parseInt(sel.value, 10); guardarOsm(); buscarOsm(); }
  });

  // ---------------------------------------------------------------- menu de contexto no mapa
  mapa.on("contextmenu", function (ev) {
    var lat = ev.latlng.lat, lon = ev.latlng.lng;
    var html = "<div class='menu-contexto'><strong>" + lat.toFixed(5) + ", " + lon.toFixed(5) + "</strong>" +
      "<button type='button' class='btn sec pequeno' data-ctx='proximos'>Apoios mais próximos daqui</button>" +
      (CFG.apoiosOsm ? "<button type='button' class='btn sec pequeno' data-ctx='osm'>Buscar apoios no OpenStreetMap</button>" : "") +
      "<a class='btn sec pequeno' target='_blank' rel='noopener' href='https://www.google.com/maps/search/?api=1&query=" + lat.toFixed(6) + "," + lon.toFixed(6) + "'>Ver no Google Maps</a></div>";
    var pop = L.popup().setLatLng(ev.latlng).setContent(html).openOn(mapa);
    var el = pop.getElement();
    if (el) {
      var b = el.querySelector("[data-ctx=proximos]");
      if (b) b.addEventListener("click", function () { mapa.closePopup(); listarProximos(lat, lon, "Apoios próximos do ponto marcado"); marcarAqui(lat, lon); });
      var bo = el.querySelector("[data-ctx=osm]");
      if (bo) bo.addEventListener("click", function () { mapa.closePopup(); marcarAqui(lat, lon); abrirBuscaOsm(lat, lon, "Perto do ponto marcado (" + lat.toFixed(4) + ", " + lon.toFixed(4) + ")"); });
    }
  });

  function marcarAqui(lat, lon) {
    if (marcadorAqui) mapa.removeLayer(marcadorAqui);
    marcadorAqui = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: "<div class='marcador-aqui'></div>", iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 }).addTo(mapa);
  }

  // ---------------------------------------------------------------- minha posição
  $("#btn-localizar").addEventListener("click", function () {
    if (!navigator.geolocation) { avisar("Seu navegador não permite obter a posição."); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      posicaoAqui = [p.coords.latitude, p.coords.longitude];
      marcarAqui(posicaoAqui[0], posicaoAqui[1]);
      mapa.flyTo(posicaoAqui, 11);
      listarProximos(posicaoAqui[0], posicaoAqui[1], "Apoios próximos da minha posição");
    }, function () { avisar("Não foi possível obter a sua posição. Verifique a permissão de localização."); }, { enableHighAccuracy: true, timeout: 10000 });
  });

  // ---------------------------------------------------------------- painel móvel
  var painel = $("#painel");
  var toggle = $("[data-painel-toggle]");
  if (toggle) toggle.addEventListener("click", function () {
    if (painel.classList.contains("recolhido")) { painel.classList.remove("recolhido"); }
    else if (painel.classList.contains("expandido")) { painel.classList.remove("expandido"); painel.classList.add("recolhido"); }
    else { painel.classList.add("expandido"); }
  });
  mapa.on("click", function () { if (window.innerWidth <= 760) painel.classList.add("recolhido"); });

  // ---------------------------------------------------------------- deep link #l=ID
  function abrirDoHash() {
    var m = /#l=(\d+)/.exec(location.hash);
    if (m) abrirDetalhe(parseInt(m[1], 10), true);
  }
  window.addEventListener("hashchange", abrirDoHash);

  carregar();

  // ---------------------------------------------------------------- veículos (posições do CSV da frota)
  var veic = { lista: [], grupo: L.layerGroup(), grupoCand: L.layerGroup(), marcadores: {}, ligado: true, faixasOff: {}, empresasOff: {}, dados: null, ultimaBusca: 0, candidatosDe: null, raioCand: 0 };
  // faixas de tempo sem GPS (calculadas no servidor): ok (< 1 h), 1h, 6h, 12h
  var FAIXAS_GPS = { ok: "GPS ok", "1h": "1 h sem GPS", "6h": "6 h sem GPS", "12h": "12 h sem GPS", "24h": "24 h sem GPS" };
  if (CFG.veiculos) {
    veic.grupo.addTo(mapa);
    veic.grupoCand.addTo(mapa);
    var cbV = $("#veiculos-ligado");
    cbV.addEventListener("change", function () { veic.ligado = cbV.checked; if (cbV.checked) veic.grupo.addTo(mapa); else mapa.removeLayer(veic.grupo); });
    $$("#veiculos-faixas input[data-faixa]").forEach(function (cb) {
      cb.addEventListener("change", function () { veic.faixasOff[cb.getAttribute("data-faixa")] = !cb.checked; desenharVeiculos(); });
    });
    var btnAtu = $("#veiculos-atualizar");
    if (btnAtu) btnAtu.addEventListener("click", function () {
      btnAtu.disabled = true;
      var info = $("#veiculos-atualizar-info"), antes = info ? info.textContent : "";
      if (info) info.textContent = "Relendo o arquivo de posições...";
      carregarVeiculos(true, function (d) {
        btnAtu.disabled = false;
        if (!info) return;
        if (d && d.erro) info.textContent = "Falha ao reler: " + d.erro;
        else if (d && d.releu === false) info.textContent = "O arquivo já tinha sido relido há menos de 30 s. " + textoAtualizacao(d);
        else if (d) info.textContent = textoAtualizacao(d);
        else info.textContent = antes;
      });
    });
    $("#veiculos-empresas").addEventListener("click", function (ev) {
      var it = ev.target.closest("[data-empresa]");
      if (!it) return;
      var e = it.getAttribute("data-empresa");
      veic.empresasOff[e] = !veic.empresasOff[e];
      it.classList.toggle("desligado", !!veic.empresasOff[e]);
      desenharVeiculos();
    });
    carregarVeiculos();
    // a cada 1 minuto, mesmo com a aba em segundo plano ou a janela coberta: posições (relidas no servidor a cada
    // VEICULOS_INTERVALO_MIN) e ocorrências (a cada 1 min). O navegador reduz o ritmo em abas escondidas, por isso
    // ao voltar para a aba (ou a conexão voltar) a busca é feita na hora, sem esperar o próximo minuto.
    setInterval(function () { carregarVeiculos(); }, 60 * 1000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && Date.now() - veic.ultimaBusca > 15000) carregarVeiculos(); });
    window.addEventListener("online", function () { carregarVeiculos(); });
    var lo = $("#ocorrencias-lista");
    if (lo) lo.addEventListener("click", function (ev) {
      var soc = ev.target.closest("[data-socorro]");
      if (soc) {
        // mostra o carro de socorro e o carro quebrado juntos
        var vs = veic.lista.filter(function (x) { return x.id === soc.getAttribute("data-socorro"); })[0];
        var vq = veic.lista.filter(function (x) { return x.id === soc.closest("[data-ocorrencia]").getAttribute("data-ocorrencia"); })[0];
        if (vs && vq) { enquadrar(L.latLngBounds([[vs.lat, vs.lon], [vq.lat, vq.lon]]).pad(0.35)); abrirVeiculo(vs, true); }
        else if (vs) abrirVeiculo(vs);
        else avisar("O carro " + soc.getAttribute("data-socorro") + " não tem posição de GPS no arquivo de hoje.");
        return;
      }
      var it = ev.target.closest("[data-ocorrencia]");
      if (!it || ev.target.closest("a")) return;
      var carro = it.getAttribute("data-ocorrencia");
      var v = veic.lista.filter(function (x) { return x.id === carro; })[0];
      if (v) abrirVeiculo(v); else { var o = (veic.ocorrencias || []).filter(function (x) { return x.carro === carro; })[0]; if (o) abrirOcorrenciaSemPosicao(o); }
    });
    if (lo) lo.addEventListener("keydown", function (ev) {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("oc-card")) { ev.preventDefault(); ev.target.click(); }
    });
  }

  function etiquetaGps(faixa) {
    return faixa && faixa !== "ok" ? "<span class='tag-gps gps-" + faixa + "'>" + faixa + "</span>" : "";
  }

  function chipGps(faixa) {
    return "<span class='chip-gps gps-" + esc(faixa || "ok") + "'>" + esc(FAIXAS_GPS[faixa] || FAIXAS_GPS.ok) + "</span>";
  }

  function minutosTexto(min) {
    if (min == null) return "";
    if (min < 60) return min + " min";
    if (min < 48 * 60) { var h = Math.floor(min / 60), m = min % 60; return h + " h" + (m ? " " + (m < 10 ? "0" : "") + m : ""); }
    return Math.round(min / 1440) + " dias";
  }

  function chipOcorrencia(o) {
    return "<span class='chip-oc' style='background:" + esc(o.status_cor) + "'>" + esc(o.status_rotulo) + "</span>";
  }

  var COR_SOCORRO = "#0097A7";

  function iconeOnibus(cor, faixa, oc, soc) {
    // silhueta lateral do ônibus na cor da empresa; com 12 h ou mais sem GPS fica cinza com o contorno na cor da empresa
    // com ocorrência aberta: contorno vermelho, radar pulsando, selo "!" e etiqueta com o status
    // carro que segue para um socorro: contorno azul-petróleo e etiqueta "Socorro -> carro"
    var sem = faixa === "12h" || faixa === "24h";
    var fill = sem ? "#B0BEC5" : cor, stroke = oc ? "#D32F2F" : (soc ? COR_SOCORRO : (sem ? cor : "#fff")), sw = (oc || soc || sem) ? 2 : 1.5, jan = sem ? "#ECEFF1" : "#fff";
    var svg = "<svg width='34' height='20' viewBox='0 0 34 20'>" +
      "<path d='M3.5 3h24c1.6 0 3 .9 3.6 2.4L32.5 9v5.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V5A2 2 0 0 1 3.5 3z' fill='" + fill + "' stroke='" + stroke + "' stroke-width='" + sw + "'/>" +
      "<rect x='4.5' y='5.5' width='5' height='4' rx='1' fill='" + jan + "' opacity='.9'/><rect x='11' y='5.5' width='5' height='4' rx='1' fill='" + jan + "' opacity='.9'/><rect x='17.5' y='5.5' width='5' height='4' rx='1' fill='" + jan + "' opacity='.9'/>" +
      "<path d='M24.5 5.5h2.6c.9 0 1.7.5 2.1 1.3L30.3 9.5h-5.8z' fill='" + jan + "' opacity='.9'/>" +
      "<circle cx='8.5' cy='16' r='2.4' fill='#37474F' stroke='#fff' stroke-width='1'/><circle cx='25.5' cy='16' r='2.4' fill='#37474F' stroke='#fff' stroke-width='1'/></svg>";
    var extra = oc ? "<span class='selo-oc'>!</span><span class='rotulo-oc'>" + esc(oc.status_rotulo) + (oc.minutos != null ? " · " + minutosTexto(oc.minutos) : "") + "</span>" : "";
    if (!oc && soc) extra = "<span class='rotulo-soc'>SOS &rarr; " + esc(soc.carro) + (soc.dist_km != null ? " - " + kmTexto(soc.dist_km) : "") + (soc.prev_min != null ? " (Prev. " + prevTexto(soc.prev_min) + ")" : "") + "</span>";
    var classes = "marcador-onibus" + (oc ? " com-ocorrencia" : "") + (soc ? " com-socorro" : "") + (faixa === "24h" ? " gps-24h" : "");
    return L.divIcon({ html: "<div class='" + classes + "'>" + extra + svg + etiquetaGps(faixa) + "</div>", className: "", iconSize: [34, 20], iconAnchor: [17, 10], tooltipAnchor: [0, (oc || soc) ? -30 : -12] });
  }

  function prevTexto(min) {
    // previsão compacta: "45m", "1h30m", "2d 3h"
    if (min == null) return "";
    if (min < 60) return min + "m";
    if (min < 48 * 60) { var h = Math.floor(min / 60), m = min % 60; return h + "h" + (m < 10 ? "0" : "") + m + "m"; }
    return Math.floor(min / 1440) + "d " + Math.floor((min % 1440) / 60) + "h";
  }

  function horaDaqui(min) {
    var d = new Date(window.ApoioDados.agoraMs() + min * 60000);
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function kmTexto(km) {
    if (km == null) return "";
    return (km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)) + " km";
  }

  function chipSocorro(texto) {
    return "<span class='chip-oc' style='background:" + COR_SOCORRO + "'>" + esc(texto || "Socorro") + "</span>";
  }

  function tooltipVeiculo(v) {
    return "<div class='tt-titulo'>" + esc(v.id) + (v.placa ? " · " + esc(v.placa) : "") + "</div>" +
      "<div class='tt-sub'>" + esc(v.empresa || "sem empresa") + (v.nop ? " · " + esc(v.nop) : "") + "</div>" +
      "<div class='tt-gps'>" + chipGps(v.faixa) + " <span class='mudo'>" + (v.quando ? "última posição " + esc(v.quando) + " (" + idadeTexto(v.idade_min) + ")" : "sem data da posição") + "</span></div>" +
      (v.ocorrencia ? "<div class='tt-oc'>" + chipOcorrencia(v.ocorrencia) + " <span class='mudo'>ocorrência há " + minutosTexto(v.ocorrencia.minutos) + (v.ocorrencia.local_socorro ? " · " + esc(v.ocorrencia.local_socorro) : "") + (v.ocorrencia.segue ? " · carro que segue: " + esc(v.ocorrencia.segue.carro) + (v.ocorrencia.segue.dist_km != null ? " (a " + kmTexto(v.ocorrencia.segue.dist_km) + ")" : "") : "") + "</span></div>" : "") +
      (v.socorro ? "<div class='tt-oc'>" + chipSocorro("SOS") + " <span class='mudo'>a caminho do carro " + esc(v.socorro.carro) + (v.socorro.dist_km != null ? " (a " + kmTexto(v.socorro.dist_km) + (v.socorro.prev_min != null ? ", prev. " + prevTexto(v.socorro.prev_min) : "") + ")" : "") + (v.socorro.local_socorro ? " · " + esc(v.socorro.local_socorro) : "") + "</span></div>" : "");
  }

  // "27/10/2026 16:13" vira "16:13" quando é hoje (hoje = relógio simulado do snapshot)
  function horaCurta(s) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})$/.exec(s || ""), hoje = window.ApoioDados.agora();
    if (!m) return s || "";
    var ehHoje = parseInt(m[1], 10) === hoje.getDate() && parseInt(m[2], 10) === hoje.getMonth() + 1 && parseInt(m[3], 10) === hoje.getFullYear();
    return ehHoje ? m[4] : s;
  }

  // texto abaixo do botão "Atualizar agora": quando o servidor releu o arquivo (botão ou leitura automática) e de quando é o arquivo
  function textoAtualizacao(d) {
    var t = "";
    if (d && d.atualizado_em) t = "Arquivo relido às " + horaCurta(d.atualizado_em) + (d.arquivo_em ? " (arquivo de " + d.arquivo_em + ")" : "") + ". ";
    return t + "Posições capturadas a cada " + CFG.veiculosIntervaloMin + " min.";
  }

  function carregarVeiculos(forcar, depois) {
    veic.ultimaBusca = Date.now();
    window.ApoioDados.veiculos(forcar).then(function (d) {
      if (d) {
        veic.dados = d;
        veic.lista = d.veiculos || [];
        veic.ocorrencias = (d.ocorrencias && d.ocorrencias.lista) || [];
        montarOcorrencias(d.ocorrencias || {});
        var info = $("#veiculos-info"), erro = $("#veiculos-erro"), infoAtu = $("#veiculos-atualizar-info");
        // ao lado do título: de quando é o arquivo (posição mais recente que ele contém)
        if (info) info.textContent = d.arquivo_em ? "(arquivo de " + d.arquivo_em + ")" : (d.atualizado_em ? "(lido em " + d.atualizado_em + ")" : "");
        if (infoAtu && !forcar) infoAtu.textContent = textoAtualizacao(d);
        if (erro) { erro.hidden = !d.erro; erro.textContent = d.erro ? "Falha ao buscar as posições: " + d.erro : ""; }
        montarEmpresasVeiculos(d.por_empresa || []);
        desenharVeiculos();
        atualizarCandidatos();
      }
      if (depois) depois(d);
    }).catch(function () { if (depois) depois(null); });
  }

  function montarEmpresasVeiculos(lista) {
    var cont = $("#veiculos-empresas");
    if (!cont) return;
    cont.innerHTML = "";
    lista.forEach(function (e) {
      var div = document.createElement("div");
      div.className = "veiculo-item" + (veic.empresasOff[e.empresa] ? " desligado" : "");
      div.setAttribute("data-empresa", e.empresa);
      div.title = "Clique para mostrar/ocultar";
      div.innerHTML = "<span class='bolinha' style='background:" + esc(e.cor) + "'></span><span>" + esc(e.empresa || "(sem empresa)") + "</span><span class='total'>" + e.total + "</span>";
      cont.appendChild(div);
    });
  }

  function veiculoVisivel(v) {
    if (v.ocorrencia || v.socorro) return true;  // carro com ocorrência aberta ou a caminho de socorro aparece sempre, mesmo com filtros desligados
    if (veic.empresasOff[v.empresa]) return false;
    if (veic.faixasOff[v.faixa || "ok"]) return false;
    return true;
  }

  // ---------------------------------------------------------------- ocorrências: cards no painel flutuante
  // Cronômetro ao vivo desde a hora da quebra (para quando o SOS é encerrado), corrigido pela hora do servidor;
  // cor e barra de tempo: até 1 h normal, de 1 h a 1h30 âmbar, 1h30 ou mais vermelho; a barra enche até 3 h.
  var STATUS_ESCURO = { aberta: "#8FB8F0", em_rota: "#C3A6F5", em_atendimento: "#F2C14E", aguardando: "#F4A06B" };
  var NOME_EMPRESA = {}, CORES_EMPRESAS = {};
  (CFG.empresasVeiculos || []).forEach(function (e) { NOME_EMPRESA[e.valor] = e.nome; CORES_EMPRESAS[e.valor] = e.cor; });
  var ocRelogio = { desvio: 0, timer: null };

  function tipoCarro(carro) {
    var n = String(carro || "").split(".")[0].replace(/\D/g, "").length;   // 5 dígitos = Double Deck, 4 = carro baixo
    return n >= 5 ? "Double Deck" : (n === 4 ? "Carro baixo" : "");
  }

  function corRgba(hex, alfa) {
    var h = String(hex).replace("#", "");
    return "rgba(" + parseInt(h.substr(0, 2), 16) + "," + parseInt(h.substr(2, 2), 16) + "," + parseInt(h.substr(4, 2), 16) + "," + alfa + ")";
  }

  function relogioTexto(seg) {
    var s = Math.max(0, Math.floor(seg)), d = function (n) { return (n < 10 ? "0" : "") + n; };
    return d(Math.floor(s / 3600)) + ":" + d(Math.floor(s / 60) % 60) + ":" + d(s % 60);
  }

  function iconeOnibusCard(cor) {
    return "<svg width='30' height='18' viewBox='0 0 34 20' aria-hidden='true'><path d='M3.5 3h24c1.6 0 3 .9 3.6 2.4L32.5 9v5.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V5A2 2 0 0 1 3.5 3z' fill='" + esc(cor) + "' stroke='#3A4D66' stroke-width='1'/>" +
      "<rect x='4.5' y='5.5' width='5' height='4' rx='1' fill='#E6EDF5'/><rect x='11' y='5.5' width='5' height='4' rx='1' fill='#E6EDF5'/><rect x='17.5' y='5.5' width='5' height='4' rx='1' fill='#E6EDF5'/>" +
      "<circle cx='8.5' cy='16' r='2.4' fill='#0F1B2A' stroke='#8FA3B8' stroke-width='1'/><circle cx='25.5' cy='16' r='2.4' fill='#0F1B2A' stroke='#8FA3B8' stroke-width='1'/></svg>";
  }

  function montarOcorrencias(d) {
    var cont = $("#ocorrencias-lista");
    if (!cont) return;
    var lista = d.lista || [];
    if (d.agora_ms) ocRelogio.desvio = d.agora_ms - Date.now();
    var total = $("#ocorrencias-total"), totPil = $("#pilula-total"), info = $("#ocorrencias-info"), erro = $("#ocorrencias-erro");
    if (total) total.textContent = lista.length;
    if (totPil) totPil.textContent = lista.length;
    if (info) info.textContent = (CFG.ocorrenciasFonte || "Ocorrências") + (d.atualizado_em ? " · lido às " + horaCurta(d.atualizado_em) : "");
    if (erro) { erro.hidden = !d.erro; erro.textContent = d.erro ? "Falha ao ler as ocorrências: " + d.erro : ""; }
    if (!lista.length) {
      cont.innerHTML = "<p class='painel-oc-vazio'>Nenhuma ocorrência aberta.</p>";
      atualizarRelogios();
      return;
    }
    var h = "";
    lista.forEach(function (o) {
      var v = veic.lista.filter(function (x) { return x.id === o.carro; })[0];
      var cor = v ? v.cor : (CORES_EMPRESAS[o.empresa] || "#607D8B");
      var stCor = STATUS_ESCURO[o.status] || "#C3D0DD";
      var emp = [NOME_EMPRESA[o.empresa] || o.empresa || "", tipoCarro(o.carro)].filter(function (x) { return x; }).join(" · ");
      var linha = [o.linha, o.servico ? "serv. " + o.servico : ""].filter(function (x) { return x; }).join(" · ");
      var desde = "";
      if (o.inicio_ms) {
        var q = new Date(o.inicio_ms);
        desde = (q.getHours() < 10 ? "0" : "") + q.getHours() + ":" + (q.getMinutes() < 10 ? "0" : "") + q.getMinutes();
      }
      h += "<div class='oc-card" + (o.tem_posicao ? "" : " sem-posicao") + "' role='button' tabindex='0' data-ocorrencia='" + esc(o.carro) + "' data-inicio='" + (o.inicio_ms || "") + "' data-fim='" + (o.fim_ms || "") + "' title='" + (o.tem_posicao ? "Ver o carro no mapa" : "Carro sem posição de GPS: abre os detalhes") + "'>" +
        "<div class='oc-cab'>" + iconeOnibusCard(cor) +
          "<div class='oc-ident'><span class='oc-carro'>" + esc(o.carro) + "</span>" + (emp ? "<span class='oc-emp' title='" + esc(emp) + "'>" + esc(emp) + "</span>" : "") + "</div>" +
          "<span class='oc-status' style='color:" + stCor + ";background:" + corRgba(stCor, 0.14) + ";border-color:" + corRgba(stCor, 0.45) + "'>" + esc(o.status_rotulo) + "</span></div>" +
        "<div class='oc-tempo'><div class='oc-tempo-linha'><span class='oc-relogio'>" + (o.inicio_ms ? "" : "--:--:--") + "</span>" + (desde ? "<span class='oc-desde'>desde " + desde + "</span>" : "") + "</div>" +
          "<div class='oc-barra'><span class='oc-barra-fill'></span><span class='oc-barra-marca' style='left:33.3%'></span><span class='oc-barra-marca' style='left:50%'></span></div>" +
          "<div class='oc-escala' aria-hidden='true'><span style='left:33.3%;transform:translateX(-50%)'>1h</span><span style='left:50%;transform:translateX(-20%)'>1h30</span><span style='right:0'>3h</span></div></div>" +
        (linha ? "<div class='oc-linha'>" + esc(linha) + "</div>" : "") +
        (o.local_socorro ? "<div class='oc-local'>" + esc(o.local_socorro) + "</div>" : "") +
        (o.defeito ? "<div class='oc-defeito'>" + esc(o.defeito) + "</div>" : "") +
        (o.segue ? "<div class='oc-segue' data-socorro='" + esc(o.segue.carro) + "' title='Ver os dois carros no mapa'>Segue: " + esc(o.segue.carro) +
          (o.segue.tem_posicao ? (o.segue.dist_km != null ? " · " + kmTexto(o.segue.dist_km) : "") + (o.segue.prev_min != null ? " · prev. " + prevTexto(o.segue.prev_min) : "") : " · sem posição de GPS") + "</div>" : "") +
        (o.tem_posicao ? "" : "<div class='oc-semgps'>Sem posição de GPS no arquivo de hoje</div>") +
        "</div>";
    });
    cont.innerHTML = h;
    atualizarRelogios();
    if (!ocRelogio.timer) ocRelogio.timer = setInterval(atualizarRelogios, 1000);
  }

  function atualizarRelogios() {
    var agora = Date.now() + ocRelogio.desvio, maior = -1;
    $$("#ocorrencias-lista .oc-card").forEach(function (c) {
      var ini = parseInt(c.getAttribute("data-inicio"), 10), fim = parseInt(c.getAttribute("data-fim"), 10);
      if (!ini) return;
      var seg = Math.max(0, ((fim || agora) - ini) / 1000);
      if (seg > maior) maior = seg;
      var nivel = seg >= 5400 ? 2 : (seg >= 3600 ? 1 : 0);
      var r = c.querySelector(".oc-relogio");
      if (r) r.textContent = relogioTexto(seg);
      var b = c.querySelector(".oc-barra-fill");
      if (b) b.style.width = Math.min(100, (seg / 10800) * 100).toFixed(1) + "%";
      c.classList.toggle("nivel-1", nivel === 1);
      c.classList.toggle("nivel-2", nivel === 2);
    });
    var pt = $("#pilula-tempo");
    if (pt) {
      pt.textContent = maior >= 0 ? relogioTexto(maior) : "";
      pt.classList.toggle("nivel-1", maior >= 3600 && maior < 5400);
      pt.classList.toggle("nivel-2", maior >= 5400);
    }
  }

  function desenharVeiculos() {
    veic.grupo.clearLayers();
    veic.marcadores = {};
    var n = 0, porFaixa = { ok: 0, "1h": 0, "6h": 0, "12h": 0, "24h": 0 };
    veic.lista.forEach(function (v) {
      porFaixa[v.faixa || "ok"] = (porFaixa[v.faixa || "ok"] || 0) + 1;
      if (!veiculoVisivel(v)) return;
      var m = L.marker([v.lat, v.lon], { icon: iconeOnibus(v.cor, v.faixa, v.ocorrencia, v.socorro), zIndexOffset: v.ocorrencia ? 1000 : (v.socorro ? 900 : 500), riseOnHover: true });
      m.bindTooltip(tooltipVeiculo(v), { direction: "top", className: "tooltip-veiculo", opacity: 1 });
      m.on("click", function () { abrirVeiculo(v); });
      veic.grupo.addLayer(m);
      veic.marcadores[v.id] = m;
      n++;
      // linha tracejada do carro de socorro até o carro quebrado, com a distância no meio
      if (v.socorro && v.socorro.tem_posicao && v.socorro.lat != null) {
        var a = [v.lat, v.lon], b = [v.socorro.lat, v.socorro.lon];
        veic.grupo.addLayer(L.polyline([a, b], { color: "#fff", weight: 6, opacity: .8, interactive: false }));
        veic.grupo.addLayer(L.polyline([a, b], { color: COR_SOCORRO, weight: 3, dashArray: "8 7", lineCap: "round", className: "linha-socorro", interactive: false }));
        if (v.socorro.dist_km != null) {
          veic.grupo.addLayer(L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: L.divIcon({ html: "<span class='dist-socorro'>" + kmTexto(v.socorro.dist_km) + "</span>", className: "", iconSize: [0, 0] }), interactive: false, zIndexOffset: 800 }));
        }
      }
    });
    var tot = $("#veiculos-total");
    if (tot) tot.textContent = n;
    Object.keys(porFaixa).forEach(function (f) { var el = $("[data-total-faixa='" + f + "']"); if (el) el.textContent = porFaixa[f]; });
  }

  function idadeTexto(min) {
    if (min == null) return "";
    if (min < 60) return "há " + min + " min";
    if (min < 48 * 60) return "há " + Math.round(min / 60) + " h";
    return "há " + Math.round(min / 1440) + " dias";
  }

  function abrirVeiculo(v, semVoar) {
    history.replaceState(null, "", location.pathname);
    var cand = v.ocorrencia ? candidatosSocorro(v) : null;
    var h = "<div class='detalhe-cabecalho'><button type='button' class='btn-voltar' data-voltar title='Voltar'>&#8592;</button>" +
      "<h2>Veículo " + esc(v.id) + (v.placa ? " <span class='mudo'>" + esc(v.placa) + "</span>" : "") + "</h2></div>" +
      "<div style='margin:4px 0 10px'><span class='etiqueta' style='background:" + esc(v.cor) + "'>" + esc(v.empresa || "sem empresa") + "</span> " + chipGps(v.faixa) + (v.ocorrencia ? " " + chipOcorrencia(v.ocorrencia) : "") + (v.socorro ? " " + chipSocorro("A caminho de socorro") : "") + "</div>" +
      (v.ocorrencia ? blocoOcorrencia(v.ocorrencia) : "") + (cand ? blocoCandidatos(cand) : "") + (v.socorro ? blocoSocorro(v.socorro) : "") +
      "<div class='secao'><h3>Última posição</h3>" +
      linhaInfo("Quando", v.quando ? v.quando + " (" + idadeTexto(v.idade_min) + ")" : "") +
      linhaInfo("Operação", v.nop) + linhaInfo("Frota", v.frota) + linhaInfo("UF", v.uf) +
      linhaInfo("Local próximo", v.local_proximo ? v.local_proximo + (v.dist_km != null ? " (" + v.dist_km + " km)" : "") : "") +
      linhaInfo("Coordenadas", v.lat.toFixed(5) + ", " + v.lon.toFixed(5)) + "</div>" +
      "<div class='botoes-detalhe'>" +
      "<button type='button' class='btn pequeno' data-proximos-veiculo='" + esc(v.id) + "'>Apoios próximos do veículo</button>" +
      (CFG.apoiosOsm ? "<button type='button' class='btn sec pequeno' data-osm-veiculo='" + esc(v.id) + "'>Apoios no OpenStreetMap</button>" : "") +
      "<a class='btn sec pequeno' target='_blank' rel='noopener' href='https://www.google.com/maps/search/?api=1&query=" + v.lat + "," + v.lon + "'>Ver no Google Maps</a>" +
      "<button type='button' class='btn sec pequeno' data-copiar='" + v.lat.toFixed(5) + ", " + v.lon.toFixed(5) + "'>Copiar coordenadas</button></div>";
    $("#tela-detalhe").innerHTML = h;
    mostrarTela("detalhe");
    if (!semVoar) mapa.flyTo(centroComPainel([v.lat, v.lon], Math.max(mapa.getZoom(), 12)), Math.max(mapa.getZoom(), 12), { duration: 0.8 });
    Object.keys(veic.marcadores).forEach(function (k) { var el = veic.marcadores[k].getElement(); if (el && el.firstChild) el.firstChild.classList.toggle("destaque", k === v.id); });
    veic.candidatosDe = cand ? v.id : null;
    desenharCandidatos(cand);
  }

  // ---------------------------------------------------------------- carros candidatos a atender um socorro
  // Ao abrir o carro quebrado: carros com GPS há menos de 1 h e sem ocorrência, num raio (100/200/300 km),
  // ligados por retas finas tracejadas com distância e previsão; os 5 mais próximos vão para a lista do painel.
  var CAND_MAX = 5;
  var CAND_GPS_MAX_MIN = 60;
  function candidatosSocorro(v) {
    var raio = veic.raioCand || CFG.socorroRaioKm || 200;
    var segue = v.ocorrencia && v.ocorrencia.carro_segue;
    var cfg = prevCfg();
    var lista = veic.lista.filter(function (x) {
      return x.id !== v.id && x.id !== segue && !x.ocorrencia && x.idade_min != null && x.idade_min < CAND_GPS_MAX_MIN;
    }).map(function (x) {
      var km = distanciaKm(v.lat, v.lon, x.lat, x.lon);
      return { v: x, km: km, prev: Math.round(km * cfg.fator_rota / Math.max(10, cfg.velocidade_kmh) * 60) };
    }).filter(function (c) { return c.km <= raio; }).sort(function (a, b) { return a.km - b.km; });
    return { de: v, raio: raio, total: lista.length, lista: lista.slice(0, CAND_MAX) };
  }

  function blocoCandidatos(c) {
    var h = "<div class='bloco-cand'><h4>Carros próximos para o socorro</h4>" +
      "<div class='osm-linha'><label>Raio <select data-cand-raio>" + [100, 200, 300].map(function (r) { return "<option value='" + r + "'" + (r === c.raio ? " selected" : "") + ">" + r + " km</option>"; }).join("") + "</select></label>" +
      "<span class='mudo'>" + (c.total ? c.total + (c.total === 1 ? " carro" : " carros") + " no raio" + (c.total > CAND_MAX ? ", os " + CAND_MAX + " mais próximos:" : ":") : "nenhum carro no raio") + "</span>" +
      (c.lista.length ? "<button type='button' class='btn sec pequeno' data-cand-enquadrar title='Mostra o carro quebrado e os candidatos no mapa'>Ver no mapa</button>" : "") + "</div>" +
      "<p class='atalhos' style='margin:0 0 4px'>Só carros com GPS há menos de 1 h e sem ocorrência aberta; distância em linha reta e previsão a " + Math.round(prevCfg().velocidade_kmh) + " km/h × " + String(prevCfg().fator_rota).replace(".", ",") + ". Opções para a coordenação avaliar, não uma designação.</p>";
    c.lista.forEach(function (x) {
      h += "<div class='cand-item' data-ver-carro='" + esc(x.v.id) + "'><span class='bolinha' style='background:" + esc(x.v.cor) + "'></span><div><div class='nome'>" + esc(x.v.id) + (x.v.socorro ? " " + chipSocorro("SOS") : "") + " <span class='mudo'>" + esc(x.v.empresa || "") + (x.v.nop ? " · " + esc(x.v.nop) : "") + "</span></div>" +
        "<div class='sub'>" + esc(kmTexto(x.km)) + " · prev. " + esc(prevTexto(x.prev)) + " · GPS " + esc(idadeTexto(x.v.idade_min)) + (x.v.local_proximo ? " · " + esc(x.v.local_proximo) : "") + "</div></div></div>";
    });
    return h + "</div>";
  }

  function desenharCandidatos(c) {
    veic.grupoCand.clearLayers();
    if (!c) return;
    c.lista.forEach(function (x) {
      var a = [c.de.lat, c.de.lon], b = [x.v.lat, x.v.lon];
      // reta pontilhada vermelha com contorno branco (aparece sobre ruas e satélite), diferente da linha tracejada azul-petróleo do carro que segue
      veic.grupoCand.addLayer(L.polyline([a, b], { color: "#fff", weight: 5, opacity: .6, lineCap: "round", interactive: false }));
      veic.grupoCand.addLayer(L.polyline([a, b], { color: "#D32F2F", weight: 2.5, opacity: .95, dashArray: "1 6", lineCap: "round", className: "linha-cand", interactive: false }));
      veic.grupoCand.addLayer(L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: L.divIcon({ html: "<span class='rotulo-cand'>" + esc(x.v.id) + " · " + esc(kmTexto(x.km)) + " · " + esc(prevTexto(x.prev)) + "</span>", className: "", iconSize: [0, 0] }), interactive: false, zIndexOffset: 600 }));
    });
  }

  function limparCandidatos() { veic.candidatosDe = null; veic.grupoCand.clearLayers(); }

  function atualizarCandidatos() {
    if (!veic.candidatosDe) return;
    var v = veic.lista.filter(function (x) { return x.id === veic.candidatosDe; })[0];
    if (v && v.ocorrencia && !$("#tela-detalhe").hidden) desenharCandidatos(candidatosSocorro(v)); else limparCandidatos();
  }

  function blocoOcorrencia(o) {
    return "<div class='bloco-oc'><h4>Ocorrência de socorro aberta</h4>" +
      linhaInfo("Status", chipOcorrencia(o) + (o.minutos != null ? " <span class='mudo'>há " + minutosTexto(o.minutos) + "</span>" : ""), true) +
      linhaInfo("Aberta em", o.aberta_em) + (o.inicio_em && o.inicio_em !== o.aberta_em ? linhaInfo("Quebra em", o.inicio_em) : "") +
      linhaInfo("Serviço", o.servico) + linhaInfo("Linha", o.linha) + linhaInfo("Local do socorro", o.local_socorro) +
      linhaInfo("Defeito", o.defeito) +
      linhaInfo("Carro que segue", textoCarroQueSegue(o), true) +
      "<p class='atalhos' style='margin:6px 0 0'><a href='" + esc(o.link || CFG.fluxoUrl || "#") + "' target='_blank' rel='noopener'>Abrir o " + esc(CFG.fluxoNome || "painel de ocorrências") + "</a></p></div>";
  }

  function textoCarroQueSegue(o) {
    if (!o.carro_segue) return "";
    var t = esc(o.carro_segue);
    if (!o.segue) return t;
    if (!o.segue.tem_posicao) return t + " <span class='mudo'>(sem posição de GPS)</span>";
    if (o.segue.dist_km != null) t += " <span class='mudo'>(a " + kmTexto(o.segue.dist_km) + (o.segue.prev_min != null ? ", prev. " + prevTexto(o.segue.prev_min) : "") + ", GPS " + idadeTexto(o.segue.idade_min) + ")</span>";
    return t;
  }

  function prevCfg() { return (veic.dados && veic.dados.previsao) || { velocidade_kmh: 70, fator_rota: 1.3 }; }

  function blocoSocorro(soc) {
    return "<div class='bloco-soc'><h4>A caminho de um socorro</h4>" +
      linhaInfo("Carro quebrado", esc(soc.carro) + (soc.empresa ? " <span class='mudo'>· " + esc(soc.empresa) + "</span>" : ""), true) +
      linhaInfo("Status", chipOcorrencia(soc) + (soc.minutos != null ? " <span class='mudo'>há " + minutosTexto(soc.minutos) + "</span>" : ""), true) +
      linhaInfo("Local do socorro", soc.local_socorro) +
      linhaInfo("Distância atual", soc.tem_posicao ? (soc.dist_km != null ? kmTexto(soc.dist_km) + " (em linha reta)" : "") : "carro quebrado sem posição de GPS") +
      (soc.prev_min != null ? linhaInfo("Previsão de chegada", esc(prevTexto(soc.prev_min)) + " <span class='mudo'>(por volta das " + horaDaqui(soc.prev_min) + "; estimativa: distância × " + String(prevCfg().fator_rota).replace(".", ",") + " a " + Math.round(prevCfg().velocidade_kmh) + " km/h)</span>", true) : "") +
      (soc.tem_posicao ? "<p class='atalhos' style='margin:6px 0 0'><button type='button' class='btn sec pequeno' data-ver-carro='" + esc(soc.carro) + "'>Ver o carro quebrado</button></p>" : "") + "</div>";
  }

  function abrirOcorrenciaSemPosicao(o) {
    history.replaceState(null, "", location.pathname);
    limparCandidatos();
    var h = "<div class='detalhe-cabecalho'><button type='button' class='btn-voltar' data-voltar title='Voltar'>&#8592;</button>" +
      "<h2>Veículo " + esc(o.carro) + (o.placa ? " <span class='mudo'>" + esc(o.placa) + "</span>" : "") + "</h2></div>" +
      "<div style='margin:4px 0 10px'><span class='etiqueta' style='background:" + esc(CORES_EMPRESAS[o.empresa] || "#607D8B") + "'>" + esc(o.empresa || "sem empresa") + "</span> " + chipOcorrencia(o) + "</div>" +
      "<p class='vazio'>Este carro não tem posição de GPS no arquivo de hoje, por isso não aparece no mapa.</p>" + blocoOcorrencia(o);
    $("#tela-detalhe").innerHTML = h;
    mostrarTela("detalhe");
  }

  $("#tela-detalhe").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-cand-enquadrar]")) {
      var vq = veic.lista.filter(function (x) { return x.id === veic.candidatosDe; })[0];
      if (vq) { var c = candidatosSocorro(vq); enquadrar(L.latLngBounds(c.lista.map(function (x) { return [x.v.lat, x.v.lon]; }).concat([[vq.lat, vq.lon]])).pad(0.25)); }
      return;
    }
    var vc = ev.target.closest("[data-ver-carro]");
    if (vc) {
      var alvo = veic.lista.filter(function (x) { return x.id === vc.getAttribute("data-ver-carro"); })[0];
      if (alvo) abrirVeiculo(alvo);
      return;
    }
    var po = ev.target.closest("[data-osm-veiculo]");
    if (po) {
      var vo = veic.lista.filter(function (x) { return x.id === po.getAttribute("data-osm-veiculo"); })[0];
      if (vo) { marcarAqui(vo.lat, vo.lon); abrirBuscaOsm(vo.lat, vo.lon, "Perto do veículo " + vo.id + (vo.local_proximo ? " (" + vo.local_proximo + ")" : "")); }
      return;
    }
    var pv = ev.target.closest("[data-proximos-veiculo]");
    if (!pv) return;
    var v = veic.lista.filter(function (x) { return x.id === pv.getAttribute("data-proximos-veiculo"); })[0];
    if (v) { marcarAqui(v.lat, v.lon); listarProximos(v.lat, v.lon, "Apoios próximos do veículo " + v.id); }
  });
  $("#tela-detalhe").addEventListener("change", function (ev) {
    var sel = ev.target.closest("[data-cand-raio]");
    if (!sel) return;
    veic.raioCand = parseInt(sel.value, 10);
    var v = veic.lista.filter(function (x) { return x.id === veic.candidatosDe; })[0];
    if (v) abrirVeiculo(v, true);
  });
}).catch(function (e) {
  console.error(e);
  var t = document.getElementById("tela-inicial");
  if (t) t.innerHTML = "<p class='vazio'>Não foi possível carregar os dados da demonstração (" + String(e.message || e) + ").</p>";
});

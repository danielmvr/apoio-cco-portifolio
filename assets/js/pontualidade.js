/* Análise de pontualidade por período (página pontualidade.html).
   Versão de portfólio: a análise, que no sistema original é feita pelo servidor (/api/historico/analise/), roda no navegador
   (assets/js/pontualidade-motor.js) sobre os arquivos de atrasos sintéticos; o resto é o código do sistema original.
   Gráficos em SVG próprio, sem bibliotecas além do Leaflet (mapa da rota). Todas as linhas: trechos, linhas, dias e horas.
   Uma linha: onde o atraso nasce ao longo da rota, mapa, trechos, horários, dias e a linha do tempo (horário x parada) de um dia. */
window.ApoioDados.pontualidadeConfig().then(function (CFG) {
  "use strict";

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var SVGNS = "http://www.w3.org/2000/svg";

  var FAIXAS = [
    { k: "adiantado", rot: "Adiantado (mais de 9 min antes)", cor: "#3B6FB6" },
    { k: "pontual", rot: "Na tolerância (saída até 8:59, demais paradas até 30 min)", cor: "#2E7D4F" },
    { k: "leve", rot: "Saída com 9 a 20 min", cor: "#D9A90F" },
    { k: "atrasado", rot: "Atraso até 45 min", cor: "#D9531A" },
    { k: "grave", rot: "Acima de 45 min", cor: "#9E1C1C" },
    { k: "sem", rot: "Sem registro", cor: "#8A96A3" }
  ];
  var COR = {};
  FAIXAS.forEach(function (f) { COR[f.k] = f.cor; });
  var PERDE = "#D9531A", GANHA = "#2E7D4F", NEUTRO = "#6B7B8C", SERIE = "#2F5F99", GRADE = "#E6EBF1", EIXO = "#5B6B7C";
  // tolerância: na saída da origem até 8:59 (9 min já é atraso); nas demais paradas (seções) e na chegada, até 30 min
  var TOL_SAIDA = 8, TOL_TRECHO = 30, ADIANTADO = 9;
  function faixa(min, tol) {
    tol = tol == null ? TOL_SAIDA : tol;
    if (min == null) return "sem";
    if (min < -ADIANTADO) return "adiantado";
    if (min <= tol) return "pontual";
    if (min <= 20) return "leve";
    if (min <= 45) return "atrasado";
    return "grave";
  }
  // cor do trecho no mapa pela perda média
  var ESCALA_PERDA = [
    { ate: -2, cor: GANHA, rot: "Recupera tempo" },
    { ate: 2, cor: "#8A96A3", rot: "Estável (até 2 min)" },
    { ate: 10, cor: "#D9A90F", rot: "Perde 2 a 10 min" },
    { ate: 20, cor: "#D9531A", rot: "Perde 10 a 20 min" },
    { ate: Infinity, cor: "#9E1C1C", rot: "Perde mais de 20 min" }
  ];
  function corPerda(v) { if (v == null) return "#C3CCD6"; for (var i = 0; i < ESCALA_PERDA.length; i++) if (v <= ESCALA_PERDA[i].ate) return ESCALA_PERDA[i].cor; return "#9E1C1C"; }

  // ---------------------------------------------------------------- formatação
  function num(v, casas) { return v == null ? "-" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas == null ? 1 : casas }); }
  // a partir de 60 min, em horas e minutos: 75,3 -> "1h15m", 120 -> "2h"
  function horasMin(v) {
    var m = Math.round(Math.abs(v)), h = Math.floor(m / 60), r = m % 60;
    return h + "h" + (r ? (r < 10 ? "0" : "") + r + "m" : "");
  }
  function minTxt(v, sinal) {
    if (v == null) return "-";
    var t = Math.abs(v) >= 60 ? horasMin(v) : num(Math.abs(v)) + " min";
    if (!sinal) return (v < 0 ? "−" : "") + t;
    return (v > 0 ? "+" : v < 0 ? "−" : "") + t;
  }
  function pctTxt(v) { return v == null ? "-" : v + "%"; }
  function diaBR(iso, ano) { var p = (iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + (ano ? "/" + p[0] : "") : iso; }
  var SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  function semana(iso) { var p = iso.split("-"); return SEMANA[new Date(+p[0], +p[1] - 1, +p[2]).getDay()]; }
  function hora(ms) { var d = new Date(ms); return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(); }
  function isoDe(d) { return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); }
  function somaDias(iso, n) { var p = iso.split("-"); return isoDe(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
  function el(tag, attrs, pai) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (pai) pai.appendChild(e);
    return e;
  }
  function texto(pai, x, y, t, attrs) { var e = el("text", Object.assign({ x: x, y: y }, attrs || {}), pai); e.textContent = t; return e; }
  function passoBonito(max, alvo) {
    var bruto = max / (alvo || 5), pot = Math.pow(10, Math.floor(Math.log10(bruto || 1))), n = bruto / pot;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pot;
  }

  // ---------------------------------------------------------------- estado e filtros
  var datas = CFG.datas || [];
  var q = new URLSearchParams(location.search);
  var filtro = { de: q.get("de") || CFG.de, ate: q.get("ate") || CFG.ate, linha: q.get("linha") || "", dia: q.get("dia") || "", semOutliers: false };
  // retirar outliers: vem do endereço (outliers=0) ou da última escolha neste navegador
  if (q.has("outliers")) filtro.semOutliers = q.get("outliers") === "0";
  else { try { filtro.semOutliers = localStorage.getItem("apoiocco.pont.outliers") === "retirar"; } catch (e) {} }
  var dados = null, redesenhar = [], linhasPorTexto = {}, pedido = 0;
  var fDe = $("#f-de"), fAte = $("#f-ate"), fLinha = $("#f-linha"), btnTodas = $("#f-todas");
  if (datas.length) { [fDe, fAte].forEach(function (i) { i.min = datas[0]; i.max = datas[datas.length - 1]; }); }
  fDe.value = filtro.de; fAte.value = filtro.ate;

  function aplicarPeriodo() {
    if (!fDe.value || !fAte.value) return;
    filtro.de = fDe.value; filtro.ate = fAte.value; filtro.dia = "";
    if (filtro.ate < filtro.de) { var t = filtro.de; filtro.de = filtro.ate; filtro.ate = t; fDe.value = filtro.de; fAte.value = filtro.ate; }
    carregar();
  }
  fDe.addEventListener("change", aplicarPeriodo);
  fAte.addEventListener("change", aplicarPeriodo);
  $$("[data-dias]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!datas.length) return;
      var ult = datas[datas.length - 1], n = +b.getAttribute("data-dias");
      fAte.value = ult;
      fDe.value = n ? (somaDias(ult, -(n - 1)) < datas[0] ? datas[0] : somaDias(ult, -(n - 1))) : datas[0];
      aplicarPeriodo();
    });
  });
  function marcarOutliers() {
    $$("[data-outliers]").forEach(function (b) { b.setAttribute("aria-pressed", (b.getAttribute("data-outliers") === "retirar") === filtro.semOutliers ? "true" : "false"); });
  }
  marcarOutliers();
  $$("[data-outliers]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-outliers") === "retirar";
      if (v === filtro.semOutliers) return;
      filtro.semOutliers = v;
      try { localStorage.setItem("apoiocco.pont.outliers", v ? "retirar" : "manter"); } catch (e) {}
      marcarOutliers();
      carregar();
    });
  });

  // ---------------------------------------------------------------- aviso de carregamento (barra e tempo decorrido)
  var carga = { t0: 0, timer: null };
  // o texto é anunciado uma vez; os segundos correm à parte (sem leitor de tela repetindo a cada segundo)
  function segundosCarga() {
    var seg = Math.round((Date.now() - carga.t0) / 1000);
    var dias = Math.round((new Date(filtro.ate) - new Date(filtro.de)) / 86400000) + 1;
    $("#pt-aviso-seg").textContent = " · " + seg + " s" + (dias > 31 && seg >= 3 ? " (períodos longos levam alguns segundos)" : "");
  }
  function iniciarCarga() {
    carga.t0 = Date.now();
    $("#pt-progresso").hidden = false;
    var per = filtro.de === filtro.ate ? diaBR(filtro.de, true) : diaBR(filtro.de) + " a " + diaBR(filtro.ate, true);
    $("#pt-aviso-txt").textContent = "Carregando a análise de " + per + (filtro.linha ? "" : ", todas as linhas") + (filtro.semOutliers ? ", sem outliers" : "");
    $("#pt-aviso-carga").hidden = false;
    segundosCarga();
    clearInterval(carga.timer);
    carga.timer = setInterval(segundosCarga, 1000);
    $$(".pt-filtros input, .pt-filtros button").forEach(function (e) { e.setAttribute("aria-busy", "true"); });
  }
  function terminarCarga() {
    clearInterval(carga.timer);
    $("#pt-progresso").hidden = true;
    $("#pt-aviso-carga").hidden = true;
    $$(".pt-filtros [aria-busy]").forEach(function (e) { e.removeAttribute("aria-busy"); });
  }

  function escolherLinha() {
    var v = fLinha.value.trim();
    if (!v) { if (filtro.linha) { filtro.linha = ""; filtro.dia = ""; carregar(); } return; }
    var cod = linhasPorTexto[v] || linhasPorTexto[v.toUpperCase()];
    if (!cod) return;
    if (cod !== filtro.linha) { filtro.linha = cod; filtro.dia = ""; carregar(); }
  }
  fLinha.addEventListener("change", escolherLinha);
  fLinha.addEventListener("keydown", function (ev) { if (ev.key === "Enter") escolherLinha(); });
  fLinha.addEventListener("search", function () { if (!fLinha.value) escolherLinha(); });
  btnTodas.addEventListener("click", function () { fLinha.value = ""; filtro.linha = ""; filtro.dia = ""; carregar(); });
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest("[data-abrir-linha]");
    if (!a) return;
    ev.preventDefault();
    filtro.linha = a.getAttribute("data-abrir-linha"); filtro.dia = "";
    carregar();
    window.scrollTo(0, 0);
  });

  function montarListaLinhas(lista) {
    linhasPorTexto = {};
    $("#lista-linhas").innerHTML = lista.map(function (l) {
      linhasPorTexto[l.descricao] = l.linha; linhasPorTexto[l.linha] = l.linha; linhasPorTexto[l.descricao.toUpperCase()] = l.linha;
      return "<option value='" + esc(l.descricao) + "'>" + l.servicos + " serviços</option>";
    }).join("");
  }

  function carregar() {
    var p = new URLSearchParams({ de: filtro.de, ate: filtro.ate });
    if (filtro.linha) p.set("linha", filtro.linha);
    if (filtro.dia) p.set("dia", filtro.dia);
    if (filtro.semOutliers) p.set("outliers", "0");
    history.replaceState(null, "", location.pathname + "?" + p.toString());
    var n = ++pedido;
    $("#pt-conteudo").classList.add("carregando");
    iniciarCarga();
    var params = {};
    p.forEach(function (v, k) { params[k] = v; });
    window.ApoioDados.analise(params).then(function (d) {
      if (n !== pedido || !d) return;
      terminarCarga();
      $("#pt-conteudo").classList.remove("carregando");
      if (d.erro) { $("#pt-conteudo").innerHTML = "<p class='pt-vazio'>" + esc(d.erro) + "</p>"; return; }
      dados = d;
      filtro.de = d.de; filtro.ate = d.ate; fDe.value = d.de; fAte.value = d.ate;
      if (d.datas) { datas = d.datas; if (datas.length) [fDe, fAte].forEach(function (i) { i.min = datas[0]; i.max = datas[datas.length - 1]; }); }
      montarListaLinhas(d.linhas_periodo || []);
      if (filtro.linha) fLinha.value = d.descricao || ((d.linhas_periodo || []).filter(function (x) { return x.linha === filtro.linha; })[0] || {}).descricao || filtro.linha;
      btnTodas.hidden = !filtro.linha;
      render();
    }).catch(function () {
      if (n !== pedido) return;
      terminarCarga();
      $("#pt-conteudo").classList.remove("carregando");
      $("#pt-conteudo").innerHTML = "<p class='pt-vazio'>Não foi possível carregar a análise. Verifique a conexão e tente de novo.</p>";
    });
  }

  // ---------------------------------------------------------------- dica (tooltip) dos gráficos
  var dica = $("#pt-dica");
  function mostrarDica(alvo, x, y) {
    dica.innerHTML = alvo.getAttribute("data-dica");
    dica.hidden = false;
    var w = dica.offsetWidth, h = dica.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)), top = y - h - 12;
    if (top < 8) top = y + 18;
    dica.style.left = left + "px"; dica.style.top = top + "px";
  }
  document.addEventListener("mousemove", function (ev) {
    var a = ev.target.closest && ev.target.closest("[data-dica]");
    if (a) mostrarDica(a, ev.clientX, ev.clientY); else dica.hidden = true;
  });
  document.addEventListener("focusin", function (ev) {
    var a = ev.target.closest && ev.target.closest("[data-dica]");
    if (!a) return;
    var r = a.getBoundingClientRect();
    mostrarDica(a, r.left + r.width / 2, r.top);
  });
  document.addEventListener("focusout", function () { dica.hidden = true; });
  window.addEventListener("scroll", function () { dica.hidden = true; }, { passive: true });

  var tRes = null;
  window.addEventListener("resize", function () { clearTimeout(tRes); tRes = setTimeout(function () { redesenhar.forEach(function (f) { f(); }); }, 150); });

  // ---------------------------------------------------------------- blocos de página
  function bloco(titulo, sub, extraCls) {
    var s = document.createElement("section");
    s.className = "pt-bloco" + (extraCls ? " " + extraCls : "");
    s.innerHTML = "<header class='pt-bloco-topo'><h2>" + esc(titulo) + "</h2>" + (sub ? "<p>" + sub + "</p>" : "") + "</header><div class='pt-bloco-corpo'></div>";
    return s;
  }
  function numeros(r, extra) {
    var itens = [
      { v: pctTxt(r.pontual_chegada), r: "chegaram no horário", d: "Serviços que chegaram ao destino dentro da tolerância de 30 min, entre os " + num(r.com_chegada, 0) + " com chegada registrada." },
      { v: pctTxt(r.pontual_saida), r: "saíram no horário", d: "Serviços que saíram da origem com até 8:59 de atraso (9 min ou mais é atraso)." },
      { v: minTxt(r.atraso_chegada, true), r: "atraso médio na chegada", d: "Média do atraso registrado na última parada do serviço." },
      { v: minTxt(r.atraso_partida, true), r: "atraso médio na saída", d: "Média do atraso registrado na primeira parada (origem)." },
      { v: num(r.servicos, 0), r: "serviços no período", d: "Serviços com ao menos duas paradas já passadas no período." },
      { v: pctTxt(r.sem_registro), r: "paradas sem registro", d: "Paradas cujo horário já passou e que não têm hora real no arquivo de atrasos. Elas ficam fora das médias." }
    ];
    if (extra) itens.splice(3, 0, extra);
    return "<dl class='pt-numeros'>" + itens.map(function (i) {
      return "<div class='pt-numero' tabindex='0' data-dica='" + esc(i.d) + "'><dt>" + esc(i.r) + "</dt><dd>" + esc(i.v) + "</dd></div>";
    }).join("") + "</dl>";
  }
  function periodoTxt(d) { return d.de === d.ate ? diaBR(d.de, true) : diaBR(d.de) + " a " + diaBR(d.ate, true); }

  function render() {
    redesenhar = [];
    var c = $("#pt-conteudo");
    c.innerHTML = "";
    var temExec = dados.execucao && dados.execucao.resumo.trechos;
    if (!dados.resumo.servicos && !temExec) {
      c.innerHTML = "<p class='pt-vazio'>" + (datas.length ? "Nenhum serviço com registro de horário neste período" + (filtro.linha ? " para esta linha" : "") + ". Escolha outro período." :
        "Ainda não há dados de atrasos.") + "</p>";
      return;
    }
    if (filtro.linha) renderLinha(c); else renderGeral(c);
  }

  // ---------------------------------------------------------------- todas as linhas
  function renderGeral(c) {
    var d = dados;
    if (!d.resumo.servicos) {
      c.insertAdjacentHTML("beforeend", "<div class='pt-cabecalho'><h1>Pontualidade de todas as linhas</h1><p>" + esc(periodoTxt(d)) + " · sem horários por parada no arquivo de atrasos neste período; abaixo, a execução por trecho</p></div>");
      renderExecucao(c, d.execucao, false);
      return;
    }
    var cab = document.createElement("div");
    cab.className = "pt-cabecalho";
    cab.innerHTML = "<h1>Pontualidade de todas as linhas</h1><p>" + esc(periodoTxt(d)) + " · média histórica do período, a partir das paradas com horário registrado</p>" + avisoOutliers(d.outliers) + numeros(d.resumo);
    c.appendChild(cab);

    var sec = d.secoes || [];
    var b1 = bloco("Trechos onde o atraso nasce", "Trechos entre duas paradas seguidas, ordenados pelo total de minutos perdidos no período. Perda = atraso ao chegar menos o atraso ao sair. Só entram trechos com 3 passagens registradas ou mais. Clique num trecho para ver as linhas que o compõem.");
    c.appendChild(b1);
    if (sec.length) {
      var top = sec[0];
      b1.querySelector(".pt-bloco-corpo").insertAdjacentHTML("beforeend", "<p class='pt-destaque'>O trecho <strong>" + esc(nomeTrecho(top)) + "</strong> foi o que mais somou atraso: " + num(top.perda_total, 0) + " min no período, " + minTxt(top.perda_media, true) + " por passagem em média, em " + top.linhas + (top.linhas === 1 ? " linha." : " linhas.") + "</p>");
    }
    tabela(b1.querySelector(".pt-bloco-corpo"), [
      { k: "trecho", rot: "Trecho", html: function (t) { return nomeTrechoHtml(t); }, ord: function (t) { return t.a + t.b; } },
      { k: "linhas", rot: "Linhas", num: true },
      { k: "com_registro", rot: "Passagens", num: true, dica: "Passagens com hora registrada nas duas pontas do trecho." },
      { k: "perda_media", rot: "Perda média", num: true, html: function (t) { return barraValor(t.perda_media, 30); }, dica: "Minutos perdidos, em média, por passagem." },
      { k: "perda_total", rot: "Minutos perdidos", num: true, html: function (t) { return num(t.perda_total, 0); } },
      { k: "perdeu", rot: "Perderam > 5 min", num: true, html: function (t) { return pctTxt(t.perdeu); } },
      { k: "pior", rot: "Pior caso", num: true, html: function (t) { return t.pior ? minTxt(t.pior.perda, true) + "<small>" + diaBR(t.pior.dia) + " " + esc(t.pior.horario) + " · carro " + esc(t.pior.veiculo || "-") + "</small>" : "-"; }, ord: function (t) { return t.pior ? t.pior.perda : -999; } }
    ], sec, "perda_total", 15, false, function (t) { return detalheLinhas(t, false); });

    var duo = document.createElement("div");
    duo.className = "pt-duo";
    c.appendChild(duo);
    var b2 = bloco("Atraso médio na chegada, por dia", "Uma coluna por dia de operação. A linha verde marca a tolerância de 30 min na chegada.");
    var b3 = bloco("Atraso médio na chegada, pela hora de saída", "Serviços agrupados pela hora programada de saída da origem.");
    duo.appendChild(b2); duo.appendChild(b3);
    graficoDias(b2.querySelector(".pt-bloco-corpo"), d.dias);
    graficoHoras(b3.querySelector(".pt-bloco-corpo"), d.horas);

    var b4 = bloco("Linhas", "Clique numa linha para ver onde o atraso dela nasce. Ordenadas pelo atraso médio na chegada.");
    c.appendChild(b4);
    tabela(b4.querySelector(".pt-bloco-corpo"), [
      { k: "descricao", rot: "Linha", html: function (l) { return "<a href='#' data-abrir-linha='" + esc(l.linha) + "'>" + esc(l.descricao) + "</a>"; } },
      { k: "servicos", rot: "Serviços", num: true },
      { k: "pontual_chegada", rot: "No horário", num: true, html: function (l) { return pctTxt(l.pontual_chegada); }, dica: "Chegaram ao destino dentro da tolerância de 30 min." },
      { k: "atraso_partida", rot: "Na saída", num: true, html: function (l) { return chipFaixa(l.atraso_partida, TOL_SAIDA); }, dica: "Atraso médio na saída da origem (tolerância até 8:59)." },
      { k: "atraso_chegada", rot: "Na chegada", num: true, html: function (l) { return chipFaixa(l.atraso_chegada, TOL_TRECHO); }, dica: "Atraso médio na chegada ao destino (tolerância de 30 min)." },
      { k: "ganho_trajeto", rot: "Perdido no trajeto", num: true, html: function (l) { return minTxt(l.ganho_trajeto, true); }, dica: "Atraso na chegada menos o atraso na saída, em média." },
      { k: "pior_trecho", rot: "Pior trecho", html: function (l) { return l.pior_trecho ? esc(l.pior_trecho.a + " → " + l.pior_trecho.b) + " <small>" + minTxt(l.pior_trecho.perda_media, true) + "</small>" : "-"; }, ord: function (l) { return l.pior_trecho ? l.pior_trecho.perda_media : -999; } }
    ], d.linhas || [], "atraso_chegada", 25);
    renderExecucao(c, d.execucao, false);
  }

  // ---------------------------------------------------------------- execução (execucao.XLS): saída e chegada por trecho, todos os tipos de serviço
  function numerosExec(r) {
    var itens = [
      { v: pctTxt(r.pontual_saida), r: "saíram no horário", d: "Trechos que saíram dentro da tolerância: até 8:59 de atraso na saída da origem do serviço, até 30 min na saída de uma seção no meio da viagem." },
      { v: minTxt(r.atraso_saida, true), r: "atraso médio na saída", d: "Média de (partida realizada - partida prevista) dos trechos com saída registrada." },
      { v: pctTxt(r.pontual_chegada), r: "chegaram no horário", d: "Trechos que chegaram dentro da tolerância de 30 min." },
      { v: minTxt(r.atraso_chegada, true), r: "atraso médio na chegada", d: "Média de (chegada realizada - chegada prevista) dos trechos com chegada registrada." },
      { v: minTxt(r.perda_media, true), r: "perdido no trecho", d: "Atraso na chegada menos o atraso na saída, em média, nos trechos com as duas pontas registradas." },
      { v: num(r.trechos, 0), r: "trechos no período", d: "Trechos da execução com a saída prevista no período e já passada." },
      { v: pctTxt(r.com_saida), r: "com saída registrada", d: "Trechos que têm a partida realizada preenchida na execução." }
    ];
    return "<dl class='pt-numeros'>" + itens.map(function (i) {
      return "<div class='pt-numero' tabindex='0' data-dica='" + esc(i.d) + "'><dt>" + esc(i.r) + "</dt><dd>" + esc(i.v) + "</dd></div>";
    }).join("") + "</dl>";
  }
  var COLS_EXEC = {
    trecho: { k: "trecho", rot: "Trecho", html: function (t) { return nomeTrechoHtml(t); }, ord: function (t) { return t.a + t.b; } },
    trechos: { k: "trechos", rot: "Trechos", num: true },
    saida: { k: "atraso_saida", rot: "Saída", num: true, html: function (t) { return chipFaixa(t.atraso_saida, TOL_SAIDA); }, dica: "Atraso médio na saída do trecho (a cor usa a tolerância da origem, 8:59)." },
    psaida: { k: "pontual_saida", rot: "Saída no horário", num: true, html: function (t) { return pctTxt(t.pontual_saida); } },
    chegada: { k: "atraso_chegada", rot: "Chegada", num: true, html: function (t) { return chipFaixa(t.atraso_chegada, TOL_TRECHO); }, dica: "Atraso médio na chegada do trecho (tolerância de 30 min)." },
    pchegada: { k: "pontual_chegada", rot: "Chegada no horário", num: true, html: function (t) { return pctTxt(t.pontual_chegada); } },
    perda: { k: "perda_media", rot: "Perda média", num: true, html: function (t) { return barraValor(t.perda_media, 30); }, dica: "Atraso na chegada menos o atraso na saída, em média." },
    perdaTotal: { k: "perda_total", rot: "Minutos perdidos", num: true, html: function (t) { return num(t.perda_total, 0); } },
    prog: { k: "prog_medio", rot: "Prog.", num: true, html: function (t) { return t.prog_medio == null ? "-" : minTxt(t.prog_medio); }, dica: "Tempo programado do trecho (chegada prevista - partida prevista), em média." },
    real: { k: "real_medio", rot: "Real.", num: true, html: function (t) { return t.real_medio == null ? "-" : minTxt(t.real_medio); }, dica: "Tempo realizado do trecho (chegada realizada - partida realizada), em média." },
    registro: { k: "com_saida", rot: "Com registro", num: true, html: function (t) { return pctTxt(t.com_saida) + "<small>saída · " + pctTxt(t.com_chegada) + " chegada</small>"; }, dica: "Trechos com partida e com chegada realizadas preenchidas na execução." },
    pior: { k: "pior", rot: "Pior caso", num: true, html: function (t) { return t.pior ? minTxt(t.pior.perda, true) + "<small>" + diaBR(t.pior.dia) + " " + esc(t.pior.horario) + " · carro " + esc(t.pior.veiculo || "-") + "</small>" : "-"; }, ord: function (t) { return t.pior ? t.pior.perda : -999; } }
  };
  function renderExecucao(c, ex, linha) {
    if (!ex || !ex.resumo.trechos) return;
    var sec = document.createElement("section");
    sec.className = "pt-grupo-exec";
    sec.innerHTML = avisoOutliers(ex.outliers) + "<header class='pt-grupo-topo'><h2>Execução dos serviços</h2><p>Do execucao.XLS: partida e chegada previstas e realizadas de cada trecho (origem → destino), de todos os tipos de serviço. Mede a pontualidade nas pontas de cada trecho" + (dados.resumo.servicos ? "; o detalhe por parada fica nos blocos acima" : "") + ".</p></header>" + numerosExec(ex.resumo);
    c.appendChild(sec);
    if (!linha) {
      var b1 = bloco("Por tipo de serviço", "Saída e chegada de cada tipo. Tipos com pouco registro de saída ou chegada têm médias menos confiáveis.");
      sec.appendChild(b1);
      tabela(b1.querySelector(".pt-bloco-corpo"), [
        { k: "tipo", rot: "Tipo" }, COLS_EXEC.trechos, COLS_EXEC.registro, COLS_EXEC.saida, COLS_EXEC.psaida, COLS_EXEC.chegada, COLS_EXEC.pchegada, COLS_EXEC.perda
      ], ex.tipos || [], "trechos");
      var b2 = bloco("Trechos da execução que mais perdem tempo", "Ordenados pelo total de minutos perdidos no período. Só entram trechos com 3 passagens medidas ou mais. Clique num trecho para ver as linhas que o compõem.");
      sec.appendChild(b2);
      tabela(b2.querySelector(".pt-bloco-corpo"), [
        COLS_EXEC.trecho, { k: "linhas", rot: "Linhas", num: true }, { k: "medidos", rot: "Medidos", num: true, dica: "Passagens com saída e chegada registradas." },
        COLS_EXEC.perda, COLS_EXEC.perdaTotal, COLS_EXEC.chegada, COLS_EXEC.pior
      ], ex.trechos || [], "perda_total", 15, false, function (t) { return detalheLinhas(t, true); });
    } else {
      var b3 = bloco("Trechos da linha", "Na ordem da viagem. Tempo programado e realizado de cada trecho, em média, e o atraso nas pontas.");
      sec.appendChild(b3);
      var trechoOrdem = Object.assign({}, COLS_EXEC.trecho, { ord: function (t) { return t.ordem; } });
      tabela(b3.querySelector(".pt-bloco-corpo"), [
        trechoOrdem, COLS_EXEC.trechos, COLS_EXEC.registro, COLS_EXEC.saida, COLS_EXEC.chegada, COLS_EXEC.perda, COLS_EXEC.prog, COLS_EXEC.real, COLS_EXEC.pior
      ], (ex.trechos || []).map(function (t, i) { t.ordem = i; return t; }), "trecho", null, true);
    }
  }
  function nomeLinha(cod) {
    var l = (dados.linhas_periodo || []).filter(function (x) { return x.linha === cod; })[0];
    return l ? l.descricao : cod;
  }

  function nomeTrechoHtml(t) {
    return "<strong>" + esc(t.a) + " → " + esc(t.b) + "</strong>" + (t.nome_a || t.nome_b ? "<small>" + esc(t.nome_a || t.a) + " → " + esc(t.nome_b || t.b) + "</small>" : "");
  }
  // linhas que compõem um trecho, da que mais soma minutos perdidos para a que menos soma
  function detalheLinhas(t, exec) {
    var ls = t.detalhe_linhas || [];
    if (!ls.length) return "<p class='pt-vazio'>Sem linhas com passagens medidas neste trecho.</p>";
    var maxP = Math.max.apply(null, ls.map(function (r) { return r.participacao || 0; }).concat([1]));
    return "<div class='pt-detalhe'><p class='pt-detalhe-tit'>Linhas que passam por " + esc(t.a) + " → " + esc(t.b) + ", da de maior para a de menor impacto (minutos perdidos no período)</p>" +
      "<table class='tabela pt-sub-tabela'><thead><tr><th scope='col'>Linha</th><th scope='col' class='num'>" + (exec ? "Medidos" : "Passagens") + "</th><th scope='col' class='num'>Perda média</th>" +
      "<th scope='col' class='num'>Minutos perdidos</th><th scope='col'>Parte do trecho</th><th scope='col' class='num'>Perderam &gt; 5 min</th><th scope='col' class='num'>" + (exec ? "Chegada" : "Atraso ao chegar") + "</th><th scope='col' class='num'>Pior caso</th></tr></thead><tbody>" +
      ls.map(function (r) {
        var w = r.participacao == null ? 0 : Math.max(2, r.participacao / maxP * 100);
        return "<tr><td><a href='#' data-abrir-linha='" + esc(r.linha) + "'>" + esc(r.descricao || r.linha) + "</a></td>" +
          "<td class='num'>" + num(exec ? r.medidos : r.com_registro, 0) + "</td><td class='num'>" + minTxt(r.perda_media, true) + "</td>" +
          "<td class='num'>" + num(r.perda_total, 0) + "</td>" +
          "<td><span class='pt-barra-valor pt-parte'><span class='pt-barra'><span style='width:" + w + "%;background:" + PERDE + "'></span></span>" + pctTxt(r.participacao) + "</span></td>" +
          "<td class='num'>" + pctTxt(r.perdeu) + "</td><td class='num'>" + chipFaixa(exec ? r.atraso_chegada : r.chegada_media, TOL_TRECHO) + "</td>" +
          "<td class='num'>" + (r.pior ? minTxt(r.pior.perda, true) + "<small>" + diaBR(r.pior.dia) + " " + esc(r.pior.horario) + " · carro " + esc(r.pior.veiculo || "-") + "</small>" : "-") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function avisoOutliers(o) {
    if (!o || !o.ligado) return "";
    var partes = [];
    if (o.perdas && o.perdas.total) partes.push(num(o.perdas.pct) + "% das perdas por trecho");
    if (o.chegadas && o.chegadas.total) partes.push(num(o.chegadas.pct) + "% das chegadas");
    if (o.saidas && o.saidas.total) partes.push(num(o.saidas.pct) + "% das saídas");
    return partes.length ? "<p class='pt-aviso-outliers'>Sem outliers: retirados " + partes.join(", ") + " (fora de Q1 - 1,5 IQR e Q3 + 1,5 IQR, em cada grupo).</p>" : "";
  }

  function nomeTrecho(t) { return t.a + " → " + t.b + (t.nome_a || t.nome_b ? " (" + (t.nome_a || t.a) + " → " + (t.nome_b || t.b) + ")" : ""); }
  // tol: TOL_TRECHO para chegadas e paradas no meio da viagem; TOL_SAIDA (padrão) para saídas
  function chipFaixa(v, tol) {
    if (v == null) return "-";
    var f = faixa(Math.floor(v), tol);
    return "<span class='pt-chip'><span class='pt-amostra' style='background:" + COR[f] + "'></span>" + minTxt(v, true) + "</span>";
  }
  function barraValor(v, ref) {
    if (v == null) return "-";
    var w = Math.min(100, Math.abs(v) / ref * 100);
    return "<span class='pt-barra-valor'><span class='pt-barra'><span style='width:" + w + "%;background:" + (v > 0 ? PERDE : GANHA) + "'></span></span>" + minTxt(v, true) + "</span>";
  }

  // ---------------------------------------------------------------- tabela ordenável
  // detalhe (opcional): função que devolve o HTML de uma linha extra, aberta ao clicar na linha da tabela
  function tabela(pai, cols, linhas, ordInicial, limite, crescente, detalhe) {
    var estado = { k: ordInicial, desc: !crescente, todos: false, abertos: [] };
    var wrap = document.createElement("div");
    wrap.className = "tabela-wrap pt-tabela";
    pai.appendChild(wrap);
    function valor(c, l) { return c.ord ? c.ord(l) : l[c.k]; }
    function desenhar() {
      var col = cols.filter(function (c) { return c.k === estado.k; })[0] || cols[0];
      var lista = linhas.slice().sort(function (a, b) {
        var va = valor(col, a), vb = valor(col, b);
        if (va == null) return 1; if (vb == null) return -1;
        var r = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
        return estado.desc ? -r : r;
      });
      var mostrar = estado.todos || !limite ? lista : lista.slice(0, limite);
      wrap.innerHTML = "<table class='tabela" + (detalhe ? " pt-com-detalhe" : "") + "'><thead><tr>" + cols.map(function (c) {
        var ativo = c.k === estado.k;
        return "<th scope='col'" + (c.num ? " class='num'" : "") + " aria-sort='" + (ativo ? (estado.desc ? "descending" : "ascending") : "none") + "'>" +
          "<button type='button' data-ord='" + c.k + "'" + (c.dica ? " data-dica='" + esc(c.dica) + "'" : "") + ">" + esc(c.rot) + (ativo ? (estado.desc ? " ↓" : " ↑") : "") + "</button></th>";
      }).join("") + "</tr></thead><tbody>" + mostrar.map(function (l) {
        var i = linhas.indexOf(l), aberto = estado.abertos.indexOf(i) >= 0;
        var tr = "<tr" + (detalhe ? " class='pt-linha-detalhe" + (aberto ? " aberta" : "") + "' data-detalhe='" + i + "'" : "") + ">" + cols.map(function (c, j) {
          var conteudo = c.html ? c.html(l) : esc(c.num ? num(l[c.k], 0) : l[c.k]);
          if (detalhe && j === 0) conteudo = "<button type='button' class='pt-abrir' aria-expanded='" + aberto + "' aria-label='" + (aberto ? "Fechar" : "Ver") + " as linhas deste trecho'>" +
            "<svg width='12' height='12' viewBox='0 0 24 24' aria-hidden='true'><path d='M9 6l6 6-6 6' fill='none' stroke='currentColor' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/></svg></button>" + conteudo;
          return "<td" + (c.num ? " class='num'" : "") + ">" + conteudo + "</td>";
        }).join("") + "</tr>";
        if (detalhe && aberto) tr += "<tr class='pt-sub'><td colspan='" + cols.length + "'>" + detalhe(l) + "</td></tr>";
        return tr;
      }).join("") + "</tbody></table>" +
        (limite && lista.length > limite ? "<button type='button' class='btn sec pequeno pt-mais'>" + (estado.todos ? "Mostrar só os " + limite + " primeiros" : "Mostrar todos (" + lista.length + ")") + "</button>" : "");
    }
    wrap.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-ord]");
      if (b) {
        var k = b.getAttribute("data-ord");
        if (estado.k === k) estado.desc = !estado.desc; else { estado.k = k; estado.desc = true; }
        desenhar();
        return;
      }
      if (ev.target.closest(".pt-mais")) { estado.todos = !estado.todos; desenhar(); return; }
      var tr = detalhe && !ev.target.closest("a, .pt-sub") && ev.target.closest("[data-detalhe]");
      if (tr) {
        var i = +tr.getAttribute("data-detalhe"), pos = estado.abertos.indexOf(i);
        if (pos >= 0) estado.abertos.splice(pos, 1); else estado.abertos.push(i);
        desenhar();
        var bt = wrap.querySelector("[data-detalhe='" + i + "'] .pt-abrir");
        if (bt) bt.focus();
      }
    });
    desenhar();
  }

  // ---------------------------------------------------------------- colunas (por dia / por hora)
  function colunas(pai, itens, opts) {
    var box = document.createElement("div");
    box.className = "pt-grafico";
    pai.appendChild(box);
    function desenhar() {
      box.innerHTML = "";
      var W = Math.max(280, box.clientWidth), H = opts.altura || 220, m = { t: 14, r: 10, b: 30, l: 44 };
      var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria }, box);
      var vals = itens.map(function (i) { return i.valor; }).filter(function (v) { return v != null; });
      var max = Math.max(opts.ref || 0, Math.max.apply(null, vals.concat([1]))), min = Math.min(0, Math.min.apply(null, vals.concat([0])));
      var passo = passoBonito(max - min, 4);
      max = Math.ceil(max / passo) * passo; min = Math.floor(min / passo) * passo;
      var y = function (v) { return m.t + (max - v) / (max - min) * (H - m.t - m.b); };
      for (var g = min; g <= max + 1e-9; g += passo) {
        el("line", { x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), stroke: g === 0 ? "#B8C3CF" : GRADE, "stroke-width": 1 }, svg);
        texto(svg, m.l - 6, y(g) + 4, num(g, 0), { "text-anchor": "end", class: "pt-eixo" });
      }
      texto(svg, 4, m.t - 2, "min", { class: "pt-eixo" });
      var n = itens.length, banda = (W - m.l - m.r) / Math.max(1, n), larg = Math.min(24, banda * 0.7);
      var cada = Math.ceil(n / Math.floor((W - m.l - m.r) / 38));
      itens.forEach(function (it, i) {
        var cx = m.l + banda * (i + 0.5);
        if (i % cada === 0) texto(svg, cx, H - m.b + 16, it.rot, { "text-anchor": "middle", class: "pt-eixo" });
        if (it.valor == null) return;
        var y0 = y(0), y1 = y(it.valor), topo = Math.min(y0, y1), alt = Math.max(1, Math.abs(y1 - y0));
        var r = Math.min(4, alt / 2, larg / 2);
        var d = it.valor >= 0
          ? "M" + (cx - larg / 2) + "," + y0 + "V" + (topo + r) + "Q" + (cx - larg / 2) + "," + topo + " " + (cx - larg / 2 + r) + "," + topo + "H" + (cx + larg / 2 - r) + "Q" + (cx + larg / 2) + "," + topo + " " + (cx + larg / 2) + "," + (topo + r) + "V" + y0 + "Z"
          : "M" + (cx - larg / 2) + "," + y0 + "V" + (y1 - r) + "Q" + (cx - larg / 2) + "," + y1 + " " + (cx - larg / 2 + r) + "," + y1 + "H" + (cx + larg / 2 - r) + "Q" + (cx + larg / 2) + "," + y1 + " " + (cx + larg / 2) + "," + (y1 - r) + "V" + y0 + "Z";
        el("path", { d: d, fill: it.cor || SERIE }, svg);
        el("rect", { x: cx - banda / 2, y: m.t, width: banda, height: H - m.t - m.b, fill: "transparent", "data-dica": it.dica, tabindex: 0 }, svg);
      });
      if (opts.ref != null) {
        el("line", { x1: m.l, x2: W - m.r, y1: y(opts.ref), y2: y(opts.ref), stroke: GANHA, "stroke-width": 1.5 }, svg);
        texto(svg, W - m.r, y(opts.ref) - 4, "tolerância " + opts.ref + " min", { "text-anchor": "end", class: "pt-eixo pt-ref" });
      }
    }
    desenhar();
    redesenhar.push(desenhar);
  }
  // dica em HTML (cada pedaço de texto escapado); em atributo de HTML montado como texto, passar por esc() de novo
  function dicaTxt(titulo, linhas) { return "<strong>" + esc(titulo) + "</strong><br>" + linhas.map(esc).join("<br>"); }
  function graficoDias(pai, dias) {
    if (!dias.length) { pai.innerHTML = "<p class='pt-vazio'>Sem dias com chegada registrada.</p>"; return; }
    colunas(pai, dias.map(function (d) {
      return { rot: diaBR(d.dia), valor: d.atraso_chegada, dica: dicaTxt(semana(d.dia) + " " + diaBR(d.dia, true), [
        "Atraso médio na chegada: " + minTxt(d.atraso_chegada, true), "No horário: " + pctTxt(d.pontual), d.com_chegada + " de " + d.servicos + " serviços com chegada registrada"]) };
    }), { ref: TOL_TRECHO, aria: "Atraso médio na chegada por dia" });
  }
  function graficoHoras(pai, horas) {
    if (!horas.length) { pai.innerHTML = "<p class='pt-vazio'>Sem chegadas registradas.</p>"; return; }
    var porHora = {};
    horas.forEach(function (h) { porHora[h.hora] = h; });
    var itens = [];
    for (var h = 0; h < 24; h++) {
      var x = porHora[h];
      itens.push({ rot: (h < 10 ? "0" : "") + h + "h", valor: x ? x.atraso_chegada : null, dica: x ? dicaTxt("Saída das " + h + "h às " + h + "h59", [
        "Atraso médio na chegada: " + minTxt(x.atraso_chegada, true), "No horário: " + pctTxt(x.pontual), x.servicos + " serviços com chegada registrada"]) : null });
    }
    colunas(pai, itens, { ref: TOL_TRECHO, aria: "Atraso médio na chegada pela hora de saída" });
  }

  // ---------------------------------------------------------------- uma linha
  function renderLinha(c) {
    var d = dados, rota = (d.secoes || []).filter(function (t) { return t.na_rota; }), par = d.paradas || [];
    if (!d.resumo.servicos) {
      c.insertAdjacentHTML("beforeend", "<div class='pt-cabecalho'><p class='pt-voltar'><a href='#' id='pt-voltar'>← Todas as linhas</a></p><h1>" + esc(nomeLinha(d.linha)) + "</h1><p>" + esc(periodoTxt(d)) +
        " · esta linha não tem horários por parada no arquivo de atrasos neste período; abaixo, a execução por trecho</p></div>");
      $("#pt-voltar").addEventListener("click", function (ev) { ev.preventDefault(); fLinha.value = ""; filtro.linha = ""; filtro.dia = ""; carregar(); });
      renderExecucao(c, d.execucao, true);
      return;
    }
    var cab = document.createElement("div");
    cab.className = "pt-cabecalho";
    cab.innerHTML = "<p class='pt-voltar'><a href='#' id='pt-voltar'>← Todas as linhas</a></p><h1>" + esc(d.descricao || d.linha) + "</h1><p>" + esc(periodoTxt(d)) +
      (par.length ? " · rota de referência " + esc(par.map(function (p) { return p.sigla; }).join(" → ")) : "") + "</p>" +
      avisoOutliers(d.outliers) + numeros(d.resumo, { v: minTxt(d.ganho_trajeto, true), r: "perdido no trajeto", d: "Atraso na chegada menos o atraso na saída, em média, nos serviços com as duas pontas registradas." });
    c.appendChild(cab);
    $("#pt-voltar").addEventListener("click", function (ev) { ev.preventDefault(); fLinha.value = ""; filtro.linha = ""; filtro.dia = ""; carregar(); });

    // onde o atraso nasce
    var b1 = bloco("Onde o atraso nasce", "Atraso médio ao sair da origem, quanto cada trecho soma ou desconta, e o atraso médio na chegada. Vermelho: o serviço perde tempo; verde: recupera.");
    c.appendChild(b1);
    var com = rota.filter(function (t) { return t.perda_media != null && t.com_registro >= 2; });
    if (com.length) {
      var pior = com.slice().sort(function (a, b) { return b.perda_media - a.perda_media; })[0];
      var corpo = b1.querySelector(".pt-bloco-corpo");
      if (pior.perda_media > 2) corpo.insertAdjacentHTML("beforeend", "<p class='pt-destaque'>O trecho <strong>" + esc(nomeTrecho(pior)) + "</strong> é onde o serviço mais perde tempo: " + minTxt(pior.perda_media, true) + " por viagem em média, e " + pctTxt(pior.perdeu) + " das passagens perderam mais de 5 min. Programado: " + num(pior.prog_medio, 0) + " min; realizado: " + num(pior.real_medio, 0) + " min.</p>");
      else corpo.insertAdjacentHTML("beforeend", "<p class='pt-destaque'>Nenhum trecho perde mais de 2 min por viagem em média neste período.</p>");
    }
    cascata(b1.querySelector(".pt-bloco-corpo"), par, rota, d.resumo.atraso_chegada);

    // mapa e trechos
    var duo = document.createElement("div");
    duo.className = "pt-duo pt-duo-mapa";
    c.appendChild(duo);
    var b2 = bloco("Rota", "Cada trecho na cor da perda média. Ligação em linha reta entre as paradas.");
    var b3 = bloco("Trechos da rota", "Na ordem da rota de referência. Tempo programado e realizado entre as duas paradas, em média.");
    duo.appendChild(b2); duo.appendChild(b3);
    mapaRota(b2.querySelector(".pt-bloco-corpo"), par, rota);
    tabela(b3.querySelector(".pt-bloco-corpo"), [
      { k: "ordem", rot: "Trecho", html: function (t) { return nomeTrechoHtml(t); }, ord: function (t) { return -(d.secoes.indexOf(t)); } },
      { k: "perda_media", rot: "Perda média", num: true, html: function (t) { return barraValor(t.perda_media, 20); } },
      { k: "prog_medio", rot: "Prog.", num: true, html: function (t) { return num(t.prog_medio, 0); }, dica: "Minutos programados entre as duas paradas." },
      { k: "real_medio", rot: "Real.", num: true, html: function (t) { return num(t.real_medio, 0); }, dica: "Minutos realizados entre as duas paradas (horas reais registradas)." },
      { k: "perdeu", rot: "> 5 min", num: true, html: function (t) { return pctTxt(t.perdeu); }, dica: "Passagens que perderam mais de 5 min no trecho." },
      { k: "com_registro", rot: "Pass.", num: true, dica: "Passagens com hora registrada nas duas pontas." },
      { k: "sem_registro", rot: "Sem reg.", num: true, html: function (t) { return pctTxt(t.sem_registro); }, dica: "Passagens sem hora real na parada de chegada do trecho." }
    ], d.secoes.filter(function (t) { return t.na_rota; }), "ordem");
    var outros = d.secoes.filter(function (t) { return !t.na_rota; });
    if (outros.length) b3.querySelector(".pt-bloco-corpo").insertAdjacentHTML("beforeend", "<p class='atalhos'>Outros trechos desta linha, fora da rota de referência: " + outros.map(function (t) { return esc(t.a + " → " + t.b) + " (" + t.passagens + ")"; }).join(", ") + ".</p>");

    // horários e dias
    var duo2 = document.createElement("div");
    duo2.className = "pt-duo";
    c.appendChild(duo2);
    var b4 = bloco("Por horário do serviço", "Atraso médio na chegada de cada horário de saída da origem.");
    var b5 = bloco("Por dia", "Atraso médio na chegada. A linha verde marca a tolerância de 30 min na chegada.");
    duo2.appendChild(b4); duo2.appendChild(b5);
    barrasHorarios(b4.querySelector(".pt-bloco-corpo"), d.horarios || []);
    graficoDias(b5.querySelector(".pt-bloco-corpo"), d.dias);

    // linha do tempo de um dia
    renderExecucao(c, d.execucao, true);

    if (d.diagrama) {
      var b6 = bloco("Linha do tempo do dia", "Horário (na horizontal) por parada (na vertical). Tracejado: programado; linha cheia: realizado, na cor do atraso ao chegar em cada parada. Quanto mais a linha cheia se afasta da tracejada, maior o atraso.", "pt-bloco-marey");
      c.appendChild(b6);
      var corpo6 = b6.querySelector(".pt-bloco-corpo");
      var dias = d.dias_disponiveis || [];
      corpo6.insertAdjacentHTML("beforeend", "<div class='pt-marey-topo'><label>Dia <select id='f-dia'>" + dias.map(function (x) {
        return "<option value='" + x + "'" + (x === d.diagrama.dia ? " selected" : "") + ">" + semana(x) + " " + diaBR(x, true) + "</option>";
      }).join("") + "</select></label>" + legendaFaixas() + "</div>");
      $("#f-dia").addEventListener("change", function () { filtro.dia = this.value; carregar(); });
      marey(corpo6, d.diagrama);
    }
  }

  function legendaFaixas() {
    return "<ul class='pt-legenda'><li><svg width='26' height='8' aria-hidden='true'><line x1='0' y1='4' x2='26' y2='4' stroke='#8A96A3' stroke-width='2' stroke-dasharray='5 4'/></svg>programado</li>" +
      FAIXAS.filter(function (f) { return f.k !== "sem"; }).map(function (f) { return "<li><span class='pt-amostra' style='background:" + f.cor + "'></span>" + f.rot + "</li>"; }).join("") + "</ul>";
  }

  // ---------------------------------------------------------------- cascata (onde o atraso nasce)
  function cascata(pai, paradas, rota, chegada) {
    if (!paradas.length) { pai.insertAdjacentHTML("beforeend", "<p class='pt-vazio'>Sem rota de referência para esta linha no período.</p>"); return; }
    var box = document.createElement("div");
    box.className = "pt-grafico";
    pai.appendChild(box);
    var saida = paradas[0].atraso_medio || 0;
    var passos = [{ rot: paradas[0].sigla, sub: "saída", de: 0, ate: saida, tipo: "base", dica: dicaTxt("Saída de " + paradas[0].sigla + (paradas[0].nome ? " (" + paradas[0].nome + ")" : ""), ["Atraso médio na saída: " + minTxt(paradas[0].atraso_medio, true), paradas[0].registros + " registros"]) }];
    var acum = saida;
    rota.forEach(function (t) {
      var v = t.perda_media;
      passos.push({ rot: t.b, sub: "", de: acum, ate: acum + (v || 0), tipo: v == null ? "sem" : v >= 0 ? "perde" : "ganha", valor: v,
        dica: dicaTxt(t.a + " → " + t.b + " (" + (t.nome_a || t.a) + " → " + (t.nome_b || t.b) + ")", [
          v == null ? "Sem passagens com as duas pontas registradas" : (v >= 0 ? "Perde " : "Recupera ") + minTxt(Math.abs(v)) + " em média",
          "Programado " + num(t.prog_medio, 0) + " min · realizado " + num(t.real_medio, 0) + " min",
          "Perderam mais de 5 min: " + pctTxt(t.perdeu), t.com_registro + " passagens registradas · sem registro na chegada: " + pctTxt(t.sem_registro),
          t.pior ? "Pior caso: " + minTxt(t.pior.perda, true) + " em " + diaBR(t.pior.dia) + ", saída " + t.pior.horario + ", carro " + (t.pior.veiculo || "-") : ""].filter(Boolean)) });
      acum += v || 0;
    });
    if (chegada != null) passos.push({ rot: "chegada", sub: "média", de: 0, ate: chegada, tipo: "total", dica: dicaTxt("Chegada ao destino", ["Atraso médio na chegada: " + minTxt(chegada, true), "Pode diferir da soma dos trechos porque nem toda parada tem registro."]) });
    function desenhar() {
      box.innerHTML = "";
      var W = Math.max(300, box.clientWidth), H = 280, m = { t: 22, r: 10, b: 40, l: 44 };
      var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Atraso acumulado ao longo da rota" }, box);
      var vs = [0]; passos.forEach(function (p) { vs.push(p.de, p.ate); });
      var max = Math.max.apply(null, vs.concat([9])), min = Math.min.apply(null, vs);
      var passo = passoBonito(max - min, 5);
      max = Math.ceil(max / passo) * passo; min = Math.floor(min / passo) * passo;
      var y = function (v) { return m.t + (max - v) / (max - min || 1) * (H - m.t - m.b); };
      for (var g = min; g <= max + 1e-9; g += passo) {
        el("line", { x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), stroke: g === 0 ? "#B8C3CF" : GRADE, "stroke-width": 1 }, svg);
        texto(svg, m.l - 6, y(g) + 4, num(g, 0), { "text-anchor": "end", class: "pt-eixo" });
      }
      texto(svg, 4, m.t - 8, "min de atraso", { class: "pt-eixo" });
      var banda = (W - m.l - m.r) / passos.length, larg = Math.min(30, banda * 0.66);
      passos.forEach(function (p, i) {
        var cx = m.l + banda * (i + 0.5), ya = y(p.de), yb = y(p.ate), topo = Math.min(ya, yb), alt = Math.max(2, Math.abs(yb - ya));
        var cor = p.tipo === "perde" ? PERDE : p.tipo === "ganha" ? GANHA : p.tipo === "sem" ? "#C3CCD6" : NEUTRO;
        el("rect", { x: cx - larg / 2, y: topo, width: larg, height: alt, rx: 3, fill: cor }, svg);
        if (i < passos.length - 1 && passos[i + 1].tipo !== "total") el("line", { x1: cx + larg / 2, x2: cx + banda - larg / 2, y1: yb, y2: yb, stroke: "#9AA6B2", "stroke-width": 1 }, svg);
        var mostraValor = p.tipo === "base" || p.tipo === "total" || (p.valor != null && Math.abs(p.valor) >= 2);
        if (mostraValor) {
          var v = p.tipo === "base" || p.tipo === "total" ? p.ate : p.valor;
          texto(svg, cx, topo - 5, (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) >= 60 ? horasMin(v) : num(Math.abs(v), 0)), { "text-anchor": "middle", class: "pt-valor" });
        }
        var mostraRot = banda >= 30 || i % Math.ceil(30 / banda) === 0 || p.tipo === "total";
        if (mostraRot) {
          texto(svg, cx, H - m.b + 16, p.rot, { "text-anchor": "middle", class: "pt-eixo pt-forte" });
          if (p.sub) texto(svg, cx, H - m.b + 30, p.sub, { "text-anchor": "middle", class: "pt-eixo" });
        }
        el("rect", { x: cx - banda / 2, y: m.t, width: banda, height: H - m.t - m.b, fill: "transparent", "data-dica": p.dica, tabindex: 0 }, svg);
      });
    }
    desenhar();
    redesenhar.push(desenhar);
  }

  // ---------------------------------------------------------------- barras por horário
  function barrasHorarios(pai, hs) {
    if (!hs.length) { pai.innerHTML = "<p class='pt-vazio'>Sem horários com registro.</p>"; return; }
    var max = Math.max(9, Math.max.apply(null, hs.map(function (h) { return Math.abs(h.atraso_chegada || 0); })));
    pai.insertAdjacentHTML("beforeend", "<ol class='pt-horarios'>" + hs.map(function (h) {
      var v = h.atraso_chegada, f = faixa(v == null ? null : Math.floor(v), TOL_TRECHO);
      var w = v == null ? 0 : Math.max(1, Math.abs(v) / max * 100);
      var dica = dicaTxt("Saída às " + h.horario, ["Atraso médio na saída: " + minTxt(h.atraso_partida, true), "Atraso médio na chegada: " + minTxt(v, true), "No horário: " + pctTxt(h.pontual), h.com_chegada + " de " + h.servicos + " serviços com chegada registrada"]);
      return "<li tabindex='0' data-dica='" + esc(dica) + "'><span class='pt-h'>" + esc(h.horario) + "</span><span class='pt-barra pt-barra-h'><span style='width:" + w + "%;background:" + COR[f] + "'></span></span>" +
        "<span class='pt-hv'>" + (v == null ? "sem chegada" : minTxt(v, true)) + "</span><span class='pt-hn'>" + h.servicos + " serv.</span></li>";
    }).join("") + "</ol>");
  }

  // ---------------------------------------------------------------- mapa da rota
  function mapaRota(pai, paradas, rota) {
    var pts = paradas.filter(function (p) { return p.lat != null && p.lon != null; });
    if (pts.length < 2) { pai.insertAdjacentHTML("beforeend", "<p class='pt-vazio'>As paradas desta linha não têm coordenadas no cadastro de localidades.</p>"); return; }
    var div = document.createElement("div");
    div.className = "pt-mapa";
    pai.appendChild(div);
    var m = L.map(div, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>" }).addTo(m);
    var pos = {};
    pts.forEach(function (p) { pos[p.sigla] = [p.lat, p.lon]; });
    rota.forEach(function (t) {
      if (!pos[t.a] || !pos[t.b]) return;
      L.polyline([pos[t.a], pos[t.b]], { color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(m);
      L.polyline([pos[t.a], pos[t.b]], { color: corPerda(t.perda_media), weight: 5, opacity: 1 }).addTo(m)
        .bindTooltip("<strong>" + esc(t.a) + " → " + esc(t.b) + "</strong><br>" + (t.perda_media == null ? "sem registro" : (t.perda_media >= 0 ? "perde " : "recupera ") + minTxt(Math.abs(t.perda_media)) + " em média"), { sticky: true });
    });
    pts.forEach(function (p, i) {
      L.circleMarker([p.lat, p.lon], { radius: i === 0 || i === pts.length - 1 ? 7 : 5, color: "#1F2A37", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(m)
        .bindTooltip("<strong>" + esc(p.sigla) + "</strong> " + esc(p.nome) + "<br>atraso médio " + minTxt(p.atraso_medio, true), { direction: "top" });
    });
    m.fitBounds(L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; })).pad(0.12));
    pai.insertAdjacentHTML("beforeend", "<ul class='pt-legenda'>" + ESCALA_PERDA.map(function (e) { return "<li><span class='pt-amostra pt-amostra-linha' style='background:" + e.cor + "'></span>" + e.rot + "</li>"; }).join("") + "</ul>");
    redesenhar.push(function () { m.invalidateSize(); });
  }

  // ---------------------------------------------------------------- linha do tempo (horário x parada)
  // a primeira parada do serviço é a origem (tolerância 8:59); as demais, seções (30 min)
  function tolPonto(s, p) { return s.paradas[0] && p[0] === s.paradas[0][0] && p[1] === s.paradas[0][1] ? TOL_SAIDA : TOL_TRECHO; }
  function marey(pai, dg) {
    var eixo = dg.eixo || [], servs = dg.servicos || [];
    if (!eixo.length || !servs.length) { pai.insertAdjacentHTML("beforeend", "<p class='pt-vazio'>Sem serviços neste dia.</p>"); return; }
    var box = document.createElement("div");
    box.className = "pt-grafico";
    pai.appendChild(box);
    var posY = {};
    eixo.forEach(function (e, i) { posY[e.sigla] = i; });
    var t0 = Infinity, t1 = -Infinity;
    servs.forEach(function (s) { s.paradas.forEach(function (p) { if (posY[p[0]] == null) return; [p[1], p[2]].forEach(function (t) { if (t != null) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); } }); }); });
    var H1 = 3600000;
    t0 = Math.floor(t0 / H1) * H1; t1 = Math.ceil(t1 / H1) * H1;
    function desenhar() {
      box.innerHTML = "";
      var W = Math.max(520, box.clientWidth), m = { t: 16, r: 14, b: 28, l: 64 };
      var maxMin = eixo[eixo.length - 1].min || 1;
      var H = Math.max(240, Math.min(560, eixo.length * 42)) + m.t + m.b;
      var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Linha do tempo dos serviços do dia por parada" }, box);
      var x = function (t) { return m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r); };
      var yS = function (sig) { return m.t + eixo[posY[sig]].min / maxMin * (H - m.t - m.b); };
      var horas = (t1 - t0) / H1, cada = horas > 16 ? 2 : 1;
      for (var t = t0, k = 0; t <= t1; t += H1, k++) {
        el("line", { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, stroke: GRADE, "stroke-width": 1 }, svg);
        if (k % cada === 0) texto(svg, x(t), H - m.b + 16, hora(t), { "text-anchor": "middle", class: "pt-eixo" });
      }
      eixo.forEach(function (e) {
        el("line", { x1: m.l, x2: W - m.r, y1: yS(e.sigla), y2: yS(e.sigla), stroke: "#EEF2F6", "stroke-width": 1 }, svg);
        var tx = texto(svg, m.l - 8, yS(e.sigla) + 4, e.sigla, { "text-anchor": "end", class: "pt-eixo pt-forte" });
        tx.appendChild(el("title", {})).textContent = e.nome;
      });
      servs.forEach(function (s) {
        var ps = s.paradas.filter(function (p) { return posY[p[0]] != null; });
        if (ps.length < 2) return;
        var g = el("g", {}, svg);
        el("path", { d: ps.map(function (p, i) { return (i ? "L" : "M") + x(p[1]).toFixed(1) + "," + yS(p[0]).toFixed(1); }).join(""), fill: "none", stroke: "#8A96A3", "stroke-width": 1.4, "stroke-dasharray": "5 4" }, g);
        var reais = ps.filter(function (p) { return p[2] != null; });
        for (var i = 1; i < reais.length; i++) {
          var a = reais[i - 1], b = reais[i];
          el("line", { x1: x(a[2]), y1: yS(a[0]), x2: x(b[2]), y2: yS(b[0]), stroke: COR[faixa(b[3], tolPonto(s, b))], "stroke-width": 2.5, "stroke-linecap": "round" }, g);
        }
        reais.forEach(function (p) { el("circle", { cx: x(p[2]), cy: yS(p[0]), r: 4, fill: COR[faixa(p[3], tolPonto(s, p))], stroke: "#fff", "stroke-width": 2 }, g); });
        var ult = reais[reais.length - 1];
        var linhas = ["Carro " + (s.veiculo || "-") + " · saída prevista " + hora(ps[0][1]),
          reais.length ? "Última parada registrada: " + ult[0] + " às " + hora(ult[2]) + " (" + (ult[3] == null ? "sem atraso calculado" : minTxt(ult[3], true)) + ")" : "Sem horários registrados",
          reais.length + " de " + ps.length + " paradas registradas"];
        var alvo = reais.length > 1 ? reais : ps;
        el("path", { d: alvo.map(function (p, i) { return (i ? "L" : "M") + x(p[2] != null ? p[2] : p[1]).toFixed(1) + "," + yS(p[0]).toFixed(1); }).join(""), fill: "none", stroke: "transparent", "stroke-width": 12, "pointer-events": "stroke", "data-dica": dicaTxt("Serviço " + s.servico, linhas) }, g);
      });
      if (dg.agora > t0 && dg.agora < t1) {
        el("line", { x1: x(dg.agora), x2: x(dg.agora), y1: m.t - 6, y2: H - m.b, stroke: SERIE, "stroke-width": 1.5 }, svg);
        texto(svg, x(dg.agora) + 4, m.t - 4, "agora", { class: "pt-eixo pt-agora" });
      }
    }
    desenhar();
    redesenhar.push(desenhar);
  }

  carregar();
}).catch(function (e) {
  console.error(e);
  var c = document.getElementById("pt-conteudo");
  if (c) c.innerHTML = "<p class='pt-vazio'>Não foi possível carregar os dados da demonstração (" + String(e.message || e) + ").</p>";
});

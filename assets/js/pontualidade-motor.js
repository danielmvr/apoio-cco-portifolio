/* Motor de pontualidade: versão em JavaScript da lógica que, no sistema original, roda no servidor
 * (historico/pontualidade.py). Lê o arquivo de atrasos (uma linha por parada comercial de cada serviço,
 * com horário programado e real), calcula a situação de cada carro agora e a análise de um período.
 *
 * Regras (as mesmas do sistema original):
 * - atraso de uma parada = tempo_atraso do arquivo; sem ele, (hora real - programada) em minutos inteiros
 *   (8:59 = 8), com hora real = partida (ou a chegada, quando não há partida);
 * - tolerância: na saída da origem, até 8:59 (9 min ou mais é atraso); nas demais paradas (seções) e na
 *   chegada, até 30 min;
 * - parada sem hora real e com o horário programado já passado há mais que a tolerância (até 2 h): atraso
 *   provisório = minutos desde o horário programado (o carro ainda não chegou);
 * - faixas: adiantado (mais de 9 min antes), pontual (dentro da tolerância), leve (até 20 min, só na saída),
 *   atrasado (até 45 min), grave (acima de 45 min) e sem (sem registro);
 * - serviço em andamento: já registrou alguma parada, ainda não registrou a última e o fim previsto (mais o
 *   atraso) passou há menos de 3 h; sem nenhuma parada registrada e com a saída prevista passada da
 *   tolerância (até 2 h), conta como saída atrasada.
 * A parte que vinha da execução dos serviços (execucao.XLS) não existe nesta versão: a demonstração só tem o
 * arquivo de atrasos. Lógica pura: sem DOM, sem rede. */
window.Pontualidade = (function () {
  "use strict";

  var TOL_SAIDA = 8, TOL_TRECHO = 30, ADIANTADO = 9, PROV_MAX = 120, ATRASO_MAX = 720, MIN_PASSAGENS = 3;
  var MIN = 60000, H = 3600000;
  var RECENTE = 3 * H, FIM_MARGEM = 3 * H, REGISTRO_MAX = 12 * H;
  var FAIXAS = ["adiantado", "pontual", "leve", "atrasado", "grave", "escala", "sem"];

  function faixa(minutos, tol) {
    tol = tol == null ? TOL_SAIDA : tol;
    if (minutos == null) return "sem";
    if (minutos < -ADIANTADO) return "adiantado";
    if (minutos <= tol) return "pontual";
    if (minutos <= 20) return "leve";
    if (minutos <= 45) return "atrasado";
    return "grave";
  }
  function minInteiros(a, b) { return Math.floor((a - b) / MIN); }   // 8:59 = 8, -0:30 = -1
  function tolParada(i) { return i === 0 ? TOL_SAIDA : TOL_TRECHO; }
  function d2(n) { return (n < 10 ? "0" : "") + n; }
  function hm(ms) { var d = new Date(ms); return d2(d.getHours()) + ":" + d2(d.getMinutes()); }
  function isoDia(d) { return d.getFullYear() + "-" + d2(d.getMonth() + 1) + "-" + d2(d.getDate()); }
  function diaDe(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function somaDias(iso, n) { var d = diaDe(iso); d.setDate(d.getDate() + n); return isoDia(d); }

  // ---------------------------------------------------------------- leitura do arquivo de atrasos
  function dataHora(t) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec((t || "").trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : null;
  }
  function inteiro(t) { t = (t || "").trim(); if (!/^-?\d+$/.test(t)) return null; return parseInt(t, 10); }

  // Texto do arquivo (tabulado, 19 colunas) -> serviços: {dtoper, servico, linha, descricao, veiculo, tol, paradas}
  // com paradas = [[sigla, prog_ms, real_ms|null, atraso_arquivo|null], ...] em ordem de horário programado.
  function lerServicos(texto) {
    var linhas = texto.split(/\r?\n/), cab = (linhas[0] || "").split("\t").map(function (c) { return c.trim(); });
    var idx = {};
    cab.forEach(function (c, i) { idx[c] = i; });
    var col = function (c, nome) { var i = idx[nome]; return i == null || i >= c.length ? "" : c[i]; };
    var por = {}, ordem = [];
    for (var n = 1; n < linhas.length; n++) {
      if (!linhas[n].trim()) continue;
      var c = linhas[n].split("\t");
      if (col(c, "frota_veiculo") === "DUPLICADO") continue;
      var dt = dataHora(col(c, "dtoper")), prog = dataHora(col(c, "horario_comercial"));
      var servico = col(c, "servico").trim(), local = col(c, "local_comercial").trim();
      if (dt == null || prog == null || !servico || !local) continue;
      var dtoper = isoDia(new Date(dt));
      var chave = dtoper + "|" + servico;
      var s = por[chave];
      if (!s) {
        var tol = inteiro(col(c, "tempo_tolerancia"));
        s = por[chave] = { dtoper: dtoper, servico: servico, linha: col(c, "codigo_linha").trim(), descricao: col(c, "descricao_linha").trim(),
          veiculo: col(c, "prefixo_veiculo").trim(), tol: tol != null ? tol : TOL_SAIDA + 1, paradas: [] };
        ordem.push(s);
      }
      if (!s.veiculo) s.veiculo = col(c, "prefixo_veiculo").trim();
      var partida = dataHora(col(c, "horario_partida_comercial_real")), entrada = dataHora(col(c, "horario_entrada_comercial_real"));
      s.paradas.push([local, prog, partida != null ? partida : entrada, inteiro(col(c, "tempo_atraso"))]);
    }
    ordem.forEach(function (s) { s.paradas.sort(function (a, b) { return a[1] - b[1]; }); });
    ordem.sort(function (a, b) { return a.dtoper < b.dtoper ? -1 : a.dtoper > b.dtoper ? 1 : a.servico < b.servico ? -1 : a.servico > b.servico ? 1 : 0; });
    return ordem;
  }

  // ---------------------------------------------------------------- situação de uma parada / de um serviço
  function atrasoRegistrado(prog, real, atr) {
    if (real == null) return null;
    var a = atr != null ? atr : minInteiros(real, prog);
    return a >= -120 && a <= ATRASO_MAX ? a : null;
  }
  // -> [feito, real, atraso, provisorio]
  function situacao(p, agora, tol) {
    var prog = p[1], real = p[2], atr = p[3];
    if (real != null && real <= agora) return [true, real, atrasoRegistrado(prog, real, atr), false];
    var espera = minInteiros(agora, prog);
    if (tol < espera && espera <= PROV_MAX) return [false, null, espera, true];
    return [false, null, null, false];
  }

  function resumoServico(s, agora) {
    var st = s.paradas.map(function (p, i) { return situacao(p, agora, tolParada(i)); });
    var ult = -1;
    st.forEach(function (x, i) { if (x[0]) ult = i; });
    var total = s.paradas.length;
    var prox = ult + 1 < total ? s.paradas[ult + 1] : null;
    var sp = prox ? st[ult + 1] : null;
    var atraso = sp && sp[3] ? sp[2] : (ult >= 0 ? st[ult][2] : null);
    var emCurso;
    if (ult < 0) emCurso = !!(sp && sp[3]);
    else if (ult + 1 < total) {
      var fim = s.paradas[total - 1][1] + Math.max(0, st[ult][2] || 0) * MIN + FIM_MARGEM;
      emCurso = agora <= fim && agora - st[ult][1] <= REGISTRO_MAX;
    } else emCurso = false;
    var tol = tolParada(sp && sp[3] ? ult + 1 : Math.max(ult, 0));
    return { ultima: ult >= 0 ? [s.paradas[ult], st[ult]] : null, proxima: prox ? [prox, sp] : null, total: total, feitas: ult + 1,
      atraso: atraso, provisorio: !!(sp && sp[3]), tol: tol, emCurso: emCurso, saidaAtrasada: ult < 0 && emCurso, ultimoReal: ult >= 0 ? st[ult][1] : null };
  }

  // ---------------------------------------------------------------- situação agora (cor dos ônibus, "Atrasados agora")
  // servicos: os do dia de hoje e de ontem; localidades: {sigla: {nome, cidade}}; garagens: lista de nomes de localidade.
  function statusAgora(servicos, agora, localidades, garagens) {
    var hoje = isoDia(new Date(agora)), ontem = somaDias(hoje, -1);
    var porCarro = {};
    servicos.forEach(function (s) {
      if (s.veiculo && (s.dtoper === hoje || s.dtoper === ontem)) (porCarro[s.veiculo] = porCarro[s.veiculo] || []).push(s);
    });
    function nome(sig) { var l = localidades[sig]; return l ? (l.cidade || l.nome || "") : ""; }
    function ponto(sig, prog, real, atraso) {
      var d = { sigla: sig, nome: nome(sig), prog: prog };
      if (real !== undefined || atraso !== undefined) { d.real = real == null ? null : real; d.atraso = atraso == null ? null : atraso; }
      return d;
    }
    var veiculos = {}, ranking = [], contagem = {};
    FAIXAS.forEach(function (f) { contagem[f] = 0; });
    Object.keys(porCarro).forEach(function (vei) {
      // prefere o serviço em andamento; entre eles, o de registro mais recente
      var atr = null;
      porCarro[vei].forEach(function (s) {
        var r = resumoServico(s, agora);
        if (!r.emCurso) return;
        var novo = r.ultimoReal || s.paradas[0][1], atual = atr ? (atr[1].ultimoReal || atr[0].paradas[0][1]) : null;
        if (atr === null || novo > atual) atr = [s, r];
      });
      if (!atr) return;
      var s = atr[0], r = atr[1], u = r.ultima, pr = r.proxima;
      var d = { fonte: "atrasos", proximo_servico: null, servico: s.servico, linha: s.linha, descricao: s.descricao, tipo: "", tol: r.tol,
        atraso: r.atraso, faixa: faixa(r.atraso, r.tol), provisorio: r.provisorio, saida_atrasada: r.saidaAtrasada,
        ultima: u ? ponto(u[0][0], u[0][1], u[1][1], u[1][2]) : null,
        proxima: pr ? ponto(pr[0][0], pr[0][1]) : null,
        destino: ponto(s.paradas[s.paradas.length - 1][0], s.paradas[s.paradas.length - 1][1]), feitas: r.feitas, total: r.total };
      contagem[d.faixa]++;
      veiculos[vei] = d;
      if (d.atraso != null && d.faixa !== "sem" && d.faixa !== "escala") ranking.push(vei);
    });
    ranking.sort(function (a, b) { return veiculos[b].atraso - veiculos[a].atraso; });
    return { agora: agora, veiculos: veiculos, ranking: ranking, contagem: contagem, garagens: garagens || [] };
  }

  // ---------------------------------------------------------------- análise do período
  function media(v, casas) {
    if (!v.length) return null;
    var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length, f = Math.pow(10, casas == null ? 1 : casas);
    return Math.round(m * f) / f;
  }
  function pct(n, d) { return d ? Math.round(100 * n / d) : null; }
  function soma(v) { return v.reduce(function (a, b) { return a + b; }, 0); }
  function quantil(xs, p) {   // quantis "inclusive" (interpolação linear entre os valores ordenados)
    var pos = (xs.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  }

  // Retirada de outliers por grupo (Tukey): sai o que fica fora de [Q1 - 1,5 IQR, Q3 + 1,5 IQR]. Grupos com menos de
  // 4 valores, ou com IQR zero, ficam como estão. Conta o que saiu por rótulo.
  function Outliers(ligado) {
    this.ligado = !!ligado;
    this.cont = {};
  }
  Outliers.prototype.filtrar = function (valores, rotulo, chave) {
    var filtrados = valores;
    if (this.ligado && valores.length >= 4) {
      var xs = valores.map(function (v) { return chave ? chave(v) : v; }).sort(function (a, b) { return a - b; });
      var q1 = quantil(xs, 0.25), q3 = quantil(xs, 0.75), iqr = q3 - q1;
      if (iqr > 0) {
        var lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
        filtrados = valores.filter(function (v) { var x = chave ? chave(v) : v; return lo <= x && x <= hi; });
      }
    }
    if (rotulo) {
      var c = this.cont[rotulo] = this.cont[rotulo] || [0, 0];
      c[0] += valores.length - filtrados.length;
      c[1] += valores.length;
    }
    return filtrados;
  };
  Outliers.prototype.resumo = function () {
    var r = { ligado: this.ligado }, self = this;
    Object.keys(this.cont).forEach(function (k) { var c = self.cont[k]; r[k] = { retirados: c[0], total: c[1], pct: c[1] ? Math.round(1000 * c[0] / c[1]) / 10 : 0 }; });
    return r;
  };

  function estatisticaServico(s, agora) {
    var pts = [];
    s.paradas.forEach(function (p) {
      if (p[1] > agora) return;
      pts.push([p[0], p[1], p[2], p[2] != null ? atrasoRegistrado(p[1], p[2], p[3]) : null]);
    });
    return pts;
  }

  function linhasPeriodo(servicos, de, ate) {
    var cont = {}, nomes = {};
    servicos.forEach(function (s) {
      if (s.dtoper < de || s.dtoper > ate) return;
      (cont[s.linha] = cont[s.linha] || {})[s.dtoper + "|" + s.servico] = true;
      nomes[s.linha] = s.descricao;
    });
    return Object.keys(cont).map(function (l) { return { linha: l, descricao: nomes[l] || l, servicos: Object.keys(cont[l]).length }; })
      .sort(function (a, b) { return a.descricao.localeCompare(b.descricao, "pt-BR"); });
  }

  function periodoPadrao(datas) {
    if (!datas.length) { var h = isoDia(new Date()); return [somaDias(h, -6), h]; }
    var ate = datas[datas.length - 1], de = somaDias(ate, -6);
    if (de < datas[0]) de = datas[0];
    return [de, ate];
  }

  function piorDe(perdas) {
    var pior = null;
    perdas.forEach(function (t) { if (!pior || t[0] > pior[0]) pior = t; });
    return pior ? { perda: pior[0], dia: pior[1], servico: pior[2], veiculo: pior[3], horario: hm(pior[4]) } : null;
  }

  // servicos: todos os já lidos (a função filtra o período e a linha); de/ate: "AAAA-MM-DD"; dia: dia do diagrama (uma linha).
  function analise(servicos, de, ate, linha, dia, agora, semOutliers, localidades) {
    var filt = new Outliers(semOutliers);
    var lista = servicos.filter(function (s) { return s.dtoper >= de && s.dtoper <= ate && (!linha || s.linha === linha); });
    function novoTrecho() { return { perdas: [], chegadas: [], prog: [], real: [], sem: 0, total: 0, linhas: {} }; }
    var secoes = {}, sl = {}, porLinha = {}, porHora = {}, porHorario = {}, porDia = {}, porParada = {}, sequencias = {};
    var siglas = {}, diasLinha = {}, tot = { servicos: 0, paradas: 0, sem_registro: 0 };

    lista.forEach(function (s) {
      var pts = estatisticaServico(s, agora);
      if (pts.length < 2) return;
      pts.forEach(function (p) { siglas[p[0]] = true; });
      tot.servicos++;
      diasLinha[s.dtoper] = true;
      if (linha) { var seqK = s.paradas.map(function (p) { return p[0]; }).join(">"); sequencias[seqK] = (sequencias[seqK] || 0) + 1; }
      pts.forEach(function (p) {
        tot.paradas++;
        var pp = porParada[p[0]] = porParada[p[0]] || { atrasos: [], sem: 0, total: 0 };
        pp.total++;
        if (p[3] == null) { tot.sem_registro++; pp.sem++; } else pp.atrasos.push(p[3]);
      });
      var ori = pts[0], fim = s.paradas[s.paradas.length - 1], ultP = pts[pts.length - 1];
      var chegada = ultP[0] === fim[0] && ultP[1] === fim[1] ? ultP[3] : null;
      var partida = ori[3];
      var L = porLinha[s.linha] = porLinha[s.linha] || { servicos: 0, chegadas: [], partidas: [], ganhos: [], descricao: "" };
      L.servicos++;
      L.descricao = s.descricao;
      if (partida != null) L.partidas.push(partida);
      var hora = new Date(ori[1]);
      var Hk = hm(ori[1]), Hh = porHorario[Hk] = porHorario[Hk] || { chegadas: [], partidas: [], n: 0 };
      Hh.n++;
      if (partida != null) Hh.partidas.push(partida);
      var D = porDia[s.dtoper] = porDia[s.dtoper] || { chegadas: [], servicos: 0 };
      D.servicos++;
      if (chegada != null) {
        L.chegadas.push(chegada);
        (porHora[hora.getHours()] = porHora[hora.getHours()] || []).push(chegada);
        Hh.chegadas.push(chegada);
        D.chegadas.push(chegada);
        if (partida != null) L.ganhos.push(chegada - partida);
      }
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        if (a[0] === b[0]) continue;
        var progMin = (b[1] - a[1]) / MIN;
        var perda = b[3] != null && a[3] != null ? [b[3] - a[3], s.dtoper, s.servico, s.veiculo, a[1]] : null;
        var realMin = perda && a[2] != null && b[2] != null ? (b[2] - a[2]) / MIN : null;
        var alvos = [secoes[(linha ? s.linha : "") + "|" + a[0] + "|" + b[0]] = secoes[(linha ? s.linha : "") + "|" + a[0] + "|" + b[0]] || novoTrecho()];
        if (!linha) alvos.push(sl[s.linha + "|" + a[0] + "|" + b[0]] = sl[s.linha + "|" + a[0] + "|" + b[0]] || novoTrecho());
        alvos.forEach(function (S) {
          S.total++;
          S.linhas[s.linha] = true;
          S.prog.push(progMin);
          if (b[3] == null) { S.sem++; return; }
          S.chegadas.push(b[3]);
          if (perda) { S.perdas.push(perda); if (realMin != null) S.real.push(realMin); }
        });
      }
    });

    function nome(sig) { var l = localidades[sig]; return l ? (l.cidade || l.nome || "") : ""; }
    function trecho(k, S, contar) {
      var ks = k.split("|");
      var perdas = filt.filtrar(S.perdas, contar ? "perdas" : null, function (t) { return t[0]; });
      var vals = perdas.map(function (t) { return t[0]; });
      return { a: ks[1], b: ks[2], nome_a: nome(ks[1]), nome_b: nome(ks[2]), linha: ks[0],
        passagens: S.total, com_registro: vals.length,
        perda_media: media(vals), perda_total: Math.round(soma(vals.filter(function (p) { return p > 0; }))),
        perdeu: pct(vals.filter(function (p) { return p > 5; }).length, vals.length),
        chegada_media: media(filt.filtrar(S.chegadas)),
        prog_medio: media(S.prog, 0), real_medio: media(filt.filtrar(S.real), 0),
        sem_registro: pct(S.sem, S.total), linhas: Object.keys(S.linhas).length, pior: piorDe(perdas) };
    }

    var linhasRes = {}, todasCh = [], todasPa = [];
    Object.keys(porLinha).forEach(function (lin) {
      var L = porLinha[lin], ch = filt.filtrar(L.chegadas, "chegadas"), pa = filt.filtrar(L.partidas);
      todasCh = todasCh.concat(ch); todasPa = todasPa.concat(pa);
      linhasRes[lin] = { linha: lin, descricao: L.descricao, servicos: L.servicos, com_chegada: ch.length,
        atraso_chegada: media(ch), atraso_partida: media(pa), ganho_trajeto: media(filt.filtrar(L.ganhos)),
        pontual_chegada: pct(ch.filter(function (c) { return c <= TOL_TRECHO; }).length, ch.length),
        pontual_saida: pct(pa.filter(function (c) { return c <= TOL_SAIDA; }).length, pa.length) };
    });
    var listaSecoes = Object.keys(secoes).map(function (k) { return trecho(k, secoes[k], true); });
    var resumo = { servicos: tot.servicos, com_chegada: todasCh.length,
      pontual_chegada: pct(todasCh.filter(function (c) { return c <= TOL_TRECHO; }).length, todasCh.length),
      pontual_saida: pct(todasPa.filter(function (c) { return c <= TOL_SAIDA; }).length, todasPa.length),
      atraso_chegada: media(todasCh), atraso_partida: media(todasPa), sem_registro: pct(tot.sem_registro, tot.paradas) };
    var dias = Object.keys(porDia).sort().map(function (d) {
      var ch = filt.filtrar(porDia[d].chegadas);
      return { dia: d, servicos: porDia[d].servicos, com_chegada: ch.length, atraso_chegada: media(ch), pontual: pct(ch.filter(function (c) { return c <= TOL_TRECHO; }).length, ch.length) };
    });
    var horas = Object.keys(porHora).map(Number).sort(function (a, b) { return a - b; }).map(function (h) {
      var ch = filt.filtrar(porHora[h]);
      return { hora: h, servicos: ch.length, atraso_chegada: media(ch), pontual: pct(ch.filter(function (c) { return c <= TOL_TRECHO; }).length, ch.length) };
    });
    var saida = { de: de, ate: ate, linha: linha || null, resumo: resumo, dias: dias, horas: horas, tolerancias: { saida: TOL_SAIDA, trecho: TOL_TRECHO, adiantado: ADIANTADO } };

    if (!linha) {
      var porAb = {}, piorLinha = {}, detalhe = {};
      Object.keys(sl).forEach(function (k) { if (sl[k].perdas.length >= 1) { var ks = k.split("|"); (porAb[ks[1] + "|" + ks[2]] = porAb[ks[1] + "|" + ks[2]] || []).push(k); } });
      listaSecoes = listaSecoes.filter(function (t) { return t.com_registro >= MIN_PASSAGENS; }).sort(function (a, b) { return b.perda_total - a.perda_total; });
      var top = {};
      listaSecoes.slice(0, 60).forEach(function (t) { top[t.a + "|" + t.b] = true; });
      Object.keys(porAb).forEach(function (ab) {
        porAb[ab].forEach(function (k) {
          var r = trecho(k, sl[k]);
          if (r.com_registro >= MIN_PASSAGENS && r.perda_media != null && r.perda_media > 0) {
            var atual = piorLinha[r.linha];
            if (!atual || r.perda_media > atual.perda_media) piorLinha[r.linha] = { a: r.a, b: r.b, perda_media: r.perda_media };
          }
          if (top[ab]) { r.descricao = porLinha[r.linha] ? porLinha[r.linha].descricao : r.linha; (detalhe[ab] = detalhe[ab] || []).push(r); }
        });
      });
      listaSecoes.slice(0, 60).forEach(function (t) {
        var ls = (detalhe[t.a + "|" + t.b] || []).sort(function (x, y) { return (y.perda_total - x.perda_total) || ((y.perda_media || 0) - (x.perda_media || 0)); });
        var tot2 = soma(ls.map(function (r) { return r.perda_total; }));
        ls.forEach(function (r) { r.participacao = tot2 ? Math.round(100 * r.perda_total / tot2) : null; });
        t.detalhe_linhas = ls;
      });
      var linhasOut = Object.keys(linhasRes).map(function (lin) { var r = linhasRes[lin]; r.pior_trecho = piorLinha[lin] || null; return r; });
      linhasOut.sort(function (x, y) { return (y.atraso_chegada != null ? y.atraso_chegada : -999) - (x.atraso_chegada != null ? x.atraso_chegada : -999); });
      saida.linhas = linhasOut;
      saida.secoes = listaSecoes.slice(0, 60);
      saida.outliers = filt.resumo();
      return saida;
    }

    // ---- uma linha: rota de referência (sequência mais comum), perfil por parada, horários e diagrama do dia
    var melhor = null;
    Object.keys(sequencias).forEach(function (k) { if (!melhor || sequencias[k] > sequencias[melhor]) melhor = k; });
    var seq = melhor ? melhor.split(">") : [];
    seq = seq.filter(function (s, i) { return i === 0 || s !== seq[i - 1]; });
    var L0 = porLinha[linha] || { descricao: "" };
    saida.descricao = L0.descricao;
    saida.ganho_trajeto = (linhasRes[linha] || {}).ganho_trajeto;
    var idx = {};
    listaSecoes.forEach(function (t) { idx[t.a + "|" + t.b] = t; });
    var rota = [];
    for (var j = 1; j < seq.length; j++) {
      var t = idx[seq[j - 1] + "|" + seq[j]];
      if (t) { t.na_rota = true; rota.push(t); delete idx[seq[j - 1] + "|" + seq[j]]; }
    }
    var outros = Object.keys(idx).map(function (k) { return idx[k]; }).sort(function (a, b) { return b.passagens - a.passagens; });
    outros.forEach(function (t) { t.na_rota = false; });
    saida.secoes = rota.concat(outros);
    saida.paradas = seq.map(function (s) {
      var pp = porParada[s] || { atrasos: [], sem: 0, total: 0 }, at = filt.filtrar(pp.atrasos), l = localidades[s];
      return { sigla: s, nome: nome(s), lat: l ? l.lat : null, lon: l ? l.lon : null, atraso_medio: media(at), registros: at.length, sem_registro: pct(pp.sem, pp.total) };
    });
    saida.horarios = Object.keys(porHorario).sort().map(function (h) {
      var v = porHorario[h], ch = filt.filtrar(v.chegadas), pa = filt.filtrar(v.partidas);
      return { horario: h, servicos: v.n, com_chegada: ch.length, atraso_chegada: media(ch), atraso_partida: media(pa), pontual: pct(ch.filter(function (c) { return c <= TOL_TRECHO; }).length, ch.length) };
    });
    saida.outliers = filt.resumo();
    var diasDisp = Object.keys(diasLinha).sort();
    saida.dias_disponiveis = diasDisp;
    var d = dia && diasDisp.indexOf(dia) >= 0 ? dia : (diasDisp.length ? diasDisp[diasDisp.length - 1] : null);
    if (d) {
      var ofs = {};
      lista.forEach(function (s) {
        var ps = s.paradas;
        if (ps.length && ps[0][0] === seq[0]) ps.forEach(function (p) { (ofs[p[0]] = ofs[p[0]] || []).push((p[1] - ps[0][1]) / MIN); });
      });
      var eixo = [], ult = -1;
      seq.forEach(function (s) {
        var v = media(ofs[s] || [], 0);
        v = v != null && v > ult ? v : ult + 30;
        eixo.push({ sigla: s, nome: nome(s), min: v });
        ult = v;
      });
      var doDia = lista.filter(function (s) { return s.dtoper === d; }).map(function (s) {
        return { servico: s.servico, veiculo: s.veiculo, tol: s.tol, paradas: s.paradas.map(function (p) {
          var real = p[2] != null && p[2] <= agora ? p[2] : null;
          return [p[0], p[1], real, real != null ? atrasoRegistrado(p[1], p[2], p[3]) : null];
        }) };
      }).sort(function (x, y) { return (x.paradas[0][1] || 0) - (y.paradas[0][1] || 0); });
      saida.diagrama = { dia: d, eixo: eixo, servicos: doDia, agora: agora };
    }
    return saida;
  }

  return { TOL_SAIDA: TOL_SAIDA, TOL_TRECHO: TOL_TRECHO, faixa: faixa, lerServicos: lerServicos, resumoServico: resumoServico,
    statusAgora: statusAgora, analise: analise, linhasPeriodo: linhasPeriodo, periodoPadrao: periodoPadrao, isoDia: isoDia, somaDias: somaDias };
})();

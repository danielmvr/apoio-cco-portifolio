/* Camada de dados da versão estática (GitHub Pages) do Apoio CCO.
 *
 * No sistema original, o mapa consulta a API de um servidor Django (/api/locais/, /api/veiculos/ ...),
 * que lê o banco, baixa o CSV de posições e cruza as ocorrências. Aqui, sem servidor, cada rota vira
 * uma função que devolve uma Promise com o mesmo formato de resposta:
 *   - locais e contatos: data/locais.json (sintéticos, gerados por scripts/gerar_dados_sinteticos.py);
 *   - frota: CSV de últimas posições lido direto do repositório do Monitoramento de Rodovias
 *     (raw.githubusercontent.com), com a cópia em data/frota/ como reserva;
 *   - ocorrências: data/ocorrencias.json, com tempos relativos ao "agora" do snapshot da frota;
 *   - apoios fora do cadastro: Nominatim (OpenStreetMap) consultado pelo navegador, 1 pedido por segundo.
 * O relógio é simulado: começa no "agora" do snapshot e avança em tempo real, para os cronômetros correrem.
 */
window.ApoioDados = (function () {
  "use strict";

  var BASE = "data/";
  var FLUXO_RAW = "https://raw.githubusercontent.com/danielmvr/monitoramento-rodovias-portifolio/main/data/";
  var FLUXO_URL = "https://danielmvr.github.io/monitoramento-rodovias-portifolio/";
  var NOMINATIM = "https://nominatim.openstreetmap.org";
  var VEICULOS_INTERVALO_MIN = 10;
  var FORCAR_COOLDOWN_SEG = 30;
  var PREVISAO = { velocidade_kmh: 70, fator_rota: 1.3 };

  var estado = { camadas: [], locais: [], meta: null, ocorrencias: [], frota: null, frotaFonte: "", frotaErro: "", lidoEm: 0, relogio: null };

  // ---------------------------------------------------------------- relógio simulado
  function relogio() {
    if (!estado.relogio) {
      var s = (estado.frota && estado.frota.agora) || (estado.meta && estado.meta.frota && estado.meta.frota.agora_snapshot) || "2026-10-15T15:40:00";
      var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
      var base = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : Date.now();
      estado.relogio = { base: base, inicio: Date.now() };
    }
    return estado.relogio;
  }
  function agoraMs() { var r = relogio(); return r.base + (Date.now() - r.inicio); }
  function agora() { return new Date(agoraMs()); }

  function d2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtData(d) { return d ? d2(d.getDate()) + "/" + d2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + d2(d.getHours()) + ":" + d2(d.getMinutes()) : ""; }
  function parseData(texto) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec((texto || "").trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : null;
  }

  function getJson(url, opts) { return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function getTexto(url, opts) { return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }); }

  // ---------------------------------------------------------------- empresas
  var EMPRESAS = [];               // [{valor, nome, sufixo, cor}]
  function empresaPorValor(v) { return EMPRESAS.filter(function (e) { return e.valor === v; })[0]; }
  function empresaDoCarro(id, frota) {
    var suf = (String(id || "").split(".")[1] || "").charAt(0).toUpperCase();
    var e = EMPRESAS.filter(function (x) { return x.sufixo && x.sufixo === suf; })[0];
    if (e) return e.valor;
    var m = /FROTA-([A-Z]+)/i.exec(frota || "");
    return m ? m[1].toUpperCase() : "";
  }
  function corEmpresa(v) { var e = empresaPorValor(v); return e ? e.cor : "#607D8B"; }

  // ---------------------------------------------------------------- carga inicial
  var pronto = Promise.all([getJson(BASE + "camadas.json"), getJson(BASE + "locais.json"), getJson(BASE + "meta.json"), getJson(BASE + "ocorrencias.json")])
    .then(function (r) {
      estado.camadas = r[0]; estado.locais = r[1]; estado.meta = r[2]; estado.ocorrencias = r[3].lista || [];
      EMPRESAS = estado.meta.empresas || [];
      return config();
    });

  function config() {
    return {
      centro: [-20.3889, -47.1137], zoom: 6,
      podeEditar: false, podeAdmin: false, demo: true,
      veiculos: true, veiculosIntervaloMin: VEICULOS_INTERVALO_MIN,
      ocorrencias: true, fluxoUrl: FLUXO_URL, fluxoNome: "Monitoramento de Rodovias", ocorrenciasFonte: "Ocorrências sintéticas",
      socorroRaioKm: 200,
      apoiosOsm: true, apoiosOsmCategorias: OSM_CATEGORIAS.map(function (c) { return { id: c.id, rotulo: c.rotulo, cor: c.cor, sigla: c.sigla }; }),
      apoiosOsmRaios: [5, 15, 30, 60], apoiosOsmRaioPadrao: 15,
      camadas: estado.camadas.map(function (c) { return { id: c.id, nome: c.nome, slug: c.slug, cor: c.cor, rotulo: c.rotulo, tipo: c.tipo, visivel: c.visivel, total: c.total }; }),
      empresas: EMPRESAS.map(function (e) { return { valor: e.valor, nome: e.nome }; }),
      empresasVeiculos: EMPRESAS.filter(function (e) { return e.sufixo; }).map(function (e) { return { valor: e.valor, nome: e.nome, cor: e.cor }; }),
      meta: estado.meta,
    };
  }

  // ---------------------------------------------------------------- locais (equivalente a /api/locais/, /api/locais/<id>/ e /api/busca/)
  function locais(inativos) {
    return pronto.then(function () {
      var itens = estado.locais.filter(function (l) { return inativos || l.ativo; }).map(function (l) {
        var item = { id: l.id, n: l.nome, s: l.sigla, c: l.camada_id, ci: l.cidade, uf: l.uf, e: l.empresa, a: l.ativo, sv: l.servicos };
        if (l.cor) item.co = l.cor;
        if (l.poligono) item.pg = l.poligono; else { item.la = l.latitude; item.lo = l.longitude; }
        return item;
      });
      return { locais: itens, gerado_em: agora().toISOString() };
    });
  }

  function digitos(tel) {
    var d = String(tel || "").replace(/\D+/g, "");
    if (d.indexOf("55") === 0 && (d.length === 12 || d.length === 13)) d = d.slice(2);
    if (d.length === 11 && d[0] === "0") d = d.slice(1);
    return (d.length === 10 || d.length === 11) ? "55" + d : "";
  }

  function detalhe(id) {
    return pronto.then(function () {
      var l = estado.locais.filter(function (x) { return x.id === id; })[0];
      if (!l) throw new Error("404");
      var camada = estado.camadas.filter(function (c) { return c.id === l.camada_id; })[0] || {};
      var emp = empresaPorValor(l.empresa);
      return {
        id: l.id, nome: l.nome, sigla: l.sigla, camada: camada.nome || "", camada_id: l.camada_id,
        cor: l.cor || camada.cor, empresa: emp ? emp.nome : "",
        latitude: l.latitude, longitude: l.longitude, area: !!l.poligono,
        endereco: l.endereco, cidade: l.cidade, uf: l.uf, telefone: l.telefone,
        telefone_tel: l.telefone ? "tel:+" + digitos(l.telefone) : "",
        horario: l.horario, servicos: l.servicos, observacoes: l.observacoes, ativo: l.ativo,
        contatos: (l.contatos || []).map(function (c, i) {
          var d = digitos(c.telefone), celular = d.length === 13 && d[4] === "9";
          return { id: i + 1, nome: c.nome, funcao: c.funcao, telefone: c.telefone, tel: d ? "tel:+" + d : "", whatsapp: celular ? "https://wa.me/" + d : "", obs: c.obs };
        }),
        atualizado_em: l.atualizado_em, atualizado_por: l.atualizado_por, descricao_original: "",
      };
    });
  }

  function busca(q) {
    return pronto.then(function () {
      var ql = (q || "").trim().toLowerCase();
      if (ql.length < 2) return { resultados: [] };
      var out = [];
      estado.locais.forEach(function (l) {
        if (!l.ativo || out.length >= 25) return;
        var basico = (l.sigla + " " + l.nome + " " + l.cidade).toLowerCase();
        var motivo = "";
        if (basico.indexOf(ql) < 0 && (l.servicos || "").toLowerCase().indexOf(ql) < 0) {
          var c = (l.contatos || []).filter(function (x) { return (x.nome + " " + x.funcao).toLowerCase().indexOf(ql) >= 0; })[0];
          if (c) motivo = "contato: " + (c.funcao ? c.funcao + " " : "") + c.nome;
          else if ((l.observacoes || "").toLowerCase().indexOf(ql) >= 0) motivo = "observações";
          else return;
        }
        var camada = estado.camadas.filter(function (c) { return c.id === l.camada_id; })[0] || {};
        out.push({ id: l.id, nome: l.nome, sigla: l.sigla, camada: camada.nome, cor: camada.cor, cidade: l.cidade, uf: l.uf, motivo: motivo, area: !!l.poligono });
      });
      return { resultados: out };
    });
  }

  // ---------------------------------------------------------------- frota (equivalente a mapa/veiculos.py)
  // O CSV vem do exportador original: vírgula decimal, por isso latitude, longitude e distância ocupam dois campos cada.
  function numero(campos) {
    if (!campos.length) return null;
    var v = campos.shift().trim();
    if (campos.length && v !== "" && v.indexOf(".") < 0 && /^\d+$/.test(campos[0].trim() || "x")) v = v + "." + campos.shift().trim();
    return v;
  }
  function flutuante(v) { if (v == null || v === "") return null; var n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; }

  // campos de texto do CSV; o gerador sintético da frota preenche regional e operação com uma letra só (X, Y, Z, W), tratada como vazio
  function texto(v) { v = (v || "").trim(); return v.length > 1 ? v : ""; }

  function interpretarLinha(linha, sep) {
    var campos = linha.split(sep);
    if (campos.length < 13) return null;
    var base = campos.slice(0, 5), fim = campos.slice(-4), meio = campos.slice(5, -4);
    var lat = flutuante(numero(meio)), lon = flutuante(numero(meio));
    var local = meio.length ? meio.shift().trim() : "";
    var dist = flutuante(numero(meio));
    return { id: base[0].trim(), placa: base[1].trim(), uf: base[2].trim(), frota: base[3].trim(), quando: parseData(base[4]),
      lat: lat, lon: lon, local_proximo: local, dist_km: dist, regional: texto(fim[0]), nop: texto(fim[3]) };
  }

  function interpretarCsv(texto) {
    var linhas = texto.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var sep = linhas.length && linhas[0].split(";").length > linhas[0].split(",").length ? ";" : ",";
    var out = [];
    linhas.slice(1).forEach(function (l) {
      var v = interpretarLinha(l, sep);
      if (!v || v.lat == null || v.lon == null) return;
      if (!(v.lat >= -35 && v.lat <= 6 && v.lon >= -75 && v.lon <= -32)) return;
      v.empresa = empresaDoCarro(v.id, v.frota);
      out.push(v);
    });
    if (!out.length) throw new Error("O arquivo não trouxe nenhum veículo com posição.");
    return out;
  }

  function faixaGps(idadeMin) {
    if (idadeMin == null) return "24h";
    if (idadeMin >= 24 * 60) return "24h";
    if (idadeMin >= 12 * 60) return "12h";
    if (idadeMin >= 6 * 60) return "6h";
    if (idadeMin >= 60) return "1h";
    return "ok";
  }
  var FAIXAS = [{ faixa: "ok", rotulo: "GPS ok", cor: "#2E7D32" }, { faixa: "1h", rotulo: "1 h sem GPS", cor: "#FDD835" }, { faixa: "6h", rotulo: "6 h sem GPS", cor: "#E53935" },
    { faixa: "12h", rotulo: "12 h sem GPS", cor: "#546E7A" }, { faixa: "24h", rotulo: "24 h sem GPS", cor: "#212121" }];

  function distanciaKm(lat1, lon1, lat2, lon2) {
    var R = 6371, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function previsaoMin(km) { return km == null ? null : Math.round(km * PREVISAO.fator_rota / Math.max(10, PREVISAO.velocidade_kmh) * 60); }

  // Lê o CSV e o meta.json do repositório do Monitoramento de Rodovias; se não der, usa a cópia local.
  function baixarFrota() {
    var marca = "?t=" + Date.now();
    return Promise.all([getTexto(FLUXO_RAW + "gps_ultimas_posicoes.csv" + marca, { cache: "no-store" }), getJson(FLUXO_RAW + "meta.json" + marca, { cache: "no-store" })])
      .then(function (r) { return { csv: r[0], meta: r[1], fonte: "github" }; })
      .catch(function () {
        return Promise.all([getTexto(BASE + "frota/gps_ultimas_posicoes.csv"), getJson(BASE + "frota/meta.json")])
          .then(function (r) { return { csv: r[0], meta: r[1], fonte: "local" }; });
      });
  }

  function carregarFrota(forcar) {
    var agoraReal = Date.now() / 1000;
    if (forcar && estado.frota && agoraReal - estado.lidoEm < FORCAR_COOLDOWN_SEG) forcar = false;
    if (!forcar && estado.frota && agoraReal - estado.lidoEm < VEICULOS_INTERVALO_MIN * 60) return Promise.resolve(false);
    return baixarFrota().then(function (r) {
      var lista = interpretarCsv(r.csv);
      estado.frota = { lista: lista, agora: r.meta && r.meta.agora, fonte: r.fonte, posicoesEm: lista.reduce(function (m, v) { return v.quando && (!m || v.quando > m) ? v.quando : m; }, null) };
      estado.frotaErro = "";
      estado.lidoEm = agoraReal;
      return true;
    }).catch(function (e) {
      estado.frotaErro = String(e.message || e);
      if (!estado.frota) estado.frota = { lista: [], agora: null, fonte: "", posicoesEm: null };
      estado.lidoEm = agoraReal - VEICULOS_INTERVALO_MIN * 60 + 60;   // tenta de novo em 1 min
      return false;
    });
  }

  function serializarVeiculo(v, agoraDt) {
    var idade = v.quando ? Math.floor((agoraDt - v.quando) / 60000) : null;
    return { id: v.id, placa: v.placa, uf: v.uf, frota: v.frota, empresa: v.empresa, regional: v.regional, nop: v.nop,
      lat: Math.round(v.lat * 1e5) / 1e5, lon: Math.round(v.lon * 1e5) / 1e5, quando: fmtData(v.quando), idade_min: idade, faixa: faixaGps(idade),
      local_proximo: v.local_proximo, dist_km: v.dist_km != null ? Math.round(v.dist_km * 10) / 10 : null, cor: corEmpresa(v.empresa) };
  }

  var STATUS = { aberta: { rotulo: "Aberta", cor: "#3A6EA5" }, em_rota: { rotulo: "Socorro em rota", cor: "#7B4FB0" }, em_atendimento: { rotulo: "Em atendimento", cor: "#CAA017" }, aguardando: { rotulo: "Aguardando", cor: "#C75C1E" } };

  function serializarOcorrencia(o, agoraDt) {
    var ini = agoraDt.getTime() - o.inicio_min_antes * 60000, aberta = agoraDt.getTime() - o.aberta_min_antes * 60000;
    var fim = o.socorro_min_antes != null ? agoraDt.getTime() - o.socorro_min_antes * 60000 : null;
    var st = STATUS[o.status] || { rotulo: o.status, cor: "#607D8B" };
    return { id: String(o.id), carro: o.carro, carro_segue: o.carro_segue || "", placa: o.placa || "", empresa: empresaDoCarro(o.carro) || o.regional || "",
      status: o.status, status_rotulo: st.rotulo, status_cor: st.cor, aberta_em: fmtData(new Date(aberta)), inicio_em: fmtData(new Date(ini)),
      minutos: Math.max(0, Math.floor(((fim || agoraDt.getTime()) - ini) / 60000)), inicio_ms: ini, fim_ms: fim,
      servico: o.servico, linha: o.linha, local_socorro: o.local_socorro, defeito: o.defeito, link: FLUXO_URL };
  }

  // Equivalente a /api/veiculos/: posições + ocorrências cruzadas pelo número do carro.
  function veiculos(forcar) {
    return pronto.then(function () { return carregarFrota(forcar); }).then(function (releu) {
      var agoraDt = agora();
      var veics = estado.frota.lista.map(function (v) { return serializarVeiculo(v, agoraDt); });
      var porId = {}, porEmpresa = {}, porFaixa = { ok: 0, "1h": 0, "6h": 0, "12h": 0, "24h": 0 };
      veics.forEach(function (v) { porId[v.id] = v; porEmpresa[v.empresa] = (porEmpresa[v.empresa] || 0) + 1; porFaixa[v.faixa]++; });
      var ocs = estado.ocorrencias.map(function (o) { return serializarOcorrencia(o, agoraDt); }).sort(function (a, b) { return b.minutos - a.minutos; });
      var vistos = {};
      ocs.forEach(function (o) {
        if (!vistos[o.carro] && porId[o.carro]) { porId[o.carro].ocorrencia = o; vistos[o.carro] = true; }
        o.tem_posicao = !!porId[o.carro];
        if (o.carro_segue) {
          var vs = porId[o.carro_segue], vq = porId[o.carro];
          var info = { carro: o.carro_segue, tem_posicao: !!vs, dist_km: null, prev_min: null, idade_min: vs ? vs.idade_min : null };
          if (vs && vq) { info.dist_km = Math.round(distanciaKm(vs.lat, vs.lon, vq.lat, vq.lon) * 10) / 10; info.prev_min = previsaoMin(info.dist_km); }
          o.segue = info;
          if (vs) vs.socorro = { carro: o.carro, status: o.status, status_rotulo: o.status_rotulo, status_cor: o.status_cor, minutos: o.minutos, local_socorro: o.local_socorro,
            empresa: o.empresa, dist_km: info.dist_km, prev_min: info.prev_min, tem_posicao: !!vq, lat: vq ? vq.lat : null, lon: vq ? vq.lon : null };
        }
      });
      var lidoEm = estado.lidoEm ? fmtData(new Date(relogio().base + (estado.lidoEm * 1000 - relogio().inicio))) : null;
      return {
        configurado: true, veiculos: veics,
        por_empresa: Object.keys(porEmpresa).sort(function (a, b) { return porEmpresa[b] - porEmpresa[a]; }).map(function (e) { return { empresa: e, total: porEmpresa[e], cor: corEmpresa(e) }; }),
        por_faixa: FAIXAS.map(function (f) { return { faixa: f.faixa, rotulo: f.rotulo, cor: f.cor, total: porFaixa[f.faixa] }; }),
        atualizado_em: veics.length ? lidoEm : null,
        arquivo_em: estado.frota.posicoesEm ? fmtData(estado.frota.posicoesEm) : null,
        arquivo_fonte: estado.frota.fonte === "github" ? "github" : "local",
        releu: releu, intervalo_min: VEICULOS_INTERVALO_MIN, erro: estado.frotaErro,
        previsao: PREVISAO,
        ocorrencias: { configurado: true, lista: ocs, atualizado_em: lidoEm, erro: "", agora_ms: agoraDt.getTime() },
      };
    });
  }

  // ---------------------------------------------------------------- apoios no OpenStreetMap (equivalente a mapa/osm.py)
  // O Nominatim pede no máximo 1 requisição por segundo: as chamadas são enfileiradas e espaçadas.
  var OSM_CATEGORIAS = [
    { id: "mecanica", rotulo: "Mecânica / guincho", cor: "#5D4037", sigla: "M", buscas: ["[car repair]", "mecânica", "guincho"] },
    { id: "borracharia", rotulo: "Borracharia", cor: "#37474F", sigla: "B", buscas: ["borracharia", "pneus"] },
    { id: "posto", rotulo: "Posto de combustível", cor: "#EF6C00", sigla: "P", buscas: ["[fuel]"] },
    { id: "pedagio", rotulo: "Pedágio", cor: "#6A1B9A", sigla: "$", buscas: ["pedágio"] },
    { id: "prf", rotulo: "Posto da PRF", cor: "#1565C0", sigla: "PRF", buscas: ["PRF", "Polícia Rodoviária Federal"] },
    { id: "lanche", rotulo: "Lanche / refeição", cor: "#2E7D32", sigla: "L", buscas: ["[restaurant]", "[fast food]"] },
    { id: "hospital", rotulo: "Hospital", cor: "#C62828", sigla: "H", buscas: ["[hospital]"] },
  ];
  var LIMITE_NOMINATIM = 40, RAIO_PERTO_KM = 5, LIMITE_POR_CATEGORIA = 15;
  var CLASSES_FORA = ["highway", "boundary", "place", "landuse", "natural", "waterway", "railway", "route", "leisure"];
  var TIPOS_FORA = ["university", "school", "college", "kindergarten", "research_institute", "library"];
  var TIPOS_VIA_OK = ["services", "rest_area", "toll_gantry"];
  var osmFila = Promise.resolve(), osmUltima = 0, osmCache = {};

  function nominatim(params) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    osmFila = osmFila.then(function () {
      var espera = Math.max(0, osmUltima + 1100 - Date.now());
      return new Promise(function (res) { setTimeout(res, espera); });
    }).then(function () {
      osmUltima = Date.now();
      return fetch(NOMINATIM + "/search?" + q, { headers: { "Accept": "application/json" } });
    }).then(function (r) {
      if (r.status === 429 || r.status === 503) throw new Error("O Nominatim (OpenStreetMap) está ocupado neste momento. Tente de novo em alguns segundos.");
      if (!r.ok) throw new Error("O Nominatim recusou a busca (HTTP " + r.status + ").");
      return r.json();
    });
    return osmFila;
  }

  function caixa(lat, lon, raioKm) {
    var dlat = raioKm / 111, dlon = raioKm / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return (lon - dlon).toFixed(5) + "," + (lat + dlat).toFixed(5) + "," + (lon + dlon).toFixed(5) + "," + (lat - dlat).toFixed(5);
  }

  function relevante(cat, r) {
    var classe = r.category || "", tipo = r.type || "";
    if (classe === "highway" && TIPOS_VIA_OK.indexOf(tipo) >= 0) return true;
    if (CLASSES_FORA.indexOf(classe) >= 0 || TIPOS_FORA.indexOf(tipo) >= 0) return false;
    if (cat.id === "prf") {
      var nome = (r.name || "").toLowerCase();
      return (classe === "amenity" && tipo === "police") || nome.split(/\s+/).indexOf("prf") >= 0 || (nome.indexOf("rodovi") >= 0 && nome.indexOf("federal") >= 0);
    }
    return true;
  }

  function endereco(end) {
    end = end || {};
    var rua = end.road || "";
    if (rua && end.house_number) rua += ", " + end.house_number;
    var cidade = end.city || end.town || end.village || end.municipality || "";
    return [rua, cidade].filter(function (x) { return x; }).join(", ");
  }

  function item(cat, r, lat, lon) {
    var plat = parseFloat(r.lat), plon = parseFloat(r.lon);
    if (isNaN(plat) || isNaN(plon)) return null;
    var extra = r.extratags || {}, detalhes = [], nome = (r.name || "").trim();
    if (extra.opening_hours === "24/7") detalhes.push("24 h"); else if (extra.opening_hours) detalhes.push(extra.opening_hours);
    if (extra.brand && nome.toLowerCase().indexOf(extra.brand.toLowerCase()) < 0) detalhes.push(extra.brand);
    if (extra.operator && (cat.id === "pedagio" || cat.id === "posto") && nome.toLowerCase().indexOf(extra.operator.toLowerCase()) < 0) detalhes.push(extra.operator);
    var tipoOsm = r.osm_type || "node";
    return { id: tipoOsm.charAt(0) + r.osm_id, nome: nome || extra.brand || extra.operator || cat.rotulo + " (sem nome no OSM)",
      categoria: cat.id, rotulo: cat.rotulo, cor: cat.cor, sigla: cat.sigla, lat: Math.round(plat * 1e6) / 1e6, lon: Math.round(plon * 1e6) / 1e6,
      dist_km: Math.round(distanciaKm(lat, lon, plat, plon) * 10) / 10,
      telefone: extra.phone || extra["contact:phone"] || extra["contact:mobile"] || "", horario: extra.opening_hours || "",
      endereco: endereco(r.address), detalhe: detalhes.join(" · "),
      osm_url: "https://www.openstreetmap.org/" + tipoOsm + "/" + r.osm_id,
      google_url: "https://www.google.com/maps/search/?api=1&query=" + plat.toFixed(6) + "," + plon.toFixed(6),
      waze_url: "https://waze.com/ul?ll=" + plat.toFixed(6) + "%2C" + plon.toFixed(6) + "&navigate=yes" };
  }

  function apoiosOsm(lat, lon, raioKm, catId) {
    var cat = OSM_CATEGORIAS.filter(function (c) { return c.id === catId; })[0];
    if (!cat) return Promise.resolve({ itens: [], erro: "Categoria desconhecida." });
    var chave = lat.toFixed(3) + "|" + lon.toFixed(3) + "|" + raioKm + "|" + catId;
    if (osmCache[chave] && Date.now() - osmCache[chave].quando < 3600000) return Promise.resolve(osmCache[chave].saida);
    var resultados = [], erro = "";
    var fila = cat.buscas.slice();
    function proxima() {
      var termo = fila.shift();
      if (!termo) return Promise.resolve();
      var base = { q: termo, format: "jsonv2", viewbox: caixa(lat, lon, raioKm), bounded: 1, limit: LIMITE_NOMINATIM, extratags: 1, addressdetails: 1, countrycodes: "br", "accept-language": "pt-BR" };
      return nominatim(base).then(function (lote) {
        resultados = resultados.concat(lote);
        if (lote.length >= LIMITE_NOMINATIM && raioKm > RAIO_PERTO_KM) {
          var perto = Object.assign({}, base, { viewbox: caixa(lat, lon, RAIO_PERTO_KM) });
          return nominatim(perto).then(function (l2) { resultados = resultados.concat(l2); });
        }
      }).then(proxima);
    }
    return proxima().catch(function (e) { erro = e.message === "Failed to fetch" ? "Não foi possível conectar ao Nominatim." : String(e.message || e); }).then(function () {
      var vistos = {}, itens = [];
      resultados.forEach(function (r) {
        if (!relevante(cat, r)) return;
        var it = item(cat, r, lat, lon);
        if (!it || vistos[it.id] || it.dist_km > raioKm) return;
        vistos[it.id] = true; itens.push(it);
      });
      itens.sort(function (a, b) { return a.dist_km - b.dist_km; });
      var saida = { categoria: catId, itens: itens.slice(0, LIMITE_POR_CATEGORIA), erro: erro };
      if (!erro) osmCache[chave] = { quando: Date.now(), saida: saida };
      return saida;
    });
  }

  return { pronto: pronto, locais: locais, detalhe: detalhe, busca: busca, veiculos: veiculos, apoiosOsm: apoiosOsm, agora: agora, agoraMs: agoraMs, estado: estado };
})();

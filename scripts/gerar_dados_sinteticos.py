"""
Gera os dados sinteticos da versao de portfolio do Apoio CCO (seed fixa).

Nada aqui e lido de base real. Cidades e coordenadas sao publicas; camadas,
locais de apoio, contatos, telefones, regionais e ocorrencias sao inventados
por regras simples definidas neste arquivo. A frota (prefixos, placas e
posicoes GPS) vem do projeto irmao Monitoramento de Rodovias, que tambem e
sintetico: https://github.com/danielmvr/monitoramento-rodovias-portifolio

Saidas (pasta data/):
  camadas.json       camadas do mapa (como as do My Maps que o sistema substitui)
  locais.json        pontos de apoio, bilheterias, paradas, terceiros e regionais,
                     com contatos ficticios
  ocorrencias.json   ocorrencias de socorro abertas, referindo carros da frota
  meta.json          seed, totais e origem da frota

Entrada (pasta data/frota/, copia do repositorio do Monitoramento de Rodovias):
  gps_ultimas_posicoes.csv   ultimas posicoes (layout do exportador original)
  meta.json                  horario do snapshot sintetico

Uso (na raiz do projeto):
    python scripts/gerar_dados_sinteticos.py
    python scripts/gerar_dados_sinteticos.py --fluxo ../monitoramento-rodovias-portifolio
        (atualiza data/frota/ a partir de um clone local antes de gerar)
    python scripts/gerar_dados_sinteticos.py --baixar
        (atualiza data/frota/ baixando do GitHub antes de gerar)
"""
import argparse
import json
import math
import os
import random
import shutil
import sys
import urllib.request

SEED = 42
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(RAIZ, "data")
FROTA = os.path.join(DATA, "frota")

FLUXO_REPO = "danielmvr/monitoramento-rodovias-portifolio"
FLUXO_RAW = f"https://raw.githubusercontent.com/{FLUXO_REPO}/main/data/"
ARQUIVOS_FROTA = ["gps_ultimas_posicoes.csv", "meta.json"]

rnd = random.Random(SEED)

# --------------------------------------------------------------------------
# Cidades: as mesmas 38 do Monitoramento de Rodovias (codigo ficticio de 3
# letras, coordenadas publicas aproximadas). A sigla do local e o codigo.
# --------------------------------------------------------------------------
CIDADES = {
    "RIO": ("Rio de Janeiro", "RJ", -22.9068, -43.1729),
    "PET": ("Petrópolis", "RJ", -22.5050, -43.1786),
    "TRR": ("Três Rios", "RJ", -22.1165, -43.2085),
    "JDF": ("Juiz de Fora", "MG", -21.7642, -43.3496),
    "BAR": ("Barbacena", "MG", -21.2214, -43.7703),
    "CLF": ("Conselheiro Lafaiete", "MG", -20.6603, -43.7861),
    "BHZ": ("Belo Horizonte", "MG", -19.9167, -43.9345),
    "SET": ("Sete Lagoas", "MG", -19.4658, -44.2467),
    "CVL": ("Curvelo", "MG", -18.7561, -44.4303),
    "MOC": ("Montes Claros", "MG", -16.7282, -43.8578),
    "VRD": ("Volta Redonda", "RJ", -22.5232, -44.1041),
    "RES": ("Resende", "RJ", -22.4686, -44.4509),
    "TAU": ("Taubaté", "SP", -23.0264, -45.5553),
    "SJC": ("São José dos Campos", "SP", -23.1896, -45.8841),
    "SPO": ("São Paulo", "SP", -23.5505, -46.6333),
    "CAM": ("Campinas", "SP", -22.9099, -47.0626),
    "RPO": ("Ribeirão Preto", "SP", -21.1775, -47.8103),
    "UBA": ("Uberaba", "MG", -19.7472, -47.9392),
    "UDI": ("Uberlândia", "MG", -18.9186, -48.2772),
    "CAT": ("Catalão", "GO", -18.1659, -47.9463),
    "BSB": ("Brasília", "DF", -15.7939, -47.8828),
    "ANA": ("Anápolis", "GO", -16.3281, -48.9534),
    "GYN": ("Goiânia", "GO", -16.6869, -49.2648),
    "RVD": ("Rio Verde", "GO", -17.7923, -50.9192),
    "JTI": ("Jataí", "GO", -17.8784, -51.7204),
    "LAV": ("Lavras", "MG", -21.2453, -44.9998),
    "POU": ("Pouso Alegre", "MG", -22.2300, -45.9366),
    "SSA": ("Salvador", "BA", -12.9777, -38.5016),
    "FSA": ("Feira de Santana", "BA", -12.2664, -38.9663),
    "VDC": ("Vitória da Conquista", "BA", -14.8615, -40.8442),
    "REG": ("Registro", "SP", -24.4872, -47.8442),
    "CUR": ("Curitiba", "PR", -25.4284, -49.2733),
    "JOI": ("Joinville", "SC", -26.3045, -48.8487),
    "FLN": ("Florianópolis", "SC", -27.5954, -48.5480),
    "RBO": ("Rio Bonito", "RJ", -22.7085, -42.6094),
    "CBF": ("Cabo Frio", "RJ", -22.8894, -42.0286),
    "MAC": ("Macaé", "RJ", -22.3768, -41.7869),
    "CPS": ("Campos dos Goytacazes", "RJ", -21.7545, -41.3244),
}

# Corredores rodoviarios (iguais aos do Monitoramento de Rodovias): rodovia -> cidades em ordem.
CORREDORES = {
    "BR-040": ["RIO", "PET", "TRR", "JDF", "BAR", "CLF", "BHZ"],
    "BR-116 (Via Dutra)": ["RIO", "VRD", "RES", "TAU", "SJC", "SPO"],
    "BR-381 (Fernão Dias)": ["BHZ", "LAV", "POU", "SPO"],
    "BR-135": ["BHZ", "SET", "CVL", "MOC"],
    "BR-050": ["BSB", "CAT", "UDI", "UBA"],
    "SP-330 (Anhanguera)": ["SPO", "CAM", "RPO", "UBA"],
    "BR-060": ["BSB", "ANA", "GYN", "RVD", "JTI"],
    "BR-116 (Régis Bittencourt)": ["SPO", "REG", "CUR"],
    "BR-101 (Sul)": ["CUR", "JOI", "FLN"],
    "BR-101 (Norte RJ)": ["RIO", "RBO", "MAC", "CPS"],
    "RJ-124 (Via Lagos)": ["RBO", "CBF"],
    "BR-324": ["SSA", "FSA"],
    "BR-116 (Rio-Bahia)": ["FSA", "VDC"],
}

# Regionais operacionais ficticias: nome -> cidades que cobrem (viram poligonos).
REGIONAIS = {
    "Regional Rio e Serra": ["RIO", "PET", "TRR", "RBO", "CBF", "MAC", "CPS"],
    "Regional Minas": ["JDF", "BAR", "CLF", "BHZ", "SET", "CVL", "MOC", "LAV"],
    "Regional São Paulo": ["VRD", "RES", "TAU", "SJC", "SPO", "CAM", "RPO", "POU", "REG"],
    "Regional Triângulo": ["UBA", "UDI", "CAT"],
    "Regional Centro-Oeste": ["BSB", "ANA", "GYN", "RVD", "JTI"],
    "Regional Sul": ["CUR", "JOI", "FLN"],
    "Regional Bahia": ["SSA", "FSA", "VDC"],
}

# Empresas ficticias do grupo (as mesmas do Monitoramento de Rodovias: sufixo A/B/C do carro).
EMPRESAS = [
    {"valor": "ALFA", "nome": "Viação Alfa", "sufixo": "A", "cor": "#1565C0"},
    {"valor": "BETA", "nome": "Expresso Beta", "sufixo": "B", "cor": "#2E7D32"},
    {"valor": "GAMA", "nome": "Rota Gama", "sufixo": "C", "cor": "#EF6C00"},
    {"valor": "GRUPO", "nome": "Todas do grupo", "sufixo": "", "cor": "#00838F"},
    {"valor": "TERCEIRO", "nome": "Terceiro", "sufixo": "", "cor": "#607D8B"},
]

CAMADAS = [
    # nome, tipo, cor, rotulo, ordem, descricao
    ("Regional Operacional", "AREA", "#FF5252", "", 10, "Áreas de atuação de cada gerência regional"),
    ("Pontos de Apoio/Garagem", "PONTO", "#0288D1", "G", 20, "Garagens, oficinas e pontos de apoio da frota"),
    ("Bilheterias / Pontos de Venda", "PONTO", "#FBC02D", "B", 30, "Bilheterias em rodoviárias e agências"),
    ("Paradas Lanche/Refeição", "PONTO", "#A52714", "R", 40, "Restaurantes e postos conveniados para as paradas"),
    ("Empresas Terceiras", "PONTO", "#6D4C41", "T", 50, "Guinchos, mecânicas e borracharias parceiras"),
]

DDD = {"RJ": "21", "MG": "31", "SP": "11", "GO": "62", "DF": "61", "BA": "71", "PR": "41", "SC": "47"}
DDD_INTERIOR = {"PET": "24", "TRR": "24", "VRD": "24", "RES": "24", "JDF": "32", "BAR": "32", "CLF": "31",
                "SET": "31", "CVL": "38", "MOC": "38", "TAU": "12", "SJC": "12", "CAM": "19", "RPO": "16",
                "UBA": "34", "UDI": "34", "CAT": "64", "ANA": "62", "RVD": "64", "JTI": "64", "LAV": "35",
                "POU": "35", "FSA": "75", "VDC": "77", "REG": "13", "JOI": "47", "RBO": "21", "CBF": "22",
                "MAC": "22", "CPS": "22"}

NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elaine", "Fábio", "Gisele", "Hugo", "Iara", "João", "Karen",
         "Lucas", "Marta", "Nelson", "Olívia", "Paulo", "Rita", "Sérgio", "Tânia", "Vitor", "Wagner",
         "Beatriz", "Caio", "Débora", "Eduardo", "Flávia", "Gustavo", "Helena", "Ivan", "Juliana"]
SOBRENOMES = ["Silva", "Souza", "Oliveira", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento",
              "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins", "Rocha", "Ribeiro"]
FUNCOES = {
    "Pontos de Apoio/Garagem": ["Gerente Operacional", "Encarregado de Manutenção", "Mecânico", "Eletricista", "Plantão Guincho"],
    "Bilheterias / Pontos de Venda": ["Responsável", "Resp. Comercial", "Supervisor de Vendas"],
    "Paradas Lanche/Refeição": ["Responsável", "Gerente"],
    "Empresas Terceiras": ["Proprietário", "Plantão 24 h"],
    "Regional Operacional": ["Gerente Regional", "Coordenador Operacional", "Encarregado"],
}
SERVICOS_GARAGEM = ["Mecânica e elétrica", "Mecânica, borracharia e guincho", "Abastecimento e lavagem",
                    "Dormitório, limpeza e abastecimento", "Funilaria e pintura", "Mecânica 24 h"]
SERVICOS_TERCEIRO = ["Guincho pesado", "Borracharia 24 h", "Mecânica diesel", "Auto elétrica", "Guincho e mecânica"]
HORARIOS = ["24 horas", "06:00 às 22:00", "05:00 às 23:00", "07:00 às 19:00"]
RUAS = ["Av. Brasil", "Rua das Oficinas", "Av. Industrial", "Rua do Comércio", "Av. Presidente Vargas",
        "Rua Quinze de Novembro", "Av. das Nações", "Rua São José", "Av. Rodoviária", "Rua Sete de Setembro"]
LANCHES = ["Restaurante Parada Certa", "Posto e Restaurante Boa Viagem", "Churrascaria Pampa", "Restaurante Rota do Sol",
           "Posto Estrela da Serra", "Lanchonete Trevo", "Restaurante Mineirinho", "Posto Girassol", "Grill da Serra",
           "Restaurante Encontro das Águas"]
TERCEIROS = ["Guincho Rápido", "Auto Socorro Horizonte", "Borracharia do Trevo", "Mecânica Diesel Irmãos", "Guincho Pesado Sul",
             "Auto Elétrica Planalto", "Socorro 24h Serra", "Borracharia Central", "Oficina Boa Vista", "Guincho Mineiro"]
DEFEITOS = ["Motor superaquecendo, sem força", "Pneu traseiro estourado", "Ar-condicionado parou, motor normal",
            "Vazamento de ar no freio", "Luz de injeção acesa, motor falhando", "Bateria descarregada, não dá partida",
            "Embreagem patinando", "Alternador sem carga"]
OBS_LOCAL = ["Entrada de caminhões pelos fundos.", "Acesso pela marginal; estacionamento para 3 carros.",
             "Pedir no balcão o cartão de refeição da empresa.", "Funciona com plantão aos domingos.",
             "Guincho atende até 150 km.", ""]


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------
def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def telefone(cod, uf, celular=True):
    """Telefone claramente ficticio: DD 99999-00NN (celular) ou DD 3333-00NN (fixo)."""
    ddd = DDD_INTERIOR.get(cod) or DDD.get(uf, "61")
    n = rnd.randint(1, 99)
    return f"({ddd}) 99999-{n:04d}" if celular else f"({ddd}) 3333-{n:04d}"


def pessoa():
    return f"{rnd.choice(NOMES)} {rnd.choice(SOBRENOMES)}"


def jitter(v, d):
    return round(v + rnd.uniform(-d, d), 6)


def casco_convexo(pontos):
    """Casco convexo (monotone chain) de uma lista de [lat, lon]."""
    pts = sorted(set(map(tuple, pontos)))
    if len(pts) < 3:
        return [list(p) for p in pts]

    def cruz(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    baixo, alto = [], []
    for p in pts:
        while len(baixo) >= 2 and cruz(baixo[-2], baixo[-1], p) <= 0:
            baixo.pop()
        baixo.append(p)
    for p in reversed(pts):
        while len(alto) >= 2 and cruz(alto[-2], alto[-1], p) <= 0:
            alto.pop()
        alto.append(p)
    return [list(p) for p in baixo[:-1] + alto[:-1]]


def poligono_regional(cods, margem=0.38):
    """Poligono em volta das cidades: casco convexo dos pontos expandidos por um circulo de `margem` graus."""
    pontos = []
    for c in cods:
        _, _, lat, lon = CIDADES[c]
        for k in range(12):
            ang = 2 * math.pi * k / 12
            pontos.append([round(lat + margem * math.sin(ang), 4), round(lon + margem * math.cos(ang) / max(0.4, math.cos(math.radians(lat))), 4)])
    return casco_convexo(pontos)


def centro(poligono):
    lat = sum(p[0] for p in poligono) / len(poligono)
    lon = sum(p[1] for p in poligono) / len(poligono)
    return round(lat, 5), round(lon, 5)


# --------------------------------------------------------------------------
# 1) Camadas e locais
# --------------------------------------------------------------------------
def gerar_camadas():
    out = []
    for i, (nome, tipo, cor, rotulo, ordem, desc) in enumerate(CAMADAS, start=1):
        out.append({"id": i, "nome": nome, "slug": nome.lower().replace(" / ", "-").replace("/", "-").replace(" ", "-"),
                    "tipo": tipo, "cor": cor, "rotulo": rotulo or nome[:1].upper(), "ordem": ordem,
                    "visivel": True, "descricao": desc})
    return out


def contatos_para(camada_nome, cod, uf, qtd=None):
    funcoes = FUNCOES[camada_nome]
    n = qtd or rnd.randint(1, min(4, len(funcoes)))
    out = []
    for i, f in enumerate(funcoes[:n]):
        celular = not (i == n - 1 and rnd.random() < 0.3)
        out.append({"nome": pessoa(), "funcao": f, "telefone": telefone(cod, uf, celular),
                    "obs": rnd.choice(["", "", "", "Só WhatsApp", "Plantão noturno", "Falar com ele(a) primeiro"])})
    return out


def gerar_locais(camadas):
    por_nome = {c["nome"]: c["id"] for c in camadas}
    locais = []
    atualizacoes = ["02/10/2026 09:14", "03/10/2026 16:40", "07/10/2026 11:02", "09/10/2026 14:25", "13/10/2026 08:50", "14/10/2026 17:33"]

    def novo(camada, nome, cod, lat, lon, **extra):
        nome_cid, uf, _, _ = CIDADES[cod]
        loc = {
            "id": len(locais) + 1, "camada_id": por_nome[camada], "nome": nome, "sigla": "", "empresa": "",
            "latitude": lat, "longitude": lon, "poligono": None,
            "endereco": "", "cidade": nome_cid, "uf": uf, "telefone": "", "cor": "", "horario": "",
            "servicos": "", "observacoes": "", "ativo": True, "contatos": [],
            "atualizado_em": rnd.choice(atualizacoes), "atualizado_por": "Equipe de cadastro",
        }
        loc.update(extra)
        locais.append(loc)
        return loc

    # Regionais (areas)
    cores_regionais = ["#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA", "#00897B", "#F4511E"]
    for i, (nome, cods) in enumerate(REGIONAIS.items()):
        pg = poligono_regional(cods)
        lat, lon = centro(pg)
        sede = cods[0]
        loc = novo("Regional Operacional", nome, sede, lat, lon, poligono=pg, cor=cores_regionais[i], empresa="GRUPO",
                   observacoes=f"Sede em {CIDADES[sede][0]}. Cobre {', '.join(CIDADES[c][0] for c in cods)}.")
        loc["contatos"] = contatos_para("Regional Operacional", sede, CIDADES[sede][1], qtd=3)

    # Pontos nas cidades
    for cod, (nome_cid, uf, lat, lon) in CIDADES.items():
        emp = rnd.choice(["ALFA", "ALFA", "BETA", "GAMA"])
        if rnd.random() < 0.7:
            loc = novo("Pontos de Apoio/Garagem", f"Garagem {nome_cid}", cod, jitter(lat, 0.035), jitter(lon, 0.035),
                       sigla=cod, empresa=emp, endereco=f"{rnd.choice(RUAS)}, {rnd.randint(100, 4800)}",
                       horario=rnd.choice(HORARIOS), servicos=rnd.choice(SERVICOS_GARAGEM),
                       telefone=telefone(cod, uf, celular=False), observacoes=rnd.choice(OBS_LOCAL))
            loc["contatos"] = contatos_para("Pontos de Apoio/Garagem", cod, uf)
        if rnd.random() < 0.9:
            loc = novo("Bilheterias / Pontos de Venda", f"Bilheteria Rodoviária {nome_cid}", cod, jitter(lat, 0.02), jitter(lon, 0.02),
                       sigla=cod, empresa=rnd.choice([emp, "GRUPO"]), endereco=f"Terminal Rodoviário, guichê {rnd.randint(1, 40)}",
                       horario=rnd.choice(HORARIOS[1:]), telefone=telefone(cod, uf, celular=False))
            loc["contatos"] = contatos_para("Bilheterias / Pontos de Venda", cod, uf)
        if rnd.random() < 0.45:
            loc = novo("Paradas Lanche/Refeição", rnd.choice(LANCHES) + f" ({nome_cid})", cod, jitter(lat, 0.08), jitter(lon, 0.08),
                       sigla=cod, empresa="GRUPO", horario=rnd.choice(HORARIOS), servicos="Refeição, lanche e banheiros",
                       telefone=telefone(cod, uf, celular=False), observacoes=rnd.choice(OBS_LOCAL))
            loc["contatos"] = contatos_para("Paradas Lanche/Refeição", cod, uf)
        if rnd.random() < 0.45:
            loc = novo("Empresas Terceiras", rnd.choice(TERCEIROS) + f" - {nome_cid}", cod, jitter(lat, 0.05), jitter(lon, 0.05),
                       empresa="TERCEIRO", horario=rnd.choice(["24 horas", "Plantão 24 h", "07:00 às 19:00"]),
                       servicos=rnd.choice(SERVICOS_TERCEIRO), observacoes=rnd.choice(OBS_LOCAL))
            loc["contatos"] = contatos_para("Empresas Terceiras", cod, uf)

    # Paradas de refeicao no meio dos corredores (entre duas cidades)
    for rod, cods in CORREDORES.items():
        for a, b in zip(cods, cods[1:]):
            if rnd.random() < 0.5:
                continue
            la, lo = CIDADES[a][2], CIDADES[a][3]
            lb, lb2 = CIDADES[b][2], CIDADES[b][3]
            f = rnd.uniform(0.35, 0.65)
            lat, lon = jitter(la + (lb - la) * f, 0.02), jitter(lo + (lb2 - lo) * f, 0.02)
            perto = a if f < 0.5 else b
            km = rnd.randint(20, 480)
            loc = novo("Paradas Lanche/Refeição", f"{rnd.choice(LANCHES)} - {rod.split(' (')[0]} km {km}", perto, lat, lon,
                       empresa="GRUPO", endereco=f"{rod}, km {km}", horario=rnd.choice(HORARIOS),
                       servicos="Refeição, lanche, banheiros e estacionamento", telefone=telefone(perto, CIDADES[perto][1], celular=False))
            loc["contatos"] = contatos_para("Paradas Lanche/Refeição", perto, CIDADES[perto][1])

    # Alguns locais inativos (ficam fora do mapa publico, como no sistema original)
    for loc in rnd.sample([l for l in locais if not l["poligono"]], 4):
        loc["ativo"] = False
        loc["observacoes"] = (loc["observacoes"] + " Desativado: parceria encerrada.").strip()
    return locais


# --------------------------------------------------------------------------
# 2) Ocorrencias de socorro, referindo carros da frota do Monitoramento
# --------------------------------------------------------------------------
def ler_frota():
    caminho = os.path.join(FROTA, "gps_ultimas_posicoes.csv")
    com_pos, sem_pos = [], []
    with open(caminho, encoding="utf-8") as f:
        next(f)
        for linha in f:
            campos = linha.rstrip("\n").split(",")
            if len(campos) < 13:
                continue
            prefixo = campos[0].strip()
            if len(campos) >= 16 and campos[5].strip():
                lat = float(campos[5] + "." + campos[6])
                lon = float(campos[7] + "." + campos[8])
                com_pos.append({"carro": prefixo, "placa": campos[1], "lat": lat, "lon": lon, "local": campos[9], "quando": campos[4]})
            else:
                sem_pos.append({"carro": prefixo, "placa": campos[1]})
    return com_pos, sem_pos


def cidade_mais_proxima(lat, lon):
    return min(CIDADES, key=lambda c: haversine(lat, lon, CIDADES[c][2], CIDADES[c][3]))


def corredor_de(cod):
    opcoes = [(rod, cods) for rod, cods in CORREDORES.items() if cod in cods]
    return rnd.choice(opcoes) if opcoes else ("BR-040", CORREDORES["BR-040"])


def linha_e_local(carro):
    """Linha ficticia (mesmo padrao L1xx - A X B do Monitoramento) e local do socorro no corredor da cidade mais proxima."""
    cod = cidade_mais_proxima(carro["lat"], carro["lon"])
    rod, cods = corredor_de(cod)
    i = cods.index(cod)
    outro = cods[i + 1] if i + 1 < len(cods) else cods[i - 1]
    a, b = (cods[0], cods[-1]) if rnd.random() < 0.5 else (cods[-1], cods[0])
    num = 101 + 2 * (list(CORREDORES).index(rod) * 2 + rnd.randint(0, 1))
    linha = f"L{num} - {a} X {b}"
    km = rnd.randint(8, 420)
    local = f"{rod}, km {km}, entre {CIDADES[cod][0]} e {CIDADES[outro][0]}"
    return linha, local, cod


def gerar_ocorrencias(com_pos, sem_pos):
    """7 ocorrencias com tempos relativos ao 'agora' do snapshot (minutos antes): a tela converte para o relogio simulado."""
    carros = sorted(com_pos, key=lambda c: c["carro"])
    escolhidos = rnd.sample(carros, 6)
    parados = sorted(sem_pos, key=lambda c: c["carro"])
    sufixo_reg = {"A": "ALFA", "B": "BETA", "C": "GAMA"}

    def perto_de(c, usados, raio=350):
        cands = [x for x in carros if x["carro"] != c["carro"] and x["carro"] not in usados and haversine(c["lat"], c["lon"], x["lat"], x["lon"]) <= raio]
        cands.sort(key=lambda x: haversine(c["lat"], c["lon"], x["lat"], x["lon"]))
        return cands[1]["carro"] if len(cands) > 1 else (cands[0]["carro"] if cands else "")

    # (status, minutos desde a quebra, minutos desde o fim do SOS ou None, tipo de carro que segue)
    perfis = [
        ("aberta", 25, None, None),
        ("em_rota", 110, None, "com_gps"),
        ("em_atendimento", 155, None, "com_gps"),
        ("aguardando", 55, None, None),
        ("em_rota", 65, None, "sem_gps"),
        ("aguardando", 190, 120, None),       # SOS encerrado: cronometro parado
    ]
    usados = {c["carro"] for c in escolhidos}
    lista = []
    for i, (c, (status, ini, fim, segue)) in enumerate(zip(escolhidos, perfis), start=1):
        linha, local, cod = linha_e_local(c)
        carro_segue = ""
        if segue == "com_gps":
            carro_segue = perto_de(c, usados)
            usados.add(carro_segue)
        elif segue == "sem_gps":
            carro_segue = parados[0]["carro"] if parados else ""
        lista.append({
            "id": 1000 + i, "carro": c["carro"], "placa": c["placa"], "regional": sufixo_reg.get(c["carro"][-1], ""),
            "status": status, "aberta_min_antes": ini - rnd.randint(2, 8), "inicio_min_antes": ini,
            "socorro_min_antes": fim, "carro_segue": carro_segue,
            "servico": str(30100000 + rnd.randint(100, 9000)), "linha": linha, "local_socorro": local,
            "defeito": rnd.choice(DEFEITOS),
        })
    # um carro sem posicao de GPS com ocorrencia aberta (aparece so na lista)
    if len(parados) > 1:
        p = parados[1]
        lista.append({
            "id": 1000 + len(lista) + 1, "carro": p["carro"], "placa": p["placa"], "regional": "",
            "status": "aberta", "aberta_min_antes": 38, "inicio_min_antes": 42, "socorro_min_antes": None, "carro_segue": "",
            "servico": str(30100000 + rnd.randint(100, 9000)), "linha": "L103 - RIO X BHZ",
            "local_socorro": "Pátio da garagem, sem transmissão de GPS", "defeito": rnd.choice(DEFEITOS),
        })
    return lista


# --------------------------------------------------------------------------
# Frota: copia do repositorio irmao
# --------------------------------------------------------------------------
def atualizar_frota(origem=None, baixar=False):
    os.makedirs(FROTA, exist_ok=True)
    for nome in ARQUIVOS_FROTA:
        destino = os.path.join(FROTA, nome)
        if origem:
            shutil.copyfile(os.path.join(origem, "data", nome), destino)
            print(f"copiado de {origem}: {nome}")
        elif baixar:
            with urllib.request.urlopen(FLUXO_RAW + nome, timeout=30) as r, open(destino, "wb") as f:
                f.write(r.read())
            print(f"baixado: {nome}")


def salvar_json(nome, obj):
    with open(os.path.join(DATA, nome), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--fluxo", help="clone local do monitoramento-rodovias-portifolio (copia data/frota/)")
    ap.add_argument("--baixar", action="store_true", help="baixa data/frota/ do GitHub antes de gerar")
    args = ap.parse_args()
    if args.fluxo or args.baixar:
        atualizar_frota(args.fluxo, args.baixar)
    for nome in ARQUIVOS_FROTA:
        if not os.path.exists(os.path.join(FROTA, nome)):
            sys.exit(f"Falta data/frota/{nome}. Use --fluxo <clone> ou --baixar.")

    os.makedirs(DATA, exist_ok=True)
    camadas = gerar_camadas()
    locais = gerar_locais(camadas)
    for c in camadas:
        c["total"] = sum(1 for l in locais if l["camada_id"] == c["id"] and l["ativo"])
    com_pos, sem_pos = ler_frota()
    ocorrencias = gerar_ocorrencias(com_pos, sem_pos)

    with open(os.path.join(FROTA, "meta.json"), encoding="utf-8") as f:
        meta_frota = json.load(f)

    salvar_json("camadas.json", camadas)
    salvar_json("locais.json", locais)
    salvar_json("ocorrencias.json", {"aviso": "Ocorrências fictícias geradas por script; tempos em minutos antes do 'agora' do snapshot.", "lista": ocorrencias})
    salvar_json("meta.json", {
        "seed": SEED,
        "aviso": "Todos os dados são sintéticos. Nenhum registro vem de base real.",
        "camadas": len(camadas), "locais": len(locais), "locais_ativos": sum(1 for l in locais if l["ativo"]),
        "contatos": sum(len(l["contatos"]) for l in locais), "regionais": sum(1 for l in locais if l["poligono"]),
        "ocorrencias": len(ocorrencias), "carros_com_posicao": len(com_pos), "carros_sem_posicao": len(sem_pos),
        "empresas": EMPRESAS,
        "frota": {"repositorio": FLUXO_REPO, "csv": FLUXO_RAW + "gps_ultimas_posicoes.csv", "meta": FLUXO_RAW + "meta.json",
                  "agora_snapshot": meta_frota.get("agora")},
    })
    print(f"OK: {len(camadas)} camadas, {len(locais)} locais ({sum(len(l['contatos']) for l in locais)} contatos), "
          f"{len(ocorrencias)} ocorrências, frota com {len(com_pos)} carros posicionados.")


if __name__ == "__main__":
    main()

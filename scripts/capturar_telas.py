"""
Captura as telas do mapa para o README (docs/img/).

Uso:
    pip install playwright && python -m playwright install chromium
    python scripts/capturar_telas.py https://USUARIO.github.io/REPOSITORIO/
    python scripts/capturar_telas.py http://localhost:8000/

Tambem roda no GitHub Actions (.github/workflows/capturas.yml), que captura a versao publicada.
"""
import os
import sys

from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "docs", "img")


def main(url):
    os.makedirs(SAIDA, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_page(viewport={"width": 1500, "height": 950}, device_scale_factor=1)
        pg.goto(url)
        pg.wait_for_selector(".oc-card", timeout=60000)
        pg.wait_for_timeout(6000)                       # tiles do mapa
        pg.screenshot(path=os.path.join(SAIDA, "01_mapa_geral.png"))

        # carro quebrado com carro que segue e candidatos ao socorro
        pg.locator(".oc-card").nth(1).click()
        pg.wait_for_timeout(5000)
        pg.screenshot(path=os.path.join(SAIDA, "02_ocorrencia_socorro.png"))

        # onibus coloridos pela pontualidade, com a lista "Atrasados agora"
        pg.locator("#tela-detalhe [data-voltar]").click()
        pg.locator("[data-cor-por='pontualidade']").click()
        pg.wait_for_timeout(3000)
        pg.locator(".at-item").first.click()
        pg.wait_for_timeout(4000)
        pg.screenshot(path=os.path.join(SAIDA, "03_pontualidade_mapa.png"))
        pg.locator("#tela-detalhe [data-voltar]").click()
        pg.locator("[data-cor-por='empresa']").click()

        # detalhe de um local de apoio com contatos
        pg.fill("#busca", "Garagem Belo Horizonte")
        pg.wait_for_timeout(800)
        pg.locator("#tela-resultados .resultado").first.click()
        pg.wait_for_timeout(4000)
        pg.screenshot(path=os.path.join(SAIDA, "04_local_contatos.png"))

        # apoios no OpenStreetMap em volta de um veiculo (consulta o Nominatim: 7 categorias, ~10 s)
        pg.locator("#tela-detalhe [data-voltar]").click()
        pg.fill("#busca", "9433")
        pg.wait_for_timeout(800)
        pg.locator("#tela-resultados .resultado").first.click()
        pg.wait_for_timeout(2500)
        pg.locator("[data-osm-veiculo]").click()
        pg.wait_for_timeout(14000)
        pg.screenshot(path=os.path.join(SAIDA, "05_apoios_osm.png"))

        # pagina Pontualidade: todas as linhas e uma linha
        pp = nav.new_page(viewport={"width": 1400, "height": 1000}, device_scale_factor=1)
        pp.goto(url.rstrip("/") + "/pontualidade.html")
        pp.wait_for_selector(".pt-numeros", timeout=60000)
        pp.wait_for_timeout(2000)
        pp.screenshot(path=os.path.join(SAIDA, "06_pontualidade_geral.png"), full_page=True)
        pp.locator("[data-abrir-linha]").first.click()
        pp.wait_for_selector(".pt-bloco-marey", timeout=60000)
        pp.wait_for_timeout(5000)                       # mapa da rota
        pp.screenshot(path=os.path.join(SAIDA, "07_pontualidade_linha.png"), full_page=True)

        # celular
        pm = nav.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pm.goto(url)
        pm.wait_for_selector("#veiculos-total", timeout=60000)
        pm.wait_for_timeout(6000)
        pm.screenshot(path=os.path.join(SAIDA, "08_celular.png"))
        nav.close()
    print(f"Telas salvas em {SAIDA}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/")

/* Comportamentos gerais: menu, mensagens e o diálogo "Sobre". Sem dependências. */
(function () {
  "use strict";

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-toggle=menu]");
    if (t) {
      var menu = document.getElementById("menu");
      var aberto = menu.classList.toggle("aberto");
      t.setAttribute("aria-expanded", aberto ? "true" : "false");
      return;
    }
    var f = ev.target.closest("[data-fechar]");
    if (f) {
      f.parentElement.remove();
      return;
    }
    var s = ev.target.closest("a[href='#sobre']");
    if (s) {
      ev.preventDefault();
      var d = document.getElementById("sobre");
      if (d && typeof d.showModal === "function") d.showModal();
      var menu2 = document.getElementById("menu");
      if (menu2) menu2.classList.remove("aberto");
    }
  });

  // fecha um <details> quando outro abre (menus)
  document.querySelectorAll("details.submenu").forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (!d.open) return;
      document.querySelectorAll("details.submenu[open]").forEach(function (o) {
        if (o !== d) o.removeAttribute("open");
      });
    });
  });
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest("details.submenu")) {
      document.querySelectorAll("details.submenu[open]").forEach(function (o) { o.removeAttribute("open"); });
    }
  });
})();

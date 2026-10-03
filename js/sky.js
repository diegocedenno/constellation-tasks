/* Cielo: cada tarea es una estrella y las completadas se unen con trazos.
   El viewBox mide lo mismo que el contenedor en píxeles, así el texto del SVG
   nunca encoge: 11,5 px son 11,5 px en un móvil y en un monitor ancho.
   No hay bucle de animación: los destellos y los trazos son animaciones
   puntuales (Web Animations API) y el titileo es CSS sobre `opacity`. */
(function () {
  "use strict";

  var App = (window.Constellation = window.Constellation || {});
  var SVG_NS = "http://www.w3.org/2000/svg";

  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
  var EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

  // Destello de cuatro puntas centrado en el origen.
  var SPARK = "M0 -9.5Q1.3 -1.3 9.5 0Q1.3 1.3 0 9.5Q-1.3 1.3 -9.5 0Q-1.3 -1.3 0 -9.5Z";
  var LABEL_SIZE = 11.5; // px; JetBrains Mono avanza 0,6 em por carácter
  var TIP_SIZE = 12;
  var COMPACT_WIDTH = 520;
  var LEAVE_MS = 420;

  function node(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function reduced() {
    return Boolean(window.Pluton && window.Pluton.reducedMotion());
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1).replace(/\s+$/, "") + "…" : text;
  }

  function retire(el) {
    el.classList.add("is-leaving");
    window.setTimeout(function () {
      el.remove();
    }, LEAVE_MS);
  }

  // Entrada sin desplazamiento: el elemento nace transparente y funde.
  function fadeIn(el) {
    el.classList.add("is-fading-in");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.remove("is-fading-in");
      });
    });
  }

  /* ---------- etiquetas sin solapes ---------- */

  // Colocación voraz: cada etiqueta prueba debajo, encima, derecha e izquierda
  // de su estrella y se queda con el primer hueco que no pisa otra etiqueta,
  // otra estrella ni el borde. Primero busca un hueco que tampoco cruce un
  // trazo; si no lo hay, acepta cruzarlo. Sin hueco, no se pinta (null).
  function placeLabels(items, frame) {
    var taken = [];
    var half = frame.size * 0.62;

    return items.map(function (item) {
      if (!item.text) return null;
      var width = item.text.length * frame.size * 0.6 + 6;
      var centered = clamp(item.x, frame.left + width / 2, frame.right - width / 2);
      var options = [
        { x: centered, y: item.y + 19, anchor: "middle" },
        { x: centered, y: item.y - 18, anchor: "middle" },
        { x: item.x + 15, y: item.y, anchor: "start" },
        { x: item.x - 15, y: item.y, anchor: "end" },
      ];
      var fallback = null;

      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        var x0 = o.anchor === "middle" ? o.x - width / 2 : o.anchor === "start" ? o.x : o.x - width;
        var box = { x0: x0, x1: x0 + width, y0: o.y - half, y1: o.y + half };
        if (box.x0 < frame.left || box.x1 > frame.right || box.y0 < frame.top || box.y1 > frame.bottom) continue;
        if (overlaps(box, taken) || coversStar(box, items, item)) continue;
        var spot = { x: o.x - item.x, y: o.y - item.y, anchor: o.anchor, box: box };
        if (!crossesLine(box, frame.lines)) {
          taken.push(box);
          return spot;
        }
        fallback = fallback || spot;
      }
      if (fallback) taken.push(fallback.box);
      return fallback;
    });
  }

  // ¿Algún trazo atraviesa la caja? Recorte de Liang–Barsky.
  function crossesLine(box, lines) {
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      var dx = s.x2 - s.x1;
      var dy = s.y2 - s.y1;
      var p = [-dx, dx, -dy, dy];
      var q = [s.x1 - box.x0, box.x1 - s.x1, s.y1 - box.y0, box.y1 - s.y1];
      var t0 = 0;
      var t1 = 1;
      var inside = true;
      for (var k = 0; k < 4 && inside; k++) {
        if (p[k] === 0) {
          inside = q[k] >= 0;
        } else {
          var t = q[k] / p[k];
          if (p[k] < 0) t0 = Math.max(t0, t);
          else t1 = Math.min(t1, t);
          inside = t0 <= t1;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  function overlaps(box, taken) {
    for (var i = 0; i < taken.length; i++) {
      var t = taken[i];
      if (box.x0 < t.x1 + 4 && box.x1 > t.x0 - 4 && box.y0 < t.y1 + 2 && box.y1 > t.y0 - 2) return true;
    }
    return false;
  }

  function coversStar(box, items, own) {
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      if (s === own) continue;
      if (s.x > box.x0 - 11 && s.x < box.x1 + 11 && s.y > box.y0 - 11 && s.y < box.y1 + 11) return true;
    }
    return false;
  }

  // Recorta el trazo para que no toque el núcleo de las estrellas.
  function segment(a, b, gap) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    var cut = Math.min(gap, length * 0.3);
    var ux = dx / length;
    var uy = dy / length;
    return {
      x1: a.x + ux * cut,
      y1: a.y + uy * cut,
      x2: b.x - ux * cut,
      y2: b.y - uy * cut,
      length: length - cut * 2,
    };
  }

  function setLine(el, s) {
    el.setAttribute("x1", s.x1.toFixed(1));
    el.setAttribute("y1", s.y1.toFixed(1));
    el.setAttribute("x2", s.x2.toFixed(1));
    el.setAttribute("y2", s.y2.toFixed(1));
  }

  /* ---------- cielo interactivo ---------- */

  App.createSky = function (options) {
    var stage = options.stage;
    var svg = options.svg;
    var linksLayer = svg.querySelector("#links");
    var starsLayer = svg.querySelector("#stars");
    var tip = svg.querySelector("#tip");
    var tipRect = tip.querySelector("rect");
    var tipText = tip.querySelector("text");

    var views = {}; // id → estrella en pantalla
    var order = []; // ids en el orden de la lista
    var links = {}; // "a>b" → trazo
    var size = { w: 0, h: 0 };
    var compact = false;
    var active = null; // única estrella en el orden de tabulación
    var focused = null;
    var hovered = null;
    var tipped = null;

    /* ---------- geometría ---------- */

    function pads() {
      return compact ? { l: 30, r: 30, t: 86, b: 56 } : { l: 46, r: 46, t: 88, b: 60 };
    }

    function point(task) {
      var p = pads();
      return {
        x: p.l + task.u * (size.w - p.l - p.r),
        y: p.t + task.v * (size.h - p.t - p.b),
      };
    }

    function position() {
      if (!size.w || !size.h) return;
      var list = order.map(function (id) {
        return views[id];
      });

      list.forEach(function (view) {
        var p = point(view.task);
        view.x = p.x;
        view.y = p.y;
        view.el.setAttribute("transform", "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")");
      });

      var lines = [];
      for (var key in links) {
        var link = links[key];
        link.shape = segment(views[link.a], views[link.b], 11);
        setLine(link.el, link.shape);
        lines.push(link.shape);
      }

      // Las encendidas eligen sitio primero; en pantallas estrechas las
      // pendientes no llevan etiqueta fija (aparece al enfocarlas o tocarlas).
      var ranked = list.slice().sort(function (a, b) {
        return (a.task.order || Infinity) - (b.task.order || Infinity);
      });
      var items = ranked.map(function (view) {
        var show = view.task.order || !compact;
        return { x: view.x, y: view.y, text: show ? truncate(view.task.title, compact ? 15 : 20) : "" };
      });
      var spots = placeLabels(items, {
        left: 8,
        right: size.w - 8,
        top: 66,
        bottom: size.h - 34,
        size: LABEL_SIZE,
        lines: lines,
      });
      ranked.forEach(function (view, i) {
        var spot = spots[i];
        view.el.classList.toggle("is-unlabeled", !spot);
        if (!spot) return;
        view.label.textContent = items[i].text;
        view.label.setAttribute("x", spot.x.toFixed(1));
        view.label.setAttribute("y", spot.y.toFixed(1));
        view.label.setAttribute("text-anchor", spot.anchor);
      });
      showTip();
    }

    function layout() {
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (!w || !h) return;
      size = { w: w, h: h };
      compact = w < COMPACT_WIDTH;
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      position();
    }

    /* ---------- etiqueta flotante ---------- */

    // Título completo de la estrella enfocada o bajo el cursor, siempre por
    // encima de todo lo demás.
    function showTip() {
      var id = focused || hovered;
      var view = id ? views[id] : null;
      if (tipped && views[tipped]) views[tipped].el.classList.remove("is-tipped");
      tipped = null;
      if (!view || !size.w) {
        tip.classList.remove("is-on");
        return;
      }
      var text = truncate(view.task.title, compact ? 30 : 44);
      var width = text.length * TIP_SIZE * 0.6 + 20;
      var x = clamp(view.x - width / 2, 6, Math.max(6, size.w - 6 - width));
      var below = view.y + 18 + 26 < size.h - 34; // sin tapar la línea del pie
      var y = below ? view.y + 18 : view.y - 18 - 26;
      tipText.textContent = text;
      tipText.setAttribute("x", (width / 2).toFixed(1));
      tipRect.setAttribute("width", width.toFixed(1));
      tip.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
      tip.classList.add("is-on");
      view.el.classList.add("is-tipped");
      tipped = id;
    }

    /* ---------- estrellas ---------- */

    function setActive(id) {
      if (active && views[active]) views[active].el.setAttribute("tabindex", "-1");
      active = id && views[id] ? id : order[0] || null;
      if (active) views[active].el.setAttribute("tabindex", "0");
    }

    // Flechas: salta a la estrella más cercana en esa dirección.
    function move(from, dx, dy) {
      var best = null;
      var bestScore = Infinity;
      order.forEach(function (id) {
        var view = views[id];
        if (view === from) return;
        var along = (view.x - from.x) * dx + (view.y - from.y) * dy;
        var across = Math.abs((view.x - from.x) * dy) + Math.abs((view.y - from.y) * dx);
        if (along < 4) return;
        var score = along + across * 2;
        if (score < bestScore) {
          bestScore = score;
          best = view;
        }
      });
      if (best) best.el.focus();
    }

    var ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    function build(task) {
      var g = node("g", { class: "star", role: "checkbox", tabindex: "-1" }, starsLayer);
      node("circle", { class: "star-hit", r: 22 }, g);
      var body = node("g", { class: "star-body" }, g);
      // El degradado va como atributo: en una hoja externa, url(#…) no
      // siempre se resuelve contra el documento.
      node("circle", { class: "star-halo", r: 21, fill: "url(#star-glow)" }, body);
      var burst = node("circle", { class: "star-burst", r: 9 }, body);
      node("circle", { class: "star-ring", r: 8.5 }, body);
      node("circle", { class: "star-dot", r: 2.4 }, body);
      node("path", { class: "star-spark", d: SPARK }, body);
      node("circle", { class: "star-focus", r: 16 }, g);
      var label = node("text", { class: "star-label", "dominant-baseline": "central" }, g);

      // Cada estrella titila a su ritmo; sale del id para que no cambie.
      var rand = App.model.prng(App.model.hash(task.id));
      g.style.setProperty("--twinkle", (3.4 + rand() * 3.6).toFixed(2) + "s");
      g.style.setProperty("--delay", (-rand() * 6).toFixed(2) + "s");

      var view = { task: task, el: g, body: body, burst: burst, label: label, x: 0, y: 0 };
      var id = task.id;

      g.addEventListener("click", function () {
        options.onToggle(id);
      });
      g.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onToggle(id);
        } else if (ARROWS[event.key]) {
          event.preventDefault();
          move(view, ARROWS[event.key][0], ARROWS[event.key][1]);
        }
      });
      g.addEventListener("focus", function () {
        focused = id;
        setActive(id);
        showTip();
        options.onPoint(id);
      });
      g.addEventListener("blur", function () {
        if (focused === id) focused = null;
        showTip();
        options.onPoint(hovered);
      });
      g.addEventListener("pointerenter", function (event) {
        if (event.pointerType !== "mouse") return;
        hovered = id;
        showTip();
        options.onPoint(id);
      });
      g.addEventListener("pointerleave", function () {
        if (hovered === id) hovered = null;
        showTip();
        options.onPoint(focused);
      });

      return view;
    }

    function appear(view) {
      if (reduced() || !view.body.animate) {
        fadeIn(view.el);
        return;
      }
      view.body.animate(
        [
          { transform: "scale(0.2)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 520, easing: EASE_SPRING }
      );
    }

    // Destello al encenderse: una onda que se abre y se apaga.
    function ignite(view) {
      if (reduced() || !view.burst.animate) return;
      view.burst.animate(
        [
          { transform: "scale(0.5)", opacity: 0.9 },
          { transform: "scale(3.4)", opacity: 0 },
        ],
        { duration: 760, easing: EASE_OUT }
      );
    }

    function draw(link) {
      var el = link.el;
      if (reduced() || !el.animate) {
        fadeIn(el);
        return;
      }
      var length = Math.max(1, link.shape.length);
      el.style.strokeDasharray = length + " " + length;
      var stroke = el.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: clamp(380 + length * 1.5, 480, 1100),
        delay: 140,
        easing: EASE_IN_OUT,
        fill: "backwards",
      });
      stroke.onfinish = stroke.oncancel = function () {
        el.style.strokeDasharray = "";
      };
    }

    /* ---------- sincronización con el estado ---------- */

    function render(tasks, pairs, animate) {
      var seen = {};
      var born = [];
      var lit = [];

      order = tasks.map(function (task) {
        var view = views[task.id];
        if (!view) {
          view = views[task.id] = build(task);
          if (animate) born.push(view);
        } else if (animate && task.order && !view.el.classList.contains("is-done")) {
          lit.push(view);
        }
        view.task = task;
        view.el.classList.toggle("is-done", task.order > 0);
        view.el.setAttribute("aria-checked", task.order > 0 ? "true" : "false");
        view.el.setAttribute("aria-label", task.title);
        seen[task.id] = true;
        return task.id;
      });

      for (var id in views) {
        if (seen[id]) continue;
        retire(views[id].el);
        delete views[id];
        if (focused === id) focused = null;
        if (hovered === id) hovered = null;
        if (tipped === id) tipped = null;
      }
      if (!active || !views[active]) setActive(null);

      var next = {};
      var fresh = [];
      pairs.forEach(function (pair) {
        var key = pair[0] + ">" + pair[1];
        var link = links[key];
        if (!link) {
          link = { a: pair[0], b: pair[1], el: node("line", { class: "link" }, linksLayer), shape: null };
          if (animate) fresh.push(link);
        }
        next[key] = link;
      });
      for (var old in links) {
        if (!next[old]) retire(links[old].el);
      }
      links = next;

      position();
      born.forEach(appear);
      lit.forEach(ignite);
      fresh.forEach(draw);
    }

    function highlight(id) {
      for (var key in views) views[key].el.classList.toggle("is-hot", key === id);
    }

    if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
    else window.addEventListener("resize", layout);
    layout();

    return { render: render, highlight: highlight };
  };

  /* ---------- constelación estática (miniaturas y detalle del archivo) ---------- */

  // Encaja la constelación en el marco: centrada y ampliada hasta llenarlo,
  // con tope para que dos estrellas vecinas no parezcan un cielo entero.
  function fit(stars, w, h, pad) {
    var aspect = App.model.ASPECT;
    var minU = 1, maxU = 0, minV = 1, maxV = 0;
    stars.forEach(function (s) {
      minU = Math.min(minU, s.u);
      maxU = Math.max(maxU, s.u);
      minV = Math.min(minV, s.v);
      maxV = Math.max(maxV, s.v);
    });
    var spanU = Math.max((maxU - minU) * aspect, 0.001);
    var spanV = Math.max(maxV - minV, 0.001);
    var full = Math.min((w - pad.x * 2) / aspect, h - pad.y * 2);
    var scale = Math.min((w - pad.x * 2) / spanU, (h - pad.y * 2) / spanV, full * 2.6);
    var midU = (minU + maxU) / 2;
    var midV = (minV + maxV) / 2;
    return stars.map(function (s) {
      return {
        x: w / 2 + (s.u - midU) * aspect * scale,
        y: h / 2 + (s.v - midV) * scale,
      };
    });
  }

  App.drawConstellation = function (svg, stars, options) {
    var w = options.width;
    var h = options.height;
    var big = Boolean(options.labels);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);

    var points = fit(stars, w, h, big ? { x: Math.min(90, w * 0.16), y: 46 } : { x: 18, y: 18 });

    var lines = [];
    for (var i = 1; i < points.length; i++) {
      var shape = segment(points[i - 1], points[i], big ? 11 : 5);
      setLine(node("line", { class: "a-link" }, svg), shape);
      lines.push(shape);
    }

    points.forEach(function (p) {
      var g = node("g", { class: "a-star", transform: "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")" }, svg);
      if (big) node("circle", { r: 21, fill: "url(#star-glow)" }, g);
      node("path", { class: "a-spark", d: SPARK, transform: "scale(" + (big ? 0.95 : 0.46) + ")" }, g);
    });

    if (!big) return;
    var items = points.map(function (p, i) {
      return { x: p.x, y: p.y, text: truncate(stars[i].title, w < COMPACT_WIDTH ? 15 : 22) };
    });
    placeLabels(items, { left: 6, right: w - 6, top: 6, bottom: h - 6, size: LABEL_SIZE, lines: lines }).forEach(function (spot, i) {
      if (!spot) return;
      var text = node("text", { class: "a-label", "dominant-baseline": "central", "text-anchor": spot.anchor }, svg);
      text.setAttribute("x", (items[i].x + spot.x).toFixed(1));
      text.setAttribute("y", (items[i].y + spot.y).toFixed(1));
      text.textContent = items[i].text;
    });
  };
})();

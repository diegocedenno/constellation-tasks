/* Lista, archivo y persistencia. El cielo y la lista pintan el mismo estado:
   cualquier cambio pasa por el modelo, se guarda y se vuelve a pintar todo. */
(function () {
  "use strict";

  var App = window.Constellation;
  var model = App.model;
  var STORE_KEY = "constellation-tasks:v1";
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Lápiz y, mientras se edita, visto bueno: el mismo botón abre y guarda.
  var ICON_EDIT =
    '<svg class="i-edit" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<svg class="i-save" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DELETE =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function $(id) {
    return document.getElementById(id);
  }

  var els = {
    count: $("count"),
    statusName: $("status-name"),
    taskCount: $("task-count"),
    form: $("add-form"),
    input: $("add-input"),
    notice: $("notice"),
    list: $("task-list"),
    tasksEmpty: $("tasks-empty"),
    skyName: $("sky-name"),
    rename: $("rename"),
    nameInput: $("name-input"),
    skyDay: $("sky-day"),
    archiveDay: $("archive-day"),
    skyEmpty: $("sky-empty"),
    hint: $("hint"),
    archiveCount: $("archive-count"),
    gallery: $("gallery"),
    archiveEmpty: $("archive-empty"),
    detail: $("detail"),
    detailName: $("detail-name"),
    detailMeta: $("detail-meta"),
    detailSky: $("detail-sky"),
    detailSvg: $("detail-svg"),
    detailList: $("detail-list"),
    detailClose: $("detail-close"),
    detailDelete: $("detail-delete"),
    announce: $("announce"),
  };

  var state;
  var rows = {}; // id → <li> de la lista
  var editing = null; // id de la tarea que se está editando
  var message = ""; // aviso puntual en el pie del cielo (p. ej. tras archivar)
  var galleryStamp = null; // evita reconstruir la galería si no cambió
  var opened = null; // constelación abierta en el diálogo
  var armed = 0; // temporizador de la confirmación de borrado

  function today() {
    return model.dayKey(new Date());
  }

  function reduced() {
    return window.Pluton.reducedMotion();
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function announce(text) {
    els.announce.textContent = text;
  }

  /* ---------- persistencia ---------- */

  function load() {
    var raw = null;
    try {
      raw = JSON.parse(window.localStorage.getItem(STORE_KEY));
    } catch (err) {
      raw = null;
    }
    return model.sanitize(raw, today());
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      /* almacenamiento no disponible o lleno: el cielo sigue funcionando en memoria */
    }
  }

  /* ---------- cabeceras, contadores y estados vacíos ---------- */

  function renderMeta() {
    var total = state.tasks.length;
    var done = model.completed(state).length;
    var name = model.displayName(state);
    var full = total >= model.MAX_TASKS;

    els.count.textContent = done + "/" + total;
    els.statusName.textContent = name;
    els.skyName.textContent = name;
    els.skyDay.textContent = model.formatDay(state.day);
    els.taskCount.textContent = total + "/" + model.MAX_TASKS;
    els.taskCount.classList.toggle("is-full", full);

    els.archiveDay.hidden = done === 0;
    els.skyEmpty.hidden = total > 0;
    els.tasksEmpty.hidden = total > 0;
    els.notice.hidden = !full;
    if (full) {
      els.notice.textContent = "Con " + model.MAX_TASKS + " estrellas el cielo de hoy está completo. Enciende o borra alguna, o archiva el día para empezar otro.";
    }

    var hint = message;
    if (!hint && total) {
      if (done === 0) hint = "toca una estrella para encenderla";
      else if (done === total) hint = "constelación completa · " + plural(done, "estrella", "estrellas");
      else hint = done + " de " + total + " encendidas";
    }
    els.hint.textContent = hint;
    els.hint.hidden = !hint;
  }

  /* ---------- lista ---------- */

  function buildRow(task) {
    var li = document.createElement("li");
    li.className = "task";
    li.dataset.id = task.id;

    var main = document.createElement("label");
    main.className = "task-main";
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "task-check";
    var title = document.createElement("span");
    title.className = "task-title";
    main.append(box, title);

    var field = document.createElement("input");
    field.type = "text";
    field.className = "task-edit";
    field.maxLength = model.MAX_TITLE;
    field.hidden = true;
    field.setAttribute("aria-label", "Editar el texto de la tarea");
    field.setAttribute("autocomplete", "off");

    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "task-btn";
    edit.dataset.action = "edit";
    edit.innerHTML = ICON_EDIT;

    var del = document.createElement("button");
    del.type = "button";
    del.className = "task-btn task-btn--danger";
    del.dataset.action = "delete";
    del.innerHTML = ICON_DELETE;

    li.append(main, field, edit, del);
    return li;
  }

  function renderList(animate) {
    var seen = {};
    state.tasks.forEach(function (task, index) {
      var li = rows[task.id];
      if (!li) {
        li = rows[task.id] = buildRow(task);
        if (animate && !reduced() && li.animate) {
          li.animate(
            [
              { transform: "translateY(-6px)", opacity: 0 },
              { transform: "translateY(0)", opacity: 1 },
            ],
            { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
          );
        }
      }
      seen[task.id] = true;
      if (els.list.children[index] !== li) els.list.insertBefore(li, els.list.children[index] || null);

      li.classList.toggle("is-done", task.order > 0);
      li.classList.toggle("is-editing", editing === task.id);
      li.querySelector(".task-check").checked = task.order > 0;
      li.querySelector(".task-title").textContent = task.title;
      li.querySelector(".task-main").hidden = editing === task.id;
      li.querySelector(".task-edit").hidden = editing !== task.id;
      li.querySelector('[data-action="edit"]').setAttribute("aria-label", (editing === task.id ? "Guardar: " : "Editar: ") + task.title);
      li.querySelector('[data-action="delete"]').setAttribute("aria-label", "Borrar: " + task.title);
    });

    for (var id in rows) {
      if (seen[id]) continue;
      rows[id].remove();
      delete rows[id];
    }
  }

  /* ---------- archivo ---------- */

  function entryMeta(entry) {
    return model.formatDay(entry.day, true) + " · " + plural(entry.stars.length, "estrella", "estrellas");
  }

  var ICON_SPARK =
    '<svg viewBox="-10 -10 20 20" width="10" height="10" aria-hidden="true"><path d="M0 -9.5Q1.3 -1.3 9.5 0Q1.3 1.3 0 9.5Q-1.3 1.3 -9.5 0Q-1.3 -1.3 0 -9.5Z" fill="currentColor"/></svg>';

  function renderArchive(freshId) {
    var count = state.archive.length;
    els.archiveCount.textContent = plural(count, "constelación", "constelaciones");
    els.archiveEmpty.hidden = count > 0;
    els.gallery.hidden = count === 0;

    var stamp = state.archive
      .map(function (entry) {
        return entry.id;
      })
      .join("|");
    if (stamp === galleryStamp) return;
    galleryStamp = stamp;

    els.gallery.textContent = "";
    state.archive.forEach(function (entry) {
      var li = document.createElement("li");
      var card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.id = entry.id;
      card.setAttribute("aria-label", "Abrir " + entry.name + ", " + entryMeta(entry));

      var thumb = document.createElementNS(SVG_NS, "svg");
      thumb.setAttribute("class", "card-thumb");
      thumb.setAttribute("aria-hidden", "true");
      App.drawConstellation(thumb, entry.stars, { width: 160, height: 100 });

      var name = document.createElement("span");
      name.className = "card-name";
      name.textContent = entry.name;
      // Fecha a la izquierda y nº de estrellas a la derecha; el texto completo
      // va en el aria-label de la tarjeta.
      var meta = document.createElement("span");
      meta.className = "card-meta mono";
      var day = document.createElement("span");
      day.textContent = model.formatDay(entry.day, true);
      var stars = document.createElement("span");
      stars.className = "card-stars";
      stars.innerHTML = ICON_SPARK;
      stars.append(String(entry.stars.length));
      meta.append(day, stars);

      card.append(thumb, name, meta);
      li.appendChild(card);
      els.gallery.appendChild(li);
      if (entry.id === freshId) card.classList.add("is-fresh");
    });
  }

  function render(options) {
    var opts = options || {};
    renderMeta();
    renderList(opts.animate);
    sky.render(state.tasks, model.links(state), Boolean(opts.animate));
    renderArchive(opts.freshId);
  }

  function commit(options) {
    save();
    render(options);
  }

  /* ---------- acciones sobre las tareas ---------- */

  function toggle(id) {
    var task = model.toggle(state, id);
    if (!task) return;
    message = "";
    commit({ animate: true });
  }

  function shake(el) {
    if (reduced() || !el.animate) return;
    el.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 340, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
    );
  }

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    var result = model.add(state, els.input.value, Date.now());
    if (!result.ok) {
      if (result.reason === "limit") {
        shake(els.form);
        announce(els.notice.textContent);
      }
      return;
    }
    els.input.value = "";
    message = "";
    commit({ animate: true });
    els.list.scrollTop = els.list.scrollHeight;
  });

  function startEdit(id) {
    var task = model.find(state, id);
    if (!task) return;
    editing = id;
    renderList(false);
    var field = rows[id].querySelector(".task-edit");
    field.value = task.title;
    field.focus();
    field.select();
  }

  function finishEdit(saveChanges, refocus) {
    var id = editing;
    if (!id || !rows[id]) return;
    editing = null; // antes de ocultar el campo: su blur no debe volver a guardar
    if (saveChanges) model.retitle(state, id, rows[id].querySelector(".task-edit").value);
    commit();
    if (refocus) rows[id].querySelector('[data-action="edit"]').focus();
  }

  function removeTask(id, byKeyboard) {
    var li = rows[id];
    var neighbour = li && (li.nextElementSibling || li.previousElementSibling);
    if (editing === id) editing = null;
    if (!model.remove(state, id)) return;
    message = "";
    commit({ animate: true });
    // Con teclado el foco no se pierde: pasa a la tarea vecina o al campo de
    // texto. Con el dedo no se mueve, para no abrir el teclado en pantalla.
    if (!byKeyboard) return;
    var target = neighbour ? neighbour.querySelector(".task-check") : els.input;
    target.focus({ preventScroll: true });
  }

  els.list.addEventListener("change", function (event) {
    var row = event.target.closest(".task");
    if (row && event.target.classList.contains("task-check")) toggle(row.dataset.id);
  });

  els.list.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var id = button.closest(".task").dataset.id;
    if (button.dataset.action === "delete") removeTask(id, event.detail === 0);
    else if (editing === id) finishEdit(true, true);
    else startEdit(id);
  });

  els.list.addEventListener("keydown", function (event) {
    if (!event.target.classList.contains("task-edit")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finishEdit(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEdit(false, true);
    }
  });

  // Salir del campo guarda. El botón de guardar no le quita el foco al
  // pulsarlo (mousedown anulado): así su clic no llega con la edición ya cerrada.
  els.list.addEventListener("focusout", function (event) {
    if (event.target.classList.contains("task-edit") && editing) finishEdit(true, false);
  });

  els.list.addEventListener("mousedown", function (event) {
    if (editing && event.target.closest('[data-action="edit"]')) event.preventDefault();
  });

  // Lista y cielo se señalan mutuamente.
  function pointRow(id) {
    for (var key in rows) rows[key].classList.toggle("is-hot", key === id);
  }

  function rowId(event) {
    var row = event.target.closest && event.target.closest(".task");
    return row ? row.dataset.id : null;
  }

  els.list.addEventListener("pointerover", function (event) {
    if (event.pointerType === "mouse") sky.highlight(rowId(event));
  });
  els.list.addEventListener("pointerleave", function () {
    sky.highlight(null);
  });
  els.list.addEventListener("focusin", function (event) {
    // Solo con teclado: tras un toque el foco se queda en la casilla y la
    // estrella seguiría señalada sin motivo.
    sky.highlight(event.target.matches(":focus-visible") ? rowId(event) : null);
  });
  els.list.addEventListener("focusout", function () {
    sky.highlight(null);
  });

  /* ---------- nombre de la constelación ---------- */

  function setRenaming(on) {
    els.skyName.hidden = on;
    els.rename.hidden = on;
    els.nameInput.hidden = !on;
  }

  els.rename.addEventListener("click", function () {
    setRenaming(true);
    els.nameInput.value = model.displayName(state);
    els.nameInput.focus();
    els.nameInput.select();
  });

  function finishRename(saveChanges, refocus) {
    if (els.nameInput.hidden) return;
    setRenaming(false);
    if (saveChanges) {
      model.setName(state, els.nameInput.value);
      commit();
      announce("La constelación de hoy se llama " + model.displayName(state));
    }
    if (refocus) els.rename.focus();
  }

  els.nameInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishRename(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(false, true);
    }
  });

  els.nameInput.addEventListener("blur", function () {
    finishRename(true, false);
  });

  /* ---------- archivar ---------- */

  els.archiveDay.addEventListener("click", function (event) {
    // Tras un clic de ratón el botón se queda con el foco; se suelta para
    // que un Enter posterior no archive otra vez.
    if (event.detail > 0) els.archiveDay.blur();
    var entry = model.archiveDay(state, Date.now());
    if (!entry) return;
    message = entry.name + " guardada en el archivo";
    commit({ animate: true, freshId: entry.id });
    announce(entry.name + " guardada en el archivo con " + plural(entry.stars.length, "estrella", "estrellas") + ". Empieza un cielo nuevo.");
    if (!event.detail) els.input.focus();
  });

  // Al cargar y al volver a la pestaña: si cambió la fecha, lo de ayer se archiva solo.
  function checkDay() {
    var result = model.rollover(state, today(), Date.now());
    if (!result) return null;
    message = "";
    if (result.entry) {
      message = result.entry.name + " (" + model.formatDay(result.entry.day) + ") guardada en el archivo";
      announce("Nuevo día. " + result.entry.name + " se guardó en el archivo.");
    }
    editing = null;
    return result;
  }

  document.addEventListener("visibilitychange", function () {
    // El titileo no corre con la pestaña oculta.
    document.documentElement.classList.toggle("is-paused", document.hidden);
    if (document.hidden) return;
    var result = checkDay();
    if (result) commit({ freshId: result.entry ? result.entry.id : null });
  });

  /* ---------- detalle de una constelación archivada ---------- */

  function drawDetail() {
    if (!opened) return;
    var width = els.detailSky.clientWidth;
    if (!width) return;
    var height = Math.round(Math.min(340, Math.max(220, width * 0.56)));
    els.detailSky.style.height = height + "px";
    App.drawConstellation(els.detailSvg, opened.stars, { width: width, height: height, labels: true });
  }

  function disarm() {
    window.clearTimeout(armed);
    armed = 0;
    els.detailDelete.textContent = "borrar del archivo";
    els.detailDelete.classList.remove("is-armed");
  }

  function openDetail(entry) {
    opened = entry;
    disarm();
    els.detailName.textContent = entry.name;
    var meta = entryMeta(entry);
    if (entry.pending) meta += " · " + plural(entry.pending, "pendiente", "pendientes");
    els.detailMeta.textContent = meta;
    els.detailSvg.setAttribute("aria-label", "Constelación " + entry.name + " con " + plural(entry.stars.length, "estrella", "estrellas"));

    els.detailList.textContent = "";
    entry.stars.forEach(function (star) {
      var li = document.createElement("li");
      li.textContent = star.title;
      els.detailList.appendChild(li);
    });

    if (typeof els.detail.showModal === "function") els.detail.showModal();
    else els.detail.setAttribute("open", "");
    drawDetail();
  }

  function closeDetail() {
    if (typeof els.detail.close === "function") els.detail.close();
    else els.detail.removeAttribute("open");
    opened = null;
    disarm();
  }

  els.gallery.addEventListener("click", function (event) {
    var card = event.target.closest(".card");
    if (!card) return;
    for (var i = 0; i < state.archive.length; i++) {
      if (state.archive[i].id === card.dataset.id) {
        openDetail(state.archive[i]);
        return;
      }
    }
  });

  els.detailClose.addEventListener("click", closeDetail);

  els.detail.addEventListener("close", function () {
    opened = null;
    disarm();
  });

  // Clic fuera del panel (sobre el fondo del diálogo) también cierra.
  els.detail.addEventListener("click", function (event) {
    if (event.target === els.detail) closeDetail();
  });

  // Borrar pide confirmación en el propio botón: el segundo clic es el que borra.
  els.detailDelete.addEventListener("click", function (event) {
    if (!opened) return;
    if (!armed) {
      els.detailDelete.textContent = "¿seguro? pulsa otra vez";
      els.detailDelete.classList.add("is-armed");
      armed = window.setTimeout(disarm, 4000);
      return;
    }
    var name = opened.name;
    model.removeArchived(state, opened.id);
    closeDetail();
    commit();
    announce(name + " borrada del archivo");
    if (event.detail > 0) return;
    var first = els.gallery.querySelector(".card");
    (first || els.input).focus({ preventScroll: true });
  });

  if (window.ResizeObserver) new ResizeObserver(drawDetail).observe(els.detailSky);

  /* ---------- arranque ---------- */

  var sky = App.createSky({
    stage: $("stage"),
    svg: $("sky"),
    onToggle: toggle,
    onPoint: pointRow,
  });

  state = load();
  if (checkDay()) save();
  render();
})();

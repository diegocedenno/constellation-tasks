/* Modelo: las tareas del día, dónde cae cada estrella, cómo se llama la
   constelación y qué se guarda en el archivo. Lógica pura, sin DOM: todo lo
   que hay aquí se puede probar con node. */
(function () {
  "use strict";

  var App = (window.Constellation = window.Constellation || {});

  var MAX_TASKS = 24;
  var MAX_TITLE = 80;
  var MAX_NAME = 28;
  var MAX_ARCHIVE = 400; // válvula de seguridad: más de un año de cielos
  var CANDIDATES = 28;
  var ASPECT = 1.6; // el cielo es apaisado: la distancia horizontal pesa más

  /* ---------- azar determinista ---------- */

  // FNV-1a de 32 bits.
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- fechas (siempre en hora local) ---------- */

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseDay(key) {
    var parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function isDayKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return dayKey(parseDay(value)) === value; // descarta 2026-02-31
  }

  // "sáb 3 oct" o, con año, "3 oct 2026".
  function formatDay(key, withYear) {
    try {
      var options = withYear
        ? { day: "numeric", month: "short", year: "numeric" }
        : { weekday: "short", day: "numeric", month: "short" };
      return new Intl.DateTimeFormat("es", options).format(parseDay(key)).replace(/[,.]/g, "");
    } catch (err) {
      return key;
    }
  }

  /* ---------- nombre de la constelación ---------- */

  var ROOTS = [
    "Lyr", "Cor", "Vel", "Aur", "Car", "Hydr", "Pers", "Cet", "Pav", "Vulp",
    "Serp", "Lup", "Col", "Dor", "Tuc", "Vol", "Cygn", "Aquil", "Pyx", "Norm",
    "Mens", "Cael", "Gem", "Delph", "Ori", "Musc", "Phoen", "Erid", "Andr", "Ant",
  ];
  var ENDINGS = ["a", "us", "um", "is", "ia", "ara", "ix", "ium", "ela", "on"];
  var EPITHETS = [
    "Minor", "Major", "Australis", "Borealis", "Nova", "Prima", "Tenuis", "Clara",
    "Vesper", "Errans", "Quieta", "Alta", "Parva", "Serena", "Diurna",
  ];

  // Pseudo-latín con semilla: el mismo día siempre recibe el mismo nombre.
  function nameFor(seed) {
    var rand = prng(hash("nombre:" + seed));
    var pick = function (list) {
      return list[Math.floor(rand() * list.length)];
    };
    return pick(ROOTS) + pick(ENDINGS) + " " + pick(EPITHETS);
  }

  /* ---------- posición de las estrellas ---------- */

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  // "Mejor candidato" de Mitchell con el azar sembrado por el id: de varios
  // puntos posibles se queda con el más alejado de las estrellas que ya hay.
  // Reparte el cielo sin rejilla y da el mismo resultado para el mismo id.
  function place(id, others) {
    var rand = prng(hash(id));
    var best = null;
    var bestDistance = -1;
    for (var i = 0; i < CANDIDATES; i++) {
      var u = rand();
      var v = rand();
      var nearest = Infinity;
      for (var k = 0; k < others.length; k++) {
        var du = (u - others[k].u) * ASPECT;
        var dv = v - others[k].v;
        nearest = Math.min(nearest, du * du + dv * dv);
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = { u: round4(u), v: round4(v) };
      }
    }
    return best;
  }

  /* ---------- estado ---------- */

  function clean(value, max) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  function unit(value) {
    return typeof value === "number" && value >= 0 && value <= 1;
  }

  function create(today) {
    return {
      v: 1,
      day: today,
      seed: today + "#0", // día + nº de cielo: archivar a mano estrena nombre
      name: "", // vacío = usar el nombre generado
      seq: 0, // contador único: ids y orden en que se completan
      tasks: [],
      archive: [],
    };
  }

  // Reconstruye el estado a partir de lo leído sin fiarse de nada.
  function sanitize(raw, today) {
    var state = create(today);
    if (!raw || typeof raw !== "object" || raw.v !== 1) return state;

    if (isDayKey(raw.day)) state.day = raw.day;
    state.seed = typeof raw.seed === "string" && raw.seed.length <= 24 && raw.seed.indexOf(state.day) === 0 ? raw.seed : state.day + "#0";
    state.name = clean(raw.name, MAX_NAME);
    if (typeof raw.seq === "number" && raw.seq > 0 && isFinite(raw.seq)) state.seq = Math.floor(raw.seq);

    var seen = {};
    (Array.isArray(raw.tasks) ? raw.tasks : []).forEach(function (item) {
      if (state.tasks.length >= MAX_TASKS || !item || typeof item.id !== "string" || !item.id || item.id.length > 40) return;
      var title = clean(item.title, MAX_TITLE);
      if (!title || seen[item.id]) return;
      seen[item.id] = true;
      var spot = unit(item.u) && unit(item.v) ? { u: item.u, v: item.v } : place(item.id, state.tasks);
      var order = typeof item.order === "number" && item.order > 0 && isFinite(item.order) ? Math.floor(item.order) : 0;
      state.seq = Math.max(state.seq, order);
      state.tasks.push({ id: item.id, title: title, u: spot.u, v: spot.v, order: order });
    });

    (Array.isArray(raw.archive) ? raw.archive : []).forEach(function (item) {
      if (state.archive.length >= MAX_ARCHIVE || !item || typeof item.id !== "string" || !item.id || !isDayKey(item.day)) return;
      var stars = (Array.isArray(item.stars) ? item.stars : [])
        .filter(function (star) {
          return star && clean(star.title, MAX_TITLE) && unit(star.u) && unit(star.v);
        })
        .slice(0, MAX_TASKS)
        .map(function (star) {
          return { title: clean(star.title, MAX_TITLE), u: star.u, v: star.v };
        });
      if (!stars.length) return;
      state.archive.push({
        id: item.id,
        day: item.day,
        name: clean(item.name, MAX_NAME) || nameFor(item.day + "#0"),
        stars: stars,
        pending: typeof item.pending === "number" && item.pending > 0 ? Math.min(MAX_TASKS, Math.floor(item.pending)) : 0,
      });
    });

    return state;
  }

  function displayName(state) {
    return state.name || nameFor(state.seed);
  }

  function setName(state, name) {
    var value = clean(name, MAX_NAME);
    state.name = value === nameFor(state.seed) ? "" : value;
  }

  function find(state, id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function add(state, title, now) {
    var value = clean(title, MAX_TITLE);
    if (!value) return { ok: false, reason: "empty" };
    if (state.tasks.length >= MAX_TASKS) return { ok: false, reason: "limit" };
    var id = now.toString(36) + "-" + (++state.seq).toString(36);
    var spot = place(id, state.tasks);
    var task = { id: id, title: value, u: spot.u, v: spot.v, order: 0 };
    state.tasks.push(task);
    return { ok: true, task: task };
  }

  // Completar asigna el siguiente número de orden; descompletar lo suelta.
  function toggle(state, id) {
    var task = find(state, id);
    if (!task) return null;
    task.order = task.order ? 0 : ++state.seq;
    return task;
  }

  function retitle(state, id, title) {
    var task = find(state, id);
    var value = clean(title, MAX_TITLE);
    if (!task || !value) return false;
    task.title = value;
    return true;
  }

  function remove(state, id) {
    var before = state.tasks.length;
    state.tasks = state.tasks.filter(function (task) {
      return task.id !== id;
    });
    return state.tasks.length < before;
  }

  // Estrellas encendidas, en el orden en que se completaron.
  function completed(state) {
    return state.tasks
      .filter(function (task) {
        return task.order > 0;
      })
      .sort(function (a, b) {
        return a.order - b.order;
      });
  }

  // Trazos de la constelación: cada estrella con la siguiente.
  function links(state) {
    var done = completed(state);
    var pairs = [];
    for (var i = 1; i < done.length; i++) pairs.push([done[i - 1].id, done[i].id]);
    return pairs;
  }

  function skiesOn(state, day) {
    return state.archive.filter(function (entry) {
      return entry.day === day;
    }).length;
  }

  // Guarda las estrellas encendidas como constelación y deja un cielo nuevo.
  // Las tareas pendientes siguen en el cielo: no se han hecho todavía.
  function archiveDay(state, now) {
    var done = completed(state);
    if (!done.length) return null;
    var entry = {
      id: "c" + now.toString(36) + "-" + (++state.seq).toString(36),
      day: state.day,
      name: displayName(state),
      stars: done.map(function (task) {
        return { title: task.title, u: task.u, v: task.v };
      }),
      pending: state.tasks.length - done.length,
    };
    state.archive.unshift(entry);
    if (state.archive.length > MAX_ARCHIVE) state.archive.length = MAX_ARCHIVE;
    state.tasks = state.tasks.filter(function (task) {
      return !task.order;
    });
    state.name = "";
    state.seed = state.day + "#" + skiesOn(state, state.day);
    return entry;
  }

  // Cambio de día: archiva lo de ayer (si brilló algo) y estrena fecha.
  function rollover(state, today, now) {
    if (state.day === today) return null;
    var entry = archiveDay(state, now);
    state.day = today;
    state.name = "";
    state.seed = today + "#" + skiesOn(state, today);
    return { entry: entry };
  }

  function removeArchived(state, id) {
    var before = state.archive.length;
    state.archive = state.archive.filter(function (entry) {
      return entry.id !== id;
    });
    return state.archive.length < before;
  }

  App.model = {
    MAX_TASKS: MAX_TASKS,
    MAX_TITLE: MAX_TITLE,
    MAX_NAME: MAX_NAME,
    ASPECT: ASPECT,
    hash: hash,
    prng: prng,
    dayKey: dayKey,
    isDayKey: isDayKey,
    formatDay: formatDay,
    nameFor: nameFor,
    place: place,
    create: create,
    sanitize: sanitize,
    displayName: displayName,
    setName: setName,
    find: find,
    add: add,
    toggle: toggle,
    retitle: retitle,
    remove: remove,
    completed: completed,
    links: links,
    archiveDay: archiveDay,
    rollover: rollover,
    removeArchived: removeArchived,
  };
})();

/*
 * Правки старых страниц из Tilda, которые нельзя сделать одним CSS (пара к legacy-overrides.css).
 * Подключается в <head> каждой такой страницы скриптом scripts/tilda_export.py.
 */

/*
 * Главная и School, карточки направлений (rec1077498656, rec1077539861, rec1120069051, rec11794264{76,81,86}):
 * плашка «Узнать больше» (group_10_1.svg) стоит внизу карточки, на GAP ниже самого длинного описания в ряду, —
 * у карточек одного ряда кнопки на одной высоте при любой длине текста. В Zero Block у кнопок жёсткие координаты,
 * поэтому скрипт мерит описания и сдвигает кнопки, а за ними — всё, что ниже (карточки следующего ряда в мобильной
 * раскладке), и высоту артборда.
 * Сдвиг — через margin-top: top Tilda переписывает на каждом ресайзе, margin не трогает. Координаты считаются через
 * offsetTop/offsetHeight × zoom (ниже 960px Tilda масштабирует элементы zoom-ом), а не getBoundingClientRect:
 * на элементах висит transform анимации появления.
 */
(function () {
  var BUTTON = 'img[src$="__group_10_1.svg"]';
  var GAP = 20; // px макета между описанием и кнопкой

  function zoomOf(el) {
    return parseFloat(getComputedStyle(el).zoom) || 1;
  }

  function box(el) {
    var z = zoomOf(el);
    return { el: el, z: z, top: el.offsetTop * z, bottom: (el.offsetTop + el.offsetHeight) * z,
      left: el.offsetLeft * z, right: (el.offsetLeft + el.offsetWidth) * z };
  }

  function layout(artboard) {
    var elems = [].slice.call(artboard.querySelectorAll('.tn-elem'));
    elems.forEach(function (el) { el.style.marginTop = ''; });
    // Высоту артборда возвращаем к той, что поставила Tilda (её инлайн-значение или CSS).
    if (artboard.style.height !== artboard.ndHeight) artboard.ndOrigHeight = artboard.style.height;
    artboard.style.removeProperty('height');
    if (artboard.ndOrigHeight) artboard.style.height = artboard.ndOrigHeight;
    artboard.ndHeight = artboard.style.height;

    var boxes = elems.map(box);
    var texts = boxes.filter(function (b) { return b.el.getAttribute('data-elem-type') === 'text'; });
    var cards = boxes.filter(function (b) { return b.el.querySelector(BUTTON); }).map(function (btn) {
      // Описание — нижний текст над кнопкой в её колонке.
      var desc = null;
      texts.forEach(function (t) {
        if (t.left < btn.right && t.right > btn.left && t.top < btn.top && (!desc || t.top > desc.top)) desc = t;
      });
      return desc && { btn: btn, desc: desc };
    }).filter(Boolean);
    if (!cards.length) return;

    // Ряд — карточки, у которых описания начинаются на одной высоте.
    var rows = [];
    cards.sort(function (a, b) { return a.desc.top - b.desc.top; }).forEach(function (card) {
      var row = rows[rows.length - 1];
      if (row && Math.abs(row[0].desc.top - card.desc.top) < 2) row.push(card);
      else rows.push([card]);
    });

    var shift = 0;
    var bounds = rows.map(function (row) {
      var lowest = Math.max.apply(null, row.map(function (c) { return c.btn.top; }));
      var target = Math.max.apply(null, row.map(function (c) { return c.desc.bottom + GAP * c.btn.z; }));
      var before = shift;
      row.forEach(function (c) { c.shift = before + target - c.btn.top; });
      shift = before + target - lowest;
      return { lowest: lowest, before: before };
    });

    var buttons = cards.map(function (c) { return c.btn.el; });
    boxes.forEach(function (b) {
      var s = shift;
      if (buttons.indexOf(b.el) !== -1) {
        s = cards[buttons.indexOf(b.el)].shift;
      } else {
        for (var i = 0; i < bounds.length; i++) {
          if (b.top <= bounds[i].lowest) { s = bounds[i].before; break; }
        }
      }
      if (Math.abs(s) >= 0.5) b.el.style.marginTop = s / b.z + 'px';
    });
    if (Math.abs(shift) >= 0.5) {
      artboard.style.setProperty('height', artboard.offsetHeight + shift + 'px', 'important');
      artboard.ndHeight = artboard.style.height;
    }
  }

  function watch(artboard) {
    var queued = false;
    var mo = new MutationObserver(schedule);
    var ro = new ResizeObserver(schedule);

    function run() {
      queued = false;
      mo.disconnect();
      layout(artboard);
      mo.takeRecords();
      mo.observe(artboard, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
    }
    function schedule() {
      if (!queued) { queued = true; requestAnimationFrame(run); }
    }

    // Tilda ставит top/zoom на ресайзе и при отрисовке — пересчитываемся после неё; шрифты и перенос строк ловит RO.
    [].forEach.call(artboard.querySelectorAll('.tn-elem[data-elem-type="text"]'), function (t) { ro.observe(t); });
    run();
  }

  function init() {
    [].forEach.call(document.querySelectorAll('.t396__artboard'), function (artboard) {
      if (artboard.querySelector(BUTTON)) watch(artboard);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

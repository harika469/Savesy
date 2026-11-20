// Renders the Reelbox home page from state sent by the app. All text goes in with textContent, so a caption or
// title can never inject markup. The native side is the `Reelbox` bridge object (see HomeWebScreen.kt).
(function () {
  'use strict';
  var bridge = window.Reelbox || {};
  function call(name) { try { if (bridge[name]) bridge[name].apply(bridge, Array.prototype.slice.call(arguments, 1)); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function $(id) { return document.getElementById(id); }

  var search = $('search');
  search.addEventListener('input', function () { call('search', search.value); });
  $('open-ig').addEventListener('click', function (e) { e.preventDefault(); call('openInstagram'); });
  $('add-link').addEventListener('click', function () { call('addLink'); });

  function stat(value, label) { var d = el('div', 'stat'); d.appendChild(el('b', '', String(value))); d.appendChild(document.createTextNode(label)); return d; }

  window.render = function (s) {
    // stats
    var stats = $('stats'); stats.textContent = '';
    stats.appendChild(stat(s.stats.saved, 'Saved')); stats.appendChild(stat(s.stats.folders, 'Folders')); stats.appendChild(stat(s.stats.week, 'This week'));

    // clipboard banner
    var banner = $('banner'); banner.textContent = '';
    if (s.banner) {
      var note = el('div', 'note');
      note.appendChild(el('b', '', 'Reel link copied'));
      note.appendChild(document.createElement('br'));
      note.appendChild(document.createTextNode(s.banner.link));
      note.appendChild(document.createElement('br'));
      var save = el('a', 'act', 'Save to Reelbox'); save.addEventListener('click', function () { call('saveClipboard'); });
      var no = el('a', 'act quiet', 'Not now'); no.addEventListener('click', function () { call('dismissClipboard'); });
      note.appendChild(save); note.appendChild(no); banner.appendChild(note);
    }

    // folder chips
    var chips = $('chips'); chips.textContent = '';
    s.chips.forEach(function (c) {
      var chip = el('div', 'chip' + (c.active ? ' active' : ''), c.name);
      chip.addEventListener('click', function () { call('folder', c.id === null ? '' : String(c.id)); });
      chips.appendChild(chip);
    });

    // cards
    var grid = $('grid'); grid.textContent = '';
    s.reels.forEach(function (r) {
      var card = el('div', 'card');
      var thumb = el('div', 'thumb'); thumb.style.background = 'linear-gradient(135deg,' + r.from + ',' + r.to + ')';
      thumb.appendChild(document.createTextNode(r.emoji)); thumb.appendChild(el('span', '', r.badge));
      var body = el('div', 'body'); body.appendChild(el('b', '', r.title)); body.appendChild(el('small', '', r.meta)); body.appendChild(document.createElement('br'));
      r.tags.forEach(function (t) { body.appendChild(el('span', 'pill', '#' + t)); });
      card.appendChild(thumb); card.appendChild(body);
      card.addEventListener('click', function () { call(r.sample ? 'sample' : 'openReel', String(r.id)); });
      grid.appendChild(card);
    });

    $('sample').hidden = !s.sample;
    var empty = $('empty'); empty.hidden = !s.emptyMessage; empty.textContent = s.emptyMessage || '';
    if (document.activeElement !== search && search.value !== s.query) search.value = s.query;
  };

  if (window.__initialState) window.render(window.__initialState);
  call('ready');
})();

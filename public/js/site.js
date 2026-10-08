// Gombe State High Court: small interactive features of the public site
(function () {
  'use strict';

  // Back to top button
  var topBtn = document.getElementById('btn-back-to-top');
  if (topBtn) {
    window.addEventListener('scroll', function () {
      topBtn.style.display = window.scrollY > 300 ? 'block' : 'none';
    }, { passive: true });
    topBtn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // Paged card grids (for example the judges on the home page, three at a time)
  document.querySelectorAll('.paged-grid').forEach(function (grid) {
    var per = parseInt(grid.getAttribute('data-per-page'), 10) || 3;
    var items = Array.prototype.slice.call(grid.querySelectorAll('[data-page-item]'));
    var pages = Math.max(1, Math.ceil(items.length / per));
    var page = 1;
    var label = grid.querySelector('[data-pager="label"]');
    var prev = grid.querySelector('[data-pager="prev"]');
    var next = grid.querySelector('[data-pager="next"]');
    function show() {
      items.forEach(function (el, i) { el.hidden = i < (page - 1) * per || i >= page * per; });
      if (label) label.textContent = 'Page ' + page + ' of ' + pages;
      if (prev) prev.disabled = page === 1;
      if (next) next.disabled = page === pages;
    }
    if (pages === 1) { var c = grid.querySelector('.pager-controls'); if (c) c.hidden = true; }
    if (prev) prev.addEventListener('click', function () { if (page > 1) { page--; show(); } });
    if (next) next.addEventListener('click', function () { if (page < pages) { page++; show(); } });
    show();
  });

  // Small Claims eligibility check (buttons with data-quiz-answer)
  document.querySelectorAll('[data-quiz-answer]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var scope = btn.closest('section') || document;
      var answer = btn.getAttribute('data-quiz-answer');
      scope.querySelectorAll('[data-quiz-result]').forEach(function (r) { r.hidden = r.getAttribute('data-quiz-result') !== answer; });
    });
  });

  // Photo viewer for albums
  var group = document.querySelector('[data-lightbox-group]');
  var modalEl = document.getElementById('lightbox');
  if (group && modalEl && window.bootstrap) {
    var links = Array.prototype.slice.call(group.querySelectorAll('[data-lightbox-index]'));
    var modal = new bootstrap.Modal(modalEl);
    var imgEl = modalEl.querySelector('[data-lb-img]');
    var cap = modalEl.querySelector('[data-lb-caption]');
    var current = 0;
    function open(i) {
      current = (i + links.length) % links.length;
      imgEl.src = links[current].getAttribute('href');
      imgEl.alt = links[current].getAttribute('data-caption') || 'Photo ' + (current + 1);
      cap.textContent = (links[current].getAttribute('data-caption') || '') + '  (' + (current + 1) + ' of ' + links.length + ')';
    }
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) { e.preventDefault(); open(i); modal.show(); });
    });
    modalEl.querySelector('[data-lb="prev"]').addEventListener('click', function () { open(current - 1); });
    modalEl.querySelector('[data-lb="next"]').addEventListener('click', function () { open(current + 1); });
    modalEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') open(current - 1);
      if (e.key === 'ArrowRight') open(current + 1);
    });
  }

  // Keep imported tab and collapse widgets working when Bootstrap loads late
  document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('active'); });
})();

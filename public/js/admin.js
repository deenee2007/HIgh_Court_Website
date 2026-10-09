// Admin dashboard behaviour (no inline scripts, so the strict security policy can stay on)
(function () {
  'use strict';
  var csrf = document.body.getAttribute('data-csrf') || '';

  // Eye button on every password field to show or hide what was typed
  function addEye(inp) {
    if (inp.dataset.eye) return;
    inp.dataset.eye = '1';
    var group = document.createElement('div');
    group.className = 'input-group';
    inp.parentNode.insertBefore(group, inp);
    group.appendChild(inp);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline-secondary';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<i class="far fa-eye" aria-hidden="true"></i>';
    btn.addEventListener('click', function () {
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.innerHTML = '<i class="far ' + (show ? 'fa-eye-slash' : 'fa-eye') + '" aria-hidden="true"></i>';
      inp.focus();
    });
    group.appendChild(btn);
  }
  document.querySelectorAll('input[type="password"]').forEach(addEye);

  // Strong temporary password generator (Users page)
  document.querySelectorAll('[data-generate-password]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.querySelector(btn.getAttribute('data-generate-password'));
      var letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
      var digits = '23456789';
      var all = letters + digits;
      var pick = function (set) { var a = new Uint32Array(1); crypto.getRandomValues(a); return set[a[0] % set.length]; };
      var out = [pick(letters), pick(letters), pick(digits), pick(digits)];
      while (out.length < 14) out.push(pick(all));
      for (var i = out.length - 1; i > 0; i--) { var a = new Uint32Array(1); crypto.getRandomValues(a); var j = a[0] % (i + 1); var t = out[i]; out[i] = out[j]; out[j] = t; }
      inp.value = out.join('');
      if (inp.type === 'password') { var eye = inp.parentNode.querySelector('button'); if (eye) eye.click(); else inp.type = 'text'; }
      inp.select();
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Mobile sidebar
  var toggle = document.querySelector('[data-toggle-side]');
  if (toggle) toggle.addEventListener('click', function () { document.getElementById('adminSide').classList.toggle('open'); });

  // Confirmation before dangerous actions
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.getAttribute('data-confirm'))) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Web address preview generated from the title
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  var src = document.querySelector('[data-slug-source]');
  var target = document.querySelector('[data-slug-target]');
  if (src && target && !target.value && !target.readOnly) {
    var touched = false;
    target.addEventListener('input', function () { touched = true; });
    src.addEventListener('input', function () { if (!touched) target.value = slugify(src.value); });
  }

  // Repeating items (cards, links)
  function renumber(list, name) {
    Array.prototype.forEach.call(list.children, function (row, i) {
      row.querySelectorAll('[name]').forEach(function (inp) {
        inp.name = inp.name.replace(new RegExp('^' + name.replace(/[[\]]/g, '\\$&') + '\\[(\\d+|__i__)\\]'), name + '[' + i + ']');
      });
    });
  }
  document.querySelectorAll('.repeater').forEach(function (rep) {
    var name = rep.getAttribute('data-name');
    var list = rep.querySelector('.repeat-list');
    var tpl = rep.querySelector('template');
    rep.querySelector('[data-add]').addEventListener('click', function () {
      var html = tpl.innerHTML.split('__i__').join(String(list.children.length));
      list.insertAdjacentHTML('beforeend', html);
      renumber(list, name);
    });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('.repeat-row');
      if (!row) return;
      if (e.target.closest('[data-remove]')) { row.remove(); renumber(list, name); }
      if (e.target.closest('[data-move="up"]') && row.previousElementSibling) { list.insertBefore(row, row.previousElementSibling); renumber(list, name); }
    });
  });

  // Section field editor
  var fieldsBox = document.querySelector('.repeater-fields');
  if (fieldsBox) {
    var flist = fieldsBox.querySelector('.field-list');
    var ftpl = fieldsBox.querySelector('template');
    var next = parseInt(fieldsBox.getAttribute('data-next'), 10) || 0;
    function syncType(row) {
      var sel = row.querySelector('[data-field-type]');
      row.setAttribute('data-type', sel ? sel.value : '');
    }
    function keyFrom(label) {
      var w = String(label || '').normalize('NFKD').replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
      var k = w.map(function (x, i) { return i ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase(); }).join('').slice(0, 40);
      return /^[a-z]/.test(k) ? k : (k ? 'f' + k : '');
    }
    flist.querySelectorAll('.field-row').forEach(syncType);
    fieldsBox.querySelector('[data-add-field]').addEventListener('click', function () {
      flist.insertAdjacentHTML('beforeend', ftpl.innerHTML.split('__i__').join(String(next++)));
      var row = flist.lastElementChild;
      syncType(row);
      var label = row.querySelector('[data-field-label]');
      var key = row.querySelector('[data-field-key]');
      label.addEventListener('input', function () { if (!key.dataset.touched) key.value = keyFrom(label.value); });
      key.addEventListener('input', function () { key.dataset.touched = '1'; });
      label.focus();
    });
    flist.addEventListener('change', function (e) {
      if (e.target.matches('[data-field-type]')) syncType(e.target.closest('.field-row'));
    });
    flist.addEventListener('click', function (e) {
      var row = e.target.closest('.field-row');
      if (!row) return;
      if (e.target.closest('[data-remove]') && window.confirm('Remove this field?')) row.remove();
      if (e.target.closest('[data-move="up"]') && row.previousElementSibling) flist.insertBefore(row, row.previousElementSibling);
    });
    // keep submitted order equal to the visual order
    document.getElementById('sectionForm').addEventListener('submit', function () {
      Array.prototype.forEach.call(flist.children, function (row, i) {
        row.querySelectorAll('[name^="fields["]').forEach(function (inp) { inp.name = inp.name.replace(/^fields\[[^\]]+\]/, 'fields[' + i + ']'); });
      });
    });
  }

  // Layout description in the section form
  var layoutSel = document.querySelector('[data-layout-select]');
  var layoutDesc = document.querySelector('[data-layout-desc]');
  if (layoutSel && layoutDesc) layoutSel.addEventListener('change', function () { layoutDesc.textContent = layoutSel.selectedOptions[0].getAttribute('data-desc'); });

  // User form: hide staff permissions for super admins
  var roleSel = document.querySelector('[data-role-select]');
  function syncRole() { document.querySelectorAll('[data-staff-only]').forEach(function (el) { el.hidden = roleSel && roleSel.value === 'superadmin'; }); }
  if (roleSel) { roleSel.addEventListener('change', syncRole); syncRole(); }

  // Menu: picking a section or page fills in the address
  document.querySelectorAll('[data-menu-target]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var form = sel.closest('form');
      if (sel.value) { form.querySelector('[name="url"]').value = sel.value; if (!form.querySelector('[name="label"]').value) form.querySelector('[name="label"]').value = sel.selectedOptions[0].textContent; }
    });
  });

  // Rich text editor
  if (window.tinymce && document.querySelector('textarea.richtext')) {
    tinymce.init({
      selector: 'textarea.richtext',
      promotion: false,
      branding: false,
      license_key: 'gpl',
      menubar: 'edit insert format table',
      plugins: 'lists link image table code autolink autoresize media',
      toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright alignjustify | bullist numlist | link image media table | removeformat code',
      block_formats: 'Paragraph=p; Heading 2=h2; Heading 3=h3; Heading 4=h4; Heading 5=h5',
      min_height: 260,
      max_height: 700,
      convert_urls: false,
      valid_elements: '*[*]',
      extended_valid_elements: 'i[class],span[class|style]',
      content_css: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css,https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css,/css/site.css',
      content_style: 'body { padding: 12px; }',
      image_caption: true,
      automatic_uploads: true,
      images_upload_handler: function (blobInfo) {
        var fd = new FormData();
        fd.append('_csrf', csrf);
        fd.append('file', blobInfo.blob(), blobInfo.filename());
        return fetch('/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (!j.location) throw new Error(j.error || 'Upload failed'); return j.location; });
      },
      setup: function (ed) { ed.on('change', function () { ed.save(); }); },
    });
  }

  // Warn about unsaved changes
  var dirty = false;
  document.querySelectorAll('form.entry-form, #sectionForm').forEach(function (f) {
    f.addEventListener('input', function () { dirty = true; });
    f.addEventListener('submit', function () { dirty = false; });
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
})();

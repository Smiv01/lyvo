// Afficher / masquer le mot de passe (amélioration facultative : le site fonctionne sans JavaScript).
document.querySelectorAll('.js-toggle-password').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var input = document.getElementById(btn.dataset.target);
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Masquer' : 'Voir';
    btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  });
});

// Confirmation avant les suppressions (le site fonctionne aussi sans JavaScript).
document.querySelectorAll('form[data-confirm]').forEach(function (f) {
  f.addEventListener('submit', function (e) {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  });
});

// Choix du thème : Clair / Auto (suit le téléphone) / Sombre.
(function () {
  var root = document.documentElement;
  var btns = document.querySelectorAll('[data-theme-set]');
  if (!btns.length) return;
  function current() {
    var t = root.getAttribute('data-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function mark() {
    var c = current();
    btns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.themeSet === c ? 'true' : 'false'); });
  }
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.dataset.themeSet;
      try {
        if (v === 'auto') { localStorage.removeItem('me-theme'); } else { localStorage.setItem('me-theme', v); }
      } catch (e) {}
      if (v === 'auto') { root.removeAttribute('data-theme'); } else { root.setAttribute('data-theme', v); }
      mark();
    });
  });
  mark();
})();

// Copier un lien (invitation).
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var el = document.getElementById(b.dataset.copy);
    if (!el) return;
    el.select();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(el.value); } else { document.execCommand('copy'); }
      b.textContent = 'Lien copié ✓';
    } catch (e) {}
  });
});

// Ma Journée : plusieurs photos à la fois, réduites sur le téléphone avant l'envoi (plus rapide, moins de données)
(function () {
  var inp = document.querySelector('.compose input[name="photos[]"]');
  var out = document.getElementById('photo-name');
  if (!inp) { return; }
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!window.createImageBitmap || !window.DataTransfer || !/^image\/(jpeg|png|webp)$/.test(file.type)) { return resolve(file); }
      createImageBitmap(file).then(function (bmp) {
        var scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * scale));
        c.height = Math.max(1, Math.round(bmp.height * scale));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file);
        }, 'image/jpeg', 0.82);
      }).catch(function () { resolve(file); });
    });
  }
  inp.addEventListener('change', function () {
    var files = Array.prototype.slice.call(inp.files || []);
    if (out) { out.textContent = files.length ? '📷 ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + (files.length > 10 ? ' (10 maximum, les autres seront ignorées)' : '') : ''; }
    if (!files.length || !window.DataTransfer) { return; }
    var form = inp.form;
    var submit = form ? form.querySelector('button[type=submit]') : null;
    if (submit) { submit.disabled = true; }
    Promise.all(files.slice(0, 10).map(shrink)).then(function (list) {
      if (submit) { submit.disabled = false; }
      try {
        var dt = new DataTransfer();
        list.forEach(function (f) { dt.items.add(f); });
        inp.files = dt.files;
      } catch (e) {}
    });
  });
})();

// Ma Journée : message vocal enregistré sur le téléphone, écouté avant l'envoi, joint au prochain « Publier » (2 min max)
(function () {
  var btn = document.getElementById('vocal-btn');
  var inp = document.getElementById('vocal-file');
  if (!btn || !inp) { return; }
  var secsInp = document.getElementById('vocal-secs');
  var st = document.getElementById('vocal-status');
  var box = document.getElementById('vocal-box');
  var prev = document.getElementById('vocal-preview');
  var cancel = document.getElementById('vocal-cancel');
  var MAX = 120;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder || !window.DataTransfer) {
    return; // navigateur trop ancien : le bouton reste caché
  }
  btn.hidden = false;
  var rec = null, chunks = [], stream = null, t0 = 0, timer = null, blobUrl = null;
  function pickType() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) { return types[i]; }
    }
    return '';
  }
  function fmt(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function stopStream() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }
  function clearVocal() {
    try { inp.files = new DataTransfer().files; } catch (e) { inp.value = ''; }
    secsInp.value = '';
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    prev.removeAttribute('src');
    box.hidden = true;
    btn.textContent = '🎤 Vocal';
    btn.setAttribute('aria-pressed', 'false');
  }
  btn.addEventListener('click', function () {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    clearVocal();
    st.textContent = 'Autorise le micro si ton téléphone le demande…';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      var type = pickType();
      try { rec = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s); } catch (e) { rec = new MediaRecorder(s); }
      chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); } };
      rec.onstop = function () {
        clearInterval(timer);
        stopStream();
        var secs = Math.min(MAX, Math.max(1, Math.round((Date.now() - t0) / 1000)));
        var mime = ((rec && rec.mimeType) || type || 'audio/webm').split(';')[0];
        rec = null;
        var blob = new Blob(chunks, { type: mime });
        btn.setAttribute('aria-pressed', 'false');
        if (!blob.size) { btn.textContent = '🎤 Vocal'; st.textContent = "Rien n'a été enregistré. Réessaie."; return; }
        var ext = mime.indexOf('mp4') >= 0 ? 'm4a' : (mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm');
        try {
          var dt = new DataTransfer();
          dt.items.add(new File([blob], 'vocal.' + ext, { type: mime }));
          inp.files = dt.files;
        } catch (e) {
          btn.textContent = '🎤 Vocal';
          st.textContent = "Ce navigateur ne permet pas d'envoyer un vocal. Essaie avec Chrome ou Safari à jour.";
          return;
        }
        secsInp.value = String(secs);
        blobUrl = URL.createObjectURL(blob);
        prev.src = blobUrl;
        box.hidden = false;
        btn.textContent = '🎤 Refaire';
        st.textContent = 'Vocal prêt (' + fmt(secs) + ') : écoute-le, puis appuie sur « Publier ».';
      };
      rec.start(1000);
      t0 = Date.now();
      btn.textContent = '⏹ Arrêter';
      btn.setAttribute('aria-pressed', 'true');
      st.textContent = '🔴 Enregistrement… 0:00 (2 min maximum)';
      timer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        st.textContent = '🔴 Enregistrement… ' + fmt(Math.min(s, MAX)) + ' (2 min maximum)';
        if (s >= MAX && rec && rec.state === 'recording') { rec.stop(); }
      }, 500);
    }).catch(function () {
      stopStream();
      st.textContent = 'Micro refusé : autorise le micro pour ce site dans les réglages, puis réessaie.';
    });
  });
  cancel.addEventListener('click', function () { clearVocal(); st.textContent = 'Vocal retiré.'; });
  if (btn.form) {
    btn.form.addEventListener('submit', function (e) {
      if (rec && rec.state === 'recording') { e.preventDefault(); st.textContent = "Arrête d'abord l'enregistrement."; }
    });
  }
})();

// Application installable : service worker + bouton « Installer »
(function () {
  var link = document.querySelector('link[rel=manifest]');
  if ('serviceWorker' in navigator && link && (window.isSecureContext || location.hostname === 'localhost')) {
    navigator.serviceWorker.register(new URL('sw.js', link.href).pathname).catch(function () {});
  }
  var btn = document.getElementById('install-btn');
  var help = document.getElementById('install-help');
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (btn) { btn.hidden = false; if (help) help.hidden = true; }
  });
  if (btn) {
    btn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; btn.hidden = true; if (help) help.hidden = false; });
    });
  }
  window.addEventListener('appinstalled', function () {
    if (btn) btn.hidden = true;
    if (help) { help.hidden = false; help.textContent = 'Lyvo est installé sur cet appareil.'; }
  });
})();

// Souvenir avec un lieu (Ma Journée) : joint la position de l'appareil au prochain envoi
(function () {
  var b = document.getElementById('post-locate');
  if (!b) return;
  var st = document.getElementById('post-loc-status');
  b.addEventListener('click', function () {
    var la = document.getElementById('post-lat'), ln = document.getElementById('post-lng');
    if (la.value) { la.value = ''; ln.value = ''; b.textContent = '📍 Ajouter le lieu'; b.setAttribute('aria-pressed', 'false'); st.textContent = 'Lieu retiré.'; return; }
    if (!navigator.geolocation) { st.textContent = 'Ton navigateur ne sait pas donner ta position.'; return; }
    st.textContent = 'Recherche de ta position…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      la.value = pos.coords.latitude.toFixed(5); ln.value = pos.coords.longitude.toFixed(5);
      b.textContent = '📍 Lieu ajouté ✓'; b.setAttribute('aria-pressed', 'true');
      st.textContent = 'Le lieu sera joint à ton souvenir.';
    }, function () { st.textContent = 'Position introuvable : autorise la localisation pour ce site.'; }, { timeout: 15000, maximumAge: 60000 });
  });
})();

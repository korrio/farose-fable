(() => {
  'use strict';

  const EPS = window.FAROSE_EPISODES;
  const HUBS = window.FAROSE_HUBS;
  const CTRY = window.FAROSE_COUNTRIES;

  const CONT = {
    Europe:        { th: 'ยุโรป',        color: '#ffcf6b' },
    Americas:      { th: 'อเมริกา',      color: '#ff7a8a' },
    Asia:          { th: 'เอเชีย',        color: '#5eead4' },
    'Middle East': { th: 'ตะวันออกกลาง', color: '#f0abfc' },
    Oceania:       { th: 'โอเชียเนีย',    color: '#a5b4fc' },
  };
  const PREC_NOTE = {
    country: 'ทราบเพียงระดับประเทศ — หมุดวางที่กึ่งกลางประเทศ',
    region: 'ตอนที่ถ่ายในยุโรปแต่ยังไม่ระบุเมือง',
  };
  const HOME = { lat: 28, lng: 35, altitude: 2.4 };
  const MOBILE = () => window.innerWidth <= 820;
  const SHIFT_MAX = 220; // px; the globe canvas is wider than the viewport so it can slide sideways
  const FB_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const FB_CONFIG = {
    apiKey: 'AIzaSyDBwzgfcWNSJZCRrPpBaoYNrxNTBJku5vA',
    authDomain: 'farose-fable.firebaseapp.com',
    projectId: 'farose-fable',
    appId: '1:182587147159:web:0b48c32084567413a17ad2',
  };
  const BEEN_KEY = 'farose.been';

  // ---------- Derived data ----------
  const hubByName = new Map();
  HUBS.forEach(h => {
    h.cont = CTRY[h.country]?.cont || 'Europe';
    h.color = CONT[h.cont].color;
    h.eps = [];
    h.id = h.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    hubByName.set(h.name, h);
  });
  const epByNum = new Map();
  EPS.forEach(e => {
    epByNum.set(e.ep, e);
    e.hubObjs = (e.hubs || []).map(n => hubByName.get(n));
    e.hubObjs.forEach(h => h.eps.push(e));
    e.cont = e.hubObjs[0]?.cont || null;
    e.color = e.cont ? CONT[e.cont].color : null;
    e.secs = e.len ? e.len.split(':').reduce((a, b) => a * 60 + +b, 0) : 0;
    e.search = [e.ep, 'ep' + e.ep, e.title, e.city, e.country, e.place, e.cat,
      ...e.hubObjs.map(h => h.th), CTRY[e.country]?.th].join(' ').toLowerCase();
  });
  HUBS.forEach(h => {
    h.n = h.eps.length;
    h.secs = h.eps.reduce((a, e) => a + e.secs, 0);
    h.alt = h.kind === 'city' ? 0.012 + Math.sqrt(h.n) * 0.032 : 0.006;
  });
  // A label is shown at world zoom if the hub is big or has no close neighbour.
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180));
  HUBS.forEach(h => {
    h.major = h.n >= 3 || HUBS.every(o => o === h || dist(h, o) > 7 || o.n < h.n);
  });
  const hubsSorted = [...HUBS].sort((a, b) => b.n - a.n || a.th.localeCompare(b.th, 'th'));

  const countries = new Set();
  EPS.forEach(e => e.hubObjs.forEach(h => CTRY[h.country] && countries.add(h.country)));
  const epsByA3 = {};
  EPS.forEach(e => {
    new Set(e.hubObjs.map(h => h.country)).forEach(c => {
      const a3 = CTRY[c]?.a3;
      if (a3) (epsByA3[a3] ||= []).push(e);
    });
  });

  // ---------- State ----------
  const state = {
    sel: null,          // selected hub (or pseudo hub)
    cur: null,          // current episode number (timeline)
    playing: false,
    q: '',
    contOff: new Set(),
    tab: 'places',
    day: false,
    hoverPoly: null,
  };

  // "I've been here": this visitor's own marks live in localStorage; the public
  // per-place counters live in Firestore (places/{hubId}.count), no login.
  const fans = { been: new Set(), counts: {}, loaded: false, db: null, fs: null };
  try { JSON.parse(localStorage.getItem(BEEN_KEY) || '[]').forEach(id => fans.been.add(id)); } catch {}
  const canCheckIn = h => h && (h.kind === 'city' || h.kind === 'country');

  // ---------- Helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flag = c => {
    const iso = CTRY[c]?.iso2;
    return iso ? String.fromCodePoint(...[...iso].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';
  };
  const ctryTh = c => CTRY[c]?.th || (c === 'Unverified' ? 'ไม่ระบุ' : c === 'Multiple' ? 'หลายประเทศ' : c);
  const fmtDur = s => {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} ชม. ${m} นาที` : `${m} นาที`;
  };
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const visibleHub = h => !state.contOff.has(h.cont) && (!state.q || h.eps.some(matches));
  const matches = e => !state.q || e.search.includes(state.q);

  // ---------- Globe ----------
  const el = $('#globe');
  const globe = new Globe(el, { animateIn: true })
    .globeImageUrl('assets/earth-night.webp')
    .bumpImageUrl('assets/earth-topology.webp')
    .backgroundImageUrl('assets/night-sky.webp')
    .showAtmosphere(true)
    .atmosphereColor('#6ea8ff')
    .atmosphereAltitude(0.2)

    // pillars
    .pointsData(HUBS)
    .pointLat('lat').pointLng('lng')
    .pointAltitude(h => h.alt)
    .pointRadius(h => h.kind === 'city' ? 0.2 + Math.sqrt(h.n) * 0.07 : 0.5)
    .pointColor(pointColor)
    .pointResolution(16)
    .pointsMerge(false)
    .pointsTransitionDuration(900)
    .pointLabel(hubTooltip)
    .onPointClick(h => { stopJourney(); selectHub(h); })
    .onPointHover(h => { el.style.cursor = h ? 'pointer' : ''; })

    // pulse rings
    .ringsData(HUBS)
    .ringLat('lat').ringLng('lng')
    .ringColor(h => t => rgba(h === state.sel ? '#ffffff' : h.color, (h.kind === 'city' ? 0.75 : 0.5) * (1 - t)))
    .ringMaxRadius(h => h === state.sel ? 6 : h.kind === 'region' ? 9 : h.kind === 'country' ? 4.5 : 1.4 + Math.sqrt(h.n) * 0.6)
    .ringPropagationSpeed(h => h.kind === 'city' ? 1.4 : 2.4)
    .ringRepeatPeriod(h => h === state.sel ? 700 : h.kind === 'city' ? 1600 + (h.lat * 37 % 900) : 2600)
    .ringAltitude(0.002)


    // floating labels
    .htmlElementsData(HUBS)
    .htmlLat('lat').htmlLng('lng')
    .htmlAltitude(h => h.alt + 0.004)
    .htmlElement(makeMarker)
    .htmlTransitionDuration(0);

  if (typeof globe.htmlElementVisibilityModifier === 'function') {
    globe.htmlElementVisibilityModifier((elm, visible) => elm.classList.toggle('behind', !visible));
    document.head.insertAdjacentHTML('beforeend', '<style>.mk.behind{opacity:0!important;pointer-events:none!important}</style>');
  }

  // Retina phones report 3x; 2x looks the same on a glowing globe and costs far less GPU.
  globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Stop drawing while the tab is hidden or a video is playing over the globe.
  const syncAnimation = () => document.hidden || $('#modal').classList.contains('open')
    ? globe.pauseAnimation() : globe.resumeAnimation();
  document.addEventListener('visibilitychange', syncAnimation);

  const mat = globe.globeMaterial();
  mat.bumpScale = 6;
  if (mat.specular) { mat.specular.set('#1c2a4a'); mat.shininess = 12; }

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 120;
  controls.maxDistance = 900;

  if (typeof globe.onZoom === 'function') {
    globe.onZoom(pov => document.body.classList.toggle('zoomed', pov.altitude < 1.15));
  }

  fetch('assets/countries.geojson').then(r => r.json()).then(geo => {
    const feats = geo.features.filter(f => f.properties.ADM0_A3 !== 'ATA');
    globe
      .polygonsData(feats)
      .polygonGeoJsonGeometry('geometry')
      .polygonAltitude(f => epsByA3[f.properties.ADM0_A3] ? 0.005 : 0.002)
      .polygonCapColor(polyCap)
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(f => {
        const v = epsByA3[f.properties.ADM0_A3];
        return v ? rgba(contOfA3(f), 0.55) : 'rgba(255,255,255,0.07)';
      })
      .polygonLabel(f => {
        const v = epsByA3[f.properties.ADM0_A3];
        if (!v) return '';
        const name = Object.keys(CTRY).find(k => CTRY[k].a3 === f.properties.ADM0_A3);
        return `<div class="gtip"><b>${flag(name)} ${esc(CTRY[name].th)}</b><small>${v.length} ตอน · คลิกเพื่อดูทั้งหมด</small></div>`;
      })
      .onPolygonHover(f => {
        state.hoverPoly = f && epsByA3[f.properties.ADM0_A3] ? f : null;
        globe.polygonCapColor(polyCap);
        el.style.cursor = state.hoverPoly ? 'pointer' : '';
      })
      .onPolygonClick(f => {
        const name = Object.keys(CTRY).find(k => CTRY[k].a3 === f.properties.ADM0_A3);
        if (name && epsByA3[f.properties.ADM0_A3]) { stopJourney(); selectCountry(name); }
      })
      .polygonsTransitionDuration(600);
  });
  function contOfA3(f) {
    const name = Object.keys(CTRY).find(k => CTRY[k].a3 === f.properties.ADM0_A3);
    return CONT[CTRY[name]?.cont || 'Europe'].color;
  }
  function polyCap(f) {
    const v = epsByA3[f.properties.ADM0_A3];
    if (!v) return 'rgba(0,0,0,0)';
    const sel = state.sel?.kind === 'countryAgg' && CTRY[state.sel.country]?.a3 === f.properties.ADM0_A3;
    const a = f === state.hoverPoly || sel ? 0.32 : 0.07 + Math.min(v.length, 30) / 30 * 0.12;
    return rgba(contOfA3(f), a);
  }

  function pointColor(h) {
    if (!visibleHub(h)) return 'rgba(255,255,255,0.08)';
    if (h === state.sel) return '#ffffff';
    return h.kind === 'city' ? h.color : rgba(h.color, 0.35);
  }
  function hubTooltip(h) {
    const list = h.eps.slice(0, 4).map(e => `<li>EP${e.ep} · ${esc(e.title)}</li>`).join('');
    const more = h.n > 4 ? `<li>และอีก ${h.n - 4} ตอน…</li>` : '';
    const fanN = fans.counts[h.id];
    const fanLine = canCheckIn(h) && (fanN || fans.been.has(h.id))
      ? `<small class="gfan">${fans.been.has(h.id) ? '✓ คุณเคยไปที่นี่ · ' : ''}${fanN ? fanN + ' คนเคยมาที่นี่' : ''}</small>` : '';
    return `<div class="gtip"><b>${esc(h.th)}</b><small>${esc(h.name)} · ${flag(h.country)} ${esc(ctryTh(h.country))} · ${h.n} ตอน</small>${fanLine}<ul>${list}${more}</ul></div>`;
  }

  const markerEls = new Map();
  function makeMarker(h) {
    const d = document.createElement('div');
    d.className = 'mk' + (h.major ? '' : ' minor') + (h.kind !== 'city' ? ' region' : '') + (fans.been.has(h.id) ? ' been' : '');
    d.style.setProperty('--c', h.color);
    d.innerHTML = `<b>${h.n}</b><span>${esc(h.th)}${h.kind === 'region' ? ' · ไม่ระบุเมือง' : ''}</span>`;
    d.addEventListener('click', ev => { ev.stopPropagation(); stopJourney(); selectHub(h); });
    markerEls.set(h, d);
    return d;
  }

  // Keep the globe centred in the space the panels leave free.
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    el.style.left = `${-SHIFT_MAX}px`;
    el.style.width = `${W + SHIFT_MAX * 2}px`;
    globe.width(W + SHIFT_MAX * 2).height(H);
    let shift = 0;
    if (!MOBILE()) {
      const rail = $('#rail').offsetWidth + 16;
      const det = document.body.classList.contains('detail-open') ? $('#detail').offsetWidth + 16 : 0;
      shift = Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, (rail - det) / 2));
    }
    el.style.transform = `translateX(${shift}px)`;
  }
  el.style.transition = 'transform 0.6s cubic-bezier(.2,.8,.2,1)';
  window.addEventListener('resize', layout);
  layout();

  globe.pointOfView({ lat: HOME.lat, lng: HOME.lng, altitude: 3.6 });
  const ready = () => {
    if ($('#loader').classList.contains('done')) return;
    $('#loader').classList.add('done');
    loadFans();
    setTimeout(() => !state.sel && globe.pointOfView(HOME, 2600), 300);
  };
  if (typeof globe.onGlobeReady === 'function') globe.onGlobeReady(ready);
  else setTimeout(ready, 1200);
  setTimeout(() => $('#loader').classList.contains('done') || ready(), 6000);

  function refreshGlobe() {
    globe.pointColor(pointColor)
      .ringsData(HUBS.filter(visibleHub));
    markerEls.forEach((m, h) => {
      m.classList.toggle('sel', h === state.sel);
      m.classList.toggle('hidden', state.contOff.has(h.cont));
      m.classList.toggle('dim', !!state.q && !h.eps.some(matches));
    });
  }

  // ---------- Selection ----------
  function fly(lat, lng, altitude, ms = 1600) {
    controls.autoRotate = false;
    $('[data-ctl=rotate]').classList.remove('active');
    globe.pointOfView({ lat, lng, altitude }, ms);
  }

  function selectHub(h, { focusEp = null, flyTo = true, alt = null } = {}) {
    state.sel = h;
    openDetail(renderHub(h), focusEp);
    if (flyTo) fly(h.lat, h.lng, alt ?? (h.kind === 'city' ? (h.n > 10 ? 0.75 : 0.95) : h.kind === 'region' ? 1.9 : 1.5));
    refreshGlobe();
    globe.polygonCapColor(polyCap);
    markListActive();
  }

  function selectCountry(name) {
    const hubs = HUBS.filter(h => h.country === name);
    const eps = epsByA3[CTRY[name].a3].slice().sort((a, b) => a.ep - b.ep);
    const lat = hubs.reduce((a, h) => a + h.lat, 0) / hubs.length;
    const lng = hubs.reduce((a, h) => a + h.lng, 0) / hubs.length;
    const pseudo = { kind: 'countryAgg', name, th: CTRY[name].th, country: name, cont: CTRY[name].cont,
      color: CONT[CTRY[name].cont].color, eps, n: eps.length, secs: eps.reduce((a, e) => a + e.secs, 0), lat, lng };
    state.sel = pseudo;
    openDetail(renderHub(pseudo));
    fly(lat, lng, 1.3);
    refreshGlobe();
    globe.polygonCapColor(polyCap);
    markListActive();
  }

  function selectEp(n, { journey = false } = {}) {
    const e = epByNum.get(n);
    if (!e) return;
    state.cur = n;
    history.replaceState(null, '', '#ep-' + n);
    updateTimeline();
    if (e.hubObjs.length) {
      const h = e.hubObjs[0];
      const sameHub = state.sel === h;
      if (journey) {
        state.sel = h;
        openDetail(renderHub(h), n);
        fly(h.lat, h.lng, h.kind === 'city' ? 1.25 : 1.7, sameHub ? 600 : 2000);
        refreshGlobe();
        markListActive();
      } else {
        selectHub(h, { focusEp: n });
      }
    } else {
      state.sel = null;
      openDetail(renderUnmapped(e), n);
      refreshGlobe();
    }
  }

  // ---------- Detail panel ----------
  function card(e) {
    const na = !e.vid || e.status !== 'Public';
    const thumb = e.vid ? `background-image:url(https://i.ytimg.com/vi/${e.vid}/hqdefault.jpg)` : '';
    const route = e.stops ? e.stops.map(s => hubByName.get(s.name)?.th || s.name).join(' → ') : null;
    const where = route || [e.place !== e.city ? e.place : null, e.hubObjs[0]?.th || e.city].filter(Boolean).join(' · ');
    return `<article class="card" data-ep="${e.ep}" style="--c:${e.color || '#8a93a8'}">
      <button class="thumb ${na ? 'na' : ''}" style="${thumb}" data-play="${e.ep}" ${na ? 'disabled' : ''} aria-label="เล่น EP${e.ep}">
        <span class="ep">EP${e.ep}</span>${e.len ? `<span class="len">${e.len}</span>` : ''}
        <span class="pbtn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      </button>
      <div class="card-b">
        <h3>${esc(e.title)}</h3>
        <div class="where">${esc(where)}</div>
        <div class="card-f">
          <span class="conf ${e.conf}" title="ความมั่นใจของตำแหน่ง">${e.conf}</span>
          <span class="pill">${esc(e.cat)}</span>
          ${na ? `<span class="pill warn">${e.status === 'Not found' ? 'ไม่พบวิดีโอ' : 'วิดีโอไม่เปิดสาธารณะ'}</span>` : ''}
          ${e.vid ? `<a href="https://www.youtube.com/watch?v=${e.vid}" target="_blank" rel="noopener">YouTube ↗</a>` : ''}
          ${e.maps ? `<a href="${esc(e.maps)}" target="_blank" rel="noopener">Maps ↗</a>` : ''}
        </div>
        ${e.note ? `<p class="d-note">${esc(e.note)}</p>` : ''}
      </div>
    </article>`;
  }

  function renderHub(h) {
    const eps = h.eps.slice().sort((a, b) => a.ep - b.ep);
    const kicker = h.kind === 'countryAgg'
      ? `ประเทศ · ${CONT[h.cont].th}`
      : `${flag(h.country)} ${ctryTh(h.country)} · ${CONT[h.cont].th}`;
    const note = PREC_NOTE[h.kind];
    return `<div class="d-hero" style="--c:${h.color}">
        <div class="d-kicker">${esc(kicker)}</div>
        <h2>${h.kind === 'countryAgg' ? flag(h.country) + ' ' : ''}${esc(h.th)}</h2>
        <div class="en">${esc(h.name)}</div>
        <div class="d-meta">
          <span class="pill">${h.n} ตอน</span>
          ${h.secs ? `<span class="pill">${fmtDur(h.secs)}</span>` : ''}
          <span class="pill">EP${eps[0].ep}${eps.length > 1 ? '–' + eps[eps.length - 1].ep : ''}</span>
          ${note ? `<span class="pill warn">${note}</span>` : ''}
        </div>
        ${canCheckIn(h) ? `<div class="been-box" data-been-box="${h.id}">${beenBox(h)}</div>` : ''}
      </div>
      <div class="cards">${eps.map(card).join('')}</div>`;
  }

  function beenBox(h) {
    const on = fans.been.has(h.id), n = fans.counts[h.id] || 0;
    const others = n - (on ? 1 : 0);
    const line = !fans.loaded ? ''
      : on ? (others > 0 ? `คุณและอีก ${others} คนเคยมาที่นี่` : 'คุณเป็นคนแรกที่ปักหมุดที่นี่')
      : n > 0 ? `${n} คนเคยมาที่นี่` : 'ยังไม่มีใครปักหมุด — เป็นคนแรกเลย';
    return `<button class="been-btn ${on ? 'on' : ''}" data-been="${h.name}" aria-pressed="${on}">
        <svg viewBox="0 0 24 24">${on ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'}</svg>
        <span>${on ? 'เคยไปแล้ว' : 'ฉันเคยไปที่นี่'}</span>
      </button><span class="been-n">${line}</span>`;
  }

  async function loadFans() {
    try {
      const [{ initializeApp }, fs] = await Promise.all([
        import(FB_SDK + 'firebase-app.js'),
        import(FB_SDK + 'firebase-firestore-lite.js'),
      ]);
      fans.fs = fs;
      fans.db = fs.getFirestore(initializeApp(FB_CONFIG));
      const snap = await fs.getDocs(fs.collection(fans.db, 'places'));
      snap.forEach(d => { fans.counts[d.id] = d.data().count || 0; });
    } catch (err) {
      console.warn('[farose] fan counts unavailable', err);
    }
    fans.loaded = true;
    renderFans();
  }

  async function toggleBeen(h) {
    const on = !fans.been.has(h.id);
    on ? fans.been.add(h.id) : fans.been.delete(h.id);
    try { localStorage.setItem(BEEN_KEY, JSON.stringify([...fans.been])); } catch {}
    fans.counts[h.id] = Math.max(0, (fans.counts[h.id] || 0) + (on ? 1 : -1));
    renderFans();
    if (!fans.db) return;
    const { doc, setDoc, increment } = fans.fs;
    try {
      await setDoc(doc(fans.db, 'places', h.id), { count: increment(on ? 1 : -1) }, { merge: true });
    } catch (err) {
      console.warn('[farose] check-in not saved', err);
    }
  }

  function renderFans() {
    markerEls.forEach((m, h) => m.classList.toggle('been', fans.been.has(h.id)));
    document.querySelectorAll('[data-been-box]').forEach(b => {
      const h = HUBS.find(x => x.id === b.dataset.beenBox);
      if (h) b.innerHTML = beenBox(h);
    });
    const total = HUBS.filter(canCheckIn).length;
    const mine = HUBS.filter(h => canCheckIn(h) && fans.been.has(h.id)).length;
    const pp = $('#passport');
    pp.hidden = !mine;
    pp.innerHTML = `<span>คุณเคยไปแล้ว <b>${mine}</b> จาก ${total} ที่ในรายการ</span><i style="width:${mine / total * 100}%"></i>`;
  }

  function renderUnmapped(e) {
    return `<div class="d-hero" style="--c:#8a93a8">
        <div class="d-kicker">ไม่ระบุพิกัด</div>
        <h2>EP${e.ep}</h2>
        <div class="en">${esc(e.city)}</div>
        <p class="d-note">ตอนนี้ยังไม่สามารถปักหมุดบนแผนที่ได้ (รวมฉาก / หลายเมือง / ไม่พบข้อมูล)</p>
      </div>
      <div class="cards">${card(e)}</div>`;
  }

  function openDetail(html, focusEp) {
    const body = $('#detailBody');
    body.innerHTML = html;
    $('#detail').classList.add('open');
    $('#detail').setAttribute('aria-hidden', 'false');
    if (!document.body.classList.contains('detail-open')) {
      document.body.classList.add('detail-open');
      layout();
    }
    if (MOBILE()) document.body.classList.remove('rail-open');
    if (focusEp != null) {
      const c = body.querySelector(`[data-ep="${focusEp}"]`);
      if (c) {
        c.classList.add('flash');
        requestAnimationFrame(() => c.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      }
    } else body.scrollTop = 0;
  }

  function closeDetail() {
    state.sel = null;
    $('#detail').classList.remove('open');
    $('#detail').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('detail-open');
    layout();
    refreshGlobe();
    globe.polygonCapColor(polyCap);
    markListActive();
  }

  $('#detailClose').addEventListener('click', () => { stopJourney(); closeDetail(); });
  $('#detailBody').addEventListener('click', ev => {
    const p = ev.target.closest('[data-play]');
    if (p && !p.disabled) { stopJourney(); openVideo(+p.dataset.play); }
    const b = ev.target.closest('[data-been]');
    if (b) toggleBeen(hubByName.get(b.dataset.been));
  });

  // ---------- Video modal ----------
  function openVideo(n) {
    const e = epByNum.get(n);
    if (!e?.vid) return;
    $('#player').src = `https://www.youtube-nocookie.com/embed/${e.vid}?autoplay=1&rel=0&modestbranding=1`;
    $('#modalMeta').innerHTML = `<b>EP${e.ep}</b><strong>${esc(e.title)}</strong><span>${esc(e.hubObjs.map(h => h.th).join(' → ') || e.city)}</span>`;
    $('#modal').classList.add('open');
    $('#modal').setAttribute('aria-hidden', 'false');
    syncAnimation();
  }
  function closeVideo() {
    $('#modal').classList.remove('open');
    $('#modal').setAttribute('aria-hidden', 'true');
    syncAnimation();
    setTimeout(() => { $('#player').src = 'about:blank'; }, 300);
  }
  $('#modal').addEventListener('click', ev => { if (ev.target.closest('[data-close]')) closeVideo(); });

  // ---------- Rail ----------
  const totalSecs = EPS.reduce((a, e) => a + e.secs, 0);
  $('#stats').innerHTML = [
    [EPS.length, 'ตอน'],
    [countries.size, 'ประเทศ'],
    [HUBS.filter(h => h.kind === 'city').length, 'เมือง/จุด'],
    [Math.round(totalSecs / 3600), 'ชั่วโมง'],
  ].map(([v, l]) => `<div class="stat"><b data-count="${v}">0</b><span>${l}</span></div>`).join('');
  document.querySelectorAll('[data-count]').forEach(b => {
    const target = +b.dataset.count, t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / 1600), k = 1 - Math.pow(1 - p, 3);
      b.textContent = Math.round(target * k);
      if (p < 1) requestAnimationFrame(step);
    };
    setTimeout(() => requestAnimationFrame(step), 700);
  });

  $('#legend').innerHTML = Object.entries(CONT).map(([k, v]) => {
    const n = EPS.filter(e => e.cont === k).length;
    return `<button class="chip" data-cont="${k}" style="--c:${v.color}" title="ซ่อน/แสดง"><i></i>${v.th} <span>${n}</span></button>`;
  }).join('');
  $('#legend').addEventListener('click', ev => {
    const b = ev.target.closest('[data-cont]');
    if (!b) return;
    const k = b.dataset.cont;
    state.contOff.has(k) ? state.contOff.delete(k) : state.contOff.add(k);
    b.classList.toggle('off', state.contOff.has(k));
    applyFilter();
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    renderList();
  }));

  let qTimer;
  $('#q').addEventListener('input', ev => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = ev.target.value.trim().toLowerCase(); applyFilter(); }, 120);
  });

  function applyFilter() {
    renderList();
    refreshGlobe();
    updateTimeline();
  }

  function renderList() {
    const list = $('#list');
    const maxN = hubsSorted[0].n;
    if (state.tab === 'places') {
      const hubs = hubsSorted.filter(visibleHub);
      const row = h => `<button class="row" data-hub="${esc(h.name)}" style="--c:${h.color}">
          <span class="dot ${h.kind !== 'city' ? 'hollow' : ''}"></span>
          <span class="nm"><b>${esc(h.th)}${h.kind === 'region' ? ' · ไม่ระบุเมือง' : ''}</b><small>${flag(h.country)} ${esc(h.kind === 'city' ? h.name + ' · ' + ctryTh(h.country) : 'ระบุได้ระดับประเทศ/ภูมิภาค')}</small></span>
          <span class="ct">${state.q ? h.eps.filter(matches).length + '/' : ''}${h.n}</span>
          <span class="bar"><i style="width:${h.n / maxN * 100}%"></i></span>
        </button>`;
      const cities = hubs.filter(h => h.kind === 'city'), rough = hubs.filter(h => h.kind !== 'city');
      list.innerHTML = hubs.length
        ? cities.map(row).join('') + (rough.length ? `<div class="group-h">ไม่ระบุเมือง</div>` + rough.map(row).join('') : '')
        : `<div class="empty">ไม่พบสถานที่ที่ตรงกับคำค้น</div>`;
    } else {
      const eps = EPS.filter(e => matches(e) && (!e.cont || !state.contOff.has(e.cont)));
      list.innerHTML = eps.length ? eps.map(e => `<button class="row" data-epn="${e.ep}" style="--c:${e.color || '#8a93a8'}">
          <span class="epn">${e.ep}</span>
          <span class="nm"><b>${esc(e.title)}</b><small>${esc(e.hubObjs.map(h => h.th).join(' → ') || 'ไม่ระบุพิกัด')} · ${esc(e.cat)}</small></span>
          <span class="dot ${e.color ? '' : 'hollow'}"></span>
        </button>`).join('') : `<div class="empty">ไม่พบตอนที่ตรงกับคำค้น</div>`;
    }
    markListActive();
  }
  function markListActive() {
    document.querySelectorAll('#list .row').forEach(r => {
      r.classList.toggle('active', !!(
        (r.dataset.hub && state.sel?.name === r.dataset.hub && state.sel.kind !== 'countryAgg') ||
        (r.dataset.epn && +r.dataset.epn === state.cur)));
    });
  }
  $('#list').addEventListener('click', ev => {
    const r = ev.target.closest('.row');
    if (!r) return;
    stopJourney();
    if (r.dataset.hub) {
      const h = hubByName.get(r.dataset.hub);
      const firstMatch = state.q ? h.eps.find(matches)?.ep : null;
      selectHub(h, { focusEp: firstMatch });
    } else selectEp(+r.dataset.epn);
  });

  $('#railToggle').addEventListener('click', () => document.body.classList.toggle('rail-open'));

  // ---------- Controls ----------
  document.querySelectorAll('.ctl').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.ctl;
    if (k === 'rotate') {
      controls.autoRotate = !controls.autoRotate;
      b.classList.toggle('active', controls.autoRotate);
    } else if (k === 'day') {
      state.day = !state.day;
      b.classList.toggle('active', state.day);
      globe.globeImageUrl(state.day ? 'assets/earth-blue-marble.webp' : 'assets/earth-night.webp');
    } else if (k === 'home') {
      stopJourney();
      closeDetail();
      globe.pointOfView(HOME, 1800);
    }
  }));

  // ---------- Timeline ----------
  const ticks = $('#ticks');
  ticks.innerHTML = EPS.map(e => `<i class="tk ${e.color ? '' : 'none'}" data-ep="${e.ep}" style="--c:${e.color || '#555'}"></i>`).join('');
  const tip = $('#tickTip');
  ticks.addEventListener('mousemove', ev => {
    const t = ev.target.closest('.tk');
    if (!t) return tip.classList.remove('show');
    const e = epByNum.get(+t.dataset.ep);
    const r = t.getBoundingClientRect();
    tip.innerHTML = `<b>EP${e.ep}</b>${esc(e.hubObjs.map(h => h.th).join(' → ') || 'ไม่ระบุพิกัด')} — ${esc(e.title)}`;
    tip.style.left = Math.max(140, Math.min(window.innerWidth - 140, r.left + r.width / 2)) + 'px';
    tip.style.top = r.top - 8 + 'px';
    tip.classList.add('show');
  });
  ticks.addEventListener('mouseleave', () => tip.classList.remove('show'));
  ticks.addEventListener('click', ev => {
    const t = ev.target.closest('.tk');
    if (t) { stopJourney(); selectEp(+t.dataset.ep); }
  });

  function updateTimeline() {
    ticks.classList.toggle('filtering', !!state.q);
    ticks.querySelectorAll('.tk').forEach(t => {
      const n = +t.dataset.ep, e = epByNum.get(n);
      t.classList.toggle('cur', n === state.cur);
      t.classList.toggle('past', state.cur != null && n < state.cur);
      t.classList.toggle('match', !!state.q && matches(e));
    });
    const e = epByNum.get(state.cur);
    if (e) $('#tlNow').innerHTML = `<b>EP${e.ep}</b> · ${esc(e.hubObjs.map(h => h.th).join(' → ') || 'ไม่ระบุพิกัด')} — ${esc(e.title)}`;
  }

  // ---------- Journey ----------
  let journeyTimer = null;
  function startJourney() {
    state.playing = true;
    document.body.classList.add('playing');
    let n = state.cur && state.cur < EPS.length ? state.cur : 0;
    const step = () => {
      n = n >= EPS.length ? 1 : n + 1;
      let e = epByNum.get(n);
      while (e && !e.hubObjs.length && n < EPS.length) e = epByNum.get(++n);
      if (!e?.hubObjs.length) return stopJourney();
      const moved = state.sel !== e.hubObjs[0];
      selectEp(n, { journey: true });
      journeyTimer = setTimeout(step, moved ? 3400 : 2000);
      if (n >= EPS.length) { clearTimeout(journeyTimer); journeyTimer = setTimeout(stopJourney, 3400); }
    };
    step();
  }
  function stopJourney() {
    if (!state.playing) return;
    state.playing = false;
    clearTimeout(journeyTimer);
    document.body.classList.remove('playing');
  }
  $('#play').addEventListener('click', () => state.playing ? stopJourney() : startJourney());
  // Dragging the globe pauses the tour.
  el.addEventListener('pointerdown', () => stopJourney());

  // ---------- Keyboard ----------
  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input')) {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    if (ev.key === 'Escape') {
      if ($('#modal').classList.contains('open')) closeVideo();
      else { stopJourney(); closeDetail(); }
    } else if (ev.key === ' ') {
      ev.preventDefault();
      state.playing ? stopJourney() : startJourney();
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      stopJourney();
      const d = ev.key === 'ArrowRight' ? 1 : -1;
      const n = Math.max(1, Math.min(EPS.length, (state.cur ?? 0) + d));
      selectEp(n);
    } else if (ev.key === '/') {
      ev.preventDefault();
      if (MOBILE()) document.body.classList.add('rail-open');
      $('#q').focus();
    }
  });

  // ---------- Boot ----------
  renderList();
  renderFans();
  const m = location.hash.match(/^#ep-(\d+)$/);
  if (m && epByNum.has(+m[1])) setTimeout(() => selectEp(+m[1]), 1500);
})();

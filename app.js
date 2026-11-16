/* 숲나침반 3D — 산림공공데이터 3D 탐색
 * 데이터: 산림청 자연휴양림 / 100대명산 / 치유의숲 / 국가숲길(GPX) / 보호수
 * 지형: SRTM 기반 Terrarium 표고 타일을 400×400 격자로 변환해 사용
 */
(function () {
  'use strict';

  const COLOR = {
    hyuyang: 0x74f0b4,
    myeongsan: 0xffc861,
    healing: 0x86c2ff,
    tree: 0xbdf08d
  };
  const ELE_SCALE = 0.019;
  const WORLD_W = 470;
  const KM_LON = 111.32 * Math.cos(36.2 * Math.PI / 180);
  const KM_LAT = 110.57;

  const $ = (s) => document.querySelector(s);
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

  const S = {
    meta: null, grid: null,
    hyuyang: [], myeongsan: [], healing: [], trees: [], trails: [],
    visible: { hyuyang: true, myeongsan: true, trail: true, healing: true, tree: false },
    sido: '', extra: '', search: '',
    selected: null, geo: null, radiusKm: 20, mood: 'day', nearList: [],
    span: { width: WORLD_W, depth: 0 }
  };

  // ------------------------------------------------------------- helpers
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtNum = (n) => (n == null || isNaN(n)) ? '-' : Number(n).toLocaleString('ko-KR');
  function fmtDist(m) { return m == null ? '-' : (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + 'km' : Math.round(m) + 'm'); }
  function haversine(a, b) {
    const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
    const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  // ------------------------------------------------------------- projection
  const P = { lonC: 0, latC: 0, k: 1 };
  const projX = (lon) => (lon - P.lonC) * KM_LON * P.k;
  const projZ = (lat) => (P.latC - lat) * KM_LAT * P.k;
  function heightAt(lat, lon) {
    const m = S.meta, g = m.grid, N = S.grid;
    const r = Math.round((m.latN - lat) / (m.latN - m.latS) * (g - 1));
    const c = Math.round((lon - m.lonW) / (m.lonE - m.lonW) * (g - 1));
    if (r < 0 || c < 0 || r >= g || c >= g) return 0;
    return N[r * g + c];
  }

  // ------------------------------------------------------------- three
  let renderer, scene, camera, raycaster;
  const pointerNDC = new THREE.Vector2(-10, -10);
  let terrainMesh, markerGroups = {}, instanced = {}, treePoints, trailLines, trailSel, particles, mePin;
  let hemi, sun, rim, ambient, contourMesh = null, seaMesh = null;
  const spriteBillboards = [];

  function initThree() {
    const canvas = $('#scene');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.FogExp2(0x0a2420, 0.00040);

    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 6000);

    raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 1.4;

    hemi = new THREE.HemisphereLight(0xdcefff, 0x2a5442, 1.5);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4dd, 1.55);
    sun.position.set(-260, 760, 340);
    scene.add(sun);
    rim = new THREE.DirectionalLight(0x7fc0ff, 0.65);
    rim.position.set(520, 300, -560);
    scene.add(rim);
    ambient = new THREE.AmbientLight(0x3a5f4d, 1.35);
    scene.add(ambient);

    for (const k of ['hyuyang', 'myeongsan', 'healing', 'tree', 'trail']) {
      markerGroups[k] = new THREE.Group();
      scene.add(markerGroups[k]);
    }
    window.addEventListener('resize', onResize, { passive: true });
  }

  function skyTexture(colors) {
    const c = colors || ['#02090f', '#061a1a', '#0b2a26', '#071612'];
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, c[0]);
    g.addColorStop(0.42, c[1]);
    g.addColorStop(0.72, c[2]);
    g.addColorStop(1, c[3]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(cv);
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ------------------------------------------------------------- 분위기·조명 모드
  const MOODS = {
    day: {
      exposure: 1.25,
      hemiSky: 0xdcefff, hemiGround: 0x2a5442, hemiI: 1.5,
      sunColor: 0xfff4dd, sunI: 1.55, sunPos: [-260, 760, 340],
      rimColor: 0x7fc0ff, rimI: 0.65,
      ambColor: 0x3a5f4d, ambI: 1.35,
      fog: 0x0a2420, fogD: 0.00040,
      sky: ['#02090f', '#061a1a', '#0b2a26', '#071612'],
      contour: 0, emissive: 0x0d2018, sea: 0x123f57, seaEm: 0x0a2230
    },
    sunset: {
      exposure: 1.5,
      hemiSky: 0xffd2a0, hemiGround: 0x3a2216, hemiI: 1.1,
      sunColor: 0xff9a4d, sunI: 2.15, sunPos: [560, 175, 300],
      rimColor: 0xff6f5e, rimI: 0.95,
      ambColor: 0x7a4630, ambI: 1.05,
      fog: 0x3d1f18, fogD: 0.00055,
      sky: ['#150818', '#431420', '#9c4227', '#2a1220'],
      contour: 0, emissive: 0x2b1206, sea: 0x36233a, seaEm: 0x3a1524
    },
    mist: {
      exposure: 1.08,
      hemiSky: 0xd8ecf6, hemiGround: 0x2c463e, hemiI: 1.85,
      sunColor: 0xeaf6ff, sunI: 0.75, sunPos: [-220, 540, 240],
      rimColor: 0x9fd8ff, rimI: 0.45,
      ambColor: 0x52706a, ambI: 1.45,
      fog: 0x7d9f99, fogD: 0.00135,
      sky: ['#0d2430', '#1e4644', '#568079', '#7fa39a'],
      contour: 1, emissive: 0x163027, sea: 0x5c8079, seaEm: 0x2e4a44
    }
  };

  function applyMood(key) {
    const m = MOODS[key] || MOODS.day;
    S.mood = MOODS[key] ? key : 'day';
    renderer.toneMappingExposure = m.exposure;
    hemi.color.setHex(m.hemiSky); hemi.groundColor.setHex(m.hemiGround); hemi.intensity = m.hemiI;
    sun.color.setHex(m.sunColor); sun.intensity = m.sunI; sun.position.set(m.sunPos[0], m.sunPos[1], m.sunPos[2]);
    rim.color.setHex(m.rimColor); rim.intensity = m.rimI;
    ambient.color.setHex(m.ambColor); ambient.intensity = m.ambI;
    scene.fog = new THREE.FogExp2(m.fog, m.fogD);
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = skyTexture(m.sky);
    if (terrainMesh && terrainMesh.material.emissive) terrainMesh.material.emissive.setHex(m.emissive);
    if (seaMesh) { seaMesh.material.color.setHex(m.sea); seaMesh.material.emissive.setHex(m.seaEm); }
    if (m.contour) { ensureContours(); if (contourMesh) contourMesh.visible = true; }
    else if (contourMesh) contourMesh.visible = false;
    document.querySelectorAll('.moods button').forEach((b) => b.classList.toggle('on', b.dataset.mood === S.mood));
  }

  // 100m 등고선을 지형 텍스처로 생성 (산림 안개 모드에서 고도 강조)
  function ensureContours() {
    if (contourMesh || !terrainMesh) return;
    const G = S.meta.grid, HV = S.grid, SZ = 1024, STEP = 100;
    const cv = document.createElement('canvas'); cv.width = cv.height = SZ;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(SZ, SZ);
    const hAt = (r, c) => HV[clamp(Math.round(r), 0, G - 1) * G + clamp(Math.round(c), 0, G - 1)];
    for (let y = 0; y < SZ; y++) {
      const r = (y / (SZ - 1)) * (G - 1);
      for (let x = 0; x < SZ; x++) {
        const c = (x / (SZ - 1)) * (G - 1);
        const h = hAt(r, c);
        if (h < 4) continue;
        const lv = Math.floor(h / STEP);
        if (Math.floor(hAt(r, c + 1.3) / STEP) === lv && Math.floor(hAt(r + 1.3, c) / STEP) === lv) continue;
        const i = (y * SZ + x) * 4;
        const major = lv % 5 === 0;
        img.data[i] = major ? 235 : 150;
        img.data[i + 1] = 255;
        img.data[i + 2] = major ? 240 : 222;
        img.data[i + 3] = major ? 210 : 105;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    contourMesh = new THREE.Mesh(terrainMesh.geometry, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.62, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    }));
    contourMesh.visible = false;
    contourMesh.renderOrder = 2;
    scene.add(contourMesh);
  }

  function koreaFitRadius() {
    const vFov = camera.fov * Math.PI / 180;
    const aspect = Math.max(0.35, window.innerWidth / window.innerHeight);
    const hHalf = Math.atan(Math.tan(vFov / 2) * aspect);
    const kW = 330, kD = 400;
    return clamp(Math.max((kW / 2) / Math.tan(hHalf), (kD / 2) / Math.tan(vFov / 2)), 360, 1500);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  // ------------------------------------------------------------- load
  async function loadJSON(p) {
    const r = await fetch(p);
    if (!r.ok) throw new Error(p + ' ' + r.status);
    return r.json();
  }
  function b64ToU16(txt) {
    const bin = atob(txt.trim());
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dv = new DataView(u8.buffer);
    const out = new Uint16Array(u8.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, true);
    return out;
  }
  async function loadData() {
    const [meta, b64, hyu, mtn, heal, trees, trails] = await Promise.all([
      loadJSON('data/terrain_meta.json'),
      fetch('data/terrain.b64').then((r) => r.text()),
      loadJSON('data/hyuyang.json'),
      loadJSON('data/myeongsan.json'),
      loadJSON('data/healing.json'),
      loadJSON('data/trees.json'),
      loadJSON('data/trails.json')
    ]);
    S.meta = meta; S.grid = b64ToU16(b64);
    S.hyuyang = hyu; S.myeongsan = mtn; S.healing = heal; S.trees = trees; S.trails = trails.courses;
    P.lonC = (meta.lonW + meta.lonE) / 2;
    P.latC = (meta.latN + meta.latS) / 2;
    const kmX = (meta.lonE - meta.lonW) * KM_LON;
    const kmY = (meta.latN - meta.latS) * KM_LAT;
    P.k = WORLD_W / kmX;
    S.span = { width: WORLD_W, depth: kmY * P.k, kmX, kmY, k: P.k };
  }

  // ------------------------------------------------------------- terrain
  function elevColor(e) {
    const stops = [0, 30, 120, 300, 550, 800, 1050, 1300, 1600, 2100];
    const cols = [0x3d8f66, 0x47996f, 0x4f9f73, 0x589f75, 0x66a179, 0x84ab7c, 0xa2b189, 0xbdb79c, 0xd2ccb4, 0xe6e1d2];
    let i = 0;
    while (i < stops.length - 2 && e > stops[i + 1]) i++;
    const t = clamp((e - stops[i]) / (stops[i + 1] - stops[i] || 1), 0, 1);
    return new THREE.Color(cols[i]).lerp(new THREE.Color(cols[i + 1]), t);
  }

  function buildTerrain() {
    const m = S.meta, G = m.grid;
    const N = isMobile() ? 360 : 520;
    const step = (G - 1) / (N - 1);
    const W = S.span.width, D = S.span.depth;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 4);
    const uv = new Float32Array(N * N * 2);
    const rock = new THREE.Color(0x6e6a56);
    const cTmp = new THREE.Color();
    const hAt = (r, c) => S.grid[clamp(Math.round(r), 0, G - 1) * G + clamp(Math.round(c), 0, G - 1)];
    const cellM = (S.span.kmX * 1000) / (N - 1);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const gr = r * step, gc = c * step;
        const e = hAt(gr, gc);
        const i = (r * N + c) * 3;
        const ci = (r * N + c) * 4;
        pos[i] = (c / (N - 1) - 0.5) * W;
        pos[i + 1] = e * ELE_SCALE;
        pos[i + 2] = (r / (N - 1) - 0.5) * D;
        const ui = (r * N + c) * 2;
        uv[ui] = c / (N - 1); uv[ui + 1] = 1 - r / (N - 1);

        const dz = hAt(gr + 1, gc) - hAt(gr - 1, gc);      // north-south slope
        const dx = hAt(gr, gc + 1) - hAt(gr, gc - 1);      // east-west slope
        const gx = dx / (2 * cellM), gz = dz / (2 * cellM);
        const slope = Math.min(1, Math.hypot(gx, gz) * 1.35);
        // hillshade: light from north-west
        const shade = clamp(0.84 + (gz * 0.9 - gx * 0.6) * 1.9, 0.58, 1.22);

        cTmp.copy(elevColor(e)).lerp(rock, Math.pow(slope, 1.6) * 0.42);
        cTmp.multiplyScalar(shade * (0.9 + 0.12 * Math.min(1, e / 900)));
        col[ci] = cTmp.r; col[ci + 1] = cTmp.g; col[ci + 2] = cTmp.b;
        const edgeFade = Math.min(1, Math.min(r, c, N - 1 - r, N - 1 - c) / 10);
        col[ci + 3] = clamp((e - 1) / 18, 0, 1) * edgeFade;
        if (e <= 1) { pos[i + 1] = -3; }
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const a = r * N + c, b = a + 1, d = a + N, e2 = d + 1;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
        idx[k++] = b; idx[k++] = d; idx[k++] = e2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const tMat = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: true,
      emissive: new THREE.Color(0x0d2018), emissiveIntensity: 0.9
    });
    tMat.vertexColors = true;
    if ('vertexAlphas' in tMat) tMat.vertexAlphas = true;
    terrainMesh = new THREE.Mesh(geo, tMat);
    terrainMesh.name = 'terrain';
    scene.add(terrainMesh);

    // water
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2.4, D * 2.4),
      new THREE.MeshPhongMaterial({ color: 0x123f57, shininess: 90, specular: 0x9ad4f0, emissive: 0x0a2230, transparent: true, opacity: 0.97 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.2;
    seaMesh = sea;
    scene.add(sea);
  }

  // ------------------------------------------------------------- markers (instanced)
  function makeGlowTexture() {
    const size = 64, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,.45)');
    g.addColorStop(0.65, 'rgba(255,255,255,.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(cv);
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function buildInstancedKind(kind, geo, items, scaleOf, hoverScale) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: new THREE.Color(COLOR[kind]), emissiveIntensity: 0.28 });
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.userData = { kind, items, scales: items.map(scaleOf) };
    const c = new THREE.Color(COLOR[kind]);
    for (let i = 0; i < items.length; i++) im.setColorAt(i, c);
    if (im.instanceColor) im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    instanced[kind] = im;
    markerGroups[kind].add(im);

    // glow points (single draw call)
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(items.length * 3);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      pos[i * 3] = projX(it.lon);
      pos[i * 3 + 1] = heightAt(it.lat, it.lon) * ELE_SCALE + 2.2;
      pos[i * 3 + 2] = projZ(it.lat);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color: COLOR[kind], size: kind === 'myeongsan' ? 10 : 8, map: makeGlowTexture(),
      transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    pts.userData = { kind, glow: true };
    markerGroups[kind].add(pts);
    return im;
  }

  let lastMarkerR = 0;
  function updateMarkerScale() {
    if (!instanced.hyuyang) return;
    if (lastMarkerR && Math.abs(cam.cRadius - lastMarkerR) / lastMarkerR < 0.05) return;
    lastMarkerR = cam.cRadius;
    placeInstances();
  }

  function markerScale() { return clamp(cam.cRadius / 520, 0.55, 2.6); }

  function placeInstances() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const kind of ['hyuyang', 'myeongsan', 'healing']) {
      const im = instanced[kind];
      if (!im) continue;
      const items = im.userData.items, scales = im.userData.scales;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const visible = S.visible[kind] && matches(kind, it);
        const s = visible ? scales[i] * markerScale() : 0;
        v.set(projX(it.lon), heightAt(it.lat, it.lon) * ELE_SCALE + (kind === 'myeongsan' ? 2.4 * s : 2.0 * s), projZ(it.lat));
        sc.set(s, s, s);
        m4.compose(v, q, sc);
        im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      const glow = markerGroups[kind].children.find((c) => c.userData && c.userData.glow);
      if (glow) glow.material.size = (kind === 'myeongsan' ? 10 : 8) * markerScale();
    }
  }

  function buildMarkers() {
    buildInstancedKind('hyuyang', new THREE.SphereGeometry(1.35, 10, 8), S.hyuyang, () => 1);
    buildInstancedKind('myeongsan', new THREE.ConeGeometry(1.6, 3.6, 5),
      S.myeongsan, (it) => 0.8 + clamp((it.h || 500) / 1900, 0, 1) * 0.9);
    buildInstancedKind('healing', new THREE.OctahedronGeometry(1.45, 0), S.healing, () => 1.05);

    // 보호수 points
    const n = S.trees.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = S.trees[i];
      pos[i * 3] = projX(t[9]);
      pos[i * 3 + 1] = heightAt(t[8], t[9]) * ELE_SCALE + 1.4;
      pos[i * 3 + 2] = projZ(t[8]);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    treePoints = new THREE.Points(g, new THREE.PointsMaterial({
      color: COLOR.tree, size: 2.1, map: makeGlowTexture(), transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    treePoints.userData = { kind: 'tree' };
    markerGroups.tree.add(treePoints);
    markerGroups.tree.visible = false;
  }

  // ------------------------------------------------------------- trails
  function buildTrails() {
    const posA = [], colA = [], segMeta = [];
    const cLow = new THREE.Color(0xc8ffe4), cHigh = new THREE.Color(0xffd98f);
    for (const course of S.trails) {
      for (const tr of course.tracks) {
        const pts = tr.pts, starts = (tr.brk || [0]).concat([pts.length]);
        for (let s = 0; s < starts.length - 1; s++) {
          const a = starts[s], b = starts[s + 1];
          for (let i = a; i < b - 1; i++) {
            for (const j of [i, i + 1]) {
              const [la, lo] = pts[j];
              const e = heightAt(la, lo);
              posA.push(projX(lo), e * ELE_SCALE + 1.3, projZ(la));
              const c = cLow.clone().lerp(cHigh, clamp(e / 1100, 0, 1));
              colA.push(c.r, c.g, c.b);
            }
            segMeta.push({ course: course.code, track: tr });
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
    trailLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1.0
    }));
    trailLines.userData = { kind: 'trail', segMeta };
    markerGroups.trail.add(trailLines);
    const glow = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(1, 1, 1);
    glow.userData = { kind: 'trail', segMeta, glowLine: true };
    markerGroups.trail.add(glow);
  }

  function buildParticles() {
    const n = 1100;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const W = S.span.width, D = S.span.depth;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * W * 1.05;
      pos[i * 3 + 1] = 12 + Math.random() * 150;
      pos[i * 3 + 2] = (Math.random() - 0.5) * D * 1.05;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    particles = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xcdeeff, size: 1.1, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, map: makeGlowTexture()
    }));
    scene.add(particles);
  }

  // ------------------------------------------------------------- camera
  const cam = { tx: -40, ty: 0, tz: 40, theta: 0.20, phi: 0.70, radius: 560, cx: 0, cy: 0, cz: 0, cTheta: 0.20, cPhi: 0.70, cRadius: 1100 };
  function applyCamera(dt) {
    const k = 1 - Math.exp(-(dt || 0.016) * 5.5);
    cam.cTheta = lerp(cam.cTheta, cam.theta, k);
    cam.cPhi = lerp(cam.cPhi, cam.phi, k);
    cam.cRadius = lerp(cam.cRadius, cam.radius, k * 0.9);
    cam.cx = lerp(cam.cx, cam.tx, k);
    cam.cy = lerp(cam.cy, cam.ty, k);
    cam.cz = lerp(cam.cz, cam.tz, k);
    const r = cam.cRadius, ph = cam.cPhi, th = cam.cTheta;
    camera.position.set(cam.cx + r * Math.sin(ph) * Math.sin(th), cam.cy + r * Math.cos(ph), cam.cz + r * Math.sin(ph) * Math.cos(th));
    camera.lookAt(cam.cx, cam.cy, cam.cz);
  }

  function initControls() {
    const el = $('#scene');
    let dragging = false, panMode = false, lx = 0, ly = 0, moved = 0, pinch0 = 0, pinchR0 = 0;

    el.addEventListener('pointerdown', (e) => {
      dragging = true; panMode = (e.button === 1 || e.shiftKey);
      lx = e.clientX; ly = e.clientY; moved = 0;
      try { el.setPointerCapture(e.pointerId); } catch (_) { }
    });
    el.addEventListener('pointermove', (e) => {
      updatePointer(e);
      if (!dragging || fly.active) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (!panMode) {
        cam.theta -= dx * 0.0055;
        cam.phi = clamp(cam.phi - dy * 0.0045, 0.18, 1.46);
      } else {
        const k = cam.radius * 0.0016;
        cam.tx += dx * k * Math.cos(cam.theta);
        cam.tz -= dx * k * Math.sin(cam.theta);
        cam.ty -= dy * k * 0.9;
      }
    });
    el.addEventListener('pointerup', (e) => {
      const wasDrag = moved >= 6;
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { }
      if (!wasDrag) handleClick();
    });
    el.addEventListener('pointerleave', () => { dragging = false; S.hoverItem = null; pinRefresh(); pointerNDC.set(-10, -10); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.radius = clamp(cam.radius * (1 + Math.sign(e.deltaY) * 0.08), 55, 1700);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinch0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        pinchR0 = cam.radius;
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinch0 > 0) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        cam.radius = clamp(pinchR0 * (pinch0 / Math.max(1, d)), 55, 1700);
        S.hoverItem = null; pinRefresh();
      }
    }, { passive: true });
    el.addEventListener('touchend', () => { pinch0 = 0; });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (fly.active) stopFly(false); else { closeDetail(); closeModals(); } }
      if (e.key === '+' || e.key === '=') cam.radius = clamp(cam.radius * 0.86, 55, 1700);
      if (e.key === '-') cam.radius = clamp(cam.radius * 1.16, 55, 1700);
    });
  }

  function updatePointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    S.px = e.clientX; S.py = e.clientY;
  }

  // ------------------------------------------------------------- picking
  const KIND_LABEL = { hyuyang: '휴양림', myeongsan: '100대명산', healing: '치유의숲', trail: '국가숲길', tree: '보호수' };

  function itemLatLon(kind, item) {
    if (kind === 'tree') return { lat: item[8], lon: item[9] };
    if (kind === 'trail') {
      const pts = item.track.pts, m = pts[Math.floor(pts.length / 2)];
      return { lat: m[0], lon: m[1] };
    }
    return { lat: item.lat, lon: item.lon };
  }

  function itemName(kind, item) {
    if (kind === 'tree') return item[0] + ' 보호수';
    if (kind === 'trail') return courseName(item.course) + ' · ' + item.track.id;
    return item.n || '이름 없음';
  }

  function itemSub(kind, item) {
    if (kind === 'hyuyang') return '자연휴양림 · ' + (item.sd || '') + (item.stay === 'Y' ? ' · 숙박' : '');
    if (kind === 'myeongsan') return '100대명산 · ' + fmtNum(Math.round(item.h)) + 'm' + (item.level && item.level !== '-' ? ' · ' + item.level : '');
    if (kind === 'healing') return '치유의숲 · ' + (item.kind || '') + (item.region ? ' · ' + item.region : '');
    if (kind === 'trail') return '국가숲길 · ' + fmtDist(item.track.dist) + ' · 누적 상승 ' + fmtNum(item.track.up) + 'm';
    if (kind === 'tree') return '보호수 · ' + item[2] + '년 · ' + (item[5] || '') + ' ' + (item[6] || '');
    return '';
  }

  function badgeKey(kind, item) {
    if (kind === 'tree') return 't' + item[8] + ',' + item[9] + ',' + item[0];
    if (kind === 'trail') return 'r' + item.course + item.track.id;
    return 'i' + (item.n || '') + (item.lat || '') + (item.lon || '');
  }

  function pickTargets() {
    const targets = [];
    for (const k of ['hyuyang', 'myeongsan', 'healing']) if (S.visible[k] && instanced[k]) targets.push(instanced[k]);
    if (S.visible.tree && treePoints) targets.push(treePoints);
    if (S.visible.trail) targets.push(trailLines);
    return targets;
  }

  function pickAt() {
    raycaster.setFromCamera(pointerNDC, camera);
    raycaster.params.Points.threshold = clamp(cam.cRadius * 0.0075, 1.8, 6.5);
    const hits = raycaster.intersectObjects(pickTargets(), false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.kind === 'trail') {
        const meta = ud.segMeta[Math.floor(h.index / 2)];
        if (meta && matches('trail', meta)) return { kind: 'trail', item: meta, instanceId: null };
      } else if (ud.kind === 'tree') {
        const t = S.trees[h.index];
        if (t && matches('tree', t)) return { kind: 'tree', item: t, instanceId: null };
      } else if (h.instanceId != null) {
        const it = ud.items[h.instanceId];
        if (it && matches(ud.kind, it)) return { kind: ud.kind, item: it, instanceId: h.instanceId };
      }
    }
    return null;
  }

  let hoverT = 0, lastHover = null, hoveredInstance = null;
  function doHover() {
    const now = performance.now();
    if (now - hoverT < 60) return;
    hoverT = now;
    const found = pickAt();
    const key = found ? found.kind + ':' + (found.instanceId != null ? found.instanceId : badgeKey(found.kind, found.item)) : null;
    if (key !== lastHover) {
      restoreHoverColors();
      if (found && found.instanceId != null) {
        const im = instanced[found.kind];
        im.setColorAt(found.instanceId, new THREE.Color(0xffffff));
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        hoveredInstance = { kind: found.kind, id: found.instanceId };
      }
      lastHover = key;
    }
    S.hoverItem = found;
    document.body.style.cursor = found ? 'pointer' : '';
    if (S.hoverItem) pinRefresh();
  }

  function restoreHoverColors() {
    if (hoveredInstance) {
      const im = instanced[hoveredInstance.kind];
      im.setColorAt(hoveredInstance.id, new THREE.Color(COLOR[hoveredInstance.kind]));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      hoveredInstance = null;
    }
  }

  // ------------------------------------------------------------- 3D 포인트 위 이름 배지
  const pinV = new THREE.Vector3();
  function pinPoint(kind, item) {
    const ll = itemLatLon(kind, item);
    return pinV.set(projX(ll.lon), heightAt(ll.lat, ll.lon) * ELE_SCALE + 3.4, projZ(ll.lat));
  }
  function pinRefresh() {
    const el = $('#pin');
    if (!el) return;
    const cur = S.selected || S.hoverItem;
    const sheet = $('#detail');
    if (!cur || fly.active || (isMobile() && cur === S.selected && sheet && !sheet.hidden)) {
      el.classList.remove('show'); el.hidden = true; el._key = null; return;
    }
    el.hidden = false;
    const isSel = cur === S.selected;
    const key = (isSel ? 'sel|' : 'hov|') + cur.kind + '|' + badgeKey(cur.kind, cur.item);
    if (el._key !== key) {
      const name = itemName(cur.kind, cur.item), sub = itemSub(cur.kind, cur.item);
      el.className = 'pin k-' + cur.kind + (isSel ? ' sel' : ' hover');
      el.innerHTML = '<b><span class="pin-chip">' + esc(KIND_LABEL[cur.kind] || '') + '</span>' + esc(name) + '</b>'
        + (sub ? '<small>' + esc(sub) + '</small>' : '');
      el._key = key;
    }
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const p = pinPoint(cur.kind, cur.item).project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1.08 || Math.abs(p.y) > 1.08) { el.classList.remove('show'); el.hidden = true; return; }
    el.style.left = ((p.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
    el.style.top = ((-p.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
    el.classList.add('show');
  }

  function handleClick() {
    if (fly.active) return;
    const hit = pickAt();
    if (hit) return select(hit.kind, hit.item);
    closeDetail();
  }

  const COURSE_NAMES = {
    '9900000001': 'DMZ펀치볼둘레길', '9900000002': '내포문화숲길', '9900000003': '대관령숲길',
    '9900000004': '백두대간트레일', '9900000005': '울진금강소나무숲길', '9900000006': '지리산둘레길'
  };
  const courseName = (c) => COURSE_NAMES[c] || '국가숲길';

  // ------------------------------------------------------------- selection
  let selRing = null;
  function showSelRing(x, y, z, color) {
    if (!selRing) {
      const g = new THREE.RingGeometry(2.4, 3.2, 40);
      selRing = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
      }));
      selRing.rotation.x = -Math.PI / 2;
      scene.add(selRing);
    }
    selRing.material.color.set(color || 0xffffff);
    selRing.position.set(x, y + 0.6, z);
    selRing.userData.t0 = performance.now();
    selRing.visible = true;
  }

  function select(kind, item) {
    if (fly.active) stopFly(true);
    S.selected = { kind, item };
    const ll = itemLatLon(kind, item);
    showSelRing(projX(ll.lon), heightAt(ll.lat, ll.lon) * ELE_SCALE, projZ(ll.lat), COLOR[kind] || 0xffffff);
    if (kind === 'trail') {
      focusOn(ll.lat, ll.lon, 250);
      highlightTrail(item);
    } else {
      focusOn(ll.lat, ll.lon, kind === 'myeongsan' ? 240 : (kind === 'tree' ? 120 : 200));
    }
    pinRefresh();
    buildRadiusRing(ll.lat, ll.lon, S.radiusKm);
    renderDetail(kind, item);
  }

  function highlightTrail(item) {
    if (trailSel) { scene.remove(trailSel); trailSel = null; }
    const t = item.track, pts = t.pts, starts = (t.brk || [0]).concat([pts.length]);
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let s = 0; s < starts.length - 1; s++) {
      const a = starts[s], b = starts[s + 1];
      if (b - a < 2) continue;
      const vs = [];
      for (let i = a; i < b; i++) {
        const [la, lo] = pts[i];
        vs.push(new THREE.Vector3(projX(lo), heightAt(la, lo) * ELE_SCALE + 1.8, projZ(la)));
      }
      const curve = new THREE.CatmullRomCurve3(vs, false, 'catmullrom', 0.2);
      const tube = new THREE.TubeGeometry(curve, Math.min(240, vs.length * 2), 0.55, 6, false);
      grp.add(new THREE.Mesh(tube, mat));
    }
    if (!grp.children.length) return;
    trailSel = grp;
    scene.add(trailSel);
  }

  function focusOn(lat, lon, radius) {
    cam.tx = projX(lon); cam.tz = projZ(lat); cam.ty = heightAt(lat, lon) * ELE_SCALE;
    if (radius) cam.radius = radius;
    cam.phi = clamp(cam.phi, 0.5, 1.2);
  }

  // ------------------------------------------------------------- detail
  function renderDetail(kind, item) {
    const box = $('#detail');
    let html = '';
    if (kind === 'hyuyang') html = detailHyuyang(item);
    else if (kind === 'myeongsan') html = detailMyeongsan(item);
    else if (kind === 'healing') html = detailHealing(item);
    else if (kind === 'tree') html = detailTree(item);
    else if (kind === 'trail') html = detailTrail(item);
    $('#detailBody').innerHTML = html + nearbyBlock(kind, item);
    box.hidden = false;
    const body = $('#detailBody');
    if (body) body.scrollTop = 0;
  }

  function detailTree(t) {
    const old = t[2] >= 300;
    return `
      <span class="kicker k-tree">보호수</span>
      <h3>${esc(t[0])} 보호수</h3>
      <p class="sub">${esc(t[7])}</p>
      <dl class="kv">
        <dt>수종</dt><dd>${esc(t[0])}</dd>
        <dt>유형</dt><dd>${esc(t[1] || '-')}${old ? ' · 노거수' : ''}</dd>
        <dt>수령</dt><dd>${fmtNum(t[2])}년${old ? ' (300년 이상)' : ''}</dd>
        <dt>나무높이</dt><dd>${t[3] ? t[3] + 'm' : '-'}</dd>
        <dt>가슴높이 둘레</dt><dd>${t[4] ? t[4] : '-'} <span style="color:var(--muted);font-size:11px">(원본 값)</span></dd>
        <dt>지역</dt><dd>${esc((t[5] || '') + ' ' + (t[6] || ''))}</dd>
        <dt>좌표</dt><dd>${Number(t[8]).toFixed(4)}, ${Number(t[9]).toFixed(4)}</dd>
      </dl>
      <div class="detail-actions"><button type="button" data-act="fit">지도에서 확대</button></div>
      <div class="src">출처: 전국보호수표준데이터(산림청·지자체) · 수종·수령·규격·소재지 원본 값</div>`;
  }

  function detailHyuyang(it) {
    const fac = (it.fac || []).map((f) => '<span>' + esc(f) + '</span>').join('');
    return `
      <span class="kicker">자연휴양림</span>
      <h3>${esc(it.n)}</h3>
      <p class="sub">${esc(it.addr || it.sd)}</p>
      <dl class="kv">
        <dt>구분</dt><dd>${esc(it.t || '-')} · ${esc(it.sd || '')}</dd>
        <dt>숙박</dt><dd>${it.stay === 'Y' ? '가능 (숙박시설 운영)' : '불가 (당일 이용)'}</dd>
        <dt>수용인원</dt><dd>${it.cap ? fmtNum(it.cap) + '명' : '-'}</dd>
        <dt>면적</dt><dd>${it.ar ? fmtNum(Math.round(it.ar)) + '㎡' : '-'}</dd>
        <dt>입장료</dt><dd>${esc(it.fee || '-')}</dd>
        <dt>관리</dt><dd>${esc(it.org || '-')}</dd>
        <dt>문의</dt><dd>${it.tel ? esc(it.tel) : '-'}</dd>
        <dt>좌표</dt><dd>${it.lat.toFixed(4)}, ${it.lon.toFixed(4)}</dd>
      </dl>
      ${fac ? '<h4>주요 시설</h4><div class="chips">' + fac + '</div>' : ''}
      <div class="detail-actions">
        ${it.hp ? `<a href="${esc(it.hp)}" target="_blank" rel="noopener">홈페이지 열기</a>` : ''}
        <button type="button" data-act="fit">지도에서 확대</button>
      </div>
      <div class="src">출처: 전국휴양림표준데이터(산림청·지자체) · 기준일 ${esc(it.ref || '-')}</div>`;
  }

  function detailMyeongsan(it) {
    return `
      <span class="kicker k-myeongsan">100대명산</span>
      <h3>${esc(it.n)}</h3>
      <p class="sub">${esc(it.loc)}</p>
      <dl class="kv">
        <dt>높이</dt><dd>${fmtNum(Math.round(it.h))}m</dd>
        <dt>난이도</dt><dd>${esc(it.level && it.level !== '-' ? it.level : '정보 없음')}</dd>
        <dt>산행시간</dt><dd>${esc(it.time || '-')}</dd>
        <dt>좌표</dt><dd>${it.lat.toFixed(4)}, ${it.lon.toFixed(4)}</dd>
      </dl>
      ${it.why ? '<h4>선정 이유</h4><p>' + esc(it.why) + '</p>' : ''}
      ${it.about ? '<h4>산 개요</h4><p>' + esc(it.about) + '</p>' : ''}
      ${it.point ? '<h4>산행 포인트</h4><p>' + esc(it.point) + '</p>' : ''}
      ${it.course ? '<h4>산행 코스</h4><p class="course-text">' + esc(it.course) + '</p>' : ''}
      ${it.traffic ? '<h4>교통</h4><p>' + esc(it.traffic) + '</p>' : ''}
      <div class="detail-actions"><button type="button" data-act="fit">지도에서 확대</button></div>
      <div class="src">출처: 산림청 국립자연휴양림관리소「숲나들e 100대명산 정보」 · 원본 좌표 사용</div>`;
  }

  function detailHealing(it) {
    return `
      <span class="kicker k-healing">치유의숲</span>
      <h3>${esc(it.n)}</h3>
      <p class="sub">${esc(it.addr)}</p>
      <dl class="kv">
        <dt>권역</dt><dd>${esc(it.region || '-')}</dd>
        <dt>운영</dt><dd>${esc(it.kind || '-')}</dd>
        <dt>문의</dt><dd>${it.tel ? esc(it.tel) : '-'}</dd>
        <dt>좌표</dt><dd>${it.lat.toFixed(4)}, ${it.lon.toFixed(4)}</dd>
      </dl>
      <div class="detail-actions">
        ${it.hp ? `<a href="${esc(it.hp)}" target="_blank" rel="noopener">홈페이지 열기</a>` : ''}
        <button type="button" data-act="fit">지도에서 확대</button>
      </div>
      <div class="src">출처: 산림청「전국 치유의숲 좌표」 · 국립/공립 구분 원본 값</div>`;
  }

  function detailTrail(item) {
    const t = item.track;
    return `
      <span class="kicker k-trail">국가숲길</span>
      <h3>${esc(courseName(item.course))}</h3>
      <p class="sub">${esc(t.id)} 코스 · 실제 GPX 트랙을 지형에 투영</p>
      <dl class="kv">
        <dt>구간 거리</dt><dd>${fmtDist(t.dist)}</dd>
        <dt>누적 상승</dt><dd>${fmtNum(t.up)}m</dd>
        <dt>누적 하강</dt><dd>${fmtNum(t.down)}m</dd>
        <dt>고도 범위</dt><dd>${fmtNum(t.minE)}m ~ ${fmtNum(t.maxE)}m</dd>
        <dt>트랙 구성</dt><dd>${(t.brk || [0]).length}개 구간 · ${t.pts.length}개 지점</dd>
      </dl>
      <h4>고도 프로필</h4>
      ${profileSVG(t.prof)}
      <div class="profile-meta"><span>시작</span><span>구간 고도</span><span>종료</span></div>
      <div class="detail-actions"><button type="button" data-act="fly" class="act-fly">🛩 3D 코스 비행</button><button type="button" data-act="fit">코스로 이동</button></div>
      <div class="src">출처: 한국등산트레킹지원센터「국가숲길 코스」 GPX · 고도는 실제 표고(DEM)에서 계산</div>`;
  }

  function profileSVG(prof) {
    if (!prof || prof.length < 2) return '<svg class="profile" viewBox="0 0 300 74"></svg>';
    const min = Math.min.apply(null, prof), max = Math.max.apply(null, prof);
    const W = 300, H = 74, pad = 4, span = Math.max(1, max - min);
    let d = '';
    prof.forEach((v, i) => {
      const x = pad + (i / (prof.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / span) * (H - pad * 2 - 10);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    const area = d + `L${W - pad} ${H - pad}L${pad} ${H - pad}Z`;
    return `<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7ff0b8" stop-opacity=".5"/>
        <stop offset="100%" stop-color="#7ff0b8" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#pg)"/>
      <path d="${d}" fill="none" stroke="#a9ffd2" stroke-width="1.6"/>
    </svg>`;
  }

  document.addEventListener('click', (e) => {
    const fit = e.target.closest && e.target.closest('[data-act="fit"]');
    if (fit && S.selected) {
      const k = S.selected.kind, it = S.selected.item;
      const ll = itemLatLon(k, it);
      focusOn(ll.lat, ll.lon, k === 'tree' ? 90 : 130);
    }
    const flyBtn = e.target.closest && e.target.closest('[data-act="fly"]');
    if (flyBtn && S.selected && S.selected.kind === 'trail') startFly(S.selected.item);

    const rBtn = e.target.closest && e.target.closest('[data-radius]');
    if (rBtn) {
      S.radiusKm = Number(rBtn.dataset.radius) || 20;
      if (S.selected) {
        const ll = itemLatLon(S.selected.kind, S.selected.item);
        buildRadiusRing(ll.lat, ll.lon, S.radiusKm);
        renderDetail(S.selected.kind, S.selected.item);
      }
    }

    const nBtn = e.target.closest && e.target.closest('[data-near]');
    if (nBtn) {
      const r = S.nearList[Number(nBtn.dataset.near)];
      if (r) select(r.kind, r.item);
    }
  });
  // ------------------------------------------------------------- 반경 연계 탐색 (ring)
  const RING_SEGS = 128;
  let ringStatic = null, ringPulseLine = null, ringPulseT = -1;
  const ringCtx = { lat: 0, lon: 0, km: 20 };

  function ringPts(lat, lon, km, segs) {
    const arr = new Float32Array(segs * 3);
    const dLat = km / KM_LAT;
    const dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const la = lat + dLat * Math.cos(a), lo = lon + dLon * Math.sin(a);
      arr[i * 3] = projX(lo);
      arr[i * 3 + 1] = heightAt(la, lo) * ELE_SCALE + 1.15;
      arr[i * 3 + 2] = projZ(la);
    }
    return arr;
  }

  function buildRadiusRing(lat, lon, km) {
    ringCtx.lat = lat; ringCtx.lon = lon; ringCtx.km = km;
    if (!ringStatic) {
      const g1 = new THREE.BufferGeometry();
      g1.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_SEGS * 3), 3));
      ringStatic = new THREE.LineLoop(g1, new THREE.LineBasicMaterial({
        color: 0x9dffcd, transparent: true, opacity: 0.7, depthWrite: false
      }));
      ringStatic.renderOrder = 3;
      scene.add(ringStatic);
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_SEGS * 3), 3));
      ringPulseLine = new THREE.LineLoop(g2, new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false
      }));
      ringPulseLine.renderOrder = 4;
      scene.add(ringPulseLine);
    }
    ringStatic.visible = true;
    ringStatic.geometry.attributes.position.array.set(ringPts(lat, lon, km, RING_SEGS));
    ringStatic.geometry.attributes.position.needsUpdate = true;
    ringStatic.geometry.computeBoundingSphere();
    ringPulseLine.visible = true;
    ringPulseT = 0;
  }

  function hideRadiusRing() {
    if (ringStatic) ringStatic.visible = false;
    if (ringPulseLine) ringPulseLine.visible = false;
    ringPulseT = -1;
  }

  function updateRadiusRing(dt) {
    if (ringPulseT < 0 || !ringPulseLine) return;
    ringPulseT += dt;
    const T = 1.5;
    if (ringPulseT > T * 2.4) { ringPulseT = -1; ringPulseLine.visible = false; return; }
    const p = (ringPulseT % T) / T;
    ringPulseLine.geometry.attributes.position.array.set(
      ringPts(ringCtx.lat, ringCtx.lon, ringCtx.km * (0.1 + 0.9 * p), RING_SEGS));
    ringPulseLine.geometry.attributes.position.needsUpdate = true;
    ringPulseLine.material.opacity = 0.9 * (1 - p);
    ringStatic.material.opacity = 0.5 + 0.16 * Math.sin(performance.now() / 620);
  }

  function nearbySummary(lat, lon, km) {
    const out = { km, counts: { hyuyang: 0, myeongsan: 0, healing: 0, tree: 0, trail: 0 }, list: [] };
    const me = { lat, lon };
    const add = (kind, item, d, name, sub) => {
      out.counts[kind]++;
      out.list.push({ kind, item, d, name, sub });
    };
    for (const it of S.hyuyang) {
      const d = haversine(me, { lat: it.lat, lon: it.lon });
      if (d <= km) add('hyuyang', it, d, it.n, (it.sd || '') + (it.stay === 'Y' ? ' · 숙박' : ''));
    }
    for (const it of S.myeongsan) {
      const d = haversine(me, { lat: it.lat, lon: it.lon });
      if (d <= km) add('myeongsan', it, d, it.n, fmtNum(Math.round(it.h)) + 'm');
    }
    for (const it of S.healing) {
      const d = haversine(me, { lat: it.lat, lon: it.lon });
      if (d <= km) add('healing', it, d, it.n, it.kind || '치유의숲');
    }
    for (const t of S.trees) {
      const d = haversine(me, { lat: t[8], lon: t[9] });
      if (d <= km) add('tree', t, d, t[0] + ' 보호수', t[2] + '년 · ' + (t[6] || ''));
    }
    if (S.visible.trail) {
      for (const c of S.trails) {
        for (const tr of c.tracks) {
          const pts = tr.pts;
          const step = Math.max(1, Math.floor(pts.length / 120));
          let best = 1e9;
          for (let i = 0; i < pts.length; i += step) {
            const d = haversine(me, { lat: pts[i][0], lon: pts[i][1] });
            if (d < best) best = d;
          }
          if (best <= km) add('trail', { course: c.code, track: tr }, best, courseName(c.code), tr.id + ' · ' + fmtDist(tr.dist));
        }
      }
    }
    out.list.sort((a, b) => a.d - b.d);
    return out;
  }

  function distLabel(d) { return d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km'; }

  function nearbyBlock(kind, item) {
    const ll = itemLatLon(kind, item);
    const near = nearbySummary(ll.lat, ll.lon, S.radiusKm);
    S.nearList = near.list;
    const top = near.list.slice(0, 6);
    const rows = top.map((r, i) => `<button type="button" data-near="${i}">
        <b style="font-weight:600">${esc(r.name)}</b>
        <span>${esc(KIND_LABEL[r.kind])} · ${distLabel(r.d)}</span></button>`).join('');
    return `<div class="near">
      <h4>반경 ${S.radiusKm}km 연계 산림자원</h4>
      <div class="near-top">
        <span style="font-size:11.5px;color:var(--muted);line-height:1.5">지도 위 링 안의 자원을 바로 모아 봅니다</span>
        <div class="near-radius">${[10, 20, 50].map((k) => `<button type="button" data-radius="${k}" class="${k === S.radiusKm ? 'on' : ''}">${k}km</button>`).join('')}</div>
      </div>
      <div class="near-counts">
        <div><b>${near.counts.hyuyang}</b><em>휴양림</em></div>
        <div><b>${near.counts.myeongsan}</b><em>명산</em></div>
        <div><b>${near.counts.healing}</b><em>치유의숲</em></div>
        <div><b>${near.counts.tree}</b><em>보호수</em></div>
      </div>
      <div class="near-list">${rows || '<div style="font-size:11.5px;color:var(--muted)">반경 안에 등록된 자원이 없습니다. 반경을 넓혀 보세요.</div>'}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px">국가숲길 ${near.counts.trail}개 코스가 반경을 지납니다</div>
    </div>`;
  }

  // ------------------------------------------------------------- 국가숲길 3D 코스 비행
  const fly = {
    active: false, paused: false, item: null, pts: [], cum: [], totalUnits: 0, totalMeters: 0,
    s: 0, dur: 34, prof: [], pos: new THREE.Vector3(), look: new THREE.Vector3()
  };

  function startFly(item) {
    const t = item.track, raw = t.pts;
    if (!raw || raw.length < 4) return toast('이 코스는 비행할 좌표가 부족합니다.', 3200);
    const step = Math.max(1, Math.floor(raw.length / 680));
    const pts = [];
    for (let i = 0; i < raw.length; i += step) {
      const p = raw[i];
      const e = heightAt(p[0], p[1]);
      pts.push({ v: new THREE.Vector3(projX(p[1]), e * ELE_SCALE + 2.4, projZ(p[0])), lat: p[0], lon: p[1], e });
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].v.distanceTo(pts[i].v));
    const total = cum[cum.length - 1];
    if (!(total > 0)) return toast('이 코스는 비행할 거리가 없습니다.', 3200);

    fly.item = item;
    fly.pts = pts; fly.cum = cum;
    fly.totalUnits = total;
    fly.totalMeters = total * 1000 / P.k;
    fly.dur = clamp(fly.totalMeters / 240, 26, 46);
    fly.s = 0; fly.active = true; fly.paused = false;
    fly.prof = (t.prof && t.prof.length > 1) ? t.prof : pts.map((p) => p.e);

    const p0 = pts[0], p1 = pts[Math.min(8, pts.length - 1)];
    const dir0 = p1.v.clone().sub(p0.v);
    const dirH = new THREE.Vector3(dir0.x, 0, dir0.z);
    if (dirH.lengthSq() < 1e-8) dirH.set(0, 0, -1);
    dirH.normalize();
    fly.pos.copy(p0.v).addScaledVector(dirH, -16).add(new THREE.Vector3(0, 46, 0));
    fly.look.copy(p0.v).addScaledVector(dirH, 62).add(new THREE.Vector3(0, -11, 0));
    camera.position.copy(fly.pos);
    camera.lookAt(fly.look);

    $('#flyName').textContent = courseName(item.course) + ' · ' + t.id + ' (' + fmtDist(t.dist) + ')';
    $('#flyHud').hidden = false;
    for (const k of ['hyuyang', 'myeongsan', 'healing', 'tree']) if (markerGroups[k]) markerGroups[k].visible = false;
    if (trailSel) trailSel.visible = false;
    if (selRing) selRing.visible = false;
    hideRadiusRing();
    drawSpark(fly.prof);
    updateFlyHud(sampleFly(0));
    $('#detail').hidden = true;
    $('#flyPause').textContent = '일시정지';
    document.body.classList.add('flying');
    toast('국가숲길 3D 코스 비행 시작 · ESC 로 종료', 3200);
  }

  function sampleFly(u) {
    const target = clamp(u, 0, 1) * fly.totalUnits;
    const cum = fly.cum;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const seg = (cum[hi] - cum[lo]) || 1;
    const f = clamp((target - cum[lo]) / seg, 0, 1);
    const a = fly.pts[lo], b = fly.pts[hi];
    return {
      p: a.v.clone().lerp(b.v, f),
      e: a.e + (b.e - a.e) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f
    };
  }

  function updateFlyHud(smp) {
    const done = fly.s * fly.totalMeters;
    $('#flyDist').textContent = fmtDist(done);
    $('#flyEle').textContent = fmtNum(Math.round(smp.e)) + 'm';
    $('#flyLeft').textContent = fmtDist(Math.max(0, fly.totalMeters - done));
    $('#flyPct').textContent = Math.round(fly.s * 100) + '%';
    $('#flyCursor').style.left = (fly.s * 100).toFixed(2) + '%';
  }

  function drawSpark(prof) {
    const svg = $('#flySpark');
    if (!svg || !prof || prof.length < 2) return;
    const W = 320, H = 64, pad = 5;
    const min = Math.min.apply(null, prof), max = Math.max.apply(null, prof);
    const span = Math.max(1, max - min), n = prof.length;
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = pad + (i / (n - 1)) * (W - pad * 2);
      const y = H - pad - ((prof[i] - min) / span) * (H - pad * 2 - 6);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    svg.innerHTML = '<defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="#7ff0b8" stop-opacity=".45"/>'
      + '<stop offset="100%" stop-color="#7ff0b8" stop-opacity="0"/></linearGradient></defs>'
      + `<path d="${d}L${W - pad} ${H - pad}L${pad} ${H - pad}Z" fill="url(#fg)"/>`
      + `<path d="${d}" fill="none" stroke="#a9ffd2" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  function updateFly(dt) {
    if (!fly.active) return;
    if (!fly.paused) fly.s = Math.min(1, fly.s + dt / fly.dur);
    const smp = sampleFly(fly.s);
    const ahead = sampleFly(Math.min(1, fly.s + 0.014));
    const dir = ahead.p.clone().sub(smp.p);
    dir.y = 0;
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
    dir.normalize();
    const desired = smp.p.clone().addScaledVector(dir, -16).add(new THREE.Vector3(0, 46, 0));
    fly.pos.lerp(desired, 1 - Math.exp(-dt * 3.4));
    // 카메라가 지형을 뚫지 않도록 최소 고도 유지
    const clat = P.latC - fly.pos.z / (KM_LAT * P.k);
    const clon = P.lonC + fly.pos.x / (KM_LON * P.k);
    const groundY = heightAt(clat, clon) * ELE_SCALE;
    if (fly.pos.y < groundY + 12) fly.pos.y = groundY + 12;
    const wantLook = smp.p.clone().addScaledVector(dir, 62).add(new THREE.Vector3(0, -11, 0));
    fly.look.lerp(wantLook, 1 - Math.exp(-dt * 4.8));
    camera.position.copy(fly.pos);
    camera.lookAt(fly.look);
    updateFlyHud(smp);
    if (fly.s >= 1) {
      stopFly(true);
      toast('코스 비행 완료 · ' + courseName(fly.item.course) + ' ' + fly.item.track.id, 4000);
    }
  }

  function stopFly(quiet) {
    if (!fly.active) return;
    fly.active = false; fly.paused = false;
    $('#flyHud').hidden = true;
    document.body.classList.remove('flying');
    applyFilters();
    const p = camera.position, tgt = fly.look;
    const dx = p.x - tgt.x, dy = p.y - tgt.y, dz = p.z - tgt.z;
    const r = clamp(Math.sqrt(dx * dx + dy * dy + dz * dz), 55, 1700);
    cam.tx = tgt.x; cam.ty = tgt.y; cam.tz = tgt.z;
    cam.radius = r; cam.cRadius = r;
    cam.phi = clamp(Math.acos(clamp(dy / r, -1, 1)), 0.18, 1.46);
    cam.cPhi = cam.phi;
    cam.theta = Math.atan2(dx, dz);
    cam.cTheta = cam.theta;
    cam.cx = cam.tx; cam.cy = cam.ty; cam.cz = cam.tz;
    if (S.selected && !quiet) { /* 상세는 아래에서 다시 연다 */ }
    if (trailSel) trailSel.visible = true;
    if (S.selected) {
      const ll = itemLatLon(S.selected.kind, S.selected.item);
      buildRadiusRing(ll.lat, ll.lon, S.radiusKm);
      renderDetail(S.selected.kind, S.selected.item);
    }
    if (!quiet) toast('3D 코스 비행을 종료했습니다', 2800);
  }

  function closeDetail() {
    $('#detail').hidden = true;
    S.selected = null;
    S.hoverItem = null;
    if (selRing) selRing.visible = false;
    hideRadiusRing();
    if (fly.active) stopFly(true);
    const pin = $('#pin'); if (pin) { pin.classList.remove('show'); pin.hidden = true; pin._key = null; }
  }

  // ------------------------------------------------------------- filters
  const SIDO_BOXES = [
    { k: '서울', s: 37.42, n: 37.72, w: 126.72, e: 127.20 },
    { k: '부산', s: 35.03, n: 35.40, w: 128.90, e: 129.32 },
    { k: '대구', s: 35.62, n: 36.02, w: 128.32, e: 128.80 },
    { k: '인천', s: 37.30, n: 37.92, w: 126.28, e: 126.78 },
    { k: '광주', s: 35.05, n: 35.26, w: 126.72, e: 127.02 },
    { k: '대전', s: 36.18, n: 36.50, w: 127.25, e: 127.56 },
    { k: '울산', s: 35.38, n: 35.72, w: 128.98, e: 129.45 },
    { k: '세종', s: 36.40, n: 36.70, w: 127.15, e: 127.40 },
    { k: '경기', s: 36.88, n: 38.30, w: 126.35, e: 127.90 },
    { k: '강원', s: 36.98, n: 38.62, w: 127.35, e: 129.40 },
    { k: '충북', s: 36.00, n: 37.20, w: 127.40, e: 128.70 },
    { k: '충남', s: 35.90, n: 37.10, w: 126.05, e: 127.60 },
    { k: '전북', s: 35.30, n: 36.20, w: 126.30, e: 127.80 },
    { k: '전남', s: 34.00, n: 35.50, w: 125.80, e: 127.80 },
    { k: '경북', s: 35.45, n: 37.10, w: 127.50, e: 129.60 },
    { k: '경남', s: 34.50, n: 35.80, w: 127.50, e: 129.30 },
    { k: '제주', s: 33.10, n: 33.68, w: 126.10, e: 127.00 }
  ];
  function sidoAt(lat, lon) {
    for (const b of SIDO_BOXES) if (lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e) return b.k;
    return null;
  }
  const SIDO_PATTERNS = [
    ['서울', /서울/], ['부산', /부산/], ['대구', /대구/], ['인천', /인천/], ['광주', /광주/],
    ['대전', /대전/], ['울산', /울산/], ['세종', /세종/], ['경기', /경기/], ['강원', /강원/],
    ['충북', /충북|충청북/], ['충남', /충남|충청남/], ['전북', /전북|전라북/], ['전남', /전남|전라남/],
    ['경북', /경북|경상북/], ['경남', /경남|경상남/], ['제주', /제주/]
  ];
  function canonSet(text) {
    const out = new Set();
    if (!text) return out;
    const t = String(text);
    if (/경상도/.test(t)) { out.add('경북'); out.add('경남'); }
    if (/전라도/.test(t)) { out.add('전북'); out.add('전남'); }
    if (/충청도/.test(t)) { out.add('충북'); out.add('충남'); }
    for (const [k, re] of SIDO_PATTERNS) if (re.test(t)) out.add(k);
    return out;
  }
  function trailRegions(track) {
    if (track._regions) return track._regions;
    const cnt = {}; let total = 0;
    const step = Math.max(1, Math.floor(track.pts.length / 70));
    for (let i = 0; i < track.pts.length; i += step) {
      const [la, lo] = track.pts[i];
      const k = sidoAt(la, lo);
      total++;
      if (k) cnt[k] = (cnt[k] || 0) + 1;
    }
    const regs = Object.keys(cnt).filter((k) => cnt[k] / Math.max(1, total) > 0.1);
    track._regions = regs.length ? regs : (sidoAt(track.pts[0][0], track.pts[0][1]) ? [sidoAt(track.pts[0][0], track.pts[0][1])] : []);
    return track._regions;
  }
  function itemRegions(kind, item) {
    if (kind === 'hyuyang') return canonSet(item.sd);
    if (kind === 'myeongsan') return canonSet(item.loc);
    if (kind === 'healing') return canonSet(item.region + ' ' + (item.addr || ''));
    if (kind === 'tree') return canonSet(item[5] + ' ' + item[6]);
    if (kind === 'trail') {
      const s = new Set(trailRegions(item.track));
      return s;
    }
    return new Set();
  }

  function matches(kind, item) {
    if (S.sido) {
      if (!itemRegions(kind, item).has(S.sido)) return false;
    }
    if (S.extra) {
      if (S.extra === 'stay' && !(kind === 'hyuyang' && item.stay === 'Y')) return false;
      if (S.extra === 'free' && !(kind === 'hyuyang' && /무료/.test(item.fee || ''))) return false;
      if (S.extra === 'low' && !(kind === 'myeongsan' && item.level === '초급')) return false;
      if (S.extra === 'mid' && !(kind === 'myeongsan' && item.level === '중급')) return false;
      if (S.extra === 'high' && !(kind === 'myeongsan' && item.level === '고급')) return false;
      if (S.extra === 'old' && !(kind === 'tree' && item[2] >= 300)) return false;
    }
    if (S.search) {
      const q = S.search.toLowerCase();
      let hay = '';
      if (kind === 'hyuyang') hay = item.n + ' ' + item.addr + ' ' + (item.fac || []).join(' ');
      else if (kind === 'myeongsan') hay = item.n + ' ' + item.loc;
      else if (kind === 'healing') hay = item.n + ' ' + item.addr;
      else if (kind === 'tree') hay = item[0] + ' ' + item[7];
      else if (kind === 'trail') hay = courseName(item.course);
      if (hay.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function applyFilters() {
    placeInstances();
    markerGroups.hyuyang.visible = S.visible.hyuyang;
    markerGroups.myeongsan.visible = S.visible.myeongsan;
    markerGroups.healing.visible = S.visible.healing;
    markerGroups.tree.visible = S.visible.tree;
    markerGroups.trail.visible = S.visible.trail;
    if (treePoints) treePoints.visible = S.visible.tree;
    renderList(); renderStats();
  }

  function countVisible(kind) {
    if (!S.visible[kind]) return 0;
    if (kind === 'tree') return S.trees.filter((t) => matches('tree', t)).length;
    if (kind === 'trail') {
      let n = 0;
      for (const c of S.trails) for (const t of c.tracks) if (matches('trail', { course: c.code, track: t })) n++;
      return n;
    }
    return S[kind].filter((it) => matches(kind, it)).length;
  }

  function renderStats() {
    const h = countVisible('hyuyang'), m = countVisible('myeongsan'), t = countVisible('trail'),
      he = countVisible('healing'), tr = countVisible('tree');
    $('#statText').innerHTML = `표시 중 <b>${fmtNum(h + m + t + he + tr)}</b>건 · 휴양림 ${h} · 명산 ${m} · 숲길 ${t} · 치유 ${he}` + (tr ? ` · 보호수 ${fmtNum(tr)}` : '');
  }

  function renderList() {
    const ul = $('#resultList');
    const rows = [];
    if (S.visible.hyuyang) S.hyuyang.forEach((it) => { if (matches('hyuyang', it)) rows.push({ kind: 'hyuyang', item: it, name: it.n, sub: '자연휴양림 · ' + it.sd + (it.stay === 'Y' ? ' · 숙박' : '') }); });
    if (S.visible.myeongsan) S.myeongsan.forEach((it) => { if (matches('myeongsan', it)) rows.push({ kind: 'myeongsan', item: it, name: it.n, sub: '100대명산 · ' + Math.round(it.h) + 'm · ' + (it.level || '-') }); });
    if (S.visible.healing) S.healing.forEach((it) => { if (matches('healing', it)) rows.push({ kind: 'healing', item: it, name: it.n, sub: '치유의숲 · ' + (it.region || '') }); });
    if (S.visible.trail) S.trails.forEach((c) => c.tracks.forEach((t) => { if (matches('trail', { course: c.code, track: t })) rows.push({ kind: 'trail', item: { course: c.code, track: t }, name: courseName(c.code), sub: '국가숲길 · ' + fmtDist(t.dist) }); }));
    if (S.visible.tree) S.trees.forEach((t) => { if (matches('tree', t)) rows.push({ kind: 'tree', item: t, name: t[0] + ' 보호수', sub: (t[5] || '') + ' ' + (t[6] || '') + ' · ' + t[2] + '년' }); });

    const LIMIT = 60;
    const shown = rows.slice(0, LIMIT);
    if (!shown.length) {
      ul.innerHTML = '<li class="r-empty">조건에 맞는 숲이 없습니다. 필터를 풀거나 다른 지역을 골라 보세요.</li>';
      return;
    }
    const colorOf = { hyuyang: '#74f0b4', myeongsan: '#ffc861', healing: '#86c2ff', trail: '#bfe9d0', tree: '#bdf08d' };
    ul.innerHTML = shown.map((r, i) => `<li data-i="${i}">
        <span class="r-dot" style="background:${colorOf[r.kind]}"></span>
        <span class="r-main"><span class="r-name">${esc(r.name)}</span><span class="r-sub">${esc(r.sub)}</span></span>
      </li>`).join('') + (rows.length > LIMIT ? `<li class="r-empty">외 ${fmtNum(rows.length - LIMIT)}건 — 검색으로 좁혀 보세요.</li>` : '');

    ul.querySelectorAll('li[data-i]').forEach((li) => {
      li.onclick = () => {
        const r = shown[+li.dataset.i];
        select(r.kind, r.item);
        if (isMobile()) $('#panel').classList.remove('open');
      };
    });
  }

  // ------------------------------------------------------------- UI
  function initUI() {
    document.querySelectorAll('.layer').forEach((lab) => {
      const kind = lab.dataset.kind;
      const cb = lab.querySelector('input');
      cb.checked = S.visible[kind];
      cb.addEventListener('change', () => { S.visible[kind] = cb.checked; applyFilters(); });
    });

    const sidos = Array.from(new Set(S.hyuyang.map((h) => h.sd).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
    const sel = $('#sido');
    sidos.forEach((s) => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
    sel.addEventListener('change', () => {
      const keys = Array.from(canonSet(sel.value));
      S.sido = keys.length ? keys[0] : '';
      refreshExtra(); applyFilters();
    });

    const extra = $('#extra');
    function refreshExtra() {
      const cur = extra.value;
      const opts = [['', '조건 없음'], ['stay', '숙박 가능한 휴양림'], ['free', '입장료 무료'],
        ['low', '명산 · 초급'], ['mid', '명산 · 중급'], ['high', '명산 · 고급'], ['old', '보호수 · 300년 이상']];
      extra.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      extra.value = opts.some(([v]) => v === cur) ? cur : '';
      S.extra = extra.value;
    }
    refreshExtra();
    extra.addEventListener('change', () => { S.extra = extra.value; applyFilters(); });

    let st = 0;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(st);
      st = setTimeout(() => { S.search = e.target.value.trim(); applyFilters(); }, 110);
    });

    $('#cntHyuyang').textContent = S.hyuyang.length;
    $('#cntMyeongsan').textContent = S.myeongsan.length;
    $('#cntHealing').textContent = S.healing.length;
    $('#cntTrail').textContent = S.trails.reduce((a, c) => a + c.tracks.length, 0);
    $('#cntTree').textContent = fmtNum(S.trees.length);
    const nTrail = S.trails.reduce((a, c) => a + c.tracks.length, 0);
    const ct = document.getElementById('caseTrail'), ct2 = document.getElementById('caseTrail2');
    if (ct) ct.textContent = nTrail; if (ct2) ct2.textContent = nTrail;
    const total = S.hyuyang.length + S.myeongsan.length + S.healing.length + S.trees.length + S.trails.reduce((a, c) => a + c.tracks.length, 0);
    $('#rowCountTop').textContent = fmtNum(total);

    $('#detailClose').onclick = closeDetail;

    document.querySelectorAll('.moods button').forEach((b) => {
      b.onclick = () => applyMood(b.dataset.mood);
    });
    $('#flyStop').onclick = () => stopFly(false);
    $('#flyPause').onclick = () => {
      fly.paused = !fly.paused;
      $('#flyPause').textContent = fly.paused ? '계속' : '일시정지';
    };

    document.querySelectorAll('.presets button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.presets button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const p = b.dataset.preset;
        if (p === 'all') { cam.tx = -40; cam.tz = 40; cam.ty = 0; cam.radius = koreaFitRadius(); cam.theta = 0.20; cam.phi = 0.70; }
        if (p === 'capital') focusOn(37.52, 127.02, 190);
        if (p === 'gangwon') focusOn(37.72, 128.4, 210);
        if (p === 'jiri') focusOn(35.33, 127.66, 140);
        if (p === 'jeju') focusOn(33.38, 126.55, 120);
        if (p === 'me') locateMe();
      };
    });

    $('#panelOpen').onclick = () => $('#panel').classList.add('open');
    $('#panelClose').onclick = () => $('#panel').classList.remove('open');

    $('#btnData').onclick = () => { renderDataModal(); $('#dataModal').hidden = false; };
    $('#dataClose').onclick = () => { $('#dataModal').hidden = true; };
    $('#btnCase').onclick = () => { $('#caseModal').hidden = false; };
    $('#caseClose').onclick = () => { $('#caseModal').hidden = true; };
    $('#btnHelp').onclick = () => { $('#helpModal').hidden = false; };
    $('#helpClose').onclick = () => { $('#helpModal').hidden = true; };
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }));

    setTimeout(() => $('#hint').classList.add('gone'), 7000);
  }

  function closeModals() { document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; }); }

  function renderDataModal() {
    const rows = [
      ['전국휴양림표준데이터', '산림청 · 지방자치단체', S.hyuyang.length, 'CSV/JSON 표준데이터',
        '전국 자연휴양림의 위치·면적·수용인원·입장료·숙박가능여부·주요시설·관리기관·문의·좌표를 3D 표식과 상세 카드로 사용'],
      ['숲나들e 100대명산 정보', '산림청 국립자연휴양림관리소', S.myeongsan.length, 'CSV (좌표 포함)',
        '100대명산의 높이·난이도·산행시간·산행코스·교통·선정이유를 지도 표식과 산 상세로 사용'],
      ['전국 치유의숲 좌표', '산림청', S.healing.length, 'SHP 공간정보',
        '치유의숲 위치 좌표를 지도에 투영하고, 국립/공립 구분·연락처·홈페이지를 상세로 사용'],
      ['국가숲길 코스(GPX)', '한국등산트레킹지원센터', S.trails.reduce((a, c) => a + c.tracks.length, 0) + '트랙', 'GPX 실제 궤적',
        '6개 국가숲길 56개 코스의 실제 GPS 트랙을 지형 위 3D 라인으로 그리고, 구간 거리·누적 상승·고도 프로필을 계산'],
      ['전국보호수표준데이터', '산림청 · 지방자치단체', S.trees.length, 'CSV/JSON 표준데이터',
        '전국 보호수의 수종·수령·높이·둘레·소재지를 지도 레이어로 제공하고 300년 이상 필터로 탐색']
    ];
    $('#dataList').innerHTML = rows.map((r) => `
      <div class="data-row">
        <div class="d-top"><span class="d-name">${esc(r[0])}</span><span class="d-rows">${fmtNum(r[2])}건</span></div>
        <div class="d-meta">제공 ${esc(r[1])} · 형식 ${esc(r[3])}</div>
        <div class="d-use">${esc(r[4])}</div>
      </div>`).join('') + `
      <div class="data-row">
        <div class="d-top"><span class="d-name">지형 표고(DEM)</span><span class="d-rows">400 × 400 격자</span></div>
        <div class="d-meta">SRTM 기반 Terrarium 표고 타일 · 3D 지형 메쉬</div>
        <div class="d-use">실제 표고를 그대로 옮겨 산줄기를 만들고, 모든 숲 표식과 숲길의 높이를 이 지형에서 계산했습니다.</div>
      </div>`;
  }

  function locateMe() {
    if (!navigator.geolocation) return toast('이 브라우저에서는 위치를 쓸 수 없습니다.');
    toast('현재 위치를 확인하는 중…', 2000);
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      S.geo = { lat, lon };
      focusOn(lat, lon, 140);
      const near = [];
      const scan = (kind, arr) => arr.forEach((it) => {
        const d = haversine(S.geo, { lat: it.lat, lon: it.lon });
        if (d <= 50) near.push({ kind, item: it, d });
      });
      scan('hyuyang', S.hyuyang); scan('myeongsan', S.myeongsan); scan('healing', S.healing);
      near.sort((a, b) => a.d - b.d);
      if (near.length) toast('내 주변 50km · ' + near.length + '곳 · 가장 가까운 ' + near[0].item.n + ' ' + near[0].d.toFixed(1) + 'km', 5200);
      else toast('50km 안에 등록된 숲이 없습니다. 지도를 옮겨 보세요.', 4200);

      if (!mePin) {
        mePin = new THREE.Mesh(
          new THREE.RingGeometry(2.0, 3.0, 28),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
        );
        mePin.rotation.x = -Math.PI / 2;
        scene.add(mePin);
      }
      mePin.position.set(projX(lon), heightAt(lat, lon) * ELE_SCALE + 1.2, projZ(lat));
    }, () => toast('위치를 받을 수 없습니다. 브라우저 위치 권한을 허용해 주세요.', 4200),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  // ------------------------------------------------------------- map labels & scale
  const LABELS = [
    ['서울', 37.5665, 126.978], ['인천', 37.4563, 126.7052], ['경기', 37.4138, 127.5183],
    ['강원', 37.8228, 128.1555], ['충북', 36.8, 127.7], ['충남', 36.5184, 126.8],
    ['세종', 36.48, 127.289], ['대전', 36.3504, 127.3845], ['경북', 36.4919, 128.8889],
    ['대구', 35.8714, 128.6014], ['전북', 35.7175, 127.153], ['광주', 35.1595, 126.8526],
    ['전남', 34.8679, 126.991], ['경남', 35.4606, 128.2132], ['부산', 35.1796, 129.0756],
    ['울산', 35.5384, 129.3114], ['제주', 33.4996, 126.5312]
  ];
  let labelEls = [], labelV = null;
  function initLabels() {
    const host = $('#labels');
    if (!host) return;
    labelV = new THREE.Vector3();
    labelEls = LABELS.map(([name, lat, lon]) => {
      const el = document.createElement('span');
      el.className = 'map-label';
      el.textContent = name;
      host.appendChild(el);
      return { el, x: projX(lon), y: heightAt(lat, lon) * ELE_SCALE + 3, z: projZ(lat) };
    });
  }
  function updateLabels() {
    if (!labelEls.length) return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const L of labelEls) {
      labelV.set(L.x, L.y, L.z).project(camera);
      const onScreen = labelV.z < 1 && Math.abs(labelV.x) < 1.15 && Math.abs(labelV.y) < 1.15;
      if (!onScreen) { L.el.style.opacity = '0'; continue; }
      const px = (labelV.x * 0.5 + 0.5) * w, py = (-labelV.y * 0.5 + 0.5) * h;
      L.el.style.transform = `translate(-50%,-50%) translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
      const dist = cam.cRadius;
      L.el.style.opacity = String(clamp((820 - dist) / 320, 0.45, 1));
    }
  }

  let sbT = 0;
  function updateScaleBar() {
    const now = performance.now();
    if (now - sbT < 250) return;
    sbT = now;
    const el = $('#scalebar');
    if (!el) return;
    const h = renderer.domElement.clientHeight || 1;
    const worldPerPx = (2 * cam.cRadius * Math.tan(camera.fov * Math.PI / 360)) / h;
    const metersPerPx = worldPerPx * 1000 / P.k;
    const targets = [300000, 200000, 100000, 50000, 20000, 10000, 5000];
    let pick = targets[targets.length - 1];
    for (const t of targets) { if (t / metersPerPx <= 130) { pick = t; break; } }
    const wpx = pick / metersPerPx;
    el.style.width = wpx.toFixed(0) + 'px';
    el.querySelector('b').textContent = pick >= 1000 ? (pick / 1000) + 'km' : pick + 'm';
  }

  // ------------------------------------------------------------- loop
  const t0 = performance.now();
  let fpsWin = { t: 0, n: 0, degraded: 0 };
  function guardQuality(dt) {
    fpsWin.n++;
    fpsWin.t += dt;
    if (fpsWin.t < 2.5) return;
    const fps = fpsWin.n / fpsWin.t;
    fpsWin.t = 0; fpsWin.n = 0;
    if (fps < 24 && fpsWin.degraded === 0) {
      fpsWin.degraded = 1;
      if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); renderer.setSize(window.innerWidth, window.innerHeight, false); }
    } else if (fps < 16 && fpsWin.degraded === 1) {
      fpsWin.degraded = 2;
      if (particles) particles.visible = false;
    }
  }
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const t = (now - t0) / 1000;
    const dt = Math.min(0.12, (now - (animate._p || now)) / 1000);
    animate._p = now;
    if (fly.active) updateFly(dt);
    else applyCamera(dt);
    updateMarkerScale();
    guardQuality(dt);
    if (particles) particles.rotation.y = t * 0.01;
    if (mePin) mePin.scale.setScalar(1 + 0.22 * Math.sin(t * 3));
    if (selRing && selRing.visible) {
      const ph = (performance.now() - (selRing.userData.t0 || 0)) / 1000;
      selRing.scale.setScalar(1 + 0.35 * Math.sin(ph * 3));
      selRing.material.opacity = 0.55 + 0.3 * Math.sin(ph * 3);
    }
    updateRadiusRing(dt);
    if (!fly.active && pointerNDC.x > -5) doHover();
    renderer.render(scene, camera);
    updateLabels();
    updateScaleBar();
    pinRefresh();
  }

  // ------------------------------------------------------------- boot
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    try {
      initThree();
      await loadData();
      buildTerrain();
      buildMarkers();
      buildTrails();
      buildParticles();
      initControls();
      initUI();
      initLabels();
      const fr = koreaFitRadius();
      cam.radius = fr; cam.cRadius = fr * 1.35;
      if (isMobile()) { cam.phi = 0.78; cam.cPhi = 0.95; cam.tz = 0; cam.cz = 40; }
      applyFilters();
      applyMood(S.mood);
      animate();
      window.__forest3d = {
        S, cam, scene, camera, renderer, instanced, select, applyFilters, applyMood, startFly, stopFly,
        nearbySummary, fly, pickAt, itemLatLon, buildRadiusRing, ensureContours
      };
    } catch (e) {
      console.error(e);
      toast('지도를 불러오지 못했습니다: ' + e.message, 10000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

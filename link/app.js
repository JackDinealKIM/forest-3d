/* 숲잇다 — AI 산림복지 처방 시뮬레이터 (제안 프로토타입)
   three.js 장면 + 처방 로직 + UI. 외부 의존 없음. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* =========================================================
     1. 처방 모델
     ========================================================= */
  const GOAL = {
    stress: { code: 'S', name: '스트레스 완화', axis: '정서·감각', metric: '긴장 지수' },
    sleep: { code: 'Z', name: '수면 개선', axis: '정서·호흡', metric: '수면 곤란도' },
    active: { code: 'A', name: '활동량 증대', axis: '운동·근력', metric: '활동 부족감' },
    social: { code: 'C', name: '사회 연결', axis: '관계·문화', metric: '고립감' }
  };
  const PLACE = {
    healing: { code: 'H', name: '치유의숲', scene: 'healing' },
    urban: { code: 'U', name: '도시숲·공원', scene: 'urban' },
    living: { code: 'L', name: '생활공간(도서관·경로당)', scene: 'living' }
  };
  const state = {
    goal: 'stress', sleepQ: 2, stressQ: 2, actQ: 2,
    mobility: 'free', company: 'alone', time: 90, place: 'healing'
  };

  const P = (name, min, desc, goals, inten, places) => ({ name, min, desc, goals, inten, places });

  const CATALOG = [
    // 숲 (치유의숲 · 도시숲)
    P('도착 · 호흡 정렬', 5, '걸음을 멈추고 4초 들이쉬고 6초 내쉬기', ['stress', 'sleep', 'active', 'social'], [1, 3], ['healing', 'urban']),
    P('숲 명상 데크', 20, '앉아서 소리·바람·빛만 관찰하는 정적 명상', ['stress', 'sleep'], [1, 2], ['healing', 'urban']),
    P('맨발 걷기', 15, '흙길 200m를 맨발로, 발바닥 감각에 집중', ['stress', 'active'], [2, 3], ['healing', 'urban']),
    P('편백 향 테라피', 10, '피톤치드 향을 맡으며 어깨·턱 힘 빼기', ['stress', 'sleep'], [1, 2], ['healing']),
    P('오감 산책', 25, '같은 길을 5가지 감각으로 두 번 걷기', ['stress', 'sleep', 'social'], [1, 2], ['healing', 'urban']),
    P('스텝박스 근력', 20, '숲속 계단·스텝박스로 하체·균형 운동', ['active'], [3, 3], ['healing', 'urban']),
    P('완만한 경사로 걷기', 20, '경사 5% 이하 숲길을 보행 보조와 함께', ['active', 'stress'], [1, 2], ['healing', 'urban']),
    P('짝 산책', 20, '한 사람과 나란히 걷고, 한 가지 질문에 답하며 걷기', ['social', 'stress'], [1, 2], ['healing', 'urban']),
    P('마무리 다담', 10, '오늘의 몸·마음 변화를 한 문장으로 남기기', ['stress', 'sleep', 'active', 'social'], [1, 3], ['healing', 'urban']),
    // 생활공간
    P('창가 자연광 20분', 20, '햇빛 들어오는 창가에서 책·차와 함께 쉬기', ['sleep', 'stress'], [1, 2], ['living']),
    P('목재 향 맡기', 10, '편백·소나무 목재 향을 맡으며 호흡 늘리기', ['stress', 'sleep'], [1, 2], ['living']),
    P('가로수길 걷기', 20, '도서관 밖 가로수길 왕복, 보폭·호흡 맞추기', ['active', 'stress'], [1, 3], ['living']),
    P('실내 정원 가꾸기', 25, '작은 화분·허브를 함께 심고 물 주기', ['social', 'stress'], [1, 2], ['living']),
    P('함께 차 마시기', 20, '같은 테이블에서 말 없이 차 한 잔 나누기', ['social', 'stress'], [1, 2], ['living']),
    P('의자 스트레칭', 15, '앉아서 목·어깨·고관절 풀기', ['active', 'stress'], [1, 2], ['living'])
  ];

  function intensity() {
    let v = 2;
    if (state.goal === 'active') v += (state.actQ - 2) * 0.7 + (state.stressQ - 2) * 0.15;
    else v += (state.actQ - 2) * 0.45 - (state.stressQ - 2) * 0.4;
    if (state.sleepQ === 1) v -= 0.35;
    if (state.company !== 'alone') v -= 0.4;
    if (state.mobility === 'cane') v = Math.min(v, 2);
    if (state.mobility === 'wheel') v = 1;
    return clamp(Math.round(v), 1, 3);
  }

  function travelMin() {
    if (state.place === 'healing') return state.mobility === 'wheel' ? 65 : 42;
    if (state.place === 'urban') return state.mobility === 'wheel' ? 28 : 18;
    return 9;
  }

  function accessLabel() {
    if (state.mobility === 'wheel') return state.place === 'living' ? '좋음' : '주의';
    if (state.mobility === 'cane') return state.place === 'healing' ? '보통' : '좋음';
    return '좋음';
  }

  function pickPrograms(pool, minutes) {
    const order = ['도착', '자연광', '명상', '맨발', '향', '목재', '오감', '가로수', '짝 산책', '스텝', '경사', '정원', '차', '스트레칭', '마무리'];
    const rank = (p) => order.findIndex((k) => p.name.indexOf(k) >= 0);
    const chosen = [];
    let left = minutes;
    const sorted = pool.slice().sort((a, b) => {
      const ga = a.goals.indexOf(state.goal) >= 0 ? 1 : 0;
      const gb = b.goals.indexOf(state.goal) >= 0 ? 1 : 0;
      if (ga !== gb) return gb - ga;
      return b.min - a.min;
    });
    // 도입은 항상 포함
    const intro = pool.find((p) => p.name.indexOf('도착') >= 0);
    if (intro) { chosen.push(intro); left -= intro.min; }
    const outro = pool.find((p) => p.name.indexOf('마무리') >= 0);
    for (const p of sorted) {
      if (p === intro || p === outro) continue;
      if (p.min <= left - (outro ? outro.min : 0) + 2) { chosen.push(p); left -= p.min; }
      if (chosen.length >= 5) break;
    }
    if (outro && left >= outro.min - 3) chosen.push(outro);
    if (!outro && state.place === 'living' && chosen.length < 4) {
      const s = pool.find((p) => p.name.indexOf('스트레칭') >= 0);
      if (s) chosen.push(s);
    }
    chosen.sort((a, b) => rank(a) - rank(b));
    return chosen;
  }

  function prescribe() {
    const inten = intensity();
    const trav = travelMin();
    const session = Math.max(40, state.time - Math.round(trav * 0.5));
    const pool = CATALOG.filter((p) => p.places.indexOf(state.place) >= 0 && inten >= p.inten[0] && inten <= p.inten[1]);
    const programs = pickPrograms(pool.length ? pool : CATALOG.filter((p) => p.places.indexOf(state.place) >= 0), session);
    const total = programs.reduce((a, p) => a + p.min, 0);
    const g = GOAL[state.goal];
    return {
      code: g.code + '·' + inten + '·8·' + PLACE[state.place].code,
      inten, trav, programs, total, goal: g, place: PLACE[state.place],
      session, weeks: 8
    };
  }

  /* =========================================================
     2. three.js 장면
     ========================================================= */
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x24463a, 0.0031);
  scene.background = skyTexture();

  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 1600);

  function sizeCanvas() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  sizeCanvas();

  const hemi = new THREE.HemisphereLight(0xb6e2cc, 0x101f18, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c0, 2.15);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -180; sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180;
sun.shadow.camera.far = 520; sun.shadow.bias = -0.0012;
  sun.position.set(-120, 160, 90);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x334d44, 0.55));

  function skyTexture() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 512;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#061420');
    g.addColorStop(0.42, '#123128');
    g.addColorStop(0.66, '#3d6a4c');
    g.addColorStop(0.82, '#a9c184');
    g.addColorStop(1, '#e4e0ab');
    x.fillStyle = g; x.fillRect(0, 0, 8, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- 지형 높이 함수 ----
  function H(x, z) {
    let v = 25 * Math.exp(-(x * x + z * z) / (2 * 128 * 128));
    v += 9.5 * Math.exp(-((x - 78) * (x - 78) + (z + 26) * (z + 26)) / (2 * 46 * 46));
    v += 4.2 * Math.sin(x * 0.033) * Math.cos(z * 0.041);
    v += 1.5 * Math.sin(x * 0.105 + z * 0.071);
    v -= 9 * Math.exp(-((z - 205) * (z - 205)) / (2 * 85 * 85));
    return v;
  }

  const terrain = (function () {
    const N = 168, S = 470;
    const pos = [], col = [], idx = [];
    const low = new THREE.Color(0x16291f), mid = new THREE.Color(0x2a5038), high = new THREE.Color(0x54824f);
    const tmp = new THREE.Color();
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = (i / N - 0.5) * S, z = (j / N - 0.5) * S;
        const y = H(x, z);
        pos.push(x, y, z);
        const t = clamp((y + 4) / 28, 0, 1);
        if (t < 0.5) tmp.copy(low).lerp(mid, t / 0.5);
        else tmp.copy(mid).lerp(high, (t - 0.5) / 0.5);
        const n = 0.92 + 0.16 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
        col.push(tmp.r * n, tmp.g * n, tmp.b * n);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  })();

  // ---- 경로 ----
  const ROUTES = {
    1: [[10, 176], [-18, 146], [-8, 108], [14, 74], [4, 34]],
    2: [[16, 196], [-36, 162], [-44, 118], [-10, 82], [26, 54], [4, 24]],
    3: [[20, 204], [-54, 178], [-76, 126], [-46, 82], [-4, 60], [34, 38], [8, 12]]
  };

  const LIVING_ROUTE = [[-30, 90], [-2, 102], [28, 94], [36, 68], [12, 48], [-20, 56], [-38, 74]];

  function makeLivingCurve() {
    return new THREE.CatmullRomCurve3(
      LIVING_ROUTE.map(([x, z]) => new THREE.Vector3(x, H(x, z) + 1.2, z)), true, 'catmullrom', 0.4
    );
  }

  function makeCurve(inten) {
    const pts = ROUTES[inten].map(([x, z]) => new THREE.Vector3(x, H(x, z) + 1.4, z));
    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  }

  let curve = makeCurve(2);
  let routeMesh = null;

  function buildRoute() {
    if (routeMesh) { scene.remove(routeMesh); routeMesh.geometry.dispose(); routeMesh.material.dispose(); }
    const g = new THREE.TubeGeometry(curve, 220, 1.05, 8, curve.closed === true);
    const m = new THREE.MeshStandardMaterial({
      color: 0xd8f0b0, emissive: 0x4a7a44, emissiveIntensity: 0.55,
      roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.95
    });
    routeMesh = new THREE.Mesh(g, m);
    scene.add(routeMesh);
  }
  buildRoute();

  // ---- 나무 ----
  let crownMesh = null, trunkMesh = null;
  const TREE_TOTAL = 760;

  function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  function distToRoute(x, z) {
    let best = 1e9;
    for (let i = 0; i <= 60; i++) {
      const p = curve.getPointAt(i / 60);
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function buildTrees() {
    if (crownMesh) { crownMesh.forEach((m) => scene.remove(m)); trunkMesh.forEach((m) => scene.remove(m)); }
    const cone = new THREE.ConeGeometry(2.1, 6.4, 6);
    const cyl = new THREE.CylinderGeometry(0.32, 0.42, 2.2, 5);
    const shades = [0x1d4529, 0x2a5b35, 0x39713f];
    crownMesh = shades.map((col) => {
      const mesh = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, flatShading: true }), Math.ceil(TREE_TOTAL / 3) + 4);
      mesh.castShadow = true;
      return mesh;
    });
    trunkMesh = [new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }), TREE_TOTAL)];
    trunkMesh[0].castShadow = true;
    const r = rnd(20261119);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const posv = new THREE.Vector3();
    const counts = [0, 0, 0];
    let n = 0, guard = 0;
    while (n < TREE_TOTAL && guard < 26000) {
      guard++;
      const x = (r() - 0.5) * 420, z = (r() - 0.5) * 420;
      const y = H(x, z);
      if (distToRoute(x, z) < 7) continue;
      if (Math.hypot(x - 4, z - 14) < 20) continue;
      const s = 0.6 + r() * 0.95;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      posv.set(x, y + 1.1 * s, z);
      scale.set(s, s, s);
      m4.compose(posv, q, scale);
      trunkMesh[0].setMatrixAt(n, m4);
      const gi = n % 3;
      posv.set(x, y + 2.2 * s + 3.2 * s, z);
      m4.compose(posv, q, scale);
      crownMesh[gi].setMatrixAt(counts[gi], m4);
      counts[gi]++;
      n++;
    }
    crownMesh.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; scene.add(m); });
    trunkMesh[0].count = n;
    trunkMesh[0].instanceMatrix.needsUpdate = true;
    scene.add(trunkMesh[0]);
  }
  buildTrees();

  // ---- 도시·생활공간 배경 ----
  const cityGroup = new THREE.Group();
  const livingGroup = new THREE.Group();

  function box(g, x, z, w, h, d, color, emissive) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, emissive: emissive || 0x000000, emissiveIntensity: 0.8, roughness: 0.72, metalness: 0.18 })
    );
    m.position.set(x, H(x, z) + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  (function buildings() {
    const r = rnd(777);
    for (let i = 0; i < 11; i++) {
      const ang = (i / 11) * Math.PI * 2 + 0.35;
      const rad = 165 + r() * 55;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad * 0.86 + 92;
      const w = 16 + r() * 16, h = 12 + r() * 30, d = 16 + r() * 16;
      box(cityGroup, x, z, w, h, d, 0x3b4d4f, 0x0d1a1a);
      // 옥상 표식
      box(cityGroup, x, z, w * 0.3, 2.2, d * 0.3, 0x54686a, 0x14302c);
    }
    cityGroup.visible = false;
    scene.add(cityGroup);

    // 도서관 — 마당 한쪽에 낮고 긴 건물, 유리면은 코스를 향함
    const lib = box(livingGroup, 96, 30, 58, 16, 30, 0xa9b4a6, 0x121a12);
    lib.rotation.y = -0.62;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(46, 8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xbfe6cd, emissive: 0x4e9a76, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.3 })
    );
    glass.position.set(74, H(96, 30) + 8, 44);
    glass.rotation.y = -0.62;
    livingGroup.add(glass);
    const canopy = box(livingGroup, 68, 52, 18, 1.2, 9, 0xd6ddcf, 0x101a12);
    canopy.rotation.y = -0.62;
    box(livingGroup, -52, 40, 24, 10, 16, 0x98a597, 0x0c1410);
    // 마당 — 지형을 따라가는 잔디 판
    const yg = new THREE.PlaneGeometry(96, 84, 24, 24);
    const yp = yg.attributes.position;
    for (let i = 0; i < yp.count; i++) {
      const lx = yp.getX(i), lz = -yp.getY(i);
      yp.setZ(i, H(6 + lx, 70 + lz) + 0.45 - H(6, 70));
    }
    yg.computeVertexNormals();
    const yard = new THREE.Mesh(yg, new THREE.MeshStandardMaterial({ color: 0x53764a, roughness: 1 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(6, H(6, 70), 70);
    yard.receiveShadow = true;
    livingGroup.add(yard);
    const sign = makeLabel('도서관 마당', '창가·가로수·정원');
    sign.position.set(74, H(96, 30) + 26, 44);
    livingGroup.add(sign);
    livingGroup.visible = false;
    scene.add(livingGroup);
  })();

  // ---- 정거장 ----
  const stations = [];
  let stationGroup = new THREE.Group();
  scene.add(stationGroup);

  function makeLabel(text, sub) {
    const c = document.createElement('canvas');
    const W = 512, Hh = 150;
    c.width = W; c.height = Hh;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,20,16,.82)';
    x.beginPath();
    const r = 26;
    x.moveTo(r, 0); x.lineTo(W - r, 0); x.quadraticCurveTo(W, 0, W, r);
    x.lineTo(W, Hh - r); x.quadraticCurveTo(W, Hh, W - r, Hh);
    x.lineTo(r, Hh); x.quadraticCurveTo(0, Hh, 0, Hh - r);
    x.lineTo(0, r); x.quadraticCurveTo(0, 0, r, 0); x.fill();
    x.strokeStyle = 'rgba(160,235,190,.55)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#eafff2'; x.font = '700 46px "Noto Sans KR","Malgun Gothic",sans-serif';
    x.textAlign = 'center'; x.fillText(text, W / 2, 68);
    x.fillStyle = '#a8d8bc'; x.font = '500 30px "Noto Sans KR","Malgun Gothic",sans-serif';
    x.fillText(sub, W / 2, 112);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(18, 5.3, 1);
    return sp;
  }

  function buildStations(list) {
    stationGroup.clear();
    stations.length = 0;
    const fracs = [0.055, 0.30, 0.52, 0.74, 0.955];
    const ringGeo = new THREE.TorusGeometry(3.2, 0.28, 8, 40);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd8f0b0, emissive: 0x76c98f, emissiveIntensity: 1.4, roughness: 0.4 });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x9fe8b4, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
    list.forEach((prog, i) => {
      const t = fracs[i];
      const p = curve.getPointAt(t);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, p.y + 0.5, p.z);
      stationGroup.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.6, 16, 10, 1, true), beamMat);
      beam.position.set(p.x, p.y + 8, p.z);
      stationGroup.add(beam);
      const label = makeLabel(prog.name, prog.min + '분 · ' + (i + 1) + '/' + list.length);
      label.position.set(p.x, p.y + 13.5, p.z);
      stationGroup.add(label);
      stations.push({ t, pos: p, ring, label, name: prog.name, min: prog.min });
    });
  }

  // ---- 먼 능선 ----
  (function ridges() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x16291f, roughness: 1 });
    const r = rnd(31337);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const rad = 300 + r() * 130;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const h = 34 + r() * 54, w = 70 + r() * 80;
      const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), mat);
      m.position.set(x, -6 + h / 2, z);
      m.rotation.y = r() * 3;
      scene.add(m);
    }
  })();

  (function sunGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,240,200,.95)');
    g.addColorStop(0.25, 'rgba(255,215,150,.42)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.set(220, 220, 1);
    const dir = sun.position.clone().normalize().multiplyScalar(520);
    sp.position.copy(dir);
    scene.add(sp);
  })();

  // ---- 반짝임 ----
  const dust = (function () {
    const n = 380, arr = new Float32Array(n * 3);
    const r = rnd(4242);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (r() - 0.5) * 300;
      arr[i * 3 + 1] = 2 + r() * 42;
      arr[i * 3 + 2] = (r() - 0.5) * 300;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const m = new THREE.PointsMaterial({ color: 0xd9f7b0, size: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
    const pts = new THREE.Points(g, m);
    scene.add(pts);
    return pts;
  })();

  /* =========================================================
     3. 카메라 · 조작
     ========================================================= */
  const view = { theta: -0.62, phi: 0.86, dist: 250, tx: 0, ty: 12, tz: 80 };
  let lookDrop = 0;
  let dragging = false, lx = 0, ly = 0, pinch = 0;

  function applyCamera() {
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(
      view.tx + view.dist * sp * Math.sin(view.theta),
      view.ty + view.dist * cp,
      view.tz + view.dist * sp * Math.cos(view.theta)
    );
    camera.lookAt(view.tx, view.ty - lookDrop, view.tz);
  }
  applyCamera();

  canvas.addEventListener('pointerdown', (e) => {
    if (tour.on) return;
    dragging = true; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || tour.on) return;
    view.theta -= (e.clientX - lx) * 0.005;
    view.phi = clamp(view.phi - (e.clientY - ly) * 0.004, 0.18, 1.42);
    lx = e.clientX; ly = e.clientY;
    applyCamera();
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('wheel', (e) => {
    if (tour.on) return;
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 70, 430);
    applyCamera();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (tour.on || e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const d = Math.hypot(dx, dy);
    if (pinch) view.dist = clamp(view.dist * (pinch / d), 70, 430);
    pinch = d;
    applyCamera();
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = 0; });

  /* =========================================================
     4. 코스 따라가기
     ========================================================= */
  const tour = { on: false, t: 0, speed: 0.055, hold: 0, last: 0 };

  function startTour() {
    if (tour.on) { stopTour(); return; }
    tour.on = true; tour.t = 0; tour.hold = 0;
    view.tx = 0; view.ty = 12; view.tz = 80;
    $('#tourHud').classList.add('on');
    $('#btnTour').textContent = '둘러보기 종료';
  }
  function stopTour() {
    tour.on = false;
    $('#tourHud').classList.remove('on');
    $('#btnTour').textContent = '코스 따라가기';
    applyCamera();
  }

  function updateTour(dt) {
    if (!tour.on) return;
    if (tour.hold > 0) {
      tour.hold -= dt;
      if (tour.hold <= 0) { /* hold ended */ }
      return;
    }
    tour.t += dt * tour.speed;
    if (tour.t >= 1) { tour.t = 1; }
    const p = curve.getPointAt(tour.t);
    const ahead = curve.getPointAt(Math.min(1, tour.t + 0.02));
    camera.position.set(p.x - 8, p.y + 15, p.z + 26);
    camera.lookAt(ahead.x, ahead.y + 4, ahead.z);
    // HUD
    const idx = nearestStation(tour.t);
    const st = stations[idx];
    if (st) {
      $('#thName').textContent = st.name;
      $('#thSub').textContent = st.min + '분 프로그램 · ' + (idx + 1) + '/' + stations.length + ' 정거장';
    }
    const totalMin = 18;
    const sec = Math.round(tour.t * totalMin * 60);
    $('#thFill').style.width = (tour.t * 100) + '%';
    $('#thTime').textContent = fmt(sec) + ' / ' + fmt(totalMin * 60);
    if (tour.t >= 1 && tour.hold === 0) { stopTour(); }
  }
  function nearestStation(t) {
    let best = 0, bd = 9;
    stations.forEach((s, i) => { const d = Math.abs(s.t - t); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tour.on) stopTour(); });

  /* =========================================================
     5. 처방 UI
     ========================================================= */
  function drawChart(res) {
    const c = $('#chart');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 320, h = 116;
    c.width = w * dpr; c.height = h * dpr;
    c.style.height = h + 'px';
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.clearRect(0, 0, w, h);
    const pad = { l: 26, r: 10, t: 12, b: 20 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const A = 16 + res.inten * 7 + (state.goal === 'sleep' ? 3 : 0);
    const vals = [];
    for (let w2 = 0; w2 < 8; w2++) vals.push(100 - A * (1 - Math.exp(-(w2 + 1) / 2.6)) - (w2 === 0 ? 0 : 1.4 * Math.sin(w2 * 1.7)));
    // grid
    x.strokeStyle = 'rgba(180,215,195,.14)'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih * i) / 4;
      x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke();
    }
    x.fillStyle = 'rgba(180,215,195,.5)'; x.font = '9px sans-serif'; x.textAlign = 'right';
    [100, 75, 50, 25, 0].forEach((v, i) => x.fillText(v, pad.l - 6, pad.t + (ih * i) / 4 + 3));
    // line
    const pt = (i) => [pad.l + (iw * i) / 7, pad.t + ih - (ih * vals[i]) / 100];
    x.beginPath();
    vals.forEach((v, i) => { const [px, py] = pt(i); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = '#7ee0a8'; x.lineWidth = 2.4; x.lineJoin = 'round'; x.stroke();
    const grad = x.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(126,224,168,.34)'); grad.addColorStop(1, 'rgba(126,224,168,0)');
    x.lineTo(w - pad.r, pad.t + ih); x.lineTo(pad.l, pad.t + ih); x.closePath();
    x.fillStyle = grad; x.fill();
    vals.forEach((v, i) => {
      const [px, py] = pt(i);
      x.beginPath(); x.arc(px, py, i === 0 ? 3.4 : 2.6, 0, 7);
      x.fillStyle = i === 0 ? '#c8f08a' : '#7ee0a8'; x.fill();
    });
    x.fillStyle = 'rgba(180,215,195,.55)'; x.font = '9px sans-serif'; x.textAlign = 'center';
    for (let i = 0; i < 8; i++) { const [px] = pt(i); if (i % 2 === 0) x.fillText((i + 1) + '주', px, h - 5); }
  }

  let current = null;

  function render(res) {
    current = res;
    $('#codeText').textContent = res.code;
    $('#codeDesc').textContent = '목표 ' + res.goal.code + ' · 강도 ' + res.inten + ' · ' + res.weeks + '주 · ' + res.place.name;
    $('#resMeta').textContent = '주 1회 · ' + res.weeks + '주';
    $('#mIntensity').textContent = '강도 ' + res.inten;
    $('#mMove').textContent = res.trav + '분';
    $('#mAccess').textContent = accessLabel();
    $('#progMeta').textContent = res.total + '분 · ' + res.programs.length + '개';

    const ol = $('#timeline');
    ol.innerHTML = '';
    let acc = 0;
    res.programs.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="n">' + (i + 1) + '</span>' +
        '<span class="t"><b>' + p.name + '</b><span>' + p.desc + '</span></span>' +
        '<span class="m">' + p.min + '분</span>';
      ol.appendChild(li);
      acc += p.min;
    });
    drawChart(res);

    // 회기 후 기록 — 처방에 따라 달라짐
    const d = 2 + res.inten;
    const rk = document.querySelectorAll('.rk b');
    if (rk.length === 4) {
      rk[0].textContent = '6 → ' + clamp(6 - d, 1, 6);
      rk[1].textContent = '4 → ' + clamp(4 + res.inten + 1, 4, 9);
      rk[2].textContent = (1400 + res.inten * 620).toLocaleString();
      rk[3].textContent = (86 + res.inten * 4) + '';
    }

    // 3D 반영
    curve = state.place === 'living' ? makeLivingCurve() : makeCurve(res.inten);
    buildRoute();
    buildTrees();
    buildStations(res.programs);
    applyPlace(res.place.scene);
    if (res.place.scene === 'living') {
      view.theta = -0.52; view.phi = 0.64; view.dist = 250;
      view.tx = 4; view.ty = H(4, 70) + 8; view.tz = 70;
    } else {
      view.theta = -0.62; view.phi = 0.86;
      view.dist = res.place.scene === 'urban' ? 215 : 240;
      view.tx = 0; view.ty = 10; view.tz = 80;
    }
    const portrait = canvas.clientHeight / canvas.clientWidth > 1.2;
    if (portrait) { view.dist *= 1.5; lookDrop = view.dist * 0.30; } else { lookDrop = 0; }
    applyCamera();
  }

  function applyPlace(place) {
    cityGroup.visible = place === 'urban' || place === 'living';
    livingGroup.visible = place === 'living';
    if (crownMesh) {
      const ratio = place === 'healing' ? 1 : place === 'urban' ? 0.55 : 0.3;
      crownMesh.forEach((m) => { m.count = Math.round(m.userData.full === undefined ? (m.userData.full = m.count) * ratio : m.userData.full * ratio); });
      trunkMesh.forEach((m) => { m.count = Math.round((m.userData.full === undefined ? (m.userData.full = m.count) : m.userData.full) * ratio); });
    }
    scene.fog.color.set(place === 'living' ? 0x101c1a : 0x0c1a18);
  }

  // 입력 이벤트
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const key = seg.dataset.key;
      const v = btn.dataset.v;
      state[key] = key === 'goal' || key === 'mobility' || key === 'company' || key === 'place' ? v : Number(v);
      if (key === 'mobility') {
        state.place = v === 'wheel' ? 'living' : v === 'cane' ? 'urban' : 'healing';
        syncPlaceButtons();
      }
      if (key === 'time') { /* 시간만 바뀜 */ }
      render(prescribe());
    });
  });

  function syncPlaceButtons() {
    document.querySelectorAll('#stageSwitch button').forEach((b) => {
      b.classList.toggle('on', b.dataset.place === state.place);
    });
  }

  document.querySelectorAll('#stageSwitch button').forEach((b) => {
    b.addEventListener('click', () => {
      state.place = b.dataset.place;
      syncPlaceButtons();
      render(prescribe());
    });
  });

  $('#btnPrescribe').addEventListener('click', () => {
    render(prescribe());
    const res = $('#result');
    res.animate([{ transform: 'translateY(6px)', opacity: 0.6 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 320, easing: 'ease-out' });
    if (window.innerWidth <= 900) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#btnTour').addEventListener('click', startTour);

  $('#btnInfo').addEventListener('click', () => $('#info').classList.add('on'));
  $('#infoClose').addEventListener('click', () => $('#info').classList.remove('on'));
  $('#info').addEventListener('click', (e) => { if (e.target.id === 'info') $('#info').classList.remove('on'); });

  /* =========================================================
     6. 루프
     ========================================================= */
  let lastT = performance.now();
  function animate(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    dust.rotation.y += dt * 0.012;
    stations.forEach((s, i) => {
      const dcam = camera.position.distanceTo(s.label.position);
      const lw = clamp(dcam * 0.105, 9, 26);
      s.label.scale.set(lw, lw * 0.295, 1);
      const pulse = 1 + Math.sin(now * 0.0016 + i) * 0.06;
      s.ring.scale.set(pulse, pulse, pulse);
      s.ring.material.emissiveIntensity = 1.2 + Math.sin(now * 0.0016 + i) * 0.35;
    });
    updateTour(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    sizeCanvas();
    if (current) drawChart(current);
  });

  // 시작 (URL 해시로 상태 고정 가능: #place=urban&goal=active)
  (function initFromHash() {
    const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    ['goal', 'mobility', 'company', 'place'].forEach((k) => { if (q.get(k)) state[k] = q.get(k); });
    ['sleepQ', 'stressQ', 'actQ', 'time'].forEach((k) => { if (q.get(k)) state[k] = Number(q.get(k)); });
    document.querySelectorAll('.seg').forEach((seg) => {
      const v = String(state[seg.dataset.key]);
      seg.querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn.dataset.v === v));
    });
    syncPlaceButtons();
  })();
  render(prescribe());
  requestAnimationFrame(animate);

  // 외부 검증용
  window.__forestlink = {
    state, prescribe, get curve() { return curve; }, get stations() { return stations.length; }, get treeCount() { return crownMesh.reduce((a, m) => a + m.count, 0); },
    setPlace(p) { state.place = p; syncPlaceButtons(); render(prescribe()); },
    set(key, v) { state[key] = v; render(prescribe()); }
  };
})();

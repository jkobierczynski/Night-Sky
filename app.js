/* Night Sky - interactive planetarium */
'use strict';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- state ---------------- */
const state = {
  lat: 40.71, lon: -74.01,
  date: new Date(),
  playing: false, speed: 1,
  fov: 70,
  magBase: 5,
  showLabels: true, showDSO: true, showMW: true, showLines: true, showEcl: false,
  showHorizon: false, showMeridian: false, hideBelow: false,
  autoMag: true, magManual: 5, brightness: 1,
  selected: null, hover: null,
};

/* ---------------- renderer ---------------- */
const skyCanvas = document.getElementById('sky');
const renderer = new THREE.WebGLRenderer({ canvas: skyCanvas, antialias: false, alpha: false });
renderer.setClearColor(0x000000, 1);
renderer.localClippingEnabled = true;
// horizon clipping plane (world = J2000 frame); normal is set to the zenith each frame,
// or zeroed when "hide below horizon" is off (zero normal clips nothing)
const horizonPlane = new THREE.Plane(new THREE.Vector3(0, 0, 0), 0);
const horizM3 = new THREE.Matrix3();   // J2000 -> horizontal frame (for shader-side clipping)
const zenithJ2000 = new THREE.Vector3(0, 0, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(state.fov, 1, 0.001, 10);
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, true); // updateStyle=true: canvas CSS size must track CSS pixels, not buffer pixels
  skyCanvas.style.width = w + 'px';
  skyCanvas.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  overlay.width = Math.round(w * pr); overlay.height = Math.round(h * pr);
  overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
}
window.addEventListener('resize', resize);

/* ---------------- spherical helpers (standard equatorial J2000 frame:
   x = vernal equinox, y = RA 6h, z = celestial north) ---------------- */
function radecToVec(raRad, decRad) {
  const cd = Math.cos(decRad);
  return new THREE.Vector3(cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad));
}
function vecToRadec(v) {
  const dec = Math.asin(clamp(v.z, -1, 1));
  let ra = Math.atan2(v.y, v.x);
  if (ra < 0) ra += 2 * Math.PI;
  return [ra, dec];
}

/* ---------------- star data ---------------- */
const starBytes = Uint8Array.from(atob(window.STAR_DATA.b64), c => c.charCodeAt(0));
const N_STARS = window.STAR_DATA.count;
const STAR_STRIDE = 18;
const starPos = new Float32Array(N_STARS * 3);
const starMag = new Float32Array(N_STARS);
const starCol = new Float32Array(N_STARS * 3);
const starNameIdx = new Uint16Array(N_STARS);
const dv = new DataView(starBytes.buffer);

function bvToRGB(bv) {
  bv = clamp(bv, -0.4, 2.0);
  const stops = [
    [-0.4, 0.62, 0.71, 1.00], [0.0, 1.00, 1.00, 1.00], [0.3, 1.00, 0.94, 0.87],
    [0.6, 1.00, 0.86, 0.73], [1.0, 1.00, 0.74, 0.55], [1.5, 1.00, 0.62, 0.44],
    [2.0, 1.00, 0.53, 0.37],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (bv <= b[0]) {
      const t = (bv - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [1, 0.53, 0.37];
}

for (let i = 0; i < N_STARS; i++) {
  const o = i * STAR_STRIDE;
  const ra = dv.getFloat32(o, true), dec = dv.getFloat32(o + 4, true);
  const mag = dv.getFloat32(o + 8, true), bv = dv.getFloat32(o + 12, true);
  starNameIdx[i] = dv.getUint16(o + 16, true);
  const v = radecToVec(ra, dec);
  starPos[i * 3] = v.x; starPos[i * 3 + 1] = v.y; starPos[i * 3 + 2] = v.z;
  starMag[i] = mag;
  const c = bvToRGB(bv);
  starCol[i * 3] = c[0]; starCol[i * 3 + 1] = c[1]; starCol[i * 3 + 2] = c[2];
}
const STAR_NAMES = window.STAR_DATA.names.map(s => {
  const [name, con, spect, dist] = s.split('|');
  return { name, con, spect, dist };
});

/* ---------------- shaders ---------------- */
const starVertex = `
attribute float aMag;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
uniform float uMagLimit;
uniform float uSize;
uniform float uBright;
uniform mat3 uHoriz;
uniform float uHide;
void main() {
  if (uHide > 0.5) {
    vec3 hpos = uHoriz * position;
    if (hpos.z < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float base = clamp(4.4 - 0.55 * aMag, 0.9, 8.5);
  gl_PointSize = base * uSize * (0.65 + 0.35 * uBright);
  vAlpha = 1.0 - smoothstep(uMagLimit - 1.1, uMagLimit, aMag);
  vColor = aColor * uBright;
}`;
const starFragment = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = pow(smoothstep(0.0, 1.0, 1.0 - d), 1.6);
  gl_FragColor = vec4(vColor, vAlpha * a);
}`;

function makePoints(positions, colors, mags, uniforms) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function starUniforms(size) {
  return { uMagLimit: { value: 5 }, uSize: { value: size }, uBright: { value: 1 }, uHoriz: { value: horizM3 }, uHide: { value: 0 } };
}

const stars = makePoints(starPos, starCol, starMag, starUniforms(1));
stars.frustumCulled = false;
scene.add(stars);

/* ---------------- milky way (procedural, J2000 galactic plane) ---------------- */
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function galacticToRadec(l, b) {
  const aN = 192.85948 * DEG, dN = 27.12825 * DEG, lN = 122.93192 * DEG;
  const sinb = Math.sin(b), cosb = Math.cos(b);
  const sind = Math.sin(dN) * sinb + Math.cos(dN) * cosb * Math.cos(lN - l);
  const dec = Math.asin(clamp(sind, -1, 1));
  const y = cosb * Math.sin(lN - l);
  const x = Math.cos(dN) * sinb - Math.sin(dN) * cosb * Math.cos(lN - l);
  let ra = aN + Math.atan2(y, x);
  if (ra < 0) ra += 2 * Math.PI;
  return [ra, dec];
}
function buildMilkyWay() {
  const N = 100000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), mag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let l;
    const r = Math.random();
    if (r < 0.55) l = Math.random() * 2 * Math.PI;
    else if (r < 0.85) l = gauss() * 1.0;
    else l = gauss() * 2.2;
    l = (l % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const wide = 0.10 + 0.20 * Math.exp(-((l - Math.PI) * (l - Math.PI)) / 8);
    const narrow = 0.045 + 0.10 * Math.exp(-(l * l) / 2.6);
    let b = gauss() * (Math.random() < 0.75 ? narrow : wide);
    if (Math.abs(b) > 0.5) b *= 0.4;
    const p = galacticToRadec(l, b);
    const v = radecToVec(p[0], p[1]);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const centerBoost = Math.exp(-(l * l) / 2.0);
    let alpha = 0.08 + 0.60 * Math.exp(-(b * b) / (2 * narrow * narrow * 1.6)) * (0.45 + centerBoost);
    const warm = centerBoost;
    col[i * 3] = (0.72 + 0.28 * warm) * alpha;
    col[i * 3 + 1] = (0.78 + 0.08 * warm) * alpha;
    col[i * 3 + 2] = (0.95 - 0.12 * warm) * alpha;
    mag[i] = 10;
  }
  const mw = makePoints(pos, col, mag, starUniforms(0.5));
  mw.material.uniforms.uMagLimit.value = 99;
  mw.material.uniforms.uBright.value = 1; // keep Milky Way at natural brightness
  mw.frustumCulled = false;
  return mw;
}
const milkyWay = buildMilkyWay();
scene.add(milkyWay);

/* ---------------- deep sky objects ---------------- */
const DSO_TYPE_STYLE = {
  'Galaxy': [1.0, 0.92, 0.72], 'Open cluster': [0.65, 0.80, 1.0],
  'Globular cluster': [1.0, 0.85, 0.60], 'Planetary nebula': [0.60, 1.0, 0.85],
  'Nebula': [1.0, 0.55, 0.60], 'Cluster + nebula': [1.0, 0.65, 0.75],
  'H II region': [1.0, 0.55, 0.60], 'Supernova remnant': [1.0, 0.60, 0.65],
  'Asterism': [0.80, 0.80, 1.0], 'Galaxy cloud': [1.0, 0.92, 0.72],
  'Dark nebula': [0.55, 0.55, 0.62], 'Object': [0.80, 0.85, 0.90],
};
const dsoList = window.DSO_DATA.map(function (d) {
  const ra = d[0], dec = d[1];
  let mag = d[2]; if (mag > 90) mag = 6.5; // no published magnitude
  const sizeDeg = d[3], name = d[4], con = d[5], type = d[6];
  return { ra, dec, mag, sizeDeg, name, con, type, vec: radecToVec(ra, dec), color: DSO_TYPE_STYLE[type] || DSO_TYPE_STYLE['Object'] };
});
const nDSO = dsoList.length;
const dsoPos = new Float32Array(nDSO * 3);
const dsoCol = new Float32Array(nDSO * 3);
const dsoMag = new Float32Array(nDSO);
const dsoSize = new Float32Array(nDSO);
for (let i = 0; i < nDSO; i++) {
  const d = dsoList[i];
  dsoPos[i * 3] = d.vec.x; dsoPos[i * 3 + 1] = d.vec.y; dsoPos[i * 3 + 2] = d.vec.z;
  dsoCol[i * 3] = d.color[0]; dsoCol[i * 3 + 1] = d.color[1]; dsoCol[i * 3 + 2] = d.color[2];
  dsoMag[i] = d.mag; dsoSize[i] = d.sizeDeg;
}
const dsoMaterial = new THREE.ShaderMaterial({
  uniforms: { uMagLimit: { value: 5 }, uPxScale: { value: 500 } },
  vertexShader: `
uniform float uPxScale;
uniform float uMagLimit;
uniform mat3 uHoriz;
uniform float uHide;
attribute float aMag;
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (uHide > 0.5) {
    vec3 hpos = uHoriz * position;
    if (hpos.z < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float px = aSize * uPxScale;
  gl_PointSize = clamp(px, 4.0, 900.0);
  float bright = 1.0 - smoothstep(uMagLimit - 2.5, uMagLimit + 1.0, aMag);
  float big = clamp(min(px / 30.0, 90.0 / px), 0.10, 1.0);
  vAlpha = bright * big;
  vColor = aColor;
}`,
  fragmentShader: `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.75, 1.0, d));
  gl_FragColor = vec4(vColor, vAlpha * a * 0.55);
}`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});
dsoMaterial.uniforms.uHoriz = { value: horizM3 };
dsoMaterial.uniforms.uHide = { value: 0 };
const dsoGeo = new THREE.BufferGeometry();
dsoGeo.setAttribute('position', new THREE.BufferAttribute(dsoPos, 3));
dsoGeo.setAttribute('aColor', new THREE.BufferAttribute(dsoCol, 3));
dsoGeo.setAttribute('aMag', new THREE.BufferAttribute(dsoMag, 1));
dsoGeo.setAttribute('aSize', new THREE.BufferAttribute(dsoSize, 1));
const dsoMesh = new THREE.Points(dsoGeo, dsoMaterial);
dsoMesh.frustumCulled = false;
scene.add(dsoMesh);

/* ---------------- constellation lines & names ---------------- */
const constBytes = Uint8Array.from(atob(window.CONST_DATA.b64), c => c.charCodeAt(0));
const constGeo = new THREE.BufferGeometry();
constGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(constBytes.buffer), 3));
const constMaterial = new THREE.LineBasicMaterial({
  color: 0x4a6ea8, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false, clippingPlanes: [horizonPlane],
});
const constLines = new THREE.LineSegments(constGeo, constMaterial);
constLines.frustumCulled = false;
scene.add(constLines);
const CONST_NAMES = window.CONST_DATA.names.map(n => ({ name: n[0], vec: radecToVec(n[1], n[2]), rank: parseInt(n[3]) || 1 }));

/* ---------------- coordinate grids ---------------- */
// equatorial grid (fixed J2000 frame, like the stars)
const eqGrid = (function () {
  const pts = [];
  const seg = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let dec = -80; dec <= 80; dec += 10) {
    for (let ra = 0; ra < 360; ra += 5) {
      seg(radecToVec(ra * DEG, dec * DEG), radecToVec((ra + 5) * DEG, dec * DEG));
    }
  }
  for (let ra = 0; ra < 360; ra += 15) {
    for (let dec = -80; dec < 85; dec += 5) {
      seg(radecToVec(ra * DEG, dec * DEG), radecToVec(ra * DEG, (dec + 5) * DEG));
    }
  }
  const arr = new Float32Array(pts);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x3f5f8f, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, clippingPlanes: [horizonPlane] });
  const g = new THREE.LineSegments(geo, mat);
  g.frustumCulled = false;
  g.visible = false;
  scene.add(g);
  return g;
})();

// azimuth grid (built in the local horizontal frame, oriented each frame)
function altazToVec(altDeg, azDeg) { // az measured from north, through east
  const h = altDeg * DEG, A = azDeg * DEG;
  return new THREE.Vector3(Math.cos(h) * Math.sin(A), Math.cos(h) * Math.cos(A), Math.sin(h));
}
const azGrid = new THREE.Group();
azGrid.frustumCulled = false;
scene.add(azGrid);
const azGridLines = (function () {
  const pts = [];
  const seg = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let alt = -80; alt <= 80; alt += 10) {
    for (let az = 0; az < 360; az += 3) {
      seg(altazToVec(alt, az), altazToVec(alt, az + 3));
    }
  }
  for (let az = 0; az < 360; az += 15) {
    for (let alt = -80; alt < 88; alt += 3) {
      seg(altazToVec(alt, az), altazToVec(alt + 3, az));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x8f6a3f, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, clippingPlanes: [horizonPlane] });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  l.visible = false;
  azGrid.add(l);
  return l;
})();
const horizonLine = (function () {
  const pts = [];
  for (let az = 0; az < 360; az += 1) {
    const a = altazToVec(0, az), b = altazToVec(0, az + 1);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xa8c4e8, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, clippingPlanes: [horizonPlane] });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  l.visible = false;
  azGrid.add(l);
  return l;
})();
const meridianLine = (function () {
  const pts = [];
  for (let alt = -90; alt < 90; alt += 2) {
    const a = altazToVec(alt, 0), b = altazToVec(alt + 2, 0);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const c2 = altazToVec(alt, 180), d2 = altazToVec(alt + 2, 180);
    pts.push(c2.x, c2.y, c2.z, d2.x, d2.y, d2.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffd966, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, clippingPlanes: [horizonPlane] });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  l.visible = false;
  azGrid.add(l);
  return l;
})();
// dark-green ground dome (visible when "Ground (hide below horizon)" is on)
const groundMesh = (function () {
  const geo = new THREE.SphereGeometry(0.9995, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x0d2317, side: THREE.BackSide });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI / 2; // sphere's lower half maps to the horizontal frame's below-horizon half
  m.frustumCulled = false;
  m.visible = false;
  azGrid.add(m);
  return m;
})();

/* ---------------- solar system ---------------- */
const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const PLANET_COLOR = {
  Mercury: '#b8a99a', Venus: '#f5e6b8', Mars: '#e8825a', Jupiter: '#e8c9a0',
  Saturn: '#eedda8', Uranus: '#a8e0e0', Neptune: '#7a9ce8', Pluto: '#c0b8b0',
  Sun: '#fff4d6', Moon: '#e8e8e0',
};
const solarBodies = PLANETS.concat(['Sun', 'Moon']);
let solarVecs = {};

function computeSolar() {
  const time = Astronomy.MakeTime(state.date);
  const observer = new Astronomy.Observer(state.lat, state.lon, 50);
  const rot = Astronomy.Rotation_EQD_EQJ(time); // of-date -> J2000
  const m = rot.rot;
  const R = new THREE.Matrix3().set(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]);
  const out = {};
  for (const body of solarBodies) {
    try {
      const eq = Astronomy.Equator(body, time, observer, true, true);
      const vec = new THREE.Vector3(eq.vec.x, eq.vec.y, eq.vec.z).applyMatrix3(R).normalize();
      let mag = 2;
      try { mag = Astronomy.Illumination(body, time).mag; } catch (e) { }
      out[body] = { vec, mag, distAU: eq.dist || 0 };
    } catch (e) { }
  }
  solarVecs = out;
}

/* ---------------- camera controls ---------------- */
const camQuat = new THREE.Quaternion();
(function initOrientation() {
  const target = radecToVec(5.5 * 15 * DEG, 12 * DEG);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), target, new THREE.Vector3(0, 0, 1));
  camQuat.setFromRotationMatrix(m);
})();

let dragging = false, lastX = 0, lastY = 0, moved = 0;
function dragLook(dx, dy) {
  const k = state.fov * DEG / renderer.domElement.clientHeight;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
  const north = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion()
    .setFromAxisAngle(north, dx * k)
    .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * k));
  camQuat.premultiply(q);
  camQuat.normalize();
}
skyCanvas.addEventListener('mousedown', e => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', e => {
  if (dragging && moved < 5) handleClick(e.clientX, e.clientY);
  dragging = false;
});
window.addEventListener('mousemove', e => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    dragLook(dx, dy);
    hideTooltip();
  } else {
    handleHover(e.clientX, e.clientY);
  }
});
skyCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = Math.exp(e.deltaY * 0.0012);
  state.fov = clamp(state.fov * factor, 0.5, 100);
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
}, { passive: false });

let touchDist = 0;
skyCanvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    dragging = true; moved = 0;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    dragging = false;
    touchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }
}, { passive: true });
skyCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && dragging) {
    const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    dragLook(dx, dy);
  } else if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (d > 0) {
      state.fov = clamp(state.fov * (touchDist / d), 0.5, 100);
      camera.fov = state.fov; camera.updateProjectionMatrix();
      touchDist = d;
    }
  }
}, { passive: false });
skyCanvas.addEventListener('touchend', e => {
  if (dragging && moved < 5 && e.changedTouches.length === 1) handleClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  dragging = false;
});

/* ---------------- picking (directions in J2000 frame) ---------------- */
const tmpV = new THREE.Vector3();
function screenPos(vec3) {
  // to camera (view) space first: reject anything behind the camera plane,
  // otherwise perspective divide mirrors far-side objects back on screen
  tmpV.copy(vec3).applyMatrix4(camera.matrixWorldInverse);
  if (tmpV.z > -0.01) return null;
  tmpV.applyMatrix4(camera.projectionMatrix); // divides by w -> NDC
  if (tmpV.x < -1.2 || tmpV.x > 1.2 || tmpV.y < -1.2 || tmpV.y > 1.2) return null;
  const w = window.innerWidth, h = window.innerHeight;
  return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h };
}
function clickDirection(px, py) {
  const w = window.innerWidth, h = window.innerHeight;
  const ndcX = (px / w) * 2 - 1, ndcY = -(py / h) * 2 + 1;
  const t = Math.tan(state.fov * DEG / 2);
  return new THREE.Vector3(ndcX * t * camera.aspect, ndcY * t, -1)
    .normalize().applyQuaternion(camera.quaternion);
}
function pickAt(px, py, generous) {
  const dir = clickDirection(px, py);
  const thr = (generous ? 0.02 : 0.008) * state.fov * DEG + 0.5 * DEG;
  let best = null, bestAng = Infinity;
  function consider(obj, ang, bonus) {
    const a = ang - (bonus || 0);
    if (a < bestAng) { bestAng = a; best = obj; }
  }
  for (const body in solarVecs) {
    const s = solarVecs[body];
    if (state.hideBelow && s.vec.dot(zenithJ2000) < 0) continue;
    const ang = Math.acos(clamp(dir.dot(s.vec), -1, 1));
    if (ang < thr * 2 + 0.5 * DEG) consider({ kind: 'planet', body, vec: s.vec, mag: s.mag, distAU: s.distAU }, ang, 0.3 * DEG);
  }
  for (let i = 0; i < nDSO; i++) {
    const d = dsoList[i];
    if (state.hideBelow && d.vec.dot(zenithJ2000) < 0) continue;
    const ang = Math.acos(clamp(dir.dot(d.vec), -1, 1));
    const sizeAng = Math.max(d.sizeDeg * DEG / 2, 0.3 * DEG);
    if (ang < sizeAng + thr) consider({ kind: 'dso', idx: i }, ang, 0.2 * DEG);
  }
  const cosThr = Math.cos(thr);
  for (let i = 0; i < N_STARS; i++) {
    const dot = dir.x * starPos[i * 3] + dir.y * starPos[i * 3 + 1] + dir.z * starPos[i * 3 + 2];
    if (dot > cosThr) {
      if (state.hideBelow &&
          starPos[i * 3] * zenithJ2000.x + starPos[i * 3 + 1] * zenithJ2000.y + starPos[i * 3 + 2] * zenithJ2000.z < 0) continue;
      consider({ kind: 'star', idx: i }, Math.acos(clamp(dot, -1, 1)), starNameIdx[i] !== 65535 ? 0.25 * DEG : 0);
    }
  }
  return best;
}

/* ---------------- info panel ---------------- */
const infoEl = document.getElementById('info');
const infoBody = document.getElementById('infoBody');
document.getElementById('infoClose').addEventListener('click', () => {
  infoEl.classList.add('hidden'); state.selected = null;
});
function fmtRA(raRad) {
  let h = raRad / DEG / 15;
  const H = Math.floor(h); h = (h - H) * 60;
  const M = Math.floor(h); const S = (h - M) * 60;
  return `${H}h ${String(M).padStart(2, '0')}m ${S.toFixed(1).padStart(4, '0')}s`;
}
function fmtDec(decRad) {
  const d = decRad / DEG;
  const sign = d < 0 ? '-' : '+';
  let a = Math.abs(d);
  const D = Math.floor(a); a = (a - D) * 60;
  const M = Math.floor(a); const S = (a - M) * 60;
  return `${sign}${D}\u00b0 ${String(M).padStart(2, '0')}' ${S.toFixed(0).padStart(2, '0')}"`;
}
function row(k, v) { return `<div><span class="k">${k}</span> ${v}</div>`; }
function showInfo(sel) {
  let html = '';
  if (sel.kind === 'star') {
    const named = starNameIdx[sel.idx] !== 65535 ? STAR_NAMES[starNameIdx[sel.idx]] : null;
    const p = vecToRadec(new THREE.Vector3(starPos[sel.idx * 3], starPos[sel.idx * 3 + 1], starPos[sel.idx * 3 + 2]));
    html += `<h2>${named ? named.name : 'Star #' + (sel.idx + 1)}${named && named.con ? ' <small>(' + named.con + ')</small>' : ''}</h2>`;
    html += row('Type:', 'Star');
    if (named && named.spect) html += row('Spectral:', named.spect);
    if (named && named.dist) html += row('Distance:', named.dist + ' light-years');
    html += row('Magnitude:', starMag[sel.idx].toFixed(2));
    html += row('RA:', fmtRA(p[0]));
    html += row('Dec:', fmtDec(p[1]));
  } else if (sel.kind === 'dso') {
    const d = dsoList[sel.idx];
    html += `<h2>${d.name}</h2>`;
    html += row('Type:', d.type);
    if (d.con) html += row('Constellation:', d.con);
    if (d.mag < 90) html += row('Magnitude:', d.mag.toFixed(1));
    html += row('Size:', d.sizeDeg < 1 ? (d.sizeDeg * 60).toFixed(1) + "'" : d.sizeDeg.toFixed(1) + '\u00b0');
    html += row('RA:', fmtRA(d.ra));
    html += row('Dec:', fmtDec(d.dec));
  } else if (sel.kind === 'planet') {
    html += `<h2>${sel.body}</h2>`;
    const p = vecToRadec(sel.vec);
    html += row('Type:', 'Solar System');
    if (sel.distAU) html += row('Distance:', sel.distAU.toFixed(3) + ' AU');
    html += row('Magnitude:', sel.mag.toFixed(1));
    html += row('RA:', fmtRA(p[0]));
    html += row('Dec:', fmtDec(p[1]));
    if (sel.body === 'Moon') {
      try {
        const ill = Astronomy.Illumination('Moon', Astronomy.MakeTime(state.date));
        html += row('Illuminated:', (ill.phase_fraction * 100).toFixed(0) + '%');
      } catch (e) { }
    }
  }
  infoBody.innerHTML = html + '<div id="liveVals"></div>';
  infoEl.classList.remove('hidden');
}

/* live RA/Dec of date, hour angle, altitude, azimuth for the selected object */
const liveM = new THREE.Matrix3();
function updateLive(time) {
  const el = document.getElementById('liveVals');
  if (!el) return;
  const sel = state.selected;
  if (!sel || infoEl.classList.contains('hidden')) { el.innerHTML = ''; return; }
  let v = null;
  if (sel.kind === 'star') v = new THREE.Vector3(starPos[sel.idx * 3], starPos[sel.idx * 3 + 1], starPos[sel.idx * 3 + 2]);
  else if (sel.kind === 'dso') v = dsoList[sel.idx].vec;
  else if (solarVecs[sel.body]) v = solarVecs[sel.body].vec;
  if (!v) { el.innerHTML = ''; return; }
  const m = Astronomy.Rotation_EQJ_EQD(time).rot;
  liveM.set(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]);
  const ve = v.clone().applyMatrix3(liveM);
  const p = vecToRadec(ve); // topocentric RA/Dec of date
  const lstH = ((Astronomy.SiderealTime(time) + state.lon / 15) % 24 + 24) % 24;
  let ha = lstH * 15 - p[0] / DEG; // hour angle, degrees west of meridian
  ha = ((ha % 360) + 540) % 360 - 180;
  const lat = state.lat * DEG, decR = p[1], H = ha * DEG;
  const sinH = Math.sin(H), cosH = Math.cos(H);
  const sinAlt = Math.sin(lat) * Math.sin(decR) + Math.cos(lat) * Math.cos(decR) * cosH;
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const az = Math.atan2(-Math.cos(decR) * sinH, Math.cos(lat) * Math.sin(decR) - Math.sin(lat) * Math.cos(decR) * cosH);
  const azDeg = (az / DEG + 360) % 360;
  el.innerHTML =
    '<div class="live-title">Live coordinates</div>'
    + row('RA:', fmtRA(p[0]) + ' <small>(date)</small>')
    + row('Dec:', fmtDec(p[1]))
    + row('Hour angle:', fmtRA(ha * DEG))
    + row('Altitude:', (alt / DEG).toFixed(2) + '\u00b0' + (alt < 0 ? ' <small>(below horizon)</small>' : ''))
    + row('Azimuth:', azDeg.toFixed(2) + '\u00b0');
}

/* ---------------- tooltip ---------------- */
const tooltip = document.getElementById('tooltip');
function hideTooltip() { tooltip.classList.add('hidden'); skyCanvas.style.cursor = 'default'; }
function handleHover(px, py) {
  const sel = pickAt(px, py, true);
  if (!sel) { hideTooltip(); return; }
  skyCanvas.style.cursor = 'pointer';
  let label;
  if (sel.kind === 'star') {
    const named = starNameIdx[sel.idx] !== 65535 ? STAR_NAMES[starNameIdx[sel.idx]] : null;
    label = named ? named.name : 'Star mag ' + starMag[sel.idx].toFixed(1);
  } else if (sel.kind === 'dso') label = dsoList[sel.idx].name;
  else label = sel.body;
  tooltip.textContent = label;
  tooltip.classList.remove('hidden');
  tooltip.style.left = (px + 14) + 'px';
  tooltip.style.top = (py + 14) + 'px';
}
function handleClick(px, py) {
  const sel = pickAt(px, py, false);
  if (sel) { state.selected = sel; showInfo(sel); }
}

/* ---------------- UI wiring ---------------- */
const $ = id => document.getElementById(id);
const dtInput = $('datetime');
function dateToInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
dtInput.value = dateToInput(new Date());
dtInput.addEventListener('change', () => {
  const d = new Date(dtInput.value);
  if (!isNaN(d)) state.date = d;
});
$('btnNow').addEventListener('click', () => { state.date = new Date(); dtInput.value = dateToInput(state.date); });
$('btnPrev').addEventListener('click', () => { state.date = new Date(state.date.getTime() - 3600e3); dtInput.value = dateToInput(state.date); });
$('btnNext').addEventListener('click', () => { state.date = new Date(state.date.getTime() + 3600e3); dtInput.value = dateToInput(state.date); });
$('btnPlay').addEventListener('click', () => {
  state.playing = !state.playing;
  $('btnPlay').innerHTML = state.playing ? '&#10074;&#10074;' : '&#9654;';
});
$('speed').addEventListener('change', e => { state.speed = parseFloat(e.target.value); });
$('lat').addEventListener('change', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) state.lat = clamp(v, -89, 89); });
$('lon').addEventListener('change', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) state.lon = clamp(v, -180, 180); });
$('showLabels').addEventListener('change', e => { state.showLabels = e.target.checked; });
$('showDSO').addEventListener('change', e => { state.showDSO = e.target.checked; dsoMesh.visible = e.target.checked; });
$('showMW').addEventListener('change', e => { state.showMW = e.target.checked; milkyWay.visible = e.target.checked; });
$('showLines').addEventListener('change', e => { state.showLines = e.target.checked; constLines.visible = e.target.checked; });
$('showEqGrid').addEventListener('change', e => { eqGrid.visible = e.target.checked; });
$('showAzGrid').addEventListener('change', e => { state.showAzGrid = e.target.checked; azGridLines.visible = e.target.checked; });
$('showHorizon').addEventListener('change', e => { state.showHorizon = e.target.checked; horizonLine.visible = e.target.checked; });
$('showMeridian').addEventListener('change', e => { state.showMeridian = e.target.checked; meridianLine.visible = e.target.checked; });
$('hideBelow').addEventListener('change', e => { state.hideBelow = e.target.checked; });
$('showEcl').addEventListener('change', e => { state.showEcl = e.target.checked; });
$('autoMag').addEventListener('change', e => {
  state.autoMag = e.target.checked;
  $('magSlider').disabled = state.autoMag;
  if (!state.autoMag) state.magManual = parseFloat($('magSlider').value);
});
$('magSlider').addEventListener('input', e => { state.magManual = parseFloat(e.target.value); });
$('brightSlider').addEventListener('input', e => { state.brightness = parseFloat(e.target.value); });

/* location-name collection (built-in city list) */
const CITIES = [
  ['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63],
  ['Houston', 29.76, -95.37], ['Toronto', 43.65, -79.38], ['Mexico City', 19.43, -99.13],
  ['Sao Paulo', -23.55, -46.63], ['Buenos Aires', -34.60, -58.38], ['Lima', -12.05, -77.04],
  ['Bogota', 4.71, -74.07], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35],
  ['Berlin', 52.52, 13.41], ['Madrid', 40.42, -3.70], ['Rome', 41.90, 12.50],
  ['Moscow', 55.76, 37.62], ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24],
  ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['Johannesburg', -26.20, 28.05],
  ['Cape Town', -33.92, 18.42], ['Dubai', 25.20, 55.27], ['Tehran', 35.69, 51.39],
  ['Karachi', 24.86, 67.01], ['Mumbai', 19.08, 72.88], ['Delhi', 28.61, 77.21],
  ['Kolkata', 22.57, 88.36], ['Bangkok', 13.76, 100.50], ['Singapore', 1.35, 103.82],
  ['Jakarta', -6.21, 106.85], ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47],
  ['Beijing', 39.90, 116.41], ['Seoul', 37.57, 126.98], ['Tokyo', 35.68, 139.69],
  ['Manila', 14.60, 120.98], ['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96],
  ['Auckland', -36.85, 174.76], ['Honolulu', 21.31, -157.86], ['Anchorage', 61.22, -149.90],
  ['Reykjavik', 64.15, -21.94], ['Stockholm', 59.33, 18.07], ['Athens', 37.98, 23.73],
  ['Lisbon', 38.72, -9.14], ['Santiago', -33.45, -70.67], ['Quito', -0.18, -78.47],
];
const citySel = $('city');
CITIES.forEach(c => {
  const o = document.createElement('option');
  o.value = c[1] + ',' + c[2]; o.textContent = c[0];
  citySel.appendChild(o);
});
citySel.addEventListener('change', () => {
  const v = citySel.value.split(',');
  if (v.length === 2) {
    state.lat = parseFloat(v[0]); state.lon = parseFloat(v[1]);
    $('lat').value = state.lat; $('lon').value = state.lon;
    $('geoStatus').textContent = citySel.selectedOptions[0].textContent;
  }
});

/* device geolocation (browser will ask for permission) */
$('btnGeo').addEventListener('click', () => {
  const st = $('geoStatus');
  if (!navigator.geolocation) { st.textContent = 'Geolocation not supported'; return; }
  st.textContent = 'Requesting...';
  navigator.geolocation.getCurrentPosition(pos => {
    state.lat = pos.coords.latitude; state.lon = pos.coords.longitude;
    $('lat').value = state.lat.toFixed(4); $('lon').value = state.lon.toFixed(4);
    st.textContent = 'Location set from device GPS';
  }, () => {
    st.textContent = 'Denied or unavailable';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
});

/* ---------------- overlay drawing ---------------- */
function eclipticPoints() {
  const pts = [];
  const e = 23.4393 * DEG;
  for (let i = 0; i <= 90; i++) {
    const lon = i * 4 * DEG;
    pts.push(new THREE.Vector3(Math.cos(lon), Math.sin(lon) * Math.cos(e), Math.sin(lon) * Math.sin(e)));
  }
  return pts;
}
const ECLIPTIC = eclipticPoints();

function drawOverlay(magLimit) {
  const w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  // solar bodies as glowing discs
  for (const body in solarVecs) {
    const s = solarVecs[body];
    if (state.hideBelow && s.vec.dot(zenithJ2000) < 0) continue;
    const sp = screenPos(s.vec);
    if (!sp) continue;
    const bright = body === 'Sun' ? 12 : body === 'Moon' ? 8 : clamp(6.5 - s.mag, 2.5, 8);
    const r = bright * (1 + (70 - state.fov) / 70);
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r * 3);
    g.addColorStop(0, PLANET_COLOR[body]);
    g.addColorStop(0.3, PLANET_COLOR[body]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r * 3, 0, Math.PI * 2); ctx.fill();
  }

  if (state.showEcl) {
    ctx.strokeStyle = 'rgba(130, 170, 90, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (const p of ECLIPTIC) {
      if (state.hideBelow && p.dot(zenithJ2000) < 0) { started = false; continue; }
      const sp = screenPos(p);
      if (!sp) { started = false; continue; }
      if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
      else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
  }

  // selection marker
  if (state.selected) {
    let v = null;
    if (state.selected.kind === 'star') v = new THREE.Vector3(starPos[state.selected.idx * 3], starPos[state.selected.idx * 3 + 1], starPos[state.selected.idx * 3 + 2]);
    else if (state.selected.kind === 'dso') v = dsoList[state.selected.idx].vec;
    else if (solarVecs[state.selected.body]) v = solarVecs[state.selected.body].vec;
    if (v && !(state.hideBelow && v.dot(zenithJ2000) < 0)) {
      const sp = screenPos(v);
      if (sp) {
        ctx.strokeStyle = '#ffd966';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // horizon cardinal directions
  if (state.showHorizon) {
    const dirs = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    ctx.textAlign = 'center';
    for (const d of dirs) {
      const v = altazToVec(0, d[1]).applyQuaternion(azGrid.quaternion);
      const sp = screenPos(v);
      if (!sp) continue;
      const main = d[1] % 90 === 0;
      ctx.font = (main ? 'bold ' : '') + '12px "Segoe UI", sans-serif';
      ctx.fillStyle = main ? 'rgba(225, 235, 250, 0.95)' : 'rgba(168, 196, 232, 0.55)';
      ctx.fillText(d[0], sp.x, sp.y);
    }
    ctx.textAlign = 'left';
  }

  // labels
  if (!state.showLabels) return;
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const labels = [];
  for (const body in solarVecs) {
    const sp = screenPos(solarVecs[body].vec);
    if (sp && !(state.hideBelow && solarVecs[body].vec.dot(zenithJ2000) < 0)) labels.push({ text: body, x: sp.x, y: sp.y, color: PLANET_COLOR[body], pri: -1 });
  }
  const nameCut = Math.max(1.2, magLimit - 2.2);
  const namedVec = new THREE.Vector3();
  for (let i = 0; i < N_STARS; i++) {
    const ni = starNameIdx[i];
    if (ni === 65535 || starMag[i] > nameCut) continue;
    namedVec.set(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]);
    if (state.hideBelow && namedVec.dot(zenithJ2000) < 0) continue;
    const sp = screenPos(namedVec);
    if (sp) labels.push({ text: STAR_NAMES[ni].name, x: sp.x, y: sp.y, color: 'rgba(255,255,255,0.75)', pri: starMag[i] });
  }
  if (state.showDSO) {
    for (const d of dsoList) {
      if (d.mag > magLimit - 0.3) continue;
      if (state.hideBelow && d.vec.dot(zenithJ2000) < 0) continue;
      const sp = screenPos(d.vec);
      if (sp) labels.push({
        text: d.name, x: sp.x, y: sp.y,
        color: `rgba(${d.color[0] * 255 | 0},${d.color[1] * 255 | 0},${d.color[2] * 255 | 0},0.85)`, pri: d.mag,
      });
    }
  }
  labels.sort((a, b) => a.pri - b.pri);
  const maxLabels = Math.round(clamp(4000 / Math.max(state.fov, 8), 40, 400));
  const n = Math.min(labels.length, maxLabels);
  for (let i = 0; i < n; i++) {
    const L = labels[i];
    ctx.fillStyle = L.color;
    ctx.fillText(L.text, L.x + 8, L.y - 8);
  }

  // constellation names
  if (state.showLines && state.fov > 12) {
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (const c of CONST_NAMES) {
      if (c.rank > 1 && state.fov > 30) continue;
      if (c.rank > 2 && state.fov > 60) continue;
      if (state.hideBelow && c.vec.dot(zenithJ2000) < 0) continue;
      const sp = screenPos(c.vec);
      if (!sp) continue;
      ctx.fillStyle = 'rgba(110, 145, 200, 0.5)';
      ctx.fillText(c.name.toUpperCase(), sp.x, sp.y);
    }
    ctx.textAlign = 'left';
  }
}

/* ---------------- main loop ---------------- */
let precQuat = new THREE.Quaternion();
const tmpM4 = new THREE.Matrix4();
function updateCameraOrientation(time) {
  // rotate J2000 catalog frame into equator-of-date for display
  const m = Astronomy.Rotation_EQJ_EQD(time).rot;
  const m4 = new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], 0,
    m[1][0], m[1][1], m[1][2], 0,
    m[2][0], m[2][1], m[2][2], 0,
    0, 0, 0, 1);
  precQuat.setFromRotationMatrix(m4);
  camera.quaternion.copy(precQuat).multiply(camQuat);
}
function fmtTime(d) {
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
let lastSolar = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if (state.playing) {
    if (!animate.lastTick) animate.lastTick = now;
    const dt = (now - animate.lastTick) / 1000;
    animate.lastTick = now;
    state.date = new Date(state.date.getTime() + dt * state.speed * 1000);
    dtInput.value = dateToInput(state.date);
  } else {
    animate.lastTick = now;
  }
  const time = Astronomy.MakeTime(state.date);

  updateCameraOrientation(time);

  // orient the azimuth grid: local horizontal frame -> equator of date
  // (zenith axis -> dec = latitude on the meridian; pole at alt = latitude, az = 0)
  const lstDeg = (((Astronomy.SiderealTime(time) + state.lon / 15) % 24 + 24) % 24) * 15;
  const s = Math.sin(lstDeg * DEG), c = Math.cos(lstDeg * DEG);
  const sinLat = Math.sin(state.lat * DEG), cosLat = Math.cos(state.lat * DEG);
  const m4 = new THREE.Matrix4().set(
    -s, -sinLat * c, cosLat * c, 0,
     c, -sinLat * s, cosLat * s, 0,
     0,  cosLat,      sinLat,    0,
     0, 0, 0, 1);
  const q = new THREE.Quaternion().setFromRotationMatrix(m4);
  azGrid.quaternion.copy(precQuat).invert().multiply(q);
  zenithJ2000.set(cosLat * c, cosLat * s, sinLat); // observer zenith in J2000 frame
  if (state.hideBelow) {
    tmpM4.makeRotationFromQuaternion(azGrid.quaternion);
    horizM3.setFromMatrix4(tmpM4).transpose();
  }
  stars.material.uniforms.uHide.value = state.hideBelow ? 1 : 0;
  milkyWay.material.uniforms.uHide.value = state.hideBelow ? 1 : 0;
  dsoMaterial.uniforms.uHide.value = state.hideBelow ? 1 : 0;
  if (state.hideBelow) horizonPlane.normal.copy(zenithJ2000);
  else horizonPlane.normal.set(0, 0, 0);
  groundMesh.visible = state.hideBelow;

  // magnitude limit: auto from zoom level, or manual override
  const magLimit = state.autoMag
    ? clamp(state.magBase + (70 - state.fov) * 0.12, 2, 9)
    : clamp(state.magManual, 1, 9);
  const pr = window.devicePixelRatio || 1;
  const starU = stars.material.uniforms;
  starU.uMagLimit.value = magLimit;
  starU.uSize.value = pr * clamp(0.65 + state.fov / 90, 0.8, 1.5);
  starU.uBright.value = state.brightness;
  milkyWay.material.uniforms.uSize.value = pr * 0.75 * clamp(0.7 + state.fov / 100, 0.8, 1.6);
  milkyWay.material.uniforms.uBright.value = 0.5 + 0.5 * state.brightness;
  dsoMaterial.uniforms.uMagLimit.value = magLimit;
  dsoMaterial.uniforms.uPxScale.value = (renderer.domElement.height / (2 * Math.tan(state.fov * DEG / 2))) * (Math.PI / 180);

  if (now - lastSolar > 250) {
    lastSolar = now;
    computeSolar();
  }

  renderer.render(scene, camera);
  drawOverlay(magLimit);
  animate.frame = (animate.frame || 0) + 1;
  if (animate.frame % 4 === 0) updateLive(time);

  $('maginfo').textContent = `Field: ${state.fov.toFixed(1)}\u00b0  |  Mag limit: ${magLimit.toFixed(1)} (${state.autoMag ? 'auto' : 'manual'})`;
  const lstH = (((Astronomy.SiderealTime(time) + state.lon / 15) % 24 + 24) % 24);
  const lstStr = `${String(Math.floor(lstH)).padStart(2, '0')}:${String(Math.floor((lstH % 1) * 60)).padStart(2, '0')} LST`;
  $('readout').textContent = fmtTime(state.date) + `  |  ${state.lat.toFixed(2)}\u00b0, ${state.lon.toFixed(2)}\u00b0  |  ${lstStr}`;
}

resize();
requestAnimationFrame(animate);

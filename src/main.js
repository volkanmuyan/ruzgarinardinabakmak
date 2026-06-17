import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Salon sabitleri (modern, yüksek tavanlı dairesel sergi salonu)
// ---------------------------------------------------------------------------
const WALL_RADIUS = 18;       // dairesel duvar yarıçapı (m)
const CEIL_HEIGHT = 9;        // tavan yüksekliği (m)
const PANEL_RADIUS = 17.5;    // fotoğraf panellerinin asılı olduğu yarıçap
const WALK_BOUND = 15;        // ziyaretçinin gidebileceği son sınır (duvardan ~2.5m)
const EYE_HEIGHT = 1.7;
const FOCUS_DIST = 7;         // bilgi kartının açıldığı mesafe
const CLARITY_DIST = 9;       // fotoğrafın netleşmeye başladığı mesafe
const PHOTO_DIM = 0.62;       // uzaktaki fotoğraf parlaklığı (sönük)
const PHOTO_BRIGHT = 0.9;     // yakındaki fotoğraf parlaklığı (net, bloom eşiği altında)

// Dokunmatik cihaz mı? (kontrol şeması + efekt kalitesi ayarı için)
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Yüksek efekt modu (bloom + yansıyan zemin) — her cihazda açık,
// mobilde çözünürlük/piksel oranı düşürülerek performans korunur.
const HIGH_FX = true;

// ---------------------------------------------------------------------------
// Renderer / sahne / kamera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f4);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, EYE_HEIGHT, 0);

// ---------------------------------------------------------------------------
// Salon kabuğu: zemin, dairesel duvar, tavan, ışıklık
// ---------------------------------------------------------------------------
function buildHall() {
  // --- Zemin ---
  if (HIGH_FX) {
    // Cilalı zemin: altta gerçek yansıma (Reflector) + üstte yarı saydam beton
    const reflectRes = TOUCH ? 640 : 1280;
    const reflector = new Reflector(new THREE.CircleGeometry(WALL_RADIUS, 96), {
      textureWidth: Math.min(window.innerWidth, reflectRes),
      textureHeight: Math.min(window.innerHeight, reflectRes),
      color: 0x8a8f96,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = 0.0;
    scene.add(reflector);

    const glossMat = new THREE.MeshStandardMaterial({
      color: 0xd7dade, roughness: 0.45, metalness: 0.0,
      transparent: true, opacity: 0.62,
    });
    const gloss = new THREE.Mesh(new THREE.CircleGeometry(WALL_RADIUS, 96), glossMat);
    gloss.rotation.x = -Math.PI / 2;
    gloss.position.y = 0.002;
    gloss.receiveShadow = true;
    gloss.renderOrder = 1;
    scene.add(gloss);
  } else {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd7dade, roughness: 0.38, metalness: 0.0 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_RADIUS, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // İnce zemin halkası (panellerin önünde dekoratif çizgi)
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xaeb3b9, roughness: 0.5 });
  const line = new THREE.Mesh(new THREE.RingGeometry(WALK_BOUND - 0.04, WALK_BOUND + 0.04, 96), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.012;
  line.renderOrder = 2;
  scene.add(line);

  // Dairesel duvar (içten görünür)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: 0.95, side: THREE.BackSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, CEIL_HEIGHT, 96, 1, true), wallMat);
  wall.position.y = CEIL_HEIGHT / 2;
  wall.receiveShadow = true;
  scene.add(wall);

  // Duvar dibi süpürgelik (koyu şerit)
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x363b43, roughness: 0.7, side: THREE.BackSide });
  const baseband = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS - 0.01, WALL_RADIUS - 0.01, 0.14, 96, 1, true), baseMat);
  baseband.position.y = 0.07;
  scene.add(baseband);

  // Tavan
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 1.0, side: THREE.DoubleSide });
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(WALL_RADIUS, 96), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = CEIL_HEIGHT;
  scene.add(ceil);

  // Merkezi ışıklık — yumuşak gradyanlı parlayan disk (gün ışığı hissi)
  const skylight = new THREE.Mesh(
    new THREE.CircleGeometry(7, 64),
    new THREE.MeshBasicMaterial({ map: makeRadialTexture('#ffffff', '#dfe9f5'), toneMapped: false })
  );
  skylight.rotation.x = Math.PI / 2;
  skylight.position.y = CEIL_HEIGHT - 0.02;
  scene.add(skylight);

  // Işıklık çerçevesi (ince halka)
  const skyFrame = new THREE.Mesh(
    new THREE.TorusGeometry(7, 0.1, 12, 80),
    new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.6 })
  );
  skyFrame.rotation.x = Math.PI / 2;
  skyFrame.position.y = CEIL_HEIGHT - 0.05;
  scene.add(skyFrame);

  // Işıklıktan inen yumuşak hacim hissi (additif glow sprite)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRadialTexture('rgba(255,250,240,0.9)', 'rgba(255,250,240,0)'),
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.position.set(0, CEIL_HEIGHT - 3, 0);
  glow.scale.set(20, 14, 1);
  scene.add(glow);

  // TÜREB logosu — zemin merkezinde şeffaf kakma
  new THREE.TextureLoader().load('assets/logo/tureb-logo.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const logoMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.42, depthWrite: false });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), logoMat);
    logo.rotation.x = -Math.PI / 2;
    logo.position.y = 0.02;
    logo.renderOrder = 3;
    scene.add(logo);
  });
}

// Yumuşak radyal gradyan dokusu (merkez → kenar)
function makeRadialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Aydınlatma — parlak, eşit dağılımlı modern galeri ışığı
// ---------------------------------------------------------------------------
function buildLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dadd, 0.7));

  // Işıklıktan gelen ana ışık (gölge üretir)
  const key = new THREE.DirectionalLight(0xfff6ec, 1.15);
  key.position.set(6, CEIL_HEIGHT + 6, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // Merkezde yumuşak dolgu ışığı
  const fill = new THREE.PointLight(0xffffff, 0.5, 60, 1.5);
  fill.position.set(0, CEIL_HEIGHT - 1, 0);
  scene.add(fill);
}

// ---------------------------------------------------------------------------
// Fotoğraf panelleri — duvara asılı, merkeze bakan
// ---------------------------------------------------------------------------
const panels = [];

function buildPanels(photos, textures) {
  const IMG = 2.4;          // kare fotoğraf kenarı (m)
  const FRAME = 0.12;       // çerçeve kalınlığı
  const centerY = 2.6;      // panel merkez yüksekliği

  photos.forEach((p, i) => {
    const angle = (i / photos.length) * Math.PI * 2;
    const group = new THREE.Group();
    const x = Math.cos(angle) * PANEL_RADIUS;
    const z = Math.sin(angle) * PANEL_RADIUS;
    group.position.set(x, centerY, z);
    group.lookAt(0, centerY, 0); // merkeze dön

    // Çerçeve (hafif parlayabilen — odak vurgusu için)
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2b2f36,
      roughness: 0.5,
      metalness: 0.1,
      emissive: 0x4aa3df,
      emissiveIntensity: 0,
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(IMG + FRAME * 2, IMG + FRAME * 2, 0.1), frameMat);
    frame.position.z = 0.06;
    frame.castShadow = true;
    group.add(frame);

    // Beyaz paspartu
    const matteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const matte = new THREE.Mesh(new THREE.PlaneGeometry(IMG + FRAME, IMG + FRAME), matteMat);
    matte.position.z = 0.115;
    group.add(matte);

    // Fotoğrafın kendisi — gerçek renkler (tone-mapping ve ışıktan bağımsız).
    // Uzaktayken hafif sönük başlar, yaklaşınca netleşir (updateFocus).
    const tex = textures[p.id];
    const photoMat = new THREE.MeshBasicMaterial({ map: tex || null, color: 0xffffff, toneMapped: false });
    photoMat.color.setScalar(PHOTO_DIM);
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(IMG, IMG), photoMat);
    photo.position.z = 0.12;
    group.add(photo);

    // Alt etiket (başlık + fotoğrafçı)
    const labelTex = makeLabelTexture(p.title, p.photographer);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(IMG * 0.9, IMG * 0.9 * 0.22), labelMat);
    label.position.set(0, -IMG / 2 - 0.32, 0.12);
    group.add(label);

    scene.add(group);

    panels.push({
      group,
      frameMat,
      photoMat,
      data: p,
      center: new THREE.Vector3(x, centerY, z),
      baseScale: 1,
    });
  });
}

// Küçük etiket dokusu (başlık + fotoğrafçı) — canvas ile
function makeLabelTexture(title, photographer) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024 * 0.22;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1c2128';
  ctx.textAlign = 'center';
  ctx.font = '600 92px system-ui, sans-serif';
  ctx.fillText(title, c.width / 2, 100);
  ctx.fillStyle = '#4a5560';
  ctx.font = '400 64px system-ui, sans-serif';
  ctx.fillText(photographer, c.width / 2, 180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---------------------------------------------------------------------------
// Birinci şahıs kontrolleri
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, renderer.domElement);
const keys = {};
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const WALK_SPEED = 26;

// Dokunmatik / mobil giriş durumu
const isTouch = TOUCH;
let started = false;                 // sergiye girildi mi
const touchMove = { x: 0, y: 0 };    // joystick: x=yan, y=ileri(-)/geri(+)
let yaw = 0, pitch = 0;              // mobil bakış açısı (rad)

addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

function updateMovement(dt) {
  // Mobilde bakış açısını uygula (PointerLock yok)
  if (isTouch) camera.rotation.set(pitch, yaw, 0, 'YXZ');

  velocity.x -= velocity.x * 9 * dt;
  velocity.z -= velocity.z * 9 * dt;

  const fwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - touchMove.y;
  const side = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) + touchMove.x;

  direction.set(side, 0, fwd).normalize();
  const speed = WALK_SPEED * (keys['ShiftLeft'] || keys['ShiftRight'] ? 1.7 : 1);
  if (fwd) velocity.z -= direction.z * speed * dt;
  if (side) velocity.x -= direction.x * speed * dt;

  controls.moveRight(-velocity.x * dt);
  controls.moveForward(-velocity.z * dt);

  const obj = controls.object;
  const r = Math.hypot(obj.position.x, obj.position.z);
  if (r > WALK_BOUND) {
    const k = WALK_BOUND / r;
    obj.position.x *= k;
    obj.position.z *= k;
  }
  obj.position.y = EYE_HEIGHT;
}

// ---------------------------------------------------------------------------
// Yaklaşma-bazlı bilgi kartı + odak parıltısı
// ---------------------------------------------------------------------------
const infoCard = document.getElementById('info-card');
const cardTitle = document.getElementById('card-title');
const cardPhotographer = document.getElementById('card-photographer');
const cardMeta = document.getElementById('card-meta');
const cardDesc = document.getElementById('card-desc');

let activePanel = null;
const camPos = new THREE.Vector3();
const camDir = new THREE.Vector3();
const toPanel = new THREE.Vector3();

function updateFocus(dt) {
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);

  let best = null;
  let bestScore = -Infinity;
  for (const panel of panels) {
    const d = camPos.distanceTo(panel.center);
    if (d > FOCUS_DIST) continue;
    toPanel.copy(panel.center).sub(camPos).normalize();
    const facing = camDir.dot(toPanel); // 1 = tam bakıyor
    if (facing < 0.45) continue;
    const score = facing * 2 - d / FOCUS_DIST; // yakın + tam bakılan kazanır
    if (score > bestScore) {
      bestScore = score;
      best = panel;
    }
  }

  // Kart içeriğini güncelle (değişince)
  if (best !== activePanel) {
    activePanel = best;
    if (best) {
      const p = best.data;
      cardTitle.textContent = p.title;
      cardPhotographer.textContent = p.photographer;
      cardMeta.textContent = [p.location, p.year].filter(Boolean).join(' · ');
      cardDesc.textContent = p.description || '';
      infoCard.classList.remove('hidden');
      requestAnimationFrame(() => infoCard.classList.add('show'));
    } else {
      infoCard.classList.remove('show');
      setTimeout(() => { if (!activePanel) infoCard.classList.add('hidden'); }, 500);
    }
  }

  // Parıltı + hafif büyüme + mesafeye göre netleşme animasyonu
  for (const panel of panels) {
    const target = panel === activePanel ? 1.4 : 0;
    panel.frameMat.emissiveIntensity += (target - panel.frameMat.emissiveIntensity) * Math.min(1, dt * 8);
    const ts = panel === activePanel ? 1.035 : 1;
    const s = panel.group.scale.x + (ts - panel.group.scale.x) * Math.min(1, dt * 8);
    panel.group.scale.setScalar(s);

    // Yaklaştıkça parlaklık PHOTO_DIM → PHOTO_BRIGHT (yumuşak geçiş)
    const d = camPos.distanceTo(panel.center);
    const t = THREE.MathUtils.clamp((CLARITY_DIST - d) / (CLARITY_DIST - 2.5), 0, 1);
    const targetB = PHOTO_DIM + (PHOTO_BRIGHT - PHOTO_DIM) * t;
    const curB = panel.photoMat.color.r;
    panel.photoMat.color.setScalar(curB + (targetB - curB) * Math.min(1, dt * 6));
  }
}

// ---------------------------------------------------------------------------
// Karşılama / yükleme akışı
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter-btn');
const loadingFill = document.getElementById('loading-fill');
const loadingText = document.getElementById('loading-text');
const introEl = document.getElementById('welcome-intro');
const hud = document.getElementById('hud');
const instructions = document.getElementById('instructions');

let exhibitionData = null;

async function preload() {
  const res = await fetch('photos.json');
  exhibitionData = await res.json();
  introEl.textContent = exhibitionData.exhibition.intro;

  const photos = exhibitionData.photos;
  let loaded = 0;
  loadingText.textContent = `0 / ${photos.length} görsel`;

  const loader = new THREE.TextureLoader();
  const textures = {};
  await Promise.all(
    photos.map(
      (p) =>
        new Promise((resolve) => {
          loader.load(
            p.file,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
              textures[p.id] = tex;
              loaded++;
              loadingFill.style.width = `${(loaded / photos.length) * 100}%`;
              loadingText.textContent = `${loaded} / ${photos.length} görsel`;
              resolve();
            },
            undefined,
            () => { loaded++; resolve(); }
          );
        })
    )
  );

  buildPanels(photos, textures);

  enterBtn.disabled = false;
  enterBtn.textContent = 'Sergiye Gir';
  loadingText.textContent = 'Hazır';
}

enterBtn.addEventListener('click', () => {
  overlay.style.opacity = '0';
  setTimeout(() => overlay.classList.add('hidden'), 800);
  hud.classList.remove('hidden');
  started = true;
  if (isTouch) {
    document.getElementById('joystick').classList.remove('hidden');
  } else {
    controls.lock();
  }
  setTimeout(() => (instructions.style.opacity = '0.25'), 8000);
});

// Talimat metnini cihaza göre uyarla
if (isTouch) {
  instructions.innerHTML =
    '<strong>Gezinme</strong><br />' +
    'Sol alttaki <span class="key">joystick</span> ile hareket<br />' +
    'Ekranı <span class="key">sürükle</span> ile bak';
}

// ---------------------------------------------------------------------------
// Dokunmatik kontroller (joystick + sürükleyerek bakış)
// ---------------------------------------------------------------------------
if (isTouch) {
  const joy = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  const JOY_R = 45;
  let joyId = null;

  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joyId = e.changedTouches[0].identifier;
  }, { passive: false });

  joy.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      const r = joy.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      const m = Math.min(len, JOY_R);
      const a = Math.atan2(dy, dx);
      dx = Math.cos(a) * m;
      dy = Math.sin(a) * m;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touchMove.x = dx / JOY_R;
      touchMove.y = dy / JOY_R;
    }
  }, { passive: false });

  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      touchMove.x = 0;
      touchMove.y = 0;
      knob.style.transform = 'translate(0, 0)';
    }
  };
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // Bakış — joystick dışındaki dokunuşlar
  const LOOK_SENS = 0.005;
  let lookId = null, lastX = 0, lastY = 0;
  const el = renderer.domElement;

  el.addEventListener('touchstart', (e) => {
    if (lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier;
    lastX = t.clientX;
    lastY = t.clientY;
  }, { passive: false });

  el.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      yaw -= (t.clientX - lastX) * LOOK_SENS;
      pitch -= (t.clientY - lastY) * LOOK_SENS;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: false });

  const lookEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  };
  el.addEventListener('touchend', lookEnd);
  el.addEventListener('touchcancel', lookEnd);
}

// ---------------------------------------------------------------------------
// Rüzgar sesi — sentezlenmiş (filtrelenmiş gürültü), butonla aç/kapat
// ---------------------------------------------------------------------------
const soundBtn = document.getElementById('sound-btn');
const soundIcon = document.getElementById('sound-icon');
let audioCtx = null, windGain = null, windOn = false;

function ensureWind() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Beyaz gürültü tamponu (loop)
  const bufSize = 2 * audioCtx.sampleRate;
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  // Rüzgar tınısı: alçak/yüksek geçiren filtre zinciri
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 120;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.6;

  windGain = audioCtx.createGain();
  windGain.gain.value = 0;

  noise.connect(hp);
  hp.connect(lp);
  lp.connect(windGain);
  windGain.connect(audioCtx.destination);
  noise.start();

  // Esinti: filtre frekansını yavaşça dalgalandır
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  lfo.start();
}

function toggleWind() {
  ensureWind();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  windOn = !windOn;
  const now = audioCtx.currentTime;
  windGain.gain.cancelScheduledValues(now);
  windGain.gain.setTargetAtTime(windOn ? 0.16 : 0, now, 0.6);
  soundIcon.textContent = windOn ? '🔊' : '🔈';
}

soundBtn.addEventListener('click', toggleWind);
// Masaüstünde imleç kilitliyken butona tıklanamadığı için M kısayolu
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') toggleWind();
});

// ---------------------------------------------------------------------------
// Havada süzülen toz zerreleri (ışıkta parıldayan atmosfer)
// ---------------------------------------------------------------------------
let dust = null;
function buildDust() {
  const N = 320;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = Math.random() * (WALL_RADIUS - 1);
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.4 + Math.random() * (CEIL_HEIGHT - 0.8);
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.06,
    map: makeRadialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
    transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

// ---------------------------------------------------------------------------
// Sahneyi kur ve döngüyü başlat
// ---------------------------------------------------------------------------
buildHall();
buildLights();
buildDust();
scene.add(controls.object);

// Post-processing zinciri (yalnız HIGH_FX) — çok hafif bloom.
// Eşik 0.92; fotoğraf parlaklığı bunun ALTINDA tutulduğu için (bkz. updateFocus)
// bloom yalnız ışıklık/tavan gibi parlak yüzeyleri yakalar, fotoğrafları asla.
let composer = null;
if (HIGH_FX) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.3,   // güç (çok az)
    0.5,   // yarıçap
    0.92   // eşik
  ));
  composer.addPass(new OutputPass());
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (controls.isLocked || (isTouch && started)) updateMovement(dt);
  updateFocus(dt);

  // Toz zerrelerini yavaşça yukarı süzdür
  if (dust) {
    const p = dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * 0.12;
      if (y > CEIL_HEIGHT - 0.4) y = 0.4;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    dust.rotation.y += dt * 0.01;
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}
animate();

preload();

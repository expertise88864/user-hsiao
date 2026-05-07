/**
 * Eye-3D worker — runs the Three.js scene on an OffscreenCanvas so the
 * main thread stays free for user input + scrolling. Falls back to main-
 * thread rendering when Worker / OffscreenCanvas aren't available
 * (handled in the parent eye-3d.html).
 *
 * Communication:
 *   Main → Worker:
 *     { type: 'init', canvas: OffscreenCanvas, width, height, dpr }
 *     { type: 'resize', width, height }
 *     { type: 'pointerdown', x, y, pointerId }
 *     { type: 'pointermove', x, y, pointerId, dx, dy }
 *     { type: 'pointerup', pointerId }
 *     { type: 'wheel', dy }
 *     { type: 'reset' }
 *     { type: 'section', on }
 *   Worker → Main:
 *     { type: 'ready', renderer: 'webgpu'|'webgl2' }
 *     { type: 'pick', id }   (after click)
 */

let renderer, scene, camera, root, raycaster, mouse;
let pointerState = { isDown: false, lastX: 0, lastY: 0, pointerId: null };
let cameraDist = 3.5;
let yaw = 0, pitch = 0.3;
let needsRender = true;
let canvasW = 0, canvasH = 0;
let meshById = {};

async function init(msg) {
  const { canvas, width, height, dpr } = msg;
  canvasW = width; canvasH = height;

  const three = await import('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js');
  const THREE = three;

  // Try WebGPU first
  let useWebGPU = false;
  try {
    if (navigator.gpu && THREE.WebGPURenderer) {
      renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
      await renderer.init();
      useWebGPU = true;
    }
  } catch (e) {}
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(dpr || 1, 2));
  renderer.localClippingEnabled = false;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 2, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa4c4dd, 0.6); rim.position.set(-2, -1, -1); scene.add(rim);

  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);

  root = new THREE.Group();
  scene.add(root);

  function add(id, mesh) { mesh.userData.id = id; root.add(mesh); meshById[id] = mesh; }

  // Sclera (semi-transparent outer ball)
  add('sclera', new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshPhongMaterial({ color: 0xfef3c7, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  ));
  // Vitreous
  add('vitreous', new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 32, 32),
    new THREE.MeshPhongMaterial({ color: 0xd6e4f0, transparent: true, opacity: 0.12 })
  ));
  // Retina (back half-sphere)
  add('retina', new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 32, 32, 0, Math.PI * 2, Math.PI / 2.4, Math.PI / 1.6),
    new THREE.MeshPhongMaterial({ color: 0xfbbf24, side: THREE.BackSide, shininess: 50 })
  ));
  // Macula (red dot at back)
  const macula = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshPhongMaterial({ color: 0xdc2626 }));
  macula.position.set(0, 0, -0.86);
  add('macula', macula);
  // Optic nerve
  const nerve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.13, 0.6, 16),
    new THREE.MeshPhongMaterial({ color: 0xfde68a })
  );
  nerve.rotation.x = Math.PI / 2; nerve.position.set(0.12, 0, -1.2);
  add('optic-nerve', nerve);
  // Lens
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 32, 32),
    new THREE.MeshPhongMaterial({ color: 0xb8cfe3, transparent: true, opacity: 0.55, shininess: 100 })
  );
  lens.position.set(0, 0, 0.65); lens.scale.set(1, 1, 0.45);
  add('lens', lens);
  // Iris ring
  const iris = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.42, 32),
    new THREE.MeshPhongMaterial({ color: 0x8b6f3a, side: THREE.DoubleSide })
  );
  iris.position.set(0, 0, 0.78);
  add('iris', iris);
  // Pupil
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.18, 32), new THREE.MeshBasicMaterial({ color: 0x0f172a }));
  pupil.position.set(0, 0, 0.79);
  add('pupil', pupil);
  // Cornea (front cap)
  const cornea = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 32, 0, Math.PI * 2, 0, Math.PI / 3),
    new THREE.MeshPhongMaterial({ color: 0xa4c4dd, transparent: true, opacity: 0.35, shininess: 200 })
  );
  cornea.rotation.x = Math.PI; cornea.position.set(0, 0, 0.8);
  add('cornea', cornea);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  updateCamera();
  loop();
  self.postMessage({ type: 'ready', renderer: useWebGPU ? 'webgpu' : 'webgl2' });
}

function updateCamera() {
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  camera.position.set(
    Math.sin(yaw) * cosP * cameraDist,
    sinP * cameraDist,
    Math.cos(yaw) * cosP * cameraDist
  );
  camera.lookAt(0, 0, 0);
  needsRender = true;
}

function loop() {
  // Auto-spin slowly when not interacting
  if (!pointerState.isDown) { yaw += 0.0015; updateCamera(); }
  if (needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }
  requestAnimationFrame(loop);
}

function pick(x, y) {
  if (!raycaster) return;
  mouse.x = (x / canvasW) * 2 - 1;
  mouse.y = -(y / canvasH) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(root.children, false);
  if (hits.length) {
    const id = hits[0].object.userData.id;
    if (id) self.postMessage({ type: 'pick', id });
  }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (!m || !m.type) return;

  switch (m.type) {
    case 'init':
      await init(m);
      break;
    case 'resize':
      canvasW = m.width; canvasH = m.height;
      renderer.setSize(m.width, m.height, false);
      camera.aspect = m.width / m.height;
      camera.updateProjectionMatrix();
      needsRender = true;
      break;
    case 'pointerdown':
      pointerState.isDown = true;
      pointerState.lastX = m.x; pointerState.lastY = m.y;
      pointerState.pointerId = m.pointerId;
      break;
    case 'pointermove':
      if (!pointerState.isDown) {
        // hover-pick (cheap raycast for cursor-change feedback only — disabled for now)
        return;
      }
      yaw   -= (m.dx || 0) * 0.005;
      pitch += (m.dy || 0) * 0.005;
      pitch = Math.max(-1.4, Math.min(1.4, pitch));
      updateCamera();
      break;
    case 'pointerup':
      pointerState.isDown = false;
      break;
    case 'click':
      pick(m.x, m.y);
      break;
    case 'wheel':
      cameraDist = Math.max(1.5, Math.min(8, cameraDist + (m.dy || 0) * 0.002));
      updateCamera();
      break;
    case 'reset':
      yaw = 0; pitch = 0.3; cameraDist = 3.5; updateCamera();
      break;
    case 'highlight':
      const mesh = meshById[m.id];
      if (mesh && mesh.material) {
        const orig = mesh.material.opacity ?? 1;
        const wasT = mesh.material.transparent;
        mesh.material.transparent = true;
        let t = 0;
        const pulse = setInterval(() => {
          mesh.material.opacity = orig + 0.4 * Math.sin(t / 60 * Math.PI);
          needsRender = true;
          t += 16;
          if (t > 600) { clearInterval(pulse); mesh.material.opacity = orig; mesh.material.transparent = wasT; }
        }, 16);
      }
      break;
  }
};

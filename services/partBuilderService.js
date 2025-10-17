import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { JSDOM } from "jsdom";

// Needed for Three.js to run on backend
const dom = new JSDOM();
global.window = dom.window;
global.document = dom.window.document;

// Procedural 3D part builder
export async function generatePartGLB(prompt, context = {}) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();

  // Decide which shape to make
  const lower = prompt.toLowerCase();
  let mesh;

  if (lower.includes("exhaust")) {
    // simple exhaust
    const geom = new THREE.CylinderGeometry(0.1, 0.12, 0.5, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      metalness: 1,
      roughness: 0.2
    });
    mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0.25, -0.8);
    group.add(mesh);
  } else if (lower.includes("rim") || lower.includes("wheel")) {
    const rim = new THREE.TorusGeometry(0.3, 0.05, 16, 48);
    const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.9,
      roughness: 0.2
    });
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x777777,
      metalness: 0.9,
      roughness: 0.4
    });
    const rimMesh = new THREE.Mesh(rim, rimMat);
    const hubMesh = new THREE.Mesh(hub, hubMat);
    hubMesh.rotation.x = Math.PI / 2;
    group.add(rimMesh);
    group.add(hubMesh);
  } else {
    // fallback cube
    const geom = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ffcc });
    mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
  }

  scene.add(group);

  // Export to GLB
  const exporter = new GLTFExporter();
  return await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (bin) => resolve(Buffer.from(bin)),
      (err) => reject(err),
      { binary: true }
    );
  });
}

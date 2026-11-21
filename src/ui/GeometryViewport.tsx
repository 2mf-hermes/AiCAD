import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GeometryResult } from '../core/geometry/kernel';
export function GeometryViewport({ result, selected, onSelect, upAxis, view = 'iso' }: { result: GeometryResult | null; selected: string[]; onSelect: (id: string, additive: boolean) => void; upAxis: 'Y' | 'Z'; view?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect); select.current = onSelect;
  useEffect(() => {
    const node = host.current; if (!node) return;
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); node.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000000);
    camera.up.set(0, upAxis === 'Y' ? 1 : 0, upAxis === 'Z' ? 1 : 0);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x44505f, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(100, -100, 200); scene.add(light);
    const geometryGroup = new THREE.Group(); scene.add(geometryGroup);
    const disposables: { dispose: () => void }[] = [];
    const meshes: THREE.Mesh[] = [];
    for (const body of result?.bodies ?? []) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.mesh.vertices, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(body.mesh.normals, 3)); geometry.setIndex(body.mesh.triangles);
      const material = new THREE.MeshStandardMaterial({ color: selected.includes(body.id) ? 0x4c8dff : 0xa7bac6, metalness: 0.2, roughness: 0.42 });
      const mesh = new THREE.Mesh(geometry, material); mesh.userData.id = body.id; meshes.push(mesh); geometryGroup.add(mesh); disposables.push(geometry, material);
      const edgeGeometry = new THREE.BufferGeometry(); edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(body.edges, 3));
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x334652 }); geometryGroup.add(new THREE.LineSegments(edgeGeometry, edgeMaterial)); disposables.push(edgeGeometry, edgeMaterial);
    }
    const bounds = new THREE.Box3().setFromObject(geometryGroup);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.isEmpty() ? 50 : Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
    const grid = new THREE.GridHelper(radius * 3, 30, 0x485665, 0x2c3541); if (upAxis === 'Z') grid.rotation.x = Math.PI / 2;
    scene.add(grid); disposables.push(grid.geometry, ...(Array.isArray(grid.material) ? grid.material : [grid.material]));
    const direction = view === 'front' ? new THREE.Vector3(0, -1, 0.001) : view === 'top' ? new THREE.Vector3(0.001, 0, 1) : view === 'right' ? new THREE.Vector3(1, 0, 0.001) : new THREE.Vector3(1, -1, 0.8);
    if (upAxis === 'Y') { const y = direction.y; direction.y = direction.z; direction.z = -y; }
    camera.position.copy(center.clone().add(direction.normalize().multiplyScalar(radius * 1.65))); controls.target.copy(center); controls.update();
    const resize = new ResizeObserver(() => { const { width, height } = node.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); }); resize.observe(node);
    const raycaster = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const click = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(meshes)[0]; select.current(hit?.object.userData.id ?? '', e.ctrlKey || e.metaKey);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('click', click);
    let frame = 0; const animate = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); disposables.forEach(item => item.dispose()); renderer.dispose(); renderer.domElement.remove(); };
  }, [result, selected, upAxis, view]);
  return <div className="geometry-viewport" ref={host} aria-label="3D 模型視窗" />;
}

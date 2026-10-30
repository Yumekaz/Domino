import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const marks = [0, 3, 6, 9, 14];
const stages = ['ISSUE', 'PULL REQUEST', 'COMMIT', 'FILE', 'DEPENDENTS'];
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

/** An explicitly illustrative physical metaphor. Never repository analysis. */
export default function DominoScene({
  progress,
  onPush,
  onReady,
  cinematic = false,
}: {
  progress: number;
  onPush: () => void;
  onReady: () => void;
  cinematic?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const value = useRef(progress);
  const reduce = useReducedMotion();
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    value.current = progress;
  }, [progress]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const checkpoints = cinematic ? [0, 4, 8, 12, 18] : marks;
    const count = cinematic ? 19 : 15;
    const ground = cinematic ? '#090d16' : '#f2f1ea';
    const positionFor = (i: number) =>
      cinematic
        ? new THREE.Vector3(
            Math.cos(Math.PI * 0.82 - (i / (count - 1)) * Math.PI * 1.3) * 5.6,
            0,
            Math.sin(Math.PI * 0.82 - (i / (count - 1)) * Math.PI * 1.3) * 3.7,
          )
        : new THREE.Vector3((i - 7) * 0.93, 0, Math.sin((i / 14) * Math.PI * 1.55 - 0.6) * 1.45);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      const frame = requestAnimationFrame(() => setState('fallback'));
      return () => cancelAnimationFrame(frame);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = cinematic ? 1.1 : 0.85;
    renderer.setClearColor(ground, 0);
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(ground, cinematic ? 27 : 19, 48);
    const camera = new THREE.OrthographicCamera(-12, 12, 3.1, -3.1, 0.1, 70);
    const target = new THREE.Vector3(0, 0.75, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.06);
    scene.environment = environment.texture;
    scene.environmentIntensity = cinematic ? 0.55 : 0.42;
    room.dispose();
    pmrem.dispose();
    scene.add(
      new THREE.HemisphereLight(
        '#d3e1ff',
        cinematic ? '#101d36' : '#b0a68e',
        cinematic ? 0.9 : 0.7,
      ),
    );
    const light = new THREE.DirectionalLight('#fff7e8', cinematic ? 4.5 : 2.5);
    light.position.set(-5, 11, 5);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -14,
      right: 14,
      top: 12,
      bottom: -12,
      near: 0.5,
      far: 35,
    });
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = 0.025;
    light.shadow.blurSamples = 8;
    light.shadow.radius = 4;
    scene.add(light);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshBasicMaterial({ color: ground, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.045;
    scene.add(floor);
    let reflection: Reflector | undefined;
    if (cinematic) {
      reflection = new Reflector(new THREE.PlaneGeometry(100, 100), {
        textureWidth: 768,
        textureHeight: 768,
        clipBias: 0.003,
        color: 0x7f7f7f,
        multisample: 0,
      });
      const reflectiveMaterial = reflection.material as THREE.ShaderMaterial;
      reflectiveMaterial.fragmentShader = reflectiveMaterial.fragmentShader.replace(
        'vec4( blendOverlay( base.rgb, color ), 1.0 )',
        'vec4( blendOverlay( base.rgb, color ), 0.22 )',
      );
      reflection.rotation.x = -Math.PI / 2;
      reflection.position.y = -0.042;
      reflectiveMaterial.transparent = true;
      reflectiveMaterial.depthWrite = false;
      scene.add(reflection);
    }
    if (cinematic) {
      const rim = new THREE.DirectionalLight('#527dff', 4);
      rim.position.set(4, 5, -7);
      scene.add(rim);
      const orangeRim = new THREE.PointLight('#ff7030', 25, 13, 2);
      orangeRim.position.set(-4, 3, 5);
      scene.add(orangeRim);
    }
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.ShadowMaterial({ color: '#3e423f', opacity: 0.2 }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = -0.035;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);
    const geometry = new RoundedBoxGeometry(1.06, 2.85, 0.3, 3, 0.105);
    const faceGeometry = new RoundedBoxGeometry(1.015, 2.805, 0.055, 3, 0.08);
    const chassis = new THREE.MeshPhysicalMaterial({
      color: '#121820',
      metalness: 0.7,
      roughness: 0.26,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    });
    const createSlab = (material: THREE.Material) => {
      const slab = new THREE.Group();
      const body = new THREE.Mesh(geometry, chassis);
      body.castShadow = true;
      body.receiveShadow = true;
      slab.add(body);
      [-1, 1].forEach((side) => {
        const face = new THREE.Mesh(faceGeometry, material);
        face.position.z = side * 0.162;
        face.castShadow = true;
        face.receiveShadow = true;
        slab.add(face);
      });
      return slab;
    };
    const materials = ['#1649ed', '#f66a28', '#ffc83c', '#212730'].map(
      (color) =>
        new THREE.MeshPhysicalMaterial({
          color,
          metalness: 0.22,
          roughness: 0.27,
          clearcoat: 0.65,
          clearcoatRoughness: 0.23,
        }),
    );
    const pivots: THREE.Group[] = [];
    const coordinates: THREE.Vector3[] = [];
    const world = new THREE.Group();
    scene.add(world);
    for (let i = 0; i < count; i++) {
      const position = positionFor(i);
      coordinates.push(position);
      const base = new THREE.Group();
      base.position.copy(position);
      const next = positionFor(i + 1);
      base.rotation.y =
        Math.atan2(next.x - position.x, next.z - position.z) * (cinematic ? 1 : 0.78);
      const pivot = new THREE.Group();
      const material = i === 0 ? materials[1] : i === count - 1 ? materials[2] : materials[0];
      const mesh = createSlab(material);
      mesh.position.y = 1.425;
      if (cinematic && i === 0) {
        mesh.scale.setScalar(1.18);
        mesh.position.y = 1.425 * 1.18;
      }
      pivot.add(mesh);
      base.add(pivot);
      world.add(base);
      pivots.push(pivot);
    }
    const threads: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let i = 0; i < coordinates.length - 1; i++) {
      const a = coordinates[i].clone();
      a.y = 0.005;
      const b = coordinates[i + 1].clone();
      b.y = 0.005;
      const curve = new THREE.LineCurve3(a, b);
      const thread = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 1, 0.018, 5, false),
        new THREE.MeshBasicMaterial({ color: '#1649ed', transparent: true, opacity: 0.16 }),
      );
      world.add(thread);
      threads.push(thread);
    }
    const branchRecords: THREE.Group[] = [];
    const branchThreads: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] = [];
    (cinematic
      ? [new THREE.Vector3(1.8, 0, 1.3), new THREE.Vector3(4.3, 0, -0.4)]
      : [new THREE.Vector3(4.2, 0, 3.2), new THREE.Vector3(7.2, 0, 2.6)]
    ).forEach((position, index) => {
      const branch = new THREE.Group();
      branch.position.copy(position);
      const plate = createSlab(index === 0 ? materials[1] : materials[2]);
      plate.position.y = 1.425;
      plate.castShadow = true;
      branch.add(plate);
      branch.rotation.y = Math.PI / 5;
      world.add(branch);
      branchRecords.push(branch);
      const origin = coordinates[index === 0 ? checkpoints[3] : count - 1].clone();
      origin.y = 0.012;
      const end = position.clone();
      end.y = 0.012;
      const mid = origin.clone().lerp(end, 0.5);
      mid.z += 0.3;
      const thread = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([origin, mid, end]), 20, 0.019, 5, false),
        new THREE.MeshBasicMaterial({
          color: index === 0 ? '#f66a28' : '#d49b18',
          transparent: true,
          opacity: 0,
        }),
      );
      world.add(thread);
      branchThreads.push(thread);
    });
    const pointer = { x: 0, y: 0 };
    let width = 1;
    let height = 1;
    let dirty = true;
    let lastProgress = -1;
    const resize = () => {
      width = element.clientWidth;
      height = element.clientHeight;
      renderer.setSize(width, height);
      const aspect = width / height;
      const half = cinematic ? 5.8 : width < 600 ? 6.5 : width < 900 ? 4.6 : 3.6;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.position.set(
        cinematic ? 10 : width < 600 ? 15 : 8,
        cinematic ? 10 : width < 600 ? 12 : 7,
        cinematic ? 18 : width < 600 ? 6 : 19,
      );
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const move = (event: PointerEvent) => {
      if (reduce || event.pointerType === 'touch') return;
      const rect = element.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 0.65;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 0.25;
    };
    const leave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    let frame = 0;
    let visible = true;
    let disposed = false;
    let last = 0;
    const start = performance.now();
    const render = (time: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      if (!visible || document.hidden || time - last < 32) return;
      last = time;
      const p = value.current / 100;
      const moving =
        Math.abs(pointer.x - world.rotation.y) > 0.0005 ||
        Math.abs(pointer.y * 0.15 - world.rotation.x) > 0.0005;
      if (!dirty && time - start > 1600 && !moving && p === lastProgress) return;
      dirty = false;
      lastProgress = p;
      const arrive = reduce ? 1 : ease((time - start) / 1100);
      world.rotation.y += (pointer.x - world.rotation.y) * 0.075;
      world.rotation.x += (pointer.y * 0.15 - world.rotation.x) * 0.075;
      pivots.forEach((pivot, i) => {
        const fall = ease((p - i * (cinematic ? 0.027 : 0.035) - 0.025) / 0.17);
        const resolution = ease((p - 0.72) / 0.28);
        const resolve = checkpoints.includes(i) ? resolution : 0;
        pivot.rotation.x = reduce ? 0 : fall * 1.18 * (1 - resolve);
        pivot.scale.setScalar(checkpoints.includes(i) ? 1 : Math.max(0.001, 1 - resolution));
        pivot.position.y =
          (reduce ? 0 : (1 - ease((arrive - i * 0.018) / 0.65)) * -3.6) -
          (checkpoints.includes(i) ? 0 : resolution * 0.25);
      });
      threads.forEach((thread, i) => {
        thread.material.opacity = p > i / 17 ? 0.85 : 0.12;
      });
      branchRecords.forEach((branch, index) => {
        const reveal = ease((p - 0.64 - index * 0.08) / 0.2);
        branch.scale.setScalar(reveal * 0.65);
        branch.visible = reveal > 0.001;
        branchThreads[index].material.opacity = reveal * 0.9;
      });
      scene.updateMatrixWorld();
      camera.lookAt(target);
      checkpoints.forEach((mark, i) => {
        const label = labels.current[i];
        if (!label) return;
        const point = new THREE.Vector3();
        pivots[mark].getWorldPosition(point);
        point.y += 0.03;
        point.project(camera);
        label.style.transform = `translate(${((point.x + 1) * width) / 2}px,${((-point.y + 1) * height) / 2 + 23}px) translate(-50%,0)`;
        label.style.opacity = String(arrive > 0.7 ? 1 : 0);
      });
      renderer.render(scene, camera);
    };
    const visibility = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
      },
      { rootMargin: '80px' },
    );
    visibility.observe(element);
    frame = requestAnimationFrame(render);
    const readyFrame = requestAnimationFrame(() => {
      setState('ready');
      onReady();
    });
    const lost = () => {
      visible = false;
      setState('fallback');
    };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(readyFrame);
      observer.disconnect();
      visibility.disconnect();
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach((material) => material.dispose());
        }
      });
      environment.dispose();
      reflection?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reduce, onReady, cinematic]);
  return (
    <div className={`domino-world ${cinematic ? 'scene-cinematic' : ''} scene-is-${state}`}>
      <img
        className="scene-fallback"
        src={cinematic ? '/assets/domino-midnight.webp' : '/assets/domino-hero.webp'}
        alt="A sculptural illustrative chain reaction"
      />
      <div
        ref={host}
        className="webgl-stage"
        role="img"
        aria-label="Interactive illustrative domino chain. An initial nudge propagates through the chain and resolves into connected records."
      />
      {state === 'ready' && (
        <div className="world-labels" aria-hidden="true">
          {stages.map((label, i) => (
            <span
              key={label}
              ref={(el) => {
                labels.current[i] = el;
              }}
            >
              <b>0{i + 1}</b>
              {label}
            </span>
          ))}
        </div>
      )}
      <button className="world-nudge" onClick={onPush}>
        <span className="nudge-mark" />
        Push the first domino <span>↗</span>
      </button>
      <span className="world-caption">
        {state === 'fallback' ? 'STATIC ART · WEBGL UNAVAILABLE' : 'LIVE 3D STUDY'} / ILLUSTRATIVE,
        NOT REPOSITORY DATA
      </span>
    </div>
  );
}

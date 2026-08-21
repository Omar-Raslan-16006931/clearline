import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * A calm, warm 3D signature object: a faceted icosahedron with a soft wireframe
 * shell, slowly rotating with a gentle float and subtle pointer parallax.
 * Transparent canvas, respects prefers-reduced-motion, cleans itself up.
 */
export function HeroObject({ className = '' }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (e) {
      return; // no WebGL → hero just stays empty
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 6);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const group = new THREE.Group();
    scene.add(group);

    // Solid faceted core.
    const geo = new THREE.IcosahedronGeometry(1.7, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6d38e0,
      emissive: 0x2a0f6b,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.35,
      flatShading: true,
    });
    const core = new THREE.Mesh(geo, mat);
    group.add(core);

    // Wireframe shell, slightly larger, violet and faint.
    const shellGeo = new THREE.IcosahedronGeometry(2.05, 1);
    const shell = new THREE.LineSegments(
      new THREE.WireframeGeometry(shellGeo),
      new THREE.LineBasicMaterial({ color: 0xb69bff, transparent: true, opacity: 0.32 }),
    );
    group.add(shell);

    // Lighting: cool violet key + magenta rim for a space feel.
    const key = new THREE.DirectionalLight(0xd8c7ff, 2.6);
    key.position.set(4, 5, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5ed0, 1.1);
    rim.position.set(-5, -2, -3);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x14092e, 1.2));

    // Pointer parallax.
    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = mount.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.6;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 0.6;
    };
    window.addEventListener('pointermove', onMove);

    let scrollY = window.scrollY || 0;
    const onScroll = () => { scrollY = window.scrollY || 0; };
    window.addEventListener('scroll', onScroll, { passive: true });

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const start = performance.now();
    const render = () => {
      const t = (performance.now() - start) / 1000;
      if (!reduce) {
        group.rotation.y += 0.003;
        group.rotation.x = scrollY * 0.0016;          // scroll drives the tilt
        shell.rotation.y -= 0.002;
        group.position.y = Math.sin(t * 0.8) * 0.12 - scrollY * 0.0009; // and drifts
        group.rotation.z = target.x * 0.25;
        camera.position.x += (target.x * 1.2 - camera.position.x) * 0.04;
        camera.position.y += (-target.y * 1.2 - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      shellGeo.dispose();
      (shell.geometry as THREE.BufferGeometry).dispose();
      (shell.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className={className} aria-hidden="true" />;
}

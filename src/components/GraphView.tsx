import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import type { GraphData, GraphNode, GraphLink } from '../lib/graph-builder';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ViewOptions, LabelMode } from '../lib/viewOptions';
import { DEFAULT_VIEW_OPTIONS } from '../lib/viewOptions';

// Re-export so callers don't have to know the type moved into viewOptions.ts.
export type { LabelMode } from '../lib/viewOptions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface TextSpriteOpts {
  fontSize: number;
  color: string;
  padding: number;
  scale: number;
}

function createTextSprite(text: string, opts: TextSpriteOpts): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${opts.fontSize}px "SF Mono", "Fira Code", monospace`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  canvas.width = textWidth + opts.padding * 2;
  canvas.height = opts.fontSize + opts.padding;
  ctx.font = font;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, opts.padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(aspect * opts.scale, opts.scale, 1);
  return sprite;
}

export interface GraphViewHandle {
  fit: () => void;
  togglePause: () => void;
  isPaused: () => boolean;
}

interface GraphViewProps {
  data: GraphData | null;
  onNodeClick?: (nodeId: string) => void;
  labelMode?: LabelMode;
  viewOptions?: ViewOptions;
}

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(function GraphView(
  { data, onNodeClick, labelMode, viewOptions },
  ref,
) {
  // viewOptions takes precedence; fall back to a minimal shape built from
  // the legacy labelMode prop so older callers keep working.
  const effectiveOptions: ViewOptions = viewOptions ?? {
    ...DEFAULT_VIEW_OPTIONS,
    labelMode: labelMode ?? DEFAULT_VIEW_OPTIONS.labelMode,
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const labelModeRef = useRef<LabelMode>(effectiveOptions.labelMode);
  labelModeRef.current = effectiveOptions.labelMode;

  // Keep live options in a ref so the animation loop & accessor fns read
  // the latest values without re-creating the ForceGraph instance.
  const optionsRef = useRef(effectiveOptions);
  optionsRef.current = effectiveOptions;

  const sharedSpheresRef = useRef(new Map<number, THREE.SphereGeometry>());
  const sharedBoxesRef = useRef(new Map<number, RoundedBoxGeometry>());
  const sharedMaterialsRef = useRef(new Map<string, THREE.MeshPhongMaterial>());
  const disposablesRef = useRef<(THREE.BufferGeometry | THREE.Material | THREE.Texture)[]>([]);
  const nodeLabelSpritesRef = useRef(new Map<string, THREE.Sprite>());
  const lightsRef = useRef<{ ambient: THREE.AmbientLight; point: THREE.PointLight } | null>(null);
  const labelRafRef = useRef(0);
  const resizeRafRef = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const centerGlowRef = useRef<THREE.MeshBasicMaterial[]>([]);

  // Hover-highlight: highlightId mutates on hover; accessors below read it.
  const highlightIdRef = useRef<string | null>(null);

  // Force multipliers' baselines, captured at graph build, so slider
  // updates can scale them without rebuilding the instance.
  const baseChargeRef = useRef(-40);
  const baseLinkDistRef = useRef(15);

  // Bloom post-processing pass (lazy-loaded). Tracked so we can remove on disable.
  const bloomPassRef = useRef<unknown | null>(null);
  const pausedRef = useRef(false);

  // Auto-rotate state. Angle advances each frame when enabled; radius is
  // captured from the initial camera distance so the orbit stays the size
  // the auto-layout chose. lastTsRef gives us a frame delta.
  const autoRotateAngleRef = useRef(0);
  const autoRotateRadiusRef = useRef(150);
  const autoRotateLastTsRef = useRef(0);

  const cleanupAll = useCallback(() => {
    cancelAnimationFrame(labelRafRef.current);
    labelRafRef.current = 0;
    cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = 0;
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (lightsRef.current) {
      if (graphRef.current) {
        const scene = graphRef.current.scene();
        scene.remove(lightsRef.current.ambient);
        scene.remove(lightsRef.current.point);
      }
      lightsRef.current.ambient.dispose();
      lightsRef.current.point.dispose();
      lightsRef.current = null;
    }
    disposablesRef.current.forEach((d) => d.dispose());
    disposablesRef.current = [];
    sharedSpheresRef.current.forEach((g) => g.dispose());
    sharedSpheresRef.current.clear();
    sharedBoxesRef.current.forEach((g) => g.dispose());
    sharedBoxesRef.current.clear();
    sharedMaterialsRef.current.forEach((m) => m.dispose());
    sharedMaterialsRef.current.clear();
    nodeLabelSpritesRef.current.clear();
    centerGlowRef.current = [];
    highlightIdRef.current = null;
    bloomPassRef.current = null;
    pausedRef.current = false;
    if (graphRef.current) {
      try { (graphRef.current as Any)._destructor(); } catch { /* already disposed */ }
      graphRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanupAll(), [cleanupAll]);

  // Imperative API consumed by the parent (Fit / Pause buttons in the panel).
  useImperativeHandle(ref, () => ({
    fit: () => {
      graphRef.current?.zoomToFit(800, 50);
    },
    togglePause: () => {
      const g = graphRef.current;
      if (!g) return;
      if (pausedRef.current) {
        g.resumeAnimation();
        pausedRef.current = false;
      } else {
        g.pauseAnimation();
        pausedRef.current = true;
      }
    },
    isPaused: () => pausedRef.current,
  }), []);

  // Rebuild the graph when data or layout-mode changes. Other view options
  // are applied via the small effects below without re-creating the instance.
  useEffect(() => {
    if (!containerRef.current) return;

    if (!data || data.nodes.length === 0) {
      cleanupAll();
      return;
    }

    cleanupAll();

    const n = data.nodes.length;
    const sharedSpheres = sharedSpheresRef.current;
    const sharedBoxes = sharedBoxesRef.current;
    const sharedMaterials = sharedMaterialsRef.current;
    const disposables = disposablesRef.current;
    const nodeLabelSprites = nodeLabelSpritesRef.current;
    const pairCount = new Map<string, number>();

    for (const link of data.links) {
      const key = [link.source, link.target].sort().join('\t');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }

    const linkRotations = new Map<object, number>();
    const rotCounters = new Map<string, number>();
    for (const link of data.links) {
      const key = [link.source, link.target].sort().join('\t');
      if ((pairCount.get(key) ?? 1) <= 1) continue;
      const idx = rotCounters.get(key) ?? 0;
      rotCounters.set(key, idx + 1);
      linkRotations.set(link, idx * (Math.PI / 3));
    }

    function getSphereGeometry(radius: number): THREE.SphereGeometry {
      const key = Math.round(radius * 100);
      let geom = sharedSpheres.get(key);
      if (!geom) {
        geom = new THREE.SphereGeometry(radius, 20, 14);
        sharedSpheres.set(key, geom);
      }
      return geom;
    }

    function getBoxGeometry(size: number): RoundedBoxGeometry {
      const key = Math.round(size * 100);
      let geom = sharedBoxes.get(key);
      if (!geom) {
        geom = new RoundedBoxGeometry(size, size, size, 2, size * 0.2);
        sharedBoxes.set(key, geom);
      }
      return geom;
    }

    function getNodeMaterial(color: string): THREE.MeshPhongMaterial {
      let mat = sharedMaterials.get(color);
      if (!mat) {
        mat = new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.25,
          shininess: 80,
          specular: 0x444444,
          transparent: true,
          opacity: 0.9,
        });
        sharedMaterials.set(color, mat);
      }
      return mat;
    }

    function isIncidentToHighlight(link: GraphLink): boolean {
      const hid = highlightIdRef.current;
      if (!hid) return true;
      const s = typeof link.source === 'string'
        ? link.source : (link.source as { id: string }).id;
      const t = typeof link.target === 'string'
        ? link.target : (link.target as { id: string }).id;
      return s === hid || t === hid;
    }

    const graph = new ForceGraph3D(containerRef.current)
      .backgroundColor('#0000')
      .graphData(data as Any)
      .nodeId('id')
      .nodeVal('val')
      .nodeLabel('id')
      .nodeColor('color')
      .nodeThreeObject((_obj: Any) => {
        const node = _obj as GraphNode;
        const radius = Math.cbrt(node.val) * 2;
        const isLiteral = node.source === 'literal';

        const geometry = isLiteral
          ? getBoxGeometry(radius * 1.6)
          : getSphereGeometry(radius);

        const group = new THREE.Group();

        if (node.isCenter) {
          const centerMat = new THREE.MeshBasicMaterial({
            color: node.color,
            transparent: true,
            opacity: 0.95,
          });
          disposables.push(centerMat);
          group.add(new THREE.Mesh(geometry, centerMat));

          const glowMats: THREE.MeshBasicMaterial[] = [];
          for (const [scale, opacity] of [[1.5, 0.18], [2.0, 0.1], [2.8, 0.05]] as const) {
            const glowGeom = getSphereGeometry(radius * scale);
            const glowMat = new THREE.MeshBasicMaterial({
              color: node.color,
              transparent: true,
              opacity,
              depthWrite: false,
            });
            disposables.push(glowMat);
            glowMats.push(glowMat);
            group.add(new THREE.Mesh(glowGeom, glowMat));
          }
          centerGlowRef.current = glowMats;
        } else {
          group.add(new THREE.Mesh(geometry, getNodeMaterial(node.color)));
        }

        const label = createTextSprite(node.label, {
          fontSize: node.isCenter ? 48 : 36,
          color: node.isCenter ? '#c8d6e5' : '#8b949e',
          padding: 10,
          scale: node.isCenter ? 5 : 3.5,
        });
        const spriteMat = label.material as THREE.SpriteMaterial;
        if (spriteMat.map) disposables.push(spriteMat.map);
        disposables.push(spriteMat);

        label.position.y = radius + (node.isCenter ? 4 : 3);
        group.add(label);

        if (!node.isCenter) {
          nodeLabelSprites.set(node.id, label);
        }

        return group;
      })
      .nodeThreeObjectExtend(false)
      .linkSource('source')
      .linkTarget('target')
      .linkColor('color')
      .linkOpacity(0.6)
      .linkWidth((link: Any) => {
        const opts = optionsRef.current;
        if (!opts.highlightNeighbors || !highlightIdRef.current) return 0.5;
        return isIncidentToHighlight(link as GraphLink) ? 1.6 : 0.2;
      })
      .linkCurvature((link: Any) => {
        const key = [
          link.source?.id ?? link.source,
          link.target?.id ?? link.target,
        ].sort().join('\t');
        return (pairCount.get(key) ?? 1) > 1 ? 0.2 : 0;
      })
      .linkCurveRotation((link: Any) => linkRotations.get(link) ?? 0)
      .linkDirectionalArrowLength(3.5)
      .linkDirectionalArrowRelPos(0.5)
      .linkDirectionalArrowColor('color')
      .linkLabel('label')
      // Particles: count read fresh from optionsRef every refresh().
      .linkDirectionalParticles(() => (optionsRef.current.particles ? 2 : 0))
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(1.2)
      .linkDirectionalParticleColor('color')
      .onNodeClick((_obj: Any) => {
        const node = _obj as GraphNode;
        onNodeClickRef.current?.(node.id);
      })
      .onNodeHover((_obj: Any) => {
        if (containerRef.current) {
          containerRef.current.style.cursor = _obj ? 'pointer' : 'default';
        }
        if (!optionsRef.current.highlightNeighbors) {
          if (highlightIdRef.current !== null) {
            highlightIdRef.current = null;
            graphRef.current?.refresh();
          }
          return;
        }
        const next = _obj ? (_obj as GraphNode).id : null;
        if (next !== highlightIdRef.current) {
          highlightIdRef.current = next;
          graphRef.current?.refresh();
        }
      })
      .showNavInfo(false)
      .warmupTicks(Math.min(40 + n, 120))
      .cooldownTicks(Math.min(80 + n, 200));

    // DAG layout (radial / top-down). Tolerate cycles by swallowing the error.
    const layout = optionsRef.current.layout;
    if (layout !== 'force') {
      graph.dagMode(layout as Any);
      graph.onDagError(() => undefined);
    }

    // --- Lighting ---
    const scene = graph.scene();
    const ambientLight = new THREE.AmbientLight(0xbbbbbb, 0.8);
    const pointLight = new THREE.PointLight(0xffffff, 1, 0);
    pointLight.position.set(200, 200, 200);
    scene.add(ambientLight);
    scene.add(pointLight);
    lightsRef.current = { ambient: ambientLight, point: pointLight };

    // --- Adaptive forces (multiplied by user-tunable scalars) ---
    const sqrtN = Math.sqrt(n);
    const baseCharge = -40 - sqrtN * 4;
    const baseLinkDist = 15 + sqrtN * 2;
    baseChargeRef.current = baseCharge;
    baseLinkDistRef.current = baseLinkDist;
    const opts0 = optionsRef.current;
    (graph.d3Force('charge') as Any)?.strength(baseCharge * opts0.chargeMul)
      .distanceMax(120 + sqrtN * 20);
    (graph.d3Force('link') as Any)?.distance(baseLinkDist * opts0.linkDistanceMul).strength(0.4);
    (graph.d3Force('center') as Any)?.strength(0.05);

    const distance = 80 + sqrtN * 22;
    graph.cameraPosition({ x: 0, y: 0, z: distance });
    autoRotateRadiusRef.current = distance;
    autoRotateAngleRef.current = 0;
    autoRotateLastTsRef.current = 0;

    if (opts0.bloom) {
      void enableBloom(graph, bloomPassRef);
    }

    // --- Animation loop: label visibility + glow pulse ---
    const _camDir = new THREE.Vector3();
    const _nodePos = new THREE.Vector3();
    const _depthSprites: THREE.Sprite[] = [];
    const _depthValues: number[] = [];

    function updateLoop() {
      labelRafRef.current = requestAnimationFrame(updateLoop);

      // Manual auto-orbit: TrackballControls (3d-force-graph default) has no
      // built-in autoRotate, so we drive the camera around the Y axis here.
      // We mutate camera.position directly to avoid kicking off the cameraPosition
      // tween every frame.
      if (optionsRef.current.autoRotate && graphRef.current) {
        const now = performance.now();
        const last = autoRotateLastTsRef.current || now;
        const dt = Math.min(now - last, 100); // clamp tab-switch jumps
        autoRotateLastTsRef.current = now;
        autoRotateAngleRef.current += dt * 0.0004; // ~radians/ms -> ~13deg/sec

        const cam = graphRef.current.camera();
        // Preserve current radius (user may have zoomed) and tilt (y).
        const r = Math.hypot(cam.position.x, cam.position.z) || autoRotateRadiusRef.current;
        cam.position.x = r * Math.sin(autoRotateAngleRef.current);
        cam.position.z = r * Math.cos(autoRotateAngleRef.current);
        cam.lookAt(0, 0, 0);
      } else {
        autoRotateLastTsRef.current = 0;
      }

      const glowMats = centerGlowRef.current;
      if (glowMats.length > 0) {
        const pulse = Math.sin(performance.now() * 0.003) * 0.5 + 0.5;
        const base = [0.18, 0.10, 0.05];
        for (let i = 0; i < glowMats.length; i++) {
          glowMats[i].opacity = base[i] * (0.4 + 1.2 * pulse);
        }
      }

      const sprites = nodeLabelSpritesRef.current;
      if (sprites.size === 0) return;

      const mode = labelModeRef.current;
      if (mode === 'none') {
        for (const s of sprites.values()) s.visible = false;
        return;
      }
      if (mode === 'all') {
        for (const s of sprites.values()) s.visible = true;
        return;
      }

      const g = graphRef.current;
      if (!g) return;
      g.camera().getWorldDirection(_camDir);

      const currentNodes = g.graphData().nodes as GraphNode[];
      let minD = Infinity;
      let maxD = -Infinity;
      _depthSprites.length = 0;
      _depthValues.length = 0;

      for (const nd of currentNodes) {
        if (nd.isCenter) continue;
        const sprite = sprites.get(nd.id);
        if (!sprite) continue;
        if (nd.x == null) { sprite.visible = true; continue; }
        _nodePos.set(nd.x!, nd.y!, nd.z!);
        const d = _nodePos.dot(_camDir);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
        _depthSprites.push(sprite);
        _depthValues.push(d);
      }

      const range = maxD - minD;
      const mid = (minD + maxD) / 2;
      const band = range * 0.2;

      for (let i = 0; i < _depthSprites.length; i++) {
        _depthSprites[i].visible = range < 0.01 || Math.abs(_depthValues[i] - mid) <= band;
      }
    }
    updateLoop();

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        if (containerRef.current) {
          const { width, height } = containerRef.current.getBoundingClientRect();
          graph.width(width).height(height);
        }
      });
    });
    ro.observe(containerRef.current);
    roRef.current = ro;

    graphRef.current = graph;
    // The `layout` dep below intentionally rebuilds the graph when toggled
    // because dagMode changes require a fresh simulation pass.
  }, [data, cleanupAll, effectiveOptions.layout]);

  // Live-apply view options that don't need a rebuild.
  useEffect(() => {
    // Re-seed the angle from the current camera position so toggling on
    // doesn't snap the camera somewhere unexpected.
    const g = graphRef.current;
    if (!g) return;
    if (effectiveOptions.autoRotate) {
      const cam = g.camera();
      autoRotateAngleRef.current = Math.atan2(cam.position.x, cam.position.z);
      autoRotateLastTsRef.current = 0;
    }
  }, [effectiveOptions.autoRotate]);

  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    (g.d3Force('charge') as Any)?.strength(baseChargeRef.current * effectiveOptions.chargeMul);
    (g.d3Force('link') as Any)?.distance(baseLinkDistRef.current * effectiveOptions.linkDistanceMul);
    g.d3ReheatSimulation();
  }, [effectiveOptions.chargeMul, effectiveOptions.linkDistanceMul]);

  // Particles + highlight changes don't need full rebuild — just refresh()
  // so the accessor functions are re-evaluated.
  useEffect(() => {
    graphRef.current?.refresh();
  }, [effectiveOptions.particles, effectiveOptions.highlightNeighbors]);

  // Bloom: lazy-load on enable, remove on disable. The lazy import keeps
  // the postprocessing modules out of the cold-start bundle.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    if (effectiveOptions.bloom) {
      void enableBloom(g, bloomPassRef);
    } else {
      disableBloom(g, bloomPassRef);
    }
  }, [effectiveOptions.bloom]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
});

function applyAutoRotate(_graph: ForceGraph3DInstance, _on: boolean): void {
  // Auto-rotate is driven manually inside the rAF loop in GraphView so we
  // don't depend on the controls type (TrackballControls has no autoRotate).
  // Kept as a no-op shim in case any external caller still references it.
}

async function enableBloom(
  graph: ForceGraph3DInstance,
  passRef: React.MutableRefObject<unknown | null>,
): Promise<void> {
  if (passRef.current) return;
  const [{ UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
  ]);
  const composer = graph.postProcessingComposer() as Any;
  const renderer = composer.renderer as THREE.WebGLRenderer;
  const w = renderer.domElement.clientWidth || 800;
  const h = renderer.domElement.clientHeight || 600;
  const pass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.85);
  composer.addPass(pass);
  // OutputPass keeps colors correct when bloom is the last pass.
  const output = new OutputPass();
  composer.addPass(output);
  passRef.current = { bloom: pass, output };
}

function disableBloom(
  graph: ForceGraph3DInstance,
  passRef: React.MutableRefObject<unknown | null>,
): void {
  if (!passRef.current) return;
  const composer = graph.postProcessingComposer() as Any;
  const { bloom, output } = passRef.current as { bloom: Any; output: Any };
  try { composer.removePass(bloom); } catch { /* ignore */ }
  try { composer.removePass(output); } catch { /* ignore */ }
  try { bloom.dispose?.(); } catch { /* ignore */ }
  try { output.dispose?.(); } catch { /* ignore */ }
  passRef.current = null;
}

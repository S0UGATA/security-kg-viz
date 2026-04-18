import { useEffect, useRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import type { GraphData, GraphNode } from '../lib/graph-builder';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

export type LabelMode = 'auto' | 'all' | 'none';

interface GraphViewProps {
  data: GraphData | null;
  onNodeClick?: (nodeId: string) => void;
  labelMode?: LabelMode;
}

export function GraphView({ data, onNodeClick, labelMode = 'auto' }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const labelModeRef = useRef(labelMode);
  labelModeRef.current = labelMode;

  useEffect(() => {
    if (!containerRef.current) return;

    function destroyGraph() {
      if (graphRef.current) {
        try { graphRef.current._destructor(); } catch { /* already disposed */ }
        graphRef.current = null;
      }
    }

    if (!data || data.nodes.length === 0) {
      destroyGraph();
      return;
    }

    destroyGraph();

    const n = data.nodes.length;
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // --- Geometry pools ---
    const sharedSpheres = new Map<number, THREE.SphereGeometry>();
    const sharedBoxes = new Map<number, RoundedBoxGeometry>();

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

    // --- Material pool ---
    const sharedMaterials = new Map<string, THREE.MeshPhongMaterial>();

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

    // --- Multi-edge tracking for curvature + rotation ---
    const pairCount = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    for (const link of data.links) {
      const key = [link.source, link.target].sort().join('\t');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }

    const nodeLabels: { node: GraphNode; sprite: THREE.Sprite }[] = [];

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

          for (const [scale, opacity] of [[1.5, 0.18], [2.0, 0.1], [2.8, 0.05]] as const) {
            const glowGeom = getSphereGeometry(radius * scale);
            const glowMat = new THREE.MeshBasicMaterial({
              color: node.color,
              transparent: true,
              opacity,
              depthWrite: false,
            });
            disposables.push(glowMat);
            group.add(new THREE.Mesh(glowGeom, glowMat));
          }
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

        if (!node.isCenter) nodeLabels.push({ node, sprite: label });

        return group;
      })
      .nodeThreeObjectExtend(false)
      .linkSource('source')
      .linkTarget('target')
      .linkColor('color')
      .linkWidth(0.5)
      .linkOpacity(0.6)
      .linkCurvature((link: Any) => {
        const key = [link.source?.id ?? link.source, link.target?.id ?? link.target].sort().join('\t');
        return (pairCount.get(key) ?? 1) > 1 ? 0.2 : 0;
      })
      .linkCurveRotation((link: Any) => {
        const key = [link.source?.id ?? link.source, link.target?.id ?? link.target].sort().join('\t');
        if ((pairCount.get(key) ?? 1) <= 1) return 0;
        const idx = pairIndex.get(key) ?? 0;
        pairIndex.set(key, idx + 1);
        return idx * (Math.PI / 3);
      })
      .linkDirectionalArrowLength(3.5)
      .linkDirectionalArrowRelPos(0.5)
      .linkDirectionalArrowColor('color')
      .linkLabel('label')
      .onNodeClick((_obj: Any) => {
        const node = _obj as GraphNode;
        onNodeClickRef.current?.(node.id);
      })
      .onNodeHover((_obj: Any) => {
        if (containerRef.current) {
          containerRef.current.style.cursor = _obj ? 'pointer' : 'default';
        }
      })
      .showNavInfo(false)
      .warmupTicks(Math.min(40 + n, 120))
      .cooldownTicks(Math.min(80 + n, 200));

    // --- Lighting ---
    const scene = graph.scene();
    const ambientLight = new THREE.AmbientLight(0xbbbbbb, 0.8);
    const pointLight = new THREE.PointLight(0xffffff, 1, 0);
    pointLight.position.set(200, 200, 200);
    scene.add(ambientLight);
    scene.add(pointLight);

    // --- Adaptive forces ---
    const sqrtN = Math.sqrt(n);
    graph.d3Force('charge')?.strength(-40 - sqrtN * 4).distanceMax(120 + sqrtN * 20);
    graph.d3Force('link')?.distance(15 + sqrtN * 2).strength(0.4);
    graph.d3Force('center')?.strength(0.05);

    const distance = 80 + sqrtN * 22;
    graph.cameraPosition({ x: 0, y: 0, z: distance });

    // --- Label visibility loop ---
    const _camDir = new THREE.Vector3();
    const _nodePos = new THREE.Vector3();
    let depthBuf = new Float64Array(0);
    let labelRaf = 0;

    function updateLabels() {
      labelRaf = requestAnimationFrame(updateLabels);
      if (nodeLabels.length === 0) return;

      const mode = labelModeRef.current;

      if (mode === 'none') {
        for (const { sprite } of nodeLabels) sprite.visible = false;
        return;
      }

      if (mode === 'all') {
        for (const { sprite } of nodeLabels) sprite.visible = true;
        return;
      }

      graph.camera().getWorldDirection(_camDir);

      let minD = Infinity;
      let maxD = -Infinity;
      const len = nodeLabels.length;
      if (depthBuf.length < len) depthBuf = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        const nd = nodeLabels[i].node;
        if (nd.x == null) { depthBuf[i] = 0; continue; }
        _nodePos.set(nd.x!, nd.y!, nd.z!);
        const d = _nodePos.dot(_camDir);
        depthBuf[i] = d;
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }

      const range = maxD - minD;
      const mid = (minD + maxD) / 2;
      const band = range * 0.2;

      for (let i = 0; i < len; i++) {
        nodeLabels[i].sprite.visible = range < 0.01 || Math.abs(depthBuf[i] - mid) <= band;
      }
    }
    updateLabels();

    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (containerRef.current) {
          const { width, height } = containerRef.current.getBoundingClientRect();
          graph.width(width).height(height);
        }
      });
    });
    ro.observe(containerRef.current);

    graphRef.current = graph;

    return () => {
      cancelAnimationFrame(labelRaf);
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      scene.remove(ambientLight);
      scene.remove(pointLight);
      ambientLight.dispose();
      pointLight.dispose();
      disposables.forEach((d) => d.dispose());
      sharedSpheres.forEach((g) => g.dispose());
      sharedSpheres.clear();
      sharedBoxes.forEach((g) => g.dispose());
      sharedBoxes.clear();
      sharedMaterials.forEach((m) => m.dispose());
      sharedMaterials.clear();
      destroyGraph();
    };
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

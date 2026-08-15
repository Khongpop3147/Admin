"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { BASE_PATH } from "../lib/basePath";
import type { GrowthStage } from "../lib/petCatalog";

// Real, rotatable 3D — react-three-fiber's <Canvas> defers all WebGL/window
// access to an effect after mount, so this is safe to render under Next.js
// App Router SSR with just "use client" (no next/dynamic ssr:false needed).
// Every species is a real user-supplied .glb model served from
// public/models/ — an earlier hand-sculpted (procedural primitive)
// version existed for species without a real model yet, but was removed
// once every catalog species had one; SPECIES in lib/petCatalog.ts should
// only ever list species with an entry in GLTF_MODEL_PATHS below.

export interface Pet3DProps {
  species: string;
  stage: GrowthStage;
  size?: number;
}

// --- Real sculpted models (user-supplied .glb, served from public/models/)
// --- A separate model per growth stage (not one model rescaled) — a baby
// and an adult cat aren't just size differences, they're different
// proportions/sculpts, so each stage gets its own file when one's supplied.
const GLTF_MODEL_PATHS: Partial<Record<string, Partial<Record<GrowthStage, string>>>> = {
  CAT: {
    baby: `${BASE_PATH}/models/cat.glb`,
    adult: `${BASE_PATH}/models/cat-adult.glb`,
  },
  DOG: {
    baby: `${BASE_PATH}/models/dog.glb`,
    adult: `${BASE_PATH}/models/dog-adult.glb`,
  },
};

// Per-stage models are separately authored assets, not guaranteed to share
// the same native scale/units — this corrects each to look right next to
// the others, tuned by eye per model rather than derived from anything.
const GLTF_STAGE_SCALE: Record<GrowthStage, number> = {
  baby: 0.75,
  adult: 1,
};

// Deliberately no useGLTF.preload() at module scope — this file (via
// PetCorner) loads on every visit to Order Entry, the single most-loaded
// page in the app, for every admin whether or not they've ever touched the
// pet feature. Eagerly preloading all 4 species/stage combos downloaded
// ~28MB on every such visit; useGLTF's own Suspense-driven lazy load below
// already fetches only the one model actually being shown, right when it's
// needed.
function GltfPetModel({ modelPath, stage }: { modelPath: string; stage: GrowthStage }) {
  const { scene } = useGLTF(modelPath);
  // useGLTF caches and returns the SAME scene object across every caller —
  // reusing it directly would break the moment two instances render at
  // once (e.g. the main viewer plus this species' own preview thumbnail in
  // the "change species" picker), since a Three.js object can only live in
  // one place in the scene graph at a time. Clone per-instance instead.
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  return <primitive object={clonedScene} scale={GLTF_STAGE_SCALE[stage]} position={[0, 0, 0]} />;
}

function PlaceholderMesh() {
  return (
    <mesh position={[0, 0.6, 0]}>
      <sphereGeometry args={[0.45, 16, 16]} />
      <meshStandardMaterial color="#3a3f4b" />
    </mesh>
  );
}

export function PetModel({ species, stage }: Omit<Pet3DProps, "size">) {
  const modelPath = GLTF_MODEL_PATHS[species]?.[stage];

  return modelPath ? (
    <Suspense fallback={<PlaceholderMesh />}>
      <GltfPetModel modelPath={modelPath} stage={stage} />
    </Suspense>
  ) : (
    <PlaceholderMesh />
  );
}

export default function Pet3D({ species, stage, size = 320 }: Pet3DProps) {
  return (
    <div style={{ width: size, height: size, borderRadius: "16px", overflow: "hidden", background: "radial-gradient(circle at 50% 30%, rgba(88,166,255,0.08), transparent 70%)" }}>
      <Canvas camera={{ position: [0, 1.2, 4], fov: 46 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 2]} intensity={1} />
        <directionalLight position={[-3, 2, -2]} intensity={0.3} />
        <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.4, 32]} />
          <meshStandardMaterial color="#1c2028" />
        </mesh>
        <PetModel species={species} stage={stage} />
        <OrbitControls autoRotate autoRotateSpeed={1.2} enableZoom={true} enablePan={false} minDistance={2.5} maxDistance={6} target={[0, 0.7, 0]} />
      </Canvas>
    </div>
  );
}

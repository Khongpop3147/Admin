"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useRouter } from "next/navigation";
import type { Group } from "three";
import { useUser } from "./UserProvider";
import { BASE_PATH } from "../lib/basePath";
import type { GrowthStage } from "../lib/petCatalog";
import { getPetCornerEnabled } from "../lib/petCornerPref";
import { PetModel } from "./Pet3D";

interface PetInfo {
  species: string;
  growthStage: GrowthStage;
}

// How far left/right the model can be dragged (world units), and how many
// screen pixels of drag equal one of those units — both tuned by eye so a
// full-width drag roughly reaches the bound without feeling stiff or
// letting the model drag off past the edge of its own small frame.
const DRAG_BOUND = 0.8;
const DRAG_PIXELS_PER_UNIT = 130;
// Pointer movement below this (px) on release counts as a click-through to
// /pets rather than a drag, so the widget stays clickable like before.
const CLICK_MOVE_THRESHOLD = 4;

// A small always-visible mascot above the "คลังหมูของฉัน" panel on /orders
// — reuses the same GLTF pipeline as the full /pets viewer
// (components/Pet3D.tsx's PetModel) so species/stage always stay in sync
// with whatever's shown there, just rendered smaller with no orbit
// controls, and draggable left/right with the mouse/touch instead. Renders
// nothing until the admin has actually picked a pet.
//
// Deliberately laid out in-flow (not position: fixed) — an earlier fixed
// corner overlay sat on top of the stock panel's own numbers on tall order
// lists, since that panel already fills the viewport down to its edge.
// Taking its own space above the panel instead means it can never cover
// real data, at the cost of nudging the panel down slightly.
export default function PetCorner() {
  const { currentUser } = useUser();
  const router = useRouter();
  const [pet, setPet] = useState<PetInfo | null>(null);
  // Starts true (matching the SSR/first-render value) and corrects itself
  // right after mount — avoids a hydration mismatch from reading
  // localStorage during render, same reasoning as the `pet` fetch below.
  const [enabled, setEnabled] = useState(true);
  const groupRef = useRef<Group>(null);
  const dragState = useRef<{ startClientX: number; startX: number; moved: number } | null>(null);

  useEffect(() => {
    setEnabled(getPetCornerEnabled());
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    fetch(`${BASE_PATH}/api/pets`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.pet) return;
        setPet({ species: data.pet.species, growthStage: data.growthStage });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  if (!pet || !enabled) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startClientX: e.clientX, startX: groupRef.current?.position.x ?? 0, moved: 0 };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || !groupRef.current) return;
    const deltaPx = e.clientX - drag.startClientX;
    drag.moved = Math.max(drag.moved, Math.abs(deltaPx));
    const nextX = drag.startX + deltaPx / DRAG_PIXELS_PER_UNIT;
    groupRef.current.position.x = Math.max(-DRAG_BOUND, Math.min(DRAG_BOUND, nextX));
  };

  const handlePointerUp = () => {
    const wasClick = (dragState.current?.moved ?? 0) < CLICK_MOVE_THRESHOLD;
    dragState.current = null;
    // next/navigation's router already accounts for next.config's basePath
    // itself (unlike the plain <a> tag this replaced, which needed BASE_PATH
    // prefixed manually) — prefixing it here double-counted it.
    if (wasClick) router.push("/pets");
  };

  return (
    <div
      title="สัตว์เลี้ยงของคุณ — ลากซ้าย/ขวาเล่นได้"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        display: "block",
        width: "100%",
        height: "150px",
        marginBottom: "12px",
        cursor: "grab",
        touchAction: "none",
      }}
    >
      {/* Same camera position/fov as the full /pets viewer (components/Pet3D.tsx's
          default export) — that framing has been verified across every growth
          stage to never clip the model, unlike a tighter zoom tried here
          earlier. Made "bigger" by growing this container instead of zooming
          the camera in. */}
      <Canvas camera={{ position: [0, 1.2, 4], fov: 46 }} gl={{ alpha: true }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 2]} intensity={1} />
        <Suspense fallback={null}>
          <group ref={groupRef}>
            <PetModel species={pet.species} stage={pet.growthStage} />
          </group>
        </Suspense>
      </Canvas>
    </div>
  );
}

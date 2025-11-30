import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const ASSETS_PATH = import.meta.env.BASE_URL + "assets/glasses/";

// Configure Draco loader for compressed GLB files
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(import.meta.env.BASE_URL + "draco/");

// State returned by loadGlasses - contains lens groups and control functions
export interface GlassesState {
  leftGroup: THREE.Group;
  rightGroup: THREE.Group;
  leftGroupAlt: THREE.Group; // Alternative left lens (for swapping)
  rightGroupAlt: THREE.Group; // Alternative right lens (for swapping)
  update: (polarAngle: number, minPolar: number, maxPolar: number) => void;
  swapLeft: () => void;
  swapRight: () => void;
  animateSwap: () => void;
  dispose: () => void;
}

// Internal refs for meshes that need per-frame updates
interface LensRefs {
  lensAMesh: THREE.Object3D | null; // Left lens with mapA (fades out when looking down)
  lensBMesh: THREE.Object3D | null; // Left lens with mapB (fades in when looking down)
  gradCanvas: HTMLCanvasElement | null; // Canvas for right lens gradient
  gradTex: THREE.CanvasTexture | null; // Texture created from gradient canvas
}

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
const textureLoader = new THREE.TextureLoader();

// Promisified GLB loader
function loadGLB(path: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      ASSETS_PATH + path,
      (gltf) => resolve(gltf.scene),
      undefined,
      reject,
    );
  });
}

// Promisified texture loader
function loadTexture(path: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    textureLoader.load(ASSETS_PATH + path, resolve, undefined, reject);
  });
}

// Black glossy material for the glasses frame
function createFrameMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.1,
    metalness: 0.0,
  });
}

// Semi-transparent gray material for the mask/blank areas
function createMaskMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#a7a7a7"),
    transmission: 0.95,
    thickness: 0.0,
    roughness: 0.4,
    ior: 1.3,
    transparent: true,
  });
}

// Left lens material - uses a texture map for thickness/roughness
// The texture controls how light transmits through the lens
// Two versions (mapA and mapB) crossfade based on viewing angle
function createLeftLensMaterial(
  map: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    transmission: 1, // Fully transmissive (see-through)
    thickness: 0,
    ior: 1.11, // Index of refraction (slight distortion)
    roughness: 1,
    thicknessMap: map, // Texture controls thickness variation
    roughnessMap: map, // Same texture controls roughness variation
    transparent: true,
    opacity: 1,
  });
}

// Creates a horizontal gradient canvas texture for the right lens
// The gradient creates a "progressive lens" effect with clear center and blurred edges
function createGradientCanvas(): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const SIZE = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d")!;
  const offset = -SIZE * 0.2;
  // Gradient: white -> black -> black -> white (clear edges, dark center band)
  const g = ctx.createLinearGradient(offset, 0, SIZE + offset, 0);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.45, "#000");
  g.addColorStop(0.55, "#000");
  g.addColorStop(1, "#fff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  return { canvas, texture };
}

// Right lens material - uses dynamic gradient texture
// The gradient position updates based on camera angle to simulate progressive lens
function createRightLensMaterial(
  gradTex: THREE.CanvasTexture,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    transmission: 1,
    thickness: 0.5,
    ior: 1.15,
    roughness: 2,
    thicknessMap: gradTex,
    roughnessMap: gradTex,
    transparent: true,
    opacity: 1,
  });
}

/**
 * Loads and sets up the glasses overlay attached to the camera.
 *
 * The glasses consist of:
 * - Left lens: Uses two overlapping meshes with texture maps that crossfade
 *   based on viewing angle (simulates bifocal/progressive lens effect)
 * - Right lens: Uses a dynamic gradient texture that shifts based on viewing
 *   angle (simulates progressive lens blur zones)
 * - Frames: Black glossy material
 * - Masks/blanks: Semi-transparent overlays
 *
 * Each lens has a primary and alternate version that can be swapped
 * with an animated transition (slides up/down).
 */
export async function loadGlasses(camera: THREE.Camera): Promise<GlassesState> {
  const refs: LensRefs = {
    lensAMesh: null,
    lensBMesh: null,
    gradCanvas: null,
    gradTex: null,
  };

  // Four groups: primary and alternate for each eye
  const leftGroup = new THREE.Group();
  const rightGroup = new THREE.Group();
  const leftGroupAlt = new THREE.Group();
  const rightGroupAlt = new THREE.Group();

  // Load the two texture maps for left lens crossfade effect
  // mapA = normal view, mapB = inverted (for looking down)
  const [mapA, mapB] = await Promise.all([
    loadTexture("lens_left_map.png"),
    loadTexture("lens_left_map_invert.png"),
  ]);
  mapA.colorSpace = THREE.SRGBColorSpace;
  mapB.colorSpace = THREE.SRGBColorSpace;

  // Load all GLB models in parallel for performance
  const [
    lensLeft, // Primary left lens geometry
    lensLeftFar, // Alternate left lens (different prescription)
    lensRight, // Primary right lens geometry
    lensRight02, // Alternate right lens
    frameLeft, // Left frame
    frameRight, // Right frame
    blankL, // Left mask/overlay
    blankR, // Right mask/overlay
  ] = await Promise.all([
    loadGLB("lens_left.glb"),
    loadGLB("lens_left_far.glb"),
    loadGLB("lens_right.glb"),
    loadGLB("lens_right_02.glb"),
    loadGLB("lens_frame_left.glb"),
    loadGLB("lens_frame_right.glb"),
    loadGLB("blank_l.glb"),
    loadGLB("blank_r.glb"),
  ]);

  // === LEFT LENS GROUP ===
  // Uses GPU-based opacity crossfade between two texture maps
  // lensAMesh (mapA) fades out while lensBMesh (mapB) fades in when looking down
  const matA = createLeftLensMaterial(mapA);
  const matB = createLeftLensMaterial(mapB);
  matB.opacity = 0; // Start with mapB invisible

  // Clone the lens geometry twice - one for each material
  const lensAMesh = lensLeft.clone();
  const lensBMesh = lensLeft.clone();
  lensAMesh.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = matA;
  });
  lensBMesh.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = matB;
  });
  refs.lensAMesh = lensAMesh;
  refs.lensBMesh = lensBMesh;

  // Position and material for left frame
  frameLeft.position.set(0.01, 0, 0.01);
  frameLeft.traverse((c) => {
    if ((c as THREE.Mesh).isMesh)
      (c as THREE.Mesh).material = createFrameMaterial();
  });

  // Left mask gets semi-transparent material
  blankL.traverse((c) => {
    if ((c as THREE.Mesh).isMesh)
      (c as THREE.Mesh).material = createMaskMaterial();
  });

  // Assemble left group and position in front of left eye
  leftGroup.add(lensAMesh, lensBMesh, frameLeft, blankL);
  leftGroup.scale.set(0.1125, 0.1125, 0.1875);
  leftGroup.position.set(-0.2625, 0, -0.4875); // Left of center, in front of camera

  // === LEFT LENS GROUP ALT (alternate prescription) ===
  // Same setup but uses lensLeftFar geometry (different lens shape)
  const matAAlt = createLeftLensMaterial(mapA);
  const matBAlt = createLeftLensMaterial(mapB);
  matBAlt.opacity = 0;

  const lensAMeshAlt = lensLeftFar.clone();
  const lensBMeshAlt = lensLeftFar.clone();
  lensAMeshAlt.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = matAAlt;
  });
  lensBMeshAlt.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = matBAlt;
  });

  const frameLeftAlt = frameLeft.clone(true);
  const blankLAlt = blankL.clone(true);

  leftGroupAlt.add(lensAMeshAlt, lensBMeshAlt, frameLeftAlt, blankLAlt);
  leftGroupAlt.scale.copy(leftGroup.scale);
  leftGroupAlt.position.copy(leftGroup.position);
  leftGroupAlt.position.y = -0.6; // Hidden below viewport (for swap animation)

  // === RIGHT LENS GROUP ===
  // Uses dynamic canvas gradient that shifts based on viewing angle
  const { canvas: gradCanvas, texture: gradTex } = createGradientCanvas();
  refs.gradCanvas = gradCanvas;
  refs.gradTex = gradTex;

  const rightMat = createRightLensMaterial(gradTex);
  lensRight.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = rightMat;
  });

  frameRight.traverse((c) => {
    if ((c as THREE.Mesh).isMesh)
      (c as THREE.Mesh).material = createFrameMaterial();
  });
  blankR.traverse((c) => {
    if ((c as THREE.Mesh).isMesh)
      (c as THREE.Mesh).material = createMaskMaterial();
  });

  // Assemble right group and position in front of right eye
  rightGroup.add(lensRight, frameRight, blankR);
  rightGroup.scale.set(0.1125, 0.1125, 0.1875);
  rightGroup.position.set(0.2625, 0, -0.4875); // Right of center, in front of camera

  // === RIGHT LENS GROUP ALT ===
  const { texture: gradTexAlt } = createGradientCanvas();
  const rightMatAlt = createRightLensMaterial(gradTexAlt);
  lensRight02.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = rightMatAlt;
  });

  const frameRightAlt = frameRight.clone(true);
  const blankRAlt = blankR.clone(true);

  rightGroupAlt.add(lensRight02, frameRightAlt, blankRAlt);
  rightGroupAlt.scale.copy(rightGroup.scale);
  rightGroupAlt.position.copy(rightGroup.position);
  rightGroupAlt.position.y = -0.6; // Hidden below viewport

  // Attach all groups to camera so they move with the view
  camera.add(leftGroup, rightGroup, leftGroupAlt, rightGroupAlt);

  // Track which lens variant is currently shown
  let leftSwapped = false;
  let rightSwapped = false;

  /**
   * Update lens effects based on camera's vertical angle (polar angle).
   * Called every frame from the render loop.
   *
   * @param polarAngle - Current camera polar angle (radians from up vector)
   * @param minPolar - Minimum polar angle bound
   * @param maxPolar - Maximum polar angle bound
   */
  function update(polarAngle: number, minPolar: number, maxPolar: number) {
    // RIGHT LENS: Shift gradient position based on viewing angle
    // Creates effect of progressive lens zones moving as you look up/down
    if (refs.gradCanvas && refs.gradTex) {
      const SIZE = 256;
      // Map polar angle to gradient offset position
      const offset = THREE.MathUtils.mapLinear(
        polarAngle,
        minPolar,
        maxPolar,
        -SIZE * 0.3,
        SIZE * 0.02,
      );
      // Redraw gradient with new offset
      const ctx = refs.gradCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, SIZE, SIZE);
      const grd = ctx.createLinearGradient(offset, 0, SIZE + offset, 0);
      grd.addColorStop(0, "#fff");
      grd.addColorStop(0.35, "#000");
      grd.addColorStop(0.55, "#000");
      grd.addColorStop(1, "#fff");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, SIZE, SIZE);
      refs.gradTex.needsUpdate = true; // Tell THREE.js to re-upload texture
    }

    // LEFT LENS: Crossfade between two texture maps based on viewing angle
    // Simulates bifocal/progressive transition when looking down
    if (refs.lensAMesh && refs.lensBMesh) {
      const neutral = Math.PI / 2; // Horizontal = 90 degrees
      const delta = neutral - polarAngle; // How far from horizontal
      // Smoothstep transition starting at 0, complete at 1 degree
      const t = THREE.MathUtils.smoothstep(delta, 0, Math.PI / 180);
      const eased = 1 - Math.pow(1 - t, 3); // Ease-out cubic
      // Crossfade: mapA fades out, mapB fades in
      refs.lensAMesh.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const mat = (c as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
          mat.opacity = 1 - eased;
        }
      });
      refs.lensBMesh.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const mat = (c as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
          mat.opacity = eased;
        }
      });
    }
  }

  // Trigger swap animation for left lens (toggles between primary and alt)
  function swapLeft() {
    leftSwapped = !leftSwapped;
    // Set animation targets: primary slides up/down, alt slides to/from view
    leftGroup.userData.targetY = leftSwapped ? 0.6 : 0;
    leftGroup.userData.animating = true;
    leftGroupAlt.userData.targetY = leftSwapped ? 0 : -0.6;
    leftGroupAlt.userData.animating = true;
  }

  // Trigger swap animation for right lens
  function swapRight() {
    rightSwapped = !rightSwapped;
    rightGroup.userData.targetY = rightSwapped ? 0.6 : 0;
    rightGroup.userData.animating = true;
    rightGroupAlt.userData.targetY = rightSwapped ? 0 : -0.6;
    rightGroupAlt.userData.animating = true;
  }

  // Animate lens swap transitions - call each frame
  // Uses lerp for smooth easing to target position
  function animateSwap() {
    const groups = [leftGroup, rightGroup, leftGroupAlt, rightGroupAlt];
    for (const group of groups) {
      if (group.userData.animating) {
        const target = group.userData.targetY as number;
        const speed = 0.08; // Lerp factor (0-1, higher = faster)
        group.position.y += (target - group.position.y) * speed;
        // Snap to target when close enough
        if (Math.abs(group.position.y - target) < 0.001) {
          group.position.y = target;
          group.userData.animating = false;
        }
      }
    }
  }

  // Clean up resources when unmounting
  function dispose() {
    camera.remove(leftGroup, rightGroup, leftGroupAlt, rightGroupAlt);
    mapA.dispose();
    mapB.dispose();
    refs.gradTex?.dispose();
  }

  return {
    leftGroup,
    rightGroup,
    leftGroupAlt,
    rightGroupAlt,
    update,
    swapLeft,
    swapRight,
    animateSwap,
    dispose,
  };
}

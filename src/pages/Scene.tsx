import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import ThreeView from "@/components/ThreeView";

export interface SceneModel {
  path: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

export interface SceneConfig {
  image: string;
  models: SceneModel[];
}

const scenes: Record<string, SceneConfig> = {
  biking: {
    image: "/assets/scenes/biking2k.exr",
    models: [
      {
        path: "/assets/scenes/low_poly_bicycle.glb",
        position: [0, -0.9, 0],
        rotation: [0, 1.25, 0],
      },
    ],
  },
  office: {
    image: "/assets/scenes/Office_Microsoft.hdr",
    models: [
      {
        path: "/assets/scenes/Desk.glb",
        position: [1.15, -1.1, 0],
        rotation: [0, -1.6, 0],
        // rotation: [0, Math.PI, 0],
        // scale: 1,
      },
    ],
  },
};

export default function Scene() {
  const { scene } = useParams<{ scene: string }>();
  const sceneConfig = scene ? scenes[scene] : null;

  if (!sceneConfig) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-4xl font-bold">Scene not found</h1>
        <Button asChild variant="outline">
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0">
      <ThreeView image={sceneConfig.image} models={sceneConfig.models} />
    </div>
  );
}

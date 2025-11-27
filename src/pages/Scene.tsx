import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    image: "/assets/scenes/office_2k.hdr",
    models: [
      {
        path: "/assets/scenes/desk.glb",
        position: [1.15, -1.1, 0],
        rotation: [0, -1.6, 0],
        // rotation: [0, Math.PI, 0],
        // scale: 1,
      },
    ],
  },
};

const sceneNames = Object.keys(scenes);

export default function Scene() {
  const { scene } = useParams<{ scene: string }>();
  const navigate = useNavigate();
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
      <div className="absolute top-4 right-4 z-30">
        <Select
          value={scene}
          onValueChange={(value) => navigate(`/scenes/${value}`)}
        >
          <SelectTrigger className="w-32 bg-black/50 text-white border-white/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sceneNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

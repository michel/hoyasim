import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import * as THREE from 'three'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function disposeMeshes(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const m of mats) m.dispose()
    }
  })
}

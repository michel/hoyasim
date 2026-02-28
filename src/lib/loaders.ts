import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const DRACO_DECODER_PATH =
  'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath(DRACO_DECODER_PATH)

export const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

export const textureLoader = new THREE.TextureLoader()

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { encodeGlb } from "../../blender/animal_glb.mjs";

export async function measureHorse(asset) {
  const doc = structuredClone(asset.doc);
  doc.materials = [{}];
  for (const mesh of doc.meshes)
    for (const primitive of mesh.primitives) primitive.material = 0;
  delete doc.images;
  delete doc.textures;
  const bytes = encodeGlb(doc, asset.bin);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    "",
  );
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find((clip) => clip.name === "idle")).play();
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3(),
    body = [];
  const triangles = {};
  for (let lod = 0; lod < 3; lod++) {
    let count = 0;
    gltf.scene.getObjectByName(`horse_lod${lod}`).traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      count += mesh.geometry.index.count / 3;
      if (lod !== 0) return;
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        const point = mesh
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(point);
        if (mesh.name === "horse_body_lod0") body.push(point);
      }
    });
    triangles[`lod${lod}`] = count;
  }
  const size = bounds.getSize(new THREE.Vector3());
  return {
    shoulderHeightM: Math.max(
      ...body
        .filter((p) => Math.abs(p.x) < 0.12 && Math.abs(p.z - 0.3) < 0.05)
        .map((p) => p.y),
    ),
    overallHeightM: bounds.max.y,
    saddleHeightM: gltf.scene
      .getObjectByName("socket_saddle_seat")
      .getWorldPosition(new THREE.Vector3()).y,
    widthM: size.x,
    lengthM: size.z,
    triangles,
    joints: asset.doc.skins[0].joints.length,
    materials: asset.doc.materials.length,
    textureMaxSize: 1024,
    textureCount: 7,
    packageBytes: 0,
  };
}

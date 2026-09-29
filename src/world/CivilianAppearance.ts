import * as THREE from 'three'
import type { CharacterFaction } from './CharacterVisuals'

// Share immutable clothing variants across residents and preserve source textures,
// geometry, skinning, and independent skeletons. Never recolor the soldier template.
const woolMaterials = new WeakMap<THREE.Material, Map<string, THREE.MeshStandardMaterial>>()
const clothShells = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
function civilianClothShell(source: THREE.BufferGeometry): THREE.BufferGeometry {
  let shell = clothShells.get(source)
  if (!shell) {
    shell = source.clone()
    const positions = shell.getAttribute('position'), normals = shell.getAttribute('normal')
    for (let i = 0; i < positions.count; i++) {
      // The soldier's armor concealed shoulder skin intersecting the undertunic.
      // Give only that fabric a little ease; preserve the neck, skin and rig.
      const ease = positions.getY(i) > 1.12 && Math.abs(positions.getX(i)) > .13 ? .035 : .006
      positions.setXYZ(i, positions.getX(i) + normals.getX(i) * ease, positions.getY(i) + normals.getY(i) * ease, positions.getZ(i) + normals.getZ(i) * ease)
    }
    positions.needsUpdate = true
    shell.computeBoundingBox(); shell.computeBoundingSphere()
    clothShells.set(source, shell)
  }
  return shell
}
function wool(source: THREE.Material, color: string): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source
  let variants = woolMaterials.get(source)
  if (!variants) { variants = new Map(); woolMaterials.set(source, variants) }
  let material = variants.get(color)
  if (!material) {
    material = source.clone()
    material.name = 'VikingCivilianWool-' + color
    material.color.setHex(0xffffff)
    material.metalness = 0
    material.roughness = .96
    const tint = new THREE.Color(color)
    material.onBeforeCompile = shader => {
      shader.uniforms.civilianWoolTint = { value: tint }
      shader.fragmentShader = 'uniform vec3 civilianWoolTint;\n' + shader.fragmentShader
      // Remove the red dye while retaining source fabric shading and normal detail.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float clothShade = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 2.0 + 0.22, 0.0, 1.0);
        diffuseColor.rgb = civilianWoolTint * clothShade;
      `)
    }
    material.customProgramCacheKey = () => 'viking-civilian-wool-v1'
    variants.set(color, material)
  }
  return material
}

/** Applied to every cloned Roman LOD; the underlying intact civilian body stays shared. */
export function applyCivilianAppearance(level: THREE.Object3D, style: CharacterFaction): void {
  level.traverse(object => {
    if (/^(Armour_top|Full_figure_42_T_pose|Helmet3|Dangles|Ties|Wrist_guard1)(_|$)/.test(object.name)) object.visible = false
    if (object instanceof THREE.Mesh && /^Tunic_1(_|$)/.test(object.name)) object.geometry = civilianClothShell(object.geometry)
    if (style !== 'viking' || !(object instanceof THREE.Mesh)) return
    const color = /^(Tunic_1|RomanUndertunic)(_|$)/.test(object.name) ? '#81806a'
      : /^New_legs(_|$)/.test(object.name) ? '#51483c' : null
    if (!color) return
    object.material = Array.isArray(object.material) ? object.material.map(m => wool(m, color)) : wool(object.material, color)
    object.userData.originalMat = object.material
  })
}

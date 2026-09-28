import * as THREE from 'three'
import type { CharacterFaction } from './CharacterVisuals'

// Share immutable clothing variants across residents and preserve source textures,
// geometry, skinning, and independent skeletons. Never recolor the soldier template.
const woolMaterials = new WeakMap<THREE.Material, Map<string, THREE.MeshStandardMaterial>>()
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
    if (style !== 'viking' || !(object instanceof THREE.Mesh)) return
    const color = /^(Tunic_1|RomanUndertunic)(_|$)/.test(object.name) ? '#81806a'
      : /^New_legs(_|$)/.test(object.name) ? '#51483c' : null
    if (!color) return
    object.material = Array.isArray(object.material) ? object.material.map(m => wool(m, color)) : wool(object.material, color)
    object.userData.originalMat = object.material
  })
}

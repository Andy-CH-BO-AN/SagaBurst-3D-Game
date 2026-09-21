import * as THREE from 'three'

const MAX_PREVIEW_SLOTS = 200
const MARKER_GEOMETRY = new THREE.CircleGeometry(0.32, 12)
const MARKER_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x73e6a2,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
})
const LINE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x9af0bd,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
})
const CENTER_GEOMETRY = new THREE.TorusGeometry(0.7, 0.06, 6, 24)
const CENTER_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x9af0bd,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
})

/** Lightweight, non-gameplay formation placement visuals. */
export class FormationPreview {
  private readonly markers: THREE.InstancedMesh
  private readonly line: THREE.Line
  private readonly center: THREE.Mesh
  private readonly markerQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  private readonly markerScale = new THREE.Vector3(1, 1, 1)
  private readonly markerMatrix = new THREE.Matrix4()
  private readonly linePositions = new Float32Array(6)
  private readonly lineAttribute: THREE.BufferAttribute

  constructor(scene: THREE.Scene) {
    this.markers = new THREE.InstancedMesh(MARKER_GEOMETRY, MARKER_MATERIAL, MAX_PREVIEW_SLOTS)
    this.markers.name = 'formation-preview-slots'
    this.markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.markers.visible = false

    this.lineAttribute = new THREE.BufferAttribute(this.linePositions, 3)
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', this.lineAttribute)
    this.line = new THREE.Line(lineGeometry, LINE_MATERIAL)
    this.line.name = 'formation-preview-line'
    this.line.visible = false

    this.center = new THREE.Mesh(CENTER_GEOMETRY, CENTER_MATERIAL)
    this.center.name = 'formation-preview-center'
    this.center.rotation.x = -Math.PI / 2
    this.center.visible = false

    scene.add(this.markers, this.line, this.center)
  }

  show(center: THREE.Vector3, slots: readonly THREE.Vector3[], valid: boolean): void {
    const color = valid ? 0x73e6a2 : 0xff6f6f
    MARKER_MATERIAL.color.setHex(color)
    LINE_MATERIAL.color.setHex(color)
    CENTER_MATERIAL.color.setHex(color)

    this.markers.count = Math.min(slots.length, MAX_PREVIEW_SLOTS)
    for (let index = 0; index < this.markers.count; index++) {
      const slot = slots[index]
      this.markerMatrix.compose(slot, this.markerQuaternion, this.markerScale)
      this.markers.setMatrixAt(index, this.markerMatrix)
    }
    this.markers.instanceMatrix.needsUpdate = true

    if (slots.length > 0) {
      const first = slots[0]
      const last = slots[slots.length - 1]
      this.linePositions[0] = first.x
      this.linePositions[1] = first.y + 0.03
      this.linePositions[2] = first.z
      this.linePositions[3] = last.x
      this.linePositions[4] = last.y + 0.03
      this.linePositions[5] = last.z
      this.lineAttribute.needsUpdate = true
    }

    this.center.position.copy(center)
    this.center.position.y += 0.04
    this.markers.visible = true
    this.line.visible = slots.length > 1
    this.center.visible = true
  }

  clear(): void {
    this.markers.visible = false
    this.line.visible = false
    this.center.visible = false
    this.markers.count = 0
  }
}

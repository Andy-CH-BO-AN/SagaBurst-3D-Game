import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { warmTownRenderResources } from '../src/town/TownRenderWarmup'

function fixture() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(58, 1, .1, 400)
  camera.position.set(0, 2, 9)
  camera.lookAt(0, 2, -20)
  camera.updateMatrixWorld(true)
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshStandardMaterial()
  const createLOD = (name: string, distances: number[]) => {
    const lod = new THREE.LOD()
    lod.position.set(70, 0, -6) // Outside the entry camera's frustum.
    distances.forEach((distance, index) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = name + '-lod' + index
      lod.addLevel(mesh, distance, .1)
    })
    scene.add(lod)
    return lod
  }
  const humanoid = createLOD('humanoid', [0, 28, 60])
  const mount = createLOD('mount', [0, 18, 38])
  const detail = new THREE.Mesh(geometry, material)
  detail.name = 'equipment-detail'
  scene.add(detail)
  const hidden = new THREE.Mesh(geometry, material)
  hidden.name = 'hidden-civilian-armour'
  hidden.visible = false
  scene.add(hidden)
  const update = humanoid.update.bind(humanoid)
  const lodHook = vi.fn((view: THREE.Camera) => {
    update(view)
    detail.visible = humanoid.getCurrentLevel() === 0
  })
  humanoid.update = lodHook
  scene.updateMatrixWorld(true)
  humanoid.update(camera)
  mount.update(camera)
  lodHook.mockClear()

  const previousTarget = new THREE.WebGLRenderTarget(8, 8)
  let activeTarget: THREE.WebGLRenderTarget | null = previousTarget
  const draws: string[][] = []
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  const renderer = {
    getRenderTarget: vi.fn(() => activeTarget),
    setRenderTarget: vi.fn((target: THREE.WebGLRenderTarget | null) => { activeTarget = target }),
    compileAsync: vi.fn(async () => {}),
    render: vi.fn((world: THREE.Scene, view: THREE.Camera) => {
      // Three updates automatic LODs before traversing their selected meshes.
      world.traverseVisible(object => {
        if (object instanceof THREE.LOD && object.autoUpdate) object.update(view)
      })
      const visible: string[] = []
      world.traverseVisible(object => {
        if (object instanceof THREE.Mesh && (!object.frustumCulled || frustum.intersectsObject(object))) {
          visible.push(object.name)
        }
      })
      draws.push(visible)
    }),
  }
  const original = scene.children.flatMap(root => {
    const objects: Array<{ object: THREE.Object3D; visible: boolean; frustumCulled: boolean }> = []
    root.traverse(object => objects.push({ object, visible: object.visible, frustumCulled: object.frustumCulled }))
    return objects
  })
  const yieldFrame = vi.fn(async () => {})
  return {
    scene, camera, humanoid, mount, detail, geometry, material, lodHook,
    renderer, draws, original, previousTarget, yieldFrame,
    warm: () => warmTownRenderResources(renderer as unknown as THREE.WebGLRenderer, scene, camera, yieldFrame),
  }
}

function expectRestored(f: ReturnType<typeof fixture>) {
  expect(f.renderer.getRenderTarget()).toBe(f.previousTarget)
  expect(f.humanoid.autoUpdate).toBe(true)
  expect(f.mount.autoUpdate).toBe(true)
  expect(f.humanoid.getCurrentLevel()).toBe(2)
  expect(f.mount.getCurrentLevel()).toBe(2)
  for (const { object, visible, frustumCulled } of f.original) {
    expect(object.visible).toBe(visible)
    expect(object.frustumCulled).toBe(frustumCulled)
  }
}

describe('Career town render warmup', () => {
  it('uploads all actual LODs outside the entry frustum, including close equipment, while retaining hidden parts', async () => {
    const f = fixture()
    const cameraBefore = f.camera.matrixWorld.clone()
    const disposeGeometry = vi.spyOn(f.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(f.material, 'dispose')
    const disposeTarget = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    try {
      await f.warm()
      expect(f.draws).toEqual([
        ['humanoid-lod0', 'mount-lod0', 'equipment-detail'],
        ['humanoid-lod1', 'mount-lod1'],
        ['humanoid-lod2', 'mount-lod2'],
      ])
      expect(f.renderer.compileAsync).toHaveBeenCalledTimes(6)
      expect(f.yieldFrame).toHaveBeenCalledTimes(3)
      expect(f.lodHook).toHaveBeenCalledTimes(4)
      expect(f.camera.matrixWorld.equals(cameraBefore)).toBe(true)
      expect(disposeGeometry).not.toHaveBeenCalled()
      expect(disposeMaterial).not.toHaveBeenCalled()
      expect(disposeTarget).toHaveBeenCalledTimes(1)
      expectRestored(f)
    } finally { disposeTarget.mockRestore() }
  })

  it('warms every new town renderer instead of sharing a global warmed flag', async () => {
    const first = fixture()
    const second = fixture()
    await first.warm()
    await second.warm()
    expect(first.draws).toHaveLength(3)
    expect(second.draws).toHaveLength(3)
    expectRestored(first)
    expectRestored(second)
  })

  it.each(['compile', 'render', 'yield'] as const)('restores visibility, LOD hooks and render target after %s fails', async stage => {
    const f = fixture()
    const error = new Error('warmup failed')
    if (stage === 'compile') f.renderer.compileAsync.mockRejectedValueOnce(error)
    else if (stage === 'render') f.renderer.render.mockImplementationOnce(() => { throw error })
    else f.yieldFrame.mockRejectedValueOnce(error)
    const disposeTarget = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    try {
      await expect(f.warm()).rejects.toBe(error)
      expectRestored(f)
      expect(disposeTarget).toHaveBeenCalledTimes(1)
    } finally { disposeTarget.mockRestore() }
  })
})

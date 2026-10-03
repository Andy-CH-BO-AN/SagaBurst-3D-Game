/** Gate swaps can change topology without changing the final obstacle count. */
const revisions = new WeakMap<object, number>()
export function obstacleTopologyRevision(obstacles: object): number { return revisions.get(obstacles) ?? 0 }
export function markObstacleTopologyChanged(obstacles: object): void { revisions.set(obstacles, obstacleTopologyRevision(obstacles) + 1) }

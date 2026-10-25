/** Source-surface skin repair. This module never changes geometry or corner attributes. */
export function repairSkin({
  arrays,
  indices,
  rigidFaceIndices,
  jointNodes,
  nodes,
  rootJoint,
}) {
  const p = arrays.POSITION,
    count = p.length / 3,
    bones = jointNodes.length;
  const groups = [],
    keyToGroup = new Map(),
    groupOf = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = p
      .slice(i * 3, i * 3 + 3)
      .map((x) => x.toFixed(6))
      .join(",");
    if (!keyToGroup.has(key)) {
      keyToGroup.set(key, groups.length);
      groups.push({
        ids: [],
        point: p.slice(i * 3, i * 3 + 3),
        neighbors: new Map(),
      });
    }
    const g = keyToGroup.get(key);
    groupOf[i] = g;
    groups[g].ids.push(i);
  }
  for (let i = 0; i < indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = groupOf[indices[i + k]],
        b = groupOf[indices[i + ((k + 1) % 3)]];
      if (a === b) continue;
      const d = Math.hypot(
        ...groups[a].point.map((v, k) => v - groups[b].point[k]),
      );
      const w = 1 / Math.max(0.015, d);
      groups[a].neighbors.set(b, w);
      groups[b].neighbors.set(a, w);
    }
  const rigid = new Set(
    rigidFaceIndices.flatMap((f) =>
      indices.slice(f * 3, f * 3 + 3).map((i) => groupOf[i]),
    ),
  );
  const jointName = jointNodes.map((n) => nodes[n].name),
    tail = new Set(
      jointName
        .map((n, i) => (/^Bone_0(15|16|17|18|19|20|21|22)$/.test(n) ? i : -1))
        .filter((i) => i >= 0),
    );
  let weights = groups.map((g) => {
    const w = new Float64Array(bones);
    for (const i of g.ids)
      for (let k = 0; k < 4; k++)
        w[arrays.JOINTS_0[i * 4 + k]] +=
          arrays.WEIGHTS_0[i * 4 + k] / g.ids.length;
    return w;
  });
  const torsoEquivalent = new Set(
    jointName
      .map((n, i) =>
        [0, 1, 2, 3, 4, 23, 24, 25, 26].some(
          (k) => n === "Bone_" + String(k).padStart(3, "0"),
        )
          ? i
          : -1,
      )
      .filter((i) => i >= 0),
  );
  for (const w of weights) {
    const total = [...torsoEquivalent].reduce((sum, j) => sum + w[j], 0);
    for (const j of torsoEquivalent) w[j] = 0;
    w[rootJoint] = total;
  }
  const free = [],
    priors = [],
    fixedCounts = { rigid: 0, native: 0, tail: 0 };
  const smoothstep = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < groups.length; i++) {
    const [x, y, z] = groups[i].point,
      w = weights[i],
      tailWeight = [...tail].reduce((sum, joint) => sum + w[joint], 0);
    if (rigid.has(i)) {
      w.fill(0);
      w[rootJoint] = 1;
      fixedCounts.rigid++;
      continue;
    }
    // The source tail root mixes both hips into adjacent tail vertices. A hard
    // tail-weight cutoff previously made a 4.45 cm edge stretch to 18.47 cm.
    // Use a continuous caudal/tail-confidence prior and solve its transition on
    // the same source surface as the hip. No discontinuous body-core root pins.
    const tailSupport =
      smoothstep((-z - 0.45) / 0.2) *
      smoothstep((0.2 - Math.abs(x)) / 0.08) *
      smoothstep((tailWeight - 0.1) / 0.6);
    if (tailSupport > 0 && tailWeight > 0) {
      for (let joint = 0; joint < bones; joint++) {
        const target = tail.has(joint) ? w[joint] / tailWeight : 0;
        w[joint] = w[joint] * (1 - tailSupport) + target * tailSupport;
      }
      fixedCounts.tail++;
    }
    // Retain native distal shafts. Only proximal attachments and the continuous
    // tail-root transition are free; exact original saddle vertices stay rigid.
    const front = y > 0.5 && y < 1.14 && z > 0.45 && z < 1.12;
    const rear = y > 0.46 && y < 1.14 && z > -0.78 && z < -0.05;
    const tailTransition =
      z < -0.45 && Math.abs(x) < 0.2 && tailWeight > 0.001 && tailWeight < 0.9;
    if (front || rear || tailTransition) {
      free.push(i);
      priors.push(w.slice());
    } else fixedCounts.native++;
  }
  const prior = 0.025;
  let iterations = 0,
    residual = Infinity;
  for (; iterations < 1200 && residual > 1e-6; iterations++) {
    const next = weights.slice();
    residual = 0;
    for (let k = 0; k < free.length; k++) {
      const i = free[k],
        neighbors = groups[i].neighbors,
        total = [...neighbors.values()].reduce((a, b) => a + b, 0),
        w = new Float64Array(bones);
      for (const [n, edge] of neighbors)
        for (let j = 0; j < bones; j++)
          w[j] += ((weights[n][j] * edge) / total) * (1 - prior);
      for (let j = 0; j < bones; j++) {
        w[j] += priors[k][j] * prior;
        residual = Math.max(residual, Math.abs(w[j] - weights[i][j]));
      }
      next[i] = w;
    }
    weights = next;
  }
  const joints = arrays.JOINTS_0.slice(),
    output = arrays.WEIGHTS_0.slice();
  let maxDropped = 0;
  for (let g = 0; g < groups.length; g++) {
    const sorted = Array.from(weights[g], (v, j) => [j, v])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
      sum = sorted.reduce((s, p) => s + p[1], 0);
    maxDropped = Math.max(maxDropped, 1 - sum);
    for (const i of groups[g].ids)
      for (let k = 0; k < 4; k++) {
        joints[i * 4 + k] = sorted[k][0];
        output[i * 4 + k] = sorted[k][1] / sum;
      }
  }
  return {
    arrays: { ...arrays, JOINTS_0: joints, WEIGHTS_0: output },
    report: {
      method:
        "Continuous position-domain attachment solve with native shaft anchors and actual rigid saddle surface",
      geometricPoints: groups.length,
      freePoints: free.length,
      fixedCounts,
      iterations,
      residual,
      maxDroppedWeight: maxDropped,
    },
  };
}

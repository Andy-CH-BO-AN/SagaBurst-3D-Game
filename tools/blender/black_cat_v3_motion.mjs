/** Reuse the accepted animal trajectory phase adapter; bake target-length IK offline. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Vector3 } from "three";

export function createLocomotion({
  donor,
  clip,
  duration,
  frames,
  rest,
  byName,
  chains,
  sourcePositions,
}) {
  if (!["walk", "run"].includes(clip.name)) return null;
  const donorNames = new Map(donor.doc.nodes.map((n, i) => [n.name, i]));
  const position = (m) => new Vector3().setFromMatrixPosition(m);
  const bone = (n) => byName.get("Bone_" + String(n).padStart(3, "0"));
  const front = position(rest[bone(35)]).z,
    rear = position(rest[bone(14)]).z;
  const hipSpan = front - rear,
    stride = hipSpan * (clip.name === "run" ? 0.8 : 0.55);
  const belly = [];
  for (let i = 0; i < sourcePositions.length; i += 3)
    if (
      Math.abs(sourcePositions[i]) < 0.1 &&
      sourcePositions[i + 2] > -0.1 &&
      sourcePositions[i + 2] < 0.45
    )
      belly.push(sourcePositions[i + 1]);
  const clearance = Math.min(...belly),
    lift = clip.name === "run" ? Math.max(0.22, clearance - 0.12) : 0.075;
  const curves = {};
  for (const name of Object.keys(chains)) {
    const i = donorNames.get(
      "cat_" + name.split("_")[0] + "_paw_" + name.at(-1),
    );
    curves[name] = Array.from({ length: frames + 1 }, (_, f) => {
      const p = position(donor.pose(clip, (duration * f) / frames).worlds[i]);
      return [-p.z, p.y];
    });
  }
  const script = String.raw`import json,sys,importlib.util
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('trajectory',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=json.load(sys.stdin);out={}
for name,points in d['curves'].items():
 n=len(points)-1;center,duty=m.contact_window(points);ys=[p[0]for p in points];zs=[p[1]for p in points]
 curve={'contactCenter':center,'sourceContactDuty':duty,'yMin':min(ys),'yMax':max(ys),'center':(min(ys)+max(ys))/2,'zMin':min(zs),'zMax':max(zs)}
 def sample(phase):
  f=(phase%1)*n;i=int(f);u=f-i;a=points[i];b=points[(i+1)%n];return SimpleNamespace(y=a[0]+(b[0]-a[0])*u,z=a[1]+(b[1]-a[1])*u)
 out[name]={'curve':curve,'samples':[m.foot_trajectory(f/n,curve,d['stride'],d['speed'],d['duration'],sample)for f in range(n+1)]}
json.dump(out,sys.stdout)`;
  const p = spawnSync(
    "python3",
    [
      "-c",
      script,
      fileURLToPath(new URL("./animal_trajectory.py", import.meta.url)),
    ],
    {
      input: JSON.stringify({
        curves,
        stride,
        speed: clip.name === "run" ? 13.2 : 2,
        duration,
      }),
      encoding: "utf8",
    },
  );
  if (p.status !== 0) throw Error(p.stderr);
  const result = JSON.parse(p.stdout);
  const restOffset = {};
  for (const kind of ["front", "rear"]) {
    const a = chains[kind + "_l"],
      b = chains[kind + "_r"];
    restOffset[kind] =
      (position(rest[bone(a[3])]).z -
        position(rest[bone(a[0])]).z +
        position(rest[bone(b[3])]).z -
        position(rest[bone(b[0])]).z) /
      2;
  }
  return {
    legs: result,
    lift,
    stride,
    restOffset,
    report: {
      adapter: "tools/blender/animal_trajectory.py",
      sourceHipSpan: hipSpan,
      targetStride: stride,
      sourceBellyClearance: clearance,
      targetLift: lift,
      nominalSpeed: clip.name === "run" ? 13.2 : 2,
      preservesDonorContactOrder: true,
    },
  };
}

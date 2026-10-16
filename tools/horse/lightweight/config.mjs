import path from "node:path";
export const work = process.env.HORSE_BUILD_WORK;
if (!work)
  throw new Error("Run tools/horse/build-lightweight-horse.mjs instead");
export const sourcePath = process.env.HORSE_BUILD_SOURCE;
export const donorPath = path.join(work, "donor.glb");
export const manifestPath = path.join(work, "donor-manifest.json");

/** Rebuild only into an explicit staging directory. Never overwrites public assets. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const option = (name, fallback) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const source = option("source");
const toktx = option("toktx");
if (!source || !toktx)
  throw new Error(
    "Required: --source=/path/horse.glb --toktx=/path/toktx [--python=python3] [--out=output/horse-build]",
  );
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const work = path.resolve(option("out", "output/horse-build"));
if (
  work === root ||
  work === path.join(root, "public") ||
  work.startsWith(path.join(root, "public") + path.sep)
)
  throw new Error("Use a staging directory outside public");
fs.mkdirSync(work, { recursive: true });
function requireHash(bytes, expected, label) {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== expected)
    throw new Error(
      `${label} hash mismatch: ${hash}; this repair is source-specific`,
    );
}
requireHash(
  fs.readFileSync(source),
  "1af80d4517beb4c79781b15e50285ebbdf7a4fd3a8f8d08f3c1d54f1e1b60712",
  "Source",
);
// Pin the donor before replacement; rebuilding must never retarget the new horse
// onto itself. An explicit original donor supports shallow repository clones.
const donor = option("donor")
  ? fs.readFileSync(option("donor"))
  : execFileSync(
      "git",
      ["show", "db7e0c0:public/models/mounts/v1/horse/horse_runtime.glb"],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
    );
requireHash(
  donor,
  "b7632cf8fe55b40d66d7fa60c4e7f43637eb79ac32c2f9d97bbff26e02c282c5",
  "Donor",
);
fs.writeFileSync(path.join(work, "donor.glb"), donor);
fs.copyFileSync(
  path.join(root, "tools/horse/lightweight/donor-manifest.json"),
  path.join(work, "donor-manifest.json"),
);
const versionResult = spawnSync(toktx, ["--version"], { encoding: "utf8" });
if (versionResult.error || versionResult.status !== 0)
  throw versionResult.error ?? new Error(versionResult.stderr);
const version = versionResult.stdout + versionResult.stderr;
if (!version.includes("4.4.2"))
  throw new Error(
    `Use KTX-Software 4.4.2 for reproducible textures: ${version}`,
  );
const env = {
  ...process.env,
  HORSE_BUILD_WORK: work,
  HORSE_BUILD_SOURCE: path.resolve(source),
  HORSE_BUILD_TOKTX: path.resolve(toktx),
};
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, env, stdio: "inherit" });
for (const stage of ["prepare", "bake", "lod", "tack", "flatten"])
  run(process.execPath, [`tools/horse/lightweight/${stage}.mjs`]);
run(option("python", "python3"), ["tools/horse/lightweight/textures.py"]);
run(process.execPath, ["tools/horse/lightweight/package.mjs"]);
console.log(
  `Staged package: ${path.join(work, "package")}. Inspect before copying into public.`,
);

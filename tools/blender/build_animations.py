"""Rebuild staged quadruped GLBs using the running GUI Blender MCP.

Run with uv run --python 3.11. This never promotes public assets. Start with a
fresh dedicated task scene; preserve any unrelated user Blender scene.
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/mount-retarget"


def command(*args):
    subprocess.run(["rtk", "proxy", *map(str, args)], cwd=ROOT, check=True)


def mcp(uv, stage, body):
    script = OUT / ("rebuild-" + stage + ".py")
    script.write_text(
        "import sys,runpy,importlib\nfrom pathlib import Path\n"
        + "root=Path(" + repr(str(ROOT)) + ")\n"
        + "sys.path.insert(0,str(root/'tools/blender'))\n"
        + "sys.modules.pop('animal_trajectory',None)\n"
        + "s=runpy.run_path(str(root/'tools/blender/retarget_animals.py'))\n"
        + body + "\n")
    command(uv, "run", "--python", "3.11", "tools/blender/mcp_client.py",
            "--timeout", "180", "exec", "--code-file", script,
            "--output", OUT / ("rebuild-" + stage + "-mcp.json"))
    result = json.loads((OUT / ("rebuild-" + stage + "-mcp.json")).read_text())
    # The upstream server returns code errors inside MCP content; exit status
    # alone is not a successful Blender operation.
    payload = result.get("result", {})
    if payload.get("isError"):
        raise RuntimeError("MCP failed at " + stage)
    texts = [item.get("text", "") for item in payload.get("content", [])]
    if not any("Code executed successfully" in text for text in texts):
        raise RuntimeError("Blender did not confirm execution at " + stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("animal", choices=["black-cat", "corgi", "all"])
    parser.add_argument("--uv", default=shutil.which("uv") or "uv")
    args = parser.parse_args()
    animals = ["black-cat", "corgi"] if args.animal == "all" else [args.animal]
    OUT.mkdir(parents=True, exist_ok=True)
    # Both immutable target inputs are needed by prepare_targets. The current
    # shipped packages are never used as a source for another generation.
    command("node", "tools/blender/animal_glb.mjs", "prepare")
    mcp(args.uv, "import", "s['import_donors']()")
    mcp(args.uv, "prepare", "s['prepare_targets']()")
    for donor in ["doginx_idle", "doginx_walk", "cat_run", "corgi_run"]:
        mcp(args.uv, "sample-" + donor, "s['sample_donor'](" + repr(donor) + ")")
    for animal in animals:
        # bake() previews run after each clip, so create run first.
        for clip in ["run", "idle", "walk", "death"]:
            mcp(args.uv, animal + "-" + clip,
                "s['bake'](" + repr(animal) + ", [" + repr(clip) + "])")
        if animal == "corgi":
            for clip in ["jump", "land", "hit"]:
                mcp(args.uv, animal + "-" + clip,
                    "runpy.run_path(str(root/'tools/blender/corgi_rig.py'))['bake_legacy'](("
                    + repr(clip) + ",))")
        mcp(args.uv, animal + "-finalize",
            "runpy.run_path(str(root/'tools/blender/finalize_animals.py'))['finalize']("
            + repr(animal) + ")")
        ground_clips = ["idle", "walk", "run"] + (["jump", "land", "hit"] if animal == "corgi" else [])
        for clip in ground_clips:
            mcp(args.uv, animal + "-ground-" + clip,
                "runpy.run_path(str(root/'tools/blender/ground_locomotion.py'))['ground_locomotion']("
                + repr(animal) + ", [" + repr(clip) + "])")
        mcp(args.uv, animal + "-export", "s['export_baked'](" + repr(animal) + ")")
        command("node", "tools/blender/animal_glb.mjs", "merge", animal)
    print("Staged only. Re-import each final roundtrip GLB through MCP and review before promotion.")


if __name__ == "__main__":
    main()

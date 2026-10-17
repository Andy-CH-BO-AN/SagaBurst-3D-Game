/** Byte-exact repository Meshopt packing; no pose/skin quantization. */
import fs from 'node:fs';
import {readGlb,encodeGlb} from '../lib/humanoid-glb.mjs';
import {packFactionHumanoidBuffers} from '../pack-faction-humanoid-buffers.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node tools/meshy-mounts/pack-mount-buffers.mjs INPUT.glb OUTPUT.glb');
const packed=await packFactionHumanoidBuffers(readGlb(input));
fs.writeFileSync(output,encodeGlb(packed.document,packed.binary));
fs.writeFileSync(`${output}.buffer-audit.json`,JSON.stringify(packed.report,null,2)+'\n');
console.log(JSON.stringify({bytes:fs.statSync(output).size,allBufferViewsByteExact:packed.report.allBufferViewsByteExact}));

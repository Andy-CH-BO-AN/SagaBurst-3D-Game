/** Standalone, explicit asset acceptance; never run by the unit test runner.
 * node tools/validate-black-cat-v3.mjs --source source.glb --asset candidate.glb \
 *   --donor donor.glb --transform-json transform.json \
 *   --regions-json tools/blender/black_cat_v3_regions.json --report output/audit.json
 * transform.json: { "sourceToAsset": [16 column-major numbers] }
 * --regions-json identifies flexible tack separately from the rigid
 * saddle: { "sourceSha256": "...", "rigidEquipmentFaceIndices": [...] }.
 * Geometry is compared as an oriented multiset of position/UV/normal triangles.
 * Rest skinning is checked separately, so preserving accessors cannot conceal a
 * changed bind shape. This establishes no visual, rider-fit, or GPU acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { loadRig, readGlb } from './lib/humanoid-glb.mjs';
import { decodeMeshoptGlb, embeddedBufferBytes } from './lib/meshopt-glb.mjs';
const SOURCE_SHA = '59c10fb0582b5dd90d3e281a73ad4b522ef33213506b315470b1382f6d521c4b';
const DONOR_SHA = '37c23b7cc3042c8d3aa23f03ca1484ac8f65e07f5ed9b92c0c4214ee1439695b';
const TRIANGLES = 30266;
const CLIPS = ['idle', 'walk', 'run', 'jump', 'land', 'hit', 'death'];
// Scope fingerprints are independent of the file consumed by the builder.
// Changing either requires a new source mask review, not only a new JSON file.
const REGION_SCOPE = {
    equipmentFaceIndices: { count: 10875, sha256: '7f9923ff855d890550510a71203aba64d4bde4fca0d04f46174468ffeeba494e' },
    rigidEquipmentFaceIndices: { count: 7524, sha256: 'e07c2984ae2d81ec51fed9f7c87c847080001f14fbb4af248575f1b8b797fb81' },
};
// Float32 export roundoff only; these are not mesh simplification tolerances.
const POSITION_EPSILON = 2e-6, UV_EPSILON = 1e-6, NORMAL_EPSILON = 2e-5;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let reportPath;
function options() {
    const result = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i];
        assert(['--source', '--asset', '--donor', '--transform-json', '--regions-json', '--report'].includes(key), `Unknown option ${key}`);
        assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing value for ${key}`);
        assert(!result[key.slice(2)], `Repeated option ${key}`);
        result[key.slice(2)] = path.resolve(process.argv[i + 1]);
    }
    for (const key of ['source', 'asset', 'donor', 'transform-json', 'regions-json', 'report'])
        assert(result[key], `Required --${key}`);
    assert(![result.source, result.asset, result.donor, result['transform-json'], result['regions-json']].includes(result.report), 'Report must not overwrite an input');
    return result;
}
async function read(file) {
    const raw = fs.readFileSync(file);
    assert.equal(raw.toString('ascii', 0, 4), 'glTF', `Invalid GLB: ${file}`);
    assert.equal(raw.readUInt32LE(4), 2, 'Expected glTF 2');
    assert.equal(raw.readUInt32LE(8), raw.length, 'Truncated GLB');
    assert.equal(raw.toString('ascii', 16, 20), 'JSON', 'Expected GLB JSON chunk');
    const asset = await decodeMeshoptGlb(readGlb(file));
    return { ...asset, file, sha256: sha(raw), bytes: raw.length, cache: new Map() };
}
function accessor(asset, index) {
    if (asset.cache.has(index))
        return asset.cache.get(index);
    const a = asset.document.accessors[index];
    assert(a && !a.sparse, `Missing or unsupported sparse accessor ${index}`);
    const view = asset.document.bufferViews[a.bufferView];
    assert(view, `Missing bufferView for accessor ${index}`);
    const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const readers = { 5120: ['readInt8', 1, 127], 5121: ['readUInt8', 1, 255], 5122: ['readInt16LE', 2, 32767], 5123: ['readUInt16LE', 2, 65535], 5125: ['readUInt32LE', 4, 4294967295], 5126: ['readFloatLE', 4, 1] };
    const width = widths[a.type], reader = readers[a.componentType];
    assert(width && reader, `Unsupported accessor ${index}`);
    const data = embeddedBufferBytes(asset, view.buffer, view.byteOffset ?? 0, view.byteLength);
    const stride = view.byteStride ?? width * reader[1], start = a.byteOffset ?? 0;
    assert(stride >= width * reader[1] && start + (a.count - 1) * stride + width * reader[1] <= data.length, `Accessor ${index} exceeds bufferView`);
    const values = new Float64Array(a.count * width);
    for (let row = 0; row < a.count; row++)
        for (let column = 0; column < width; column++) {
            let value = data[reader[0]](start + row * stride + column * reader[1]);
            if (a.normalized)
                value = Math.max(-1, value / reader[2]);
            assert(Number.isFinite(value), `Nonfinite accessor ${index}, element ${row}`);
            values[row * width + column] = value;
        }
    const result = { values, width, count: a.count };
    asset.cache.set(index, result);
    return result;
}
function transforms(asset) {
    const nodes = asset.document.nodes, parents = new Map(), result = [], pending = new Set();
    nodes.forEach((node, i) => (node.children ?? []).forEach(child => {
        assert(nodes[child] && !parents.has(child), 'Node hierarchy must be a tree');
        parents.set(child, i);
    }));
    function world(i) {
        if (result[i])
            return result[i];
        assert(!pending.has(i), 'Cyclic node hierarchy');
        pending.add(i);
        const n = nodes[i];
        const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3().fromArray(n.translation ?? [0, 0, 0]), new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(n.scale ?? [1, 1, 1]));
        assert(local.elements.every(Number.isFinite), `Nonfinite node ${n.name}`);
        result[i] = parents.has(i) ? world(parents.get(i)).clone().multiply(local) : local;
        pending.delete(i);
        return result[i];
    }
    nodes.forEach((_, i) => world(i));
    return result;
}
function uniformTransform(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')), values = data.sourceToAsset;
    assert(Array.isArray(values) && values.length === 16 && values.every(Number.isFinite), 'sourceToAsset must be a column-major 4x4 matrix');
    const matrix = new Matrix4().fromArray(values);
    assert(Math.abs(values[3]) + Math.abs(values[7]) + Math.abs(values[11]) + Math.abs(values[15] - 1) < 1e-10, 'Only affine transforms are permitted');
    const axes = [0, 4, 8].map(i => new Vector3(values[i], values[i + 1], values[i + 2]));
    const scale = axes[0].length();
    assert(scale > 0 && axes.every(axis => Math.abs(axis.length() - scale) < scale * 1e-8), 'Nonuniform source scaling is forbidden');
    assert(Math.abs(axes[0].dot(axes[1])) + Math.abs(axes[0].dot(axes[2])) + Math.abs(axes[1].dot(axes[2])) < scale * scale * 1e-8, 'Source shear is forbidden');
    assert(matrix.determinant() > 0, 'Source mirroring is forbidden');
    return { matrix, scale };
}
function meshNodes(asset) {
    return asset.document.nodes.flatMap((node, index) => node.mesh === undefined ? [] : [{ node, index }]);
}
function triangles(asset, nodes, world, coordinateTransform = new Matrix4()) {
    const result = [];
    for (const { node, index } of nodes) {
        const matrix = coordinateTransform.clone().multiply(world[index]), normalMatrix = new Matrix3().getNormalMatrix(matrix);
        for (const primitive of asset.document.meshes[node.mesh].primitives) {
            assert((primitive.mode ?? 4) === 4 && !primitive.targets, `${node.name}: expected triangles without morph deformation`);
            const position = accessor(asset, primitive.attributes.POSITION), uv = accessor(asset, primitive.attributes.TEXCOORD_0), normal = accessor(asset, primitive.attributes.NORMAL);
            const indices = primitive.indices === undefined ? Array.from({ length: position.count }, (_, i) => i) : accessor(asset, primitive.indices).values;
            assert.equal(indices.length % 3, 0, 'Incomplete triangle');
            assert(position.width === 3 && uv.width === 2 && normal.width === 3 && uv.count === position.count && normal.count === position.count, 'Invalid corner attributes');
            for (let i = 0; i < indices.length; i += 3) {
                const corners = Array.from(indices.slice(i, i + 3), vertex => {
                    assert(Number.isInteger(vertex) && vertex >= 0 && vertex < position.count, 'Invalid triangle index');
                    return {
                        vertex, sourceVertexKey: `${index}:${primitive.attributes.POSITION}:${vertex}`,
                        position: new Vector3().fromArray(position.values, vertex * 3).applyMatrix4(matrix),
                        normal: new Vector3().fromArray(normal.values, vertex * 3).applyNormalMatrix(normalMatrix),
                        uv: Array.from(uv.values.slice(vertex * 2, vertex * 2 + 2)),
                    };
                });
                result.push({ corners, centroid: corners.reduce((sum, c) => sum.add(c.position), new Vector3()).multiplyScalar(1 / 3), mesh: node.name, material: primitive.material });
            }
        }
    }
    return result;
}
function compareTriangles(source, candidate) {
    assert.equal(candidate.length, source.length, 'LOD0 must contain every source triangle exactly once');
    const cell = POSITION_EPSILON * 2, key = (x, y, z) => `${x},${y},${z}`;
    const coordinates = p => [Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)];
    const buckets = new Map(), used = new Set();
    source.forEach((face, i) => {
        const k = key(...coordinates(face.centroid));
        if (!buckets.has(k))
            buckets.set(k, []);
        buckets.get(k).push(i);
    });
    let maximumPositionError = 0, maximumUvError = 0, maximumNormalError = 0;
    const correspondence = [];
    for (const [faceIndex, face] of candidate.entries()) {
        const [x, y, z] = coordinates(face.centroid), matches = [];
        for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                    for (const index of buckets.get(key(x + dx, y + dy, z + dz)) ?? []) {
                        if (used.has(index) || face.material !== source[index].material)
                            continue;
                        for (let shift = 0; shift < 3; shift++) {
                            let pe = 0, ue = 0, ne = 0;
                            for (let corner = 0; corner < 3; corner++) {
                                const a = source[index].corners[corner], b = face.corners[(corner + shift) % 3];
                                pe = Math.max(pe, a.position.distanceTo(b.position));
                                ue = Math.max(ue, ...a.uv.map((value, component) => Math.abs(value - b.uv[component])));
                                ne = Math.max(ne, a.normal.distanceTo(b.normal));
                            }
                            if (pe <= POSITION_EPSILON && ue <= UV_EPSILON && ne <= NORMAL_EPSILON) {
                                matches.push({ index, shift, pe, ue, ne });
                            }
                        }
                    }
                }
        assert(matches.length, `LOD0 triangle ${faceIndex} (${face.mesh}) is changed, reversed, duplicated, or absent from source`);
        matches.sort((a, b) => a.pe + a.ue + a.ne - b.pe - b.ue - b.ne);
        const match = matches[0];
        correspondence.push({ source: match.index, candidate: faceIndex, shift: match.shift });
        used.add(match.index);
        maximumPositionError = Math.max(maximumPositionError, match.pe);
        maximumUvError = Math.max(maximumUvError, match.ue);
        maximumNormalError = Math.max(maximumNormalError, match.ne);
    }
    assert.equal(used.size, source.length, 'LOD0: missing original source triangles');
    return { correspondence, sourceTriangles: source.length, finalTriangles: candidate.length, matchedSourceTriangles: used.size, windingPreserved: true, maximumPositionError, maximumUvError, maximumNormalError,
        tolerances: { positionInSourceUnits: POSITION_EPSILON, uv: UV_EPSILON, normalVector: NORMAL_EPSILON } };
}
function sourceBoundaryPairs(sourceFaces, finalFaces, correspondence) {
    const sourceVertices = new Map(), coincidentPositions = new Map();
    const add = (map, key, corner) => {
        if (!map.has(key))
            map.set(key, new Map());
        map.get(key).set(`${corner.mesh}:${corner.vertex}`, corner);
    };
    for (const match of correspondence)
        for (let corner = 0; corner < 3; corner++) {
            const original = sourceFaces[match.source].corners[corner];
            const face = finalFaces[match.candidate], final = face.corners[(corner + match.shift) % 3];
            const value = { mesh: face.mesh, vertex: final.vertex, sourceVertex: original.sourceVertexKey };
            add(sourceVertices, original.sourceVertexKey, value);
            add(coincidentPositions, original.position.toArray().map(x => x.toPrecision(12)).join(','), value);
        }
    function pairs(groups, distinctSourceIndices) {
        const found = new Map();
        for (const group of groups.values()) {
            const body = [...group.values()].filter(v => v.mesh === 'cat_body_lod0');
            const gear = [...group.values()].filter(v => v.mesh === 'cat_saddle_leather');
            for (const a of body)
                for (const b of gear)
                    if (!distinctSourceIndices || a.sourceVertex !== b.sourceVertex)
                        found.set(`${a.vertex}:${b.vertex}`, [a, b]);
        }
        return [...found.values()];
    }
    return { sharedSourceIndexPairs: pairs(sourceVertices, false), coincidentDistinctSourceIndexPairs: pairs(coincidentPositions, true) };
}
function sourceRegions(file, finalFaces, correspondence) {
    const bytes = fs.readFileSync(file), data = JSON.parse(bytes), sets = {};
    assert.equal(data.sourceSha256, SOURCE_SHA, 'Region source identity mismatch');
    for (const [name, expected] of Object.entries(REGION_SCOPE)) {
        const indices = data[name];
        assert(Array.isArray(indices) && indices.every(i => Number.isInteger(i) && i >= 0 && i < TRIANGLES), `Invalid ${name}`);
        sets[name] = new Set(indices);
        assert.equal(sets[name].size, indices.length, `Repeated ${name} index`);
        assert.equal(indices.length, expected.count, `${name}: changed reviewed scope count`);
        assert.equal(sha(JSON.stringify([...indices].sort((a, b) => a - b))), expected.sha256, `${name}: changed reviewed scope; inspect the original source mask before updating its fingerprint`);
    }
    const equipment = sets.equipmentFaceIndices, selected = sets.rigidEquipmentFaceIndices;
    for (const index of selected)
        assert(equipment.has(index), `Rigid face ${index} is outside equipment`);
    for (const match of correspondence) {
        const expectedMesh = equipment.has(match.source) ? 'cat_saddle_leather' : 'cat_body_lod0';
        assert.equal(finalFaces[match.candidate].mesh, expectedMesh, `Source face ${match.source} moved between body and equipment partitions`);
    }
    const metadata = {
        regionsSha256: sha(bytes), sourceFaces: selected.size, equipmentSourceFaces: equipment.size,
        scopeFingerprints: REGION_SCOPE,
        scope: 'Explicit original source triangle IDs for rigid saddle/equipment; flexible tack excluded',
    };
    const faces = correspondence.filter(match => selected.has(match.source)).map(match => {
        const face = finalFaces[match.candidate];
        assert.equal(face.mesh, 'cat_saddle_leather', `Rigid source face ${match.source} is not in the equipment partition`);
        return face.corners.map(corner => corner.vertex);
    });
    assert.equal(faces.length, selected.size, 'Missing rigid equipment source face');
    return { faces, metadata };
}
function skinAudit(asset, meshes, world) {
    const body = meshes.find(({ node }) => node.name === 'cat_body_lod0');
    assert(body, 'Missing cat_body_lod0');
    const reference = asset.document.skins[body.node.skin];
    assert(reference?.inverseBindMatrices !== undefined, 'LOD0 requires skin inverse binds');
    const binds = accessor(asset, reference.inverseBindMatrices);
    assert.equal(binds.width, 16);
    assert.equal(binds.count, reference.joints.length);
    let maximumRestPositionError = 0, maximumWeightError = 0;
    for (const { node, index } of meshes) {
        const skin = asset.document.skins[node.skin];
        assert(skin && JSON.stringify(skin.joints) === JSON.stringify(reference.joints), `${node.name}: incompatible joint ordering`);
        const inverses = accessor(asset, skin.inverseBindMatrices);
        assert.equal(inverses.values.length, binds.values.length, `${node.name}: incompatible bind count`);
        assert(inverses.values.every((v, i) => Math.abs(v - binds.values[i]) < 1e-8), `${node.name}: incompatible inverse binds`);
        const matrices = skin.joints.map((joint, i) => world[joint].clone().multiply(new Matrix4().fromArray(inverses.values, i * 16)));
        for (const primitive of asset.document.meshes[node.mesh].primitives) {
            const p = accessor(asset, primitive.attributes.POSITION), j = accessor(asset, primitive.attributes.JOINTS_0), w = accessor(asset, primitive.attributes.WEIGHTS_0);
            assert(p.count === j.count && p.count === w.count && j.width === 4 && w.width === 4, `${node.name}: invalid skin attributes`);
            assert(primitive.attributes.JOINTS_1 === undefined && primitive.attributes.WEIGHTS_1 === undefined, `${node.name}: runtime supports four influences`);
            const point = new Vector3(), rest = new Vector3(), skinned = new Vector3(), temporary = new Vector3();
            for (let v = 0; v < p.count; v++) {
                point.fromArray(p.values, v * 3);
                rest.copy(point).applyMatrix4(world[index]);
                skinned.set(0, 0, 0);
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    const joint = j.values[v * 4 + k], weight = w.values[v * 4 + k];
                    assert(Number.isInteger(joint) && joint >= 0 && joint < matrices.length && weight >= 0 && weight <= 1, `${node.name}: invalid influence`);
                    sum += weight;
                    skinned.addScaledVector(temporary.copy(point).applyMatrix4(matrices[joint]), weight);
                }
                maximumWeightError = Math.max(maximumWeightError, Math.abs(sum - 1));
                maximumRestPositionError = Math.max(maximumRestPositionError, skinned.distanceTo(rest));
            }
        }
    }
    assert(maximumWeightError <= 1e-5, `Unnormalized weights: ${maximumWeightError}`);
    assert(maximumRestPositionError <= 1e-5, `Changed skin bind shape: ${maximumRestPositionError}`);
    return { joints: reference.joints.length, maximumWeightError, maximumRestPositionError, identicalJointOrderingAndInverseBinds: true };
}
function animationAudit(asset, donor) {
    const all = asset.document.animations ?? [];
    assert.deepEqual(all.map(a => a.name).sort(), [...CLIPS].sort(), 'Exactly seven named clips are required');
    const fingerprints = new Set();
    return CLIPS.map(name => {
        const animation = all.find(a => a.name === name), original = donor.document.animations.find(a => a.name === name);
        assert(original, `Missing donor ${name}`);
        const duration = a => Math.max(...a.samplers.map(s => accessor(a === animation ? asset : donor, s.input).values.at(-1)));
        const seconds = duration(animation), donorSeconds = duration(original);
        assert(seconds > 0 && Math.abs(seconds - donorSeconds) <= 1e-6, `${name}: changed donor duration ${seconds} vs ${donorSeconds}`);
        const targets = new Set(), hash = createHash('sha256');
        let changingChannels = 0;
        for (const channel of animation.channels) {
            const target = `${channel.target.node}:${channel.target.path}`, sampler = animation.samplers[channel.sampler];
            assert(asset.document.nodes[channel.target.node] && !targets.has(target), `${name}: missing/duplicate target`);
            targets.add(target);
            assert(['translation', 'rotation', 'scale'].includes(channel.target.path), `${name}: unsupported animation property`);
            assert(['LINEAR', 'STEP'].includes(sampler.interpolation ?? 'LINEAR'), `${name}: expected baked linear/step samples`);
            const time = accessor(asset, sampler.input), values = accessor(asset, sampler.output);
            assert(time.width === 1 && time.count === values.count && time.values[0] === 0, `${name}: invalid sample count/start`);
            for (let i = 1; i < time.count; i++)
                assert(time.values[i] > time.values[i - 1], `${name}: non-increasing sample time`);
            assert.equal(values.width, channel.target.path === 'rotation' ? 4 : 3, `${name}: invalid output width`);
            if (channel.target.path === 'rotation')
                for (let i = 0; i < values.count; i++)
                    assert(Math.abs(Math.hypot(...values.values.slice(i * 4, i * 4 + 4)) - 1) < 1e-4, `${name}: non-unit rotation`);
            if (values.values.some((value, i) => i >= values.width && Math.abs(value - values.values[i % values.width]) > 1e-6))
                changingChannels++;
            hash.update(Buffer.from(time.values.buffer));
            hash.update(Buffer.from(values.values.buffer));
        }
        assert(changingChannels > 0, `${name}: static animation`);
        const fingerprint = hash.digest('hex');
        assert(!fingerprints.has(fingerprint), `${name}: duplicate animation`);
        fingerprints.add(fingerprint);
        return { name, duration: seconds, donorDuration: donorSeconds, channels: targets.size, changingChannels, fingerprint };
    });
}
function appearanceAudit(source, asset) {
    assert.equal(asset.document.materials.length, source.document.materials.length, 'Unexpected extra material');
    assert.equal(asset.document.images.length, source.document.images.length, 'Unexpected extra image');
    function appearance(a, selected) {
        return selected.map(index => a.document.materials[index]).map(m => ({
            doubleSided: m.doubleSided ?? false, alphaMode: m.alphaMode ?? 'OPAQUE', alphaCutoff: m.alphaCutoff ?? .5,
            baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
            metallicFactor: m.pbrMetallicRoughness?.metallicFactor ?? 1, roughnessFactor: m.pbrMetallicRoughness?.roughnessFactor ?? 1,
            emissiveFactor: m.emissiveFactor ?? [0, 0, 0], extensions: m.extensions ?? {},
            maps: ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'].map(role => {
                const info = m[role] ?? m.pbrMetallicRoughness?.[role];
                if (!info)
                    return null;
                const texture = a.document.textures[info.index], sampler = a.document.samplers?.[texture.sampler] ?? {};
                return { role, texCoord: info.texCoord ?? 0, scale: info.scale ?? 1, strength: info.strength ?? 1, extensions: info.extensions ?? {}, wrapS: sampler.wrapS ?? 10497, wrapT: sampler.wrapT ?? 10497, minFilter: sampler.minFilter ?? null, magFilter: sampler.magFilter ?? null };
            }),
        }));
    }
    assert.deepEqual(appearance(asset, [0]), appearance(source, [0]), 'Changed original material/texture/UV configuration');
    function images(a) {
        return a.document.images.map(image => {
            assert(image.bufferView !== undefined && !image.uri, 'Images must be embedded');
            const view = a.document.bufferViews[image.bufferView];
            const bytes = embeddedBufferBytes(a, view.buffer, view.byteOffset ?? 0, view.byteLength);
            return { sha256: sha(bytes), bytes: bytes.length, mimeType: image.mimeType };
        });
    }
    const original = images(source), final = images(asset);
    const mapImages = a => [a.document.materials[0]].flatMap(m => ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'].flatMap(role => {
        const info = m[role] ?? m.pbrMetallicRoughness?.[role];
        return info ? [{ role, image: a.document.textures[info.index].source }] : [];
    }));
    const sourceMaps = mapImages(source), finalMaps = mapImages(asset);
    let imageBytesUnchanged = true;
    for (let i = 0; i < sourceMaps.length; i++) {
        const before = original[sourceMaps[i].image], after = final[finalMaps[i].image];
        assert(after, 'Texture references a missing image');
        assert.equal(after.sha256, before.sha256, `Original ${sourceMaps[i].role} image changed; texture recompression needs an explicit visual review before this contract can be revised`);
        imageBytesUnchanged &&= after.sha256 === before.sha256;
    }
    return { materialConfigurationPreserved: true, originalImages: original, finalImages: final,
        equippedMaterialImageBytesUnchanged: imageBytesUnchanged, equippedMaterialMapImages: finalMaps,
        imageCompressionAppearance: 'Current package retains exact original image bytes; alternate compression requires separate visual acceptance and a reviewed contract update' };
}
async function posedAudit(asset, boundary, rigidRegion) {
    const rig = await loadRig(asset), mixer = new AnimationMixer(rig.scene), meshes = [], skeletons = new Set();
    rig.scene.updateMatrixWorld(true);
    rig.scene.traverse(object => { if (object.isMesh) {
        assert(object.isSkinnedMesh, `${object.name}: failed skinned GLB load`);
        meshes.push(object);
        skeletons.add(object.skeleton);
    } });
    const saddle = rig.scene.getObjectByName('cat_saddle_leather');
    assert(saddle?.isSkinnedMesh, 'Saddle must load as a direct SkinnedMesh');
    for (const name of ['cat_body_lod0', 'cat_body_lod1', 'cat_body_lod2', 'cat_equipment_lod1', 'cat_equipment_lod2'])
        assert(rig.scene.getObjectByName(name)?.isSkinnedMesh, `${name}: missing from loaded scene`);
    for (const name of ['socket_saddle_seat', 'socket_camera'])
        assert(rig.scene.getObjectByName(name), `${name}: missing from loaded scene`);
    const positions = saddle.geometry.attributes.position, index = saddle.geometry.index;
    assert(index, 'Indexed saddle required');
    const rest = Array.from({ length: positions.count }, (_, i) => new Vector3().fromBufferAttribute(positions, i).applyMatrix4(saddle.matrixWorld));
    const usedVertices = [...new Set(rigidRegion.faces.flat())];
    const uniqueEdges = new Map();
    for (const face of rigidRegion.faces)
        for (let corner = 0; corner < 3; corner++) {
            const a = face[corner], b = face[(corner + 1) % 3];
            uniqueEdges.set([Math.min(a, b), Math.max(a, b)].join(','), [a, b]);
        }
    const pairs = [...uniqueEdges.values()];
    const anchors = ['x', 'y', 'z'].flatMap(axis => [usedVertices.reduce((best, i) => rest[i][axis] < rest[best][axis] ? i : best), usedVertices.reduce((best, i) => rest[i][axis] > rest[best][axis] ? i : best)]);
    // Every vertex of every declared rigid source face participates. Sampling
    // only a few edges could miss a small bag corner or one deformed stirrup.
    for (const vertex of usedVertices) {
        for (const anchor of new Set(anchors)) {
            if (vertex !== anchor)
                pairs.push([vertex, anchor]);
        }
    }
    const selected = [...new Set(pairs.flat())], lengths = pairs.map(([a, b]) => rest[a].distanceTo(rest[b]));
    const posed = new Map(selected.map(i => [i, new Vector3()])), point = new Vector3(), reports = [];
    const boundaryReferences = new Map([...boundary.sharedSourceIndexPairs, ...boundary.coincidentDistinctSourceIndexPairs].flat().map(v => [`${v.mesh}:${v.vertex}`, { ...v, object: rig.scene.getObjectByName(v.mesh), point: new Vector3() }]));
    function boundaryError(pairs) {
        let maximum = 0;
        for (const [a, b] of pairs)
            maximum = Math.max(maximum, boundaryReferences.get(`${a.mesh}:${a.vertex}`).point.distanceTo(boundaryReferences.get(`${b.mesh}:${b.vertex}`).point));
        return maximum;
    }
    try {
        for (const clip of rig.animations) {
            mixer.stopAllAction();
            const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
            action.clampWhenFinished = true;
            action.play();
            const keyTimes = [...new Set(clip.tracks.flatMap(track => Array.from(track.times)))].sort((a, b) => a - b);
            const times = [...new Set([...keyTimes, ...keyTimes.slice(1).map((time, i) => (keyTimes[i] + time) * .5)])].sort((a, b) => a - b);
            let maximumDistanceError = 0, maximumSharedSourceBoundarySeparation = 0, maximumCoincidentPositionSeparation = 0;
            for (const time of times) {
                action.paused = false;
                mixer.setTime(time);
                rig.scene.updateMatrixWorld(true);
                saddle.skeleton.update();
                for (const skeleton of skeletons)
                    skeleton.update();
                for (const vertex of selected)
                    saddle.getVertexPosition(vertex, posed.get(vertex)).applyMatrix4(saddle.matrixWorld);
                for (let i = 0; i < pairs.length; i++) {
                    const [a, b] = pairs[i];
                    maximumDistanceError = Math.max(maximumDistanceError, Math.abs(posed.get(a).distanceTo(posed.get(b)) - lengths[i]));
                }
                for (const v of boundaryReferences.values())
                    v.object.getVertexPosition(v.vertex, v.point).applyMatrix4(v.object.matrixWorld);
                maximumSharedSourceBoundarySeparation = Math.max(maximumSharedSourceBoundarySeparation, boundaryError(boundary.sharedSourceIndexPairs));
                maximumCoincidentPositionSeparation = Math.max(maximumCoincidentPositionSeparation, boundaryError(boundary.coincidentDistinctSourceIndexPairs));
            }
            assert(maximumDistanceError < 5e-5, `${clip.name}: saddle stretched ${maximumDistanceError}m`);
            assert(maximumSharedSourceBoundarySeparation < 5e-5, `${clip.name}: original shared body/gear vertices separated ${maximumSharedSourceBoundarySeparation}m`);
            const bounds = [];
            for (const phase of [0, .13, .37, .63, .89, 1]) {
                action.paused = false;
                mixer.setTime(phase * clip.duration);
                rig.scene.updateMatrixWorld(true);
                let bodyMinY = Infinity, bodyMaxY = -Infinity;
                for (const mesh of meshes) {
                    mesh.skeleton.update();
                    const used = mesh.geometry.index ? new Set(mesh.geometry.index.array) : Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => i);
                    for (const vertex of used) {
                        mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
                        assert(Number.isFinite(point.x + point.y + point.z), `${clip.name}/${phase}: nonfinite posed vertex in ${mesh.name}`);
                        if (mesh.name === 'cat_body_lod0') {
                            bodyMinY = Math.min(bodyMinY, point.y);
                            bodyMaxY = Math.max(bodyMaxY, point.y);
                        }
                    }
                }
                bounds.push({ phase, bodyMinY, bodyMaxY });
            }
            reports.push({ name: clip.name, rigiditySamples: times.length, checkedDistances: pairs.length, maximumSaddleDistanceError: maximumDistanceError, maximumSharedSourceBoundarySeparation, maximumCoincidentPositionSeparation, bodyBounds: bounds });
        }
    }
    finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(rig.scene);
        for (const skeleton of skeletons)
            skeleton.dispose();
        for (const mesh of meshes) {
            mesh.geometry.dispose();
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
                material.dispose();
        }
    }
    return { gltfLoaderSucceeded: true, rigidEquipment: { ...rigidRegion.metadata, vertices: usedVertices.length, everyRigidVertexChecked: true, measurement: 'All original rigid-region edges plus every rigid vertex to spatial anchors' }, saddleToleranceMeters: 5e-5, clips: reports,
        boundary: { sharedSourceIndexPairCount: boundary.sharedSourceIndexPairs.length, toleranceMeters: 5e-5, coincidentDistinctSourceIndexPairCount: boundary.coincidentDistinctSourceIndexPairs.length,
            coincidentPositionPolicy: 'Diagnostic only: distinct source indices at the same position may belong to independent surfaces; they are not assumed to share support.' },
        boundsInterpretation: 'Model-space body bounds are diagnostics only; runtime jump translation and terrain are not simulated. They do not establish contact or a natural gait.' };
}
async function main() {
    const args = options();
    reportPath = args.report;
    const source = await read(args.source), asset = await read(args.asset), donor = await read(args.donor);
    assert.equal(source.sha256, SOURCE_SHA, 'Wrong source GLB');
    assert.equal(donor.sha256, DONOR_SHA, 'Wrong production animation donor');
    const { matrix, scale } = uniformTransform(args['transform-json']);
    const sourceWorld = transforms(source), finalWorld = transforms(asset), meshes = meshNodes(asset);
    const names = meshes.map(({ node }) => node.name);
    assert.equal(new Set(names).size, names.length, 'Mesh node names must be unique');
    const expected = ['cat_body_lod0', 'cat_saddle_leather', 'cat_body_lod1', 'cat_equipment_lod1', 'cat_body_lod2', 'cat_equipment_lod2'];
    assert(!asset.document.nodes.some(node => node.name?.startsWith('cat_unarmored')), 'Unequipped black-cat nodes are no longer part of this asset');
    assert.deepEqual([...names].sort(), [...expected].sort(), 'Unexpected/extra mesh geometry; all LOD0 faces must be accounted for');
    for (const { node } of meshes)
        assert.equal(asset.document.meshes[node.mesh].primitives.length, 1, `${node.name} must load as a direct SkinnedMesh`);
    assert.equal(new Set(meshes.map(({ node }) => node.mesh)).size, asset.document.meshes.length, 'Unexpected unreferenced or shared mesh definition');
    for (const name of ['socket_saddle_seat', 'socket_camera'])
        assert.equal(asset.document.nodes.filter(n => n.name === name).length, 1, `Missing/duplicate ${name}`);
    assert.equal(source.document.materials.length, 1, 'Expected original one-material source');
    for (const { node } of meshes)
        for (const primitive of asset.document.meshes[node.mesh].primitives) {
            assert(asset.document.materials[primitive.material], `${node.name}: missing material`);
            assert.equal(primitive.material, 0, `${node.name}: changed original material assignment`);
        }
    const lod0 = meshes.filter(({ node }) => ['cat_body_lod0', 'cat_saddle_leather'].includes(node.name));
    const sourceAttributes = Object.keys(source.document.meshes[0].primitives[0].attributes).sort();
    for (const { node } of lod0) {
        const primitive = asset.document.meshes[node.mesh].primitives[0];
        assert.deepEqual(Object.keys(primitive.attributes).sort(), sourceAttributes, `${node.name}: changed visible vertex attributes (for example COLOR_0)`);
        assert(!Object.keys(primitive.extensions ?? {}).length, `${node.name}: unreviewed primitive appearance extension`);
    }
    const sourceFaces = triangles(source, meshNodes(source), sourceWorld), finalFaces = triangles(asset, lod0, finalWorld, matrix.clone().invert());
    assert.equal(sourceFaces.length, TRIANGLES, 'Wrong source triangle count');
    const { correspondence, ...geometry } = compareTriangles(sourceFaces, finalFaces);
    const boundary = sourceBoundaryPairs(sourceFaces, finalFaces, correspondence);
    const rigidRegion = sourceRegions(args['regions-json'], finalFaces, correspondence);
    const lods = [0, 1, 2].map(level => {
        const selected = meshes.filter(({ node }) => node.name === `cat_body_lod${level}` || node.name === (level ? `cat_equipment_lod${level}` : 'cat_saddle_leather'));
        return { level, triangles: triangles(asset, selected, finalWorld).length, meshes: selected.map(({ node }) => node.name) };
    });
    assert(lods[0].triangles > lods[1].triangles && lods[1].triangles > lods[2].triangles, 'LODs must independently reduce triangles');
    const report = {
        status: 'pass', source: { sha256: source.sha256, bytes: source.bytes }, asset: { sha256: asset.sha256, bytes: asset.bytes }, donor: { sha256: donor.sha256, bytes: donor.bytes },
        sourceToAsset: matrix.elements, uniformScale: scale, geometry, skin: skinAudit(asset, meshes, finalWorld),
        lods, clips: animationAudit(asset, donor), appearance: appearanceAudit(source, asset), posed: await posedAudit(asset, boundary, rigidRegion),
        limits: ['This asset audit does not prove natural gait, foot contact, absence of clipping, rider fit, LOD switching, gameplay, or GPU performance. Those require separate evidence.'],
    };
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
    console.error(error.stack ?? error);
    if (reportPath) {
        try {
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, JSON.stringify({ status: 'fail', error: error.message }, null, 2) + '\n');
        }
        catch (reportError) {
            console.error(`Could not replace validation report: ${reportError.message}`);
        }
    }
    process.exitCode = 1;
});

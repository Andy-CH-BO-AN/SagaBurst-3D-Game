import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Blender sampled quaternion continuity', () => {
  it('keeps half-frame chest rotation continuous without changing keyed orientations', () => {
    const result = JSON.parse(execFileSync('python3', ['-c', `
import json, math, runpy
continuous=runpy.run_path('tools/blender/animal_quaternion.py')['continuous_quaternions']
# Actual Corgi chest samples at frames 26 and 27: equivalent hemispheres
# must not interpolate through a near-zero quaternion and turn upside down.
original=[[-.9998892893280207,-.014879821474259015,2.9405524418728414e-9,-9.482220429553685e-9],[.9999276709145845,.012027175035488896,-8.512301916979776e-11,6.815185147552004e-9]]
values,flips=continuous(original)
mid=[(a+b)/2 for a,b in zip(*values)];norm=math.sqrt(sum(v*v for v in mid));mid=[v/norm for v in mid]
angles=[2*math.acos(min(1,abs(sum(a*b for a,b in zip(mid,q)))))for q in values]
equivalent=[abs(sum(a*b for a,b in zip(q,v)))/math.sqrt(sum(x*x for x in q))for q,v in zip(original,values)]
print(json.dumps({'flips':flips,'norm':norm,'angles':angles,'equivalent':equivalent}))
`], { encoding: 'utf8' }));
    expect(result.flips).toBe(1);
    expect(result.norm).toBeGreaterThan(0.999);
    for (const angle of result.angles) expect(angle).toBeLessThan(0.01);
    for (const dot of result.equivalent) expect(dot).toBeCloseTo(1, 12);
  });

  it('closes equivalent loop endpoints and rejects invalid rotation samples', () => {
    const result = JSON.parse(execFileSync('python3', ['-c', `
import json,runpy
continuous=runpy.run_path('tools/blender/animal_quaternion.py')['continuous_quaternions']
values,_=continuous([[2,0,0,0],[-3,0,0,0],[1,0,0,0]],loop=True)
rejected=0
for bad in [[0,0,0,0],[float('nan'),0,0,0],[float('inf'),0,0,0]]:
 try:continuous([bad])
 except AssertionError:rejected+=1
print(json.dumps({'values':values,'rejected':rejected}))
`], { encoding: 'utf8' }));
    for (const q of result.values) {
      expect(q[0]).toBeCloseTo(1, 12);
      for (const v of q.slice(1)) expect(v).toBeCloseTo(0, 12);
    }
    expect(result.rejected).toBe(3);
  });
});

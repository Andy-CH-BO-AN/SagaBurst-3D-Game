'use strict'
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(process.argv[2]||'source'),out=path.resolve('identity-diagnostics')
fs.mkdirSync(out,{recursive:true})
const cases=[
 ['src/rpg/WeaponDatabase.ts',"return faction === 'roman' ?","return (faction === 'roman') ?"],
 ['src/world/CharacterEquipmentPose.ts',"({ shield: false, lance: false","({ shield: Boolean(0), lance: false"],
 ['src/world/WeaponMeshFactory.ts',"const stationCount = widths.length","const stationCount = Number(widths.length)"],
 ['src/world/PaladinEquipment.ts',"return template.clone(true)","return template.clone(Boolean(1))"],
]
const runId='run_d06066084020ac43',result={runId,steps:[],scenarios:[]}
function command(args,label){
 const p=cp.spawnSync('npx',['--yes','supercov@4.24.2',...args],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024})
 fs.writeFileSync(path.join(out,label+'.stdout'),p.stdout||'')
 fs.writeFileSync(path.join(out,label+'.stderr'),p.stderr||'')
 const summary={label,exit:p.status,stderr:(p.stderr||'').slice(-800)}
 let d
 try{d=JSON.parse(p.stdout)}catch{}
 if(d){
  const v=d.data||{},counts=v.summary||{}
  summary.json={ok:d.ok,command:d.command,keys:Object.keys(v),counts,
   affectedRows:v.affected?.length,undeterminedRows:v.undetermined?.length,
   firstAffected:v.affected?.slice(0,3),truncated:v.truncated,
   firstChars:(p.stdout||'').slice(0,300)}
 }else summary.stdoutSample=(p.stdout||'').slice(0,500)
 result.steps.push(summary)
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2))
 console.log('[diagnostic]',JSON.stringify(summary).slice(0,1500))
 return {summary,data:d,stdout:p.stdout||''}
}
function modify([name,from,to]){
 const file=path.join(root,name),text=fs.readFileSync(file,'utf8')
 if(!text.includes(from)||text.split(from).length!==2)throw Error('Source edit not unique '+name)
 fs.writeFileSync(file,text.replace(from,to))
}
const seed=JSON.parse(fs.readFileSync(path.join(root,'output/supercov-seed.json'),'utf8'))
if(seed.sha!=='3966b984204fb3d96ecb500d4bfc6cdd634f0d51'||seed.runId!==runId)throw Error('Wrong source/seed')
command(['runs',runId,'tests','affected','--help'],'help')
for(let i=0;i<cases.length;i++){
 modify(cases[i]);const label='scenario'+(i+1)
 const preview=command(['runs',runId,'tests','affected','--json'],label+'-json')
 const namesJson=command(['runs',runId,'tests','affected','--names','--json'],label+'-names-json')
 const names=command(['runs',runId,'tests','affected','--names'],label+'-names')
 result.scenarios.push({label,changes:cases.slice(0,i+1).map(x=>x[0]),
  total:preview.data?.data?.summary,previewLength:preview.data?.data?.affected?.length,
  namesJson: namesJson.summary.json, nameLines:names.stdout.trim().split('\n').length})
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2))
}

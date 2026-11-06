'use strict'
// TEMPORARY PR #430: genuine <=500 native-selected Vitest acceptance on a
// historical canonical-source Full seed. No production publication.
const fs = require('node:fs'), cp = require('node:child_process'),
  path = require('node:path'), assert = require('node:assert/strict')
const {reconcileAffectedFiles,validateAffectedQuery} =
  require('./supercov-measured-evidence.cjs')
const source=path.resolve(process.argv[2]||'source')
const out=path.resolve('native-acceptance-evidence')
fs.mkdirSync(out,{recursive:true})
const id='run_d06066084020ac43'
const result={seedSha:'3966b984204fb3d96ecb500d4bfc6cdd634f0d51',
  seedRun:id,steps:[],complete:false}
function persist(){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n')}
function fail(message){persist();throw Error('Supercov native acceptance FAILED: '+message)}
function exec(cmd,args,label,opts={}){
 const start=Date.now()
 const p=cp.spawnSync(cmd,args,{cwd:source,encoding:'utf8',timeout:600000,
   maxBuffer:32*1024*1024,...opts})
 const output=p.stdout||'',stderr=p.stderr||''
 const step={label,args:[cmd,...args],exit:p.status,ms:Date.now()-start}
 result.steps.push(step);persist()
 fs.writeFileSync(path.join(out,label+'.log'),output+'\n'+stderr)
 console.log('[ACCEPT] '+label+': '+step.exit+' ('+step.ms+' ms)')
 if(p.error||p.signal||p.status!==0)fail(label+' command error '+(p.error?.message||stderr||p.status).slice(-4000))
 return output
}
function walk(dir,list=[]){
 for(const name of fs.readdirSync(dir)){
  const file=path.join(dir,name),st=fs.lstatSync(file)
  if(st.isDirectory())walk(file,list)
  else if(st.isFile()&&/\.(?:test|spec)\.[jt]sx?$/.test(file)) {
    list.push(path.relative(source,file).replace(/\\/g,'/'))
  }
 }
 return list
}
function callNative(args,label){
 const stdout=exec('npx',['--yes','supercov@4.24.2','runs',id,
   'tests','affected',...args],label)
 try{return JSON.parse(stdout)}
 catch{fail(label+' not JSON')}
}
const canonical=s=>s.replace(/ > /g,' ').replace(/\s+/g,' ').trim()
const key=x=>JSON.stringify([x.file,canonical(x.name)])
const regexEscape=s=>[...s].map(c=>'\\.^$*+?()[]{}|'.includes(c)?'\\'+c:c).join('')
function main(){
 const seed=JSON.parse(fs.readFileSync(path.join(source,'output/supercov-seed.json'),'utf8'))
 if(seed.sha!==result.seedSha||seed.runId!==id||seed.tests!==763||seed.setups!==110)
  fail('historical canonical source Full evidence mismatch')
 const base=exec('git',['rev-parse','HEAD'],'source-sha').trim()
 if(base!==seed.sha)fail('wrong historical checkout')
 const file=path.join(source,'src/rpg/WeaponDatabase.ts')
 const original=fs.readFileSync(file,'utf8'),from="return faction === 'roman' ?",to="return (faction === 'roman') ?"
 if(original.split(from).length!==2)fail('not a unique executable runtime token')
 fs.writeFileSync(file,original.replace(from,to))
 result.change={file:'src/rpg/WeaponDatabase.ts',from,to}
 result.gitDiff=exec('git',['diff','--','src/rpg/WeaponDatabase.ts'],'runtime-source-diff')
 const global=callNative(['--json'],'native-global-json')
 const counts=global.data?.summary
 if(!global.ok||counts?.affected!==92||counts?.undetermined!==0||
   global.data.affected.length!==92)fail('expected real 92-case source change')
 if(counts.affected<=54||counts.affected>100||counts.affected>500)fail('not 60-100 affected baseline')
 validateAffectedQuery(global,id,{tests:763,setups:110})
 const allFiles=walk(path.join(source,'tests')).sort()
 if(!allFiles.length||new Set(allFiles).size!==allFiles.length)fail('invalid test-file inventory')
 // Simulate the *observed global ranked-preview limit* (54) using exact
 // real CLI data, then reconstruct independently via public CLI file filters.
 const preview=structuredClone(global)
 preview.data.affected=preview.data.affected.slice(0,54)
 preview.data.affectedCount=counts.affected
 preview.data.truncated.push('the lists keep their first, highest-ranked tests; `--names` lists every one')
 fs.writeFileSync(path.join(out,'real-global.json'),JSON.stringify(global,null,2))
 fs.writeFileSync(path.join(out,'preview-54.json'),JSON.stringify(preview,null,2))
 const worker=path.resolve(__dirname,'supercov-affected-expand.cjs')
 const stdout=exec('node',[worker],'real-file-filter-queries',
   {input:JSON.stringify({runId:id,files:allFiles}),maxBuffer:40*1024*1024})
 let parts
 try{parts=JSON.parse(stdout)}catch{fail('filtered worker did not provide JSON')}
 const complete=reconcileAffectedFiles(preview,parts,allFiles,id,
   {tests:763,setups:110})
 const actual=complete.data.affected.slice().map(key).sort()
 const expected=global.data.affected.slice().map(key).sort()
 if(JSON.stringify(actual)!==JSON.stringify(expected))
  fail('reconstructed identities differ from real full native JSON')
 fs.writeFileSync(path.join(out,'reconstructed.json'),JSON.stringify(complete,null,2))
 result.recovered={original:counts.affected,
   displayed:preview.data.affected.length,filesQueried:allFiles.length,
   reconstructed:complete.data.affected.length,
   namesMatchRealSource:true}
 persist()
 const unique=[...new Set(complete.data.affected.map(x=>x.file))].sort()
 const testNames=[...new Set(complete.data.affected.map(x=>canonical(x.name)))]
 const pattern='^(?:'+testNames.map(regexEscape).join('|')+')$'
 const report=path.join(out,'normal-vitest.json')
 exec('node',['node_modules/vitest/vitest.mjs','run',
   '--reporter=default','--reporter=json','--outputFile='+report,
   ...unique,'--testNamePattern',pattern],'normal-exact-vitest')
 const json=JSON.parse(fs.readFileSync(report,'utf8'))
 const passed=[]
 const failures=[]
 for(const testFile of json.testResults||[]){
   const filename=path.relative(source,path.resolve(source,testFile.name)).replace(/\\/g,'/')
   for(const assertion of testFile.assertionResults||[]){
     if(assertion.status==='passed') passed.push({file:filename,name:assertion.fullName||assertion.title,
       duration:assertion.duration})
     if(assertion.status==='failed')failures.push({file:filename,name:assertion.fullName||assertion.title})
   }
 }
 const actualExecuted=passed.map(key).sort()
 if(failures.length||actualExecuted.length!==expected.length||
   JSON.stringify(actualExecuted)!==JSON.stringify(expected))
   fail('normal Vitest exact executed identity mismatch (pass='+passed.length+
     ' expected='+expected.length+' failed='+failures.length+')')
 const over100=passed.filter(x=>typeof x.duration==='number'&&x.duration>100)
 if(over100.length)fail('normal Vitest 100ms case limit exceeded: '+JSON.stringify(over100))
 result.normal={files:unique.length,passed:passed.length,
   maxVitestDurationMs:Math.max(...passed.map(x=>x.duration||0)),
   exact:true,noFailures:true,over100:0}
 result.complete=true;persist()
 console.log('[ACCEPT] SUCCESS real 92/92 exact native leaves from '+
   unique.length+' test files, preview54 recovered by '+allFiles.length+
   ' public file filters, normal Vitest 92/92 PASS')
}
try{main()}catch(e){console.error(e);process.exitCode=1}

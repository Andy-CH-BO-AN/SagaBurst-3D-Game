'use strict'
// TEMPORARY #430 isolated migration rehearsal. Never a production seed publisher.
const fs=require('node:fs'), cp=require('node:child_process'), path=require('node:path')
const source=path.resolve(process.argv[2]||'source')
const output=path.resolve('acceptance-evidence')
const fullSha='3966b984204fb3d96ecb500d4bfc6cdd634f0d51'
const version='4.24.2'
fs.mkdirSync(output,{recursive:true})
const report={purpose:'pre-merge isolated rehearsal, NOT dev push',fullSha,steps:[],complete:false}
const persist=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n')
const die=s=>{persist();throw Error('Isolated Supercov acceptance: '+s)}
const clean=s=>s.replace(/[^a-zA-Z0-9-]/g,'-')
function exec(cmd,args,cwd,phase,env={}){
 const start=Date.now()
 const p=cp.spawnSync(cmd,args,{cwd,env:{...process.env,...env},encoding:'utf8',maxBuffer:32*1024*1024})
 const stdout=p.stdout||'',stderr=p.stderr||''
 const event={phase,cmd:[cmd,...args],cwd,exit:p.status,signal:p.signal,ms:Date.now()-start}
 report.steps.push(event)
 fs.writeFileSync(path.join(output,clean(phase)+'.log'),stdout+'\n'+stderr)
 persist()
 console.log('[ACCEPTANCE] '+phase+': exit='+p.status+' duration='+event.ms+'ms')
 if(p.status!==0||p.error||p.signal){
  console.error((stdout+'\n'+stderr).slice(-6000))
  die(phase+' failed: '+(p.error?.message||stderr.slice(-1200)||p.status))
 }
 return stdout.trim()
}
const git=(dir,args,label)=>exec('git',args,dir,label)
function checkout(dir,branch,sha,phase){
 git(source,['worktree','add','-b',branch,dir,sha],phase+'-worktree')
 fs.symlinkSync(path.relative(dir,path.join(source,'node_modules')),path.join(dir,'node_modules'),'dir')
 fs.symlinkSync(path.relative(dir,path.join(source,'.supercov')),path.join(dir,'.supercov'),'dir')
 fs.mkdirSync(path.join(dir,'output'),{recursive:true})
}
function change(dir,original,updated,phase){
 const file=path.join(dir,'src/ui/UnitDisplayName.ts')
 const data=fs.readFileSync(file,'utf8')
 if(data.split(original).length!==2)die(phase+' original code not unique')
 fs.writeFileSync(file,data.replace(original,updated))
 git(dir,['add','src/ui/UnitDisplayName.ts'],phase+'-add')
 git(dir,['commit','-m','acceptance-only: equivalent runtime edit '+phase],phase+'-commit')
 return git(dir,['rev-parse','HEAD'],phase+'-head')
}
function query(dir,runId,phase,setupCount){
 const stdout=exec('npx',['--yes','supercov@'+version,'runs',runId,
   'tests','affected','--json'],dir,phase+'-native-query')
 const r=JSON.parse(stdout),d=r.data||{},c=d.summary||{}
 if(!r.ok||r.command!=='runs.tests.affected'||d.run!==runId||
    !Number.isSafeInteger(c.tests)||!Number.isSafeInteger(c.affected)||
    !Number.isSafeInteger(c.undetermined)||!Number.isSafeInteger(c.unaffected)||
    c.tests!==c.affected+c.undetermined+c.unaffected)die(phase+' invalid native summary')
 const min=Math.max(0,c.affected+c.undetermined-setupCount)
 if(min>500)die(phase+' native impact >500 (lower-bound='+min+'); refuse Full fallback')
 if(!Array.isArray(d.affected)||!Array.isArray(d.undetermined)||
    d.affected.length!==c.affected||d.undetermined.length!==c.undetermined)
   die(phase+' affected/undetermined list truncated; refuse incomplete selection')
 if(d.workingTree?.sourceSetChanged||!Array.isArray(d.workingTree?.runWide)||
    d.workingTree.runWide.length)die(phase+' uncertain source scope or run-wide evidence')
 const rows=[...d.affected,...d.undetermined]
 if(!rows.length)die(phase+' no native impacted tests for measured source change')
 const files=new Map()
 for(const row of rows){
  if(!/^tests\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(row?.file||'')||!row.name)
    die(phase+' unknown non-Vitest lifecycle identity: '+JSON.stringify(row))
  if(!files.has(row.file))files.set(row.file,new Set())
  files.get(row.file).add(row.name)
 }
 report[phase]={baseRun:runId,impact:c,lowerBound:min,
   identities:rows,source: d.workingTree}
 persist()
 console.log('[ACCEPTANCE] '+phase+' affected '+rows.length+' identities in '+files.size+' files')
 return files
}
const native=s=>s.replace(/ > /g,' ').replace(/\s+/g,' ').trim()
const escaped=s=>[...s].map(ch=>'\\.^$*+?()[]{}|'.includes(ch)?'\\'+ch:ch).join('')
function execute(dir,files,phase){
 const runs=[]
 let index=0
 for(const [file,names] of files){
  const chosen=[...names].map(native)
  const pattern='^(?:'+chosen.map(escaped).join('|')+')$'
  const base=['node_modules/vitest/vitest.mjs','run','--reporter=default',
    '--reporter=json','--outputFile='+path.join(output,phase+'-vitest-'+index+'.json'),
    file,'--testNamePattern',pattern]
  const env={LOGIC_TEST_FILES:JSON.stringify([file]),LOGIC_TEST_CASES:'',
    LOGIC_TEST_TARGETED:'0'}
  exec('node',base,dir,phase+'-normal-'+index,env)
  const json=JSON.parse(fs.readFileSync(path.join(output,phase+'-vitest-'+index+'.json'),'utf8'))
  const passed=(json.testResults||[]).flatMap(f=>f.assertionResults||[])
   .filter(t=>t.status==='passed').map(t=>native(t.fullName||t.title||''))
  if(passed.length!==chosen.length||passed.slice().sort().join('|')!==chosen.slice().sort().join('|'))
    die(phase+' Vitest exact identity mismatch: '+file+' expected='+JSON.stringify(chosen)+
      ' passed='+JSON.stringify(passed))
  const idFile=path.join(output,phase+'-instrumented-'+index+'.id')
  exec('npx',['--yes','supercov@'+version,'--','node',
    'node_modules/vitest/vitest.mjs','run','--reporter=default',
    file,'--testNamePattern',pattern],dir,phase+'-supercov-'+index,{
      ...env,SUPERCOV_SOURCE_ROOTS:'src,tests/helpers',SUPERCOV_RUN_ID_FILE:idFile
    })
  if(!fs.existsSync(idFile))die(phase+' missing instrumented ID')
  const id=fs.readFileSync(idFile,'utf8').trim()
  if(!/^run_[a-z0-9]+$/i.test(id)||!fs.existsSync(path.join(source,'.supercov/runs',id)))
    die(phase+' invalid instrumented run '+id)
  runs.push(id);index++
 }
 return runs
}
function merge(dir,before,after,phase){
 const stdout=exec('npx',['--yes','supercov@'+version,'merge',before,...after],
   dir,phase+'-strict-merge')
 const names=[...stdout.matchAll(/\[supercov\] merged run (run_[a-z0-9]+)/gi)]
 if(names.length!==1)die(phase+' missing unique strict merged identity')
 const id=names[0][1]
 const s=JSON.parse(exec('npx',['--yes','supercov@'+version,'runs',id,'--json'],
   dir,phase+'-merged-summary'))
 if(!s.ok||s.data?.run!==id||s.data?.valid!==true||
   s.data?.measurement?.complete!==true||s.data?.testExitCode!==0||
   s.data?.testAttribution?.partial!==0)die(phase+' merged evidence invalid')
 return id
}
function main(){
 const seed=JSON.parse(fs.readFileSync(path.join(source,'output/supercov-seed.json'),'utf8'))
 const sha=git(source,['rev-parse','HEAD'],'source-head')
 if(sha!==fullSha||seed.sha!==sha||seed.tests!==763||seed.setups!==110||
    seed.valid!==true||!fs.existsSync(path.join(source,'.supercov/runs',seed.runId)))
  die('historical Full source and immutable evidence mismatch')
 git(source,['config','user.email','isolation@localhost.invalid'],'set-git-email')
 git(source,['config','user.name','Supercov Isolated Acceptance'],'set-git-name')
 const aDir=path.resolve('acceptance-a'),bDir=path.resolve('acceptance-b')
 checkout(aDir,'acceptance-A',sha,'A')
 const aSha=change(aDir,'tier && Number.isFinite(tier) ?',
  'tier !== undefined && tier !== 0 && Number.isFinite(tier) ?','A')
 const aFiles=query(aDir,seed.runId,'A',seed.setups)
 const aRuns=execute(aDir,aFiles,'A')
 const aMerge=merge(aDir,seed.runId,aRuns,'A')
 Object.assign(report.A,{head:aSha,recordedRuns:aRuns,strictRun:aMerge});persist()
 const fresh=JSON.parse(exec('npx',['--yes','supercov@'+version,'runs',aMerge,
  'tests','affected','--json'],aDir,'A-pristine-next-query'))
 if(fresh.data?.summary?.affected!==0||fresh.data?.summary?.undetermined!==0)
  die('A strict merged seed is stale on its own checkout')
 checkout(bDir,'acceptance-B',aSha,'B')
 const bSha=change(bDir,".padStart(2, '0')",'.padStart(2, String(0))','B')
 const bFiles=query(bDir,aMerge,'B',seed.setups)
 const bRuns=execute(bDir,bFiles,'B')
 const bMerge=merge(bDir,aMerge,bRuns,'B')
 Object.assign(report.B,{head:bSha,recordedRuns:bRuns,strictRun:bMerge})
 report.complete=true;persist()
 console.log('[ACCEPTANCE] SUCCESS: actual native→exact Vitest→strict merge→native→exact Vitest')
}
try{main()}catch(e){console.error(e);process.exitCode=1}

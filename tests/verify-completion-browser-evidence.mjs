// Person 05: read-only consistency assertions over already captured browser observations.
// This script neither drives a browser nor reruns the product.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/browser');
const target='b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const bundle='ipad-web-probe-cbe80b74ccc3d3cebece9e73';
const baseURL=`http://127.0.0.1:4255/releases/${bundle}/`;
const files=(await readdir(directory)).filter(name=>/^\d{3}-.+\.json$/u.test(name)).sort();
const inputs=[],observations=new Map(),checks=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function read(path){
  const absolute=resolve(root,path),bytes=await readFile(absolute);
  inputs.push({path:relative(root,absolute).replaceAll('\\','/'),byteLength:bytes.length,sha256:digest(bytes)});
  return bytes.toString('utf8');
}
async function json(path){return JSON.parse(await read(path));}
function equal(label,actual,expected,evidence=[]){
  const check={label,evidence,actual,expected};checks.push(check);
  try{assert.deepEqual(actual,expected);check.verdict='passed';}
  catch(error){check.verdict='failed';check.message=error.message;}
}
function yes(label,actual,evidence=[]){equal(label,Boolean(actual),true,evidence);}
for(const file of files){
  const value=await json(resolve(directory,file));
  assert(!observations.has(value.name),`Observation name must be unique: ${value.name}`);
  observations.set(value.name,{file,...value});
}
const get=name=>{const value=observations.get(name);assert(value,`Missing observation ${name}`);return value;};
const field=(name,id='source')=>get(name).dom.fields.find(value=>value.id===id);
const source=name=>field(name).value;
const body=name=>get(name).dom.body;
const evidence=(...names)=>names.map(name=>get(name).file);
const footer='↑↓ 选择 · Tab / Enter 插入 · Esc 关闭';
const visible=name=>body(name).includes(footer);
const labels=name=>[...(get(name).dom.popup??'').matchAll(/class="completion-label">([^<]*)<\/span>/gu)].map(match=>match[1]);
const output=name=>body(name).split('程序输出\n')[1]?.split('\n调用栈')[0];
function visibleCandidates(name,required,forbidden=[]){
  const refs=evidence(name);yes(`${name}: footer visible in rendered body`,visible(name),refs);
  for(const item of required){yes(`${name}: candidate label ${item}`,labels(name).includes(item),refs);yes(`${name}: rendered candidate/signature ${item}`,body(name).includes(`\n${item}\n`),refs);}
  for(const item of forbidden)equal(`${name}: candidate ${item} absent`,labels(name).includes(item),false,refs);
}
function hidden(name){
  equal(`${name}: no visible candidate footer`,visible(name),false,evidence(name));
  equal(`${name}: no visible analysis status`,body(name).includes('正在本机分析代码'),false,evidence(name));
}

equal('raw numbered observation file count',files.length,42);
equal('two distinct 002 filenames retained (number is not an observation key)',files.filter(name=>name.startsWith('002-')),['002-prepared-62-resources.json','002-stopped-server-cold-launcher.json']);
for(const [name,value] of observations){
  yes(`${name}: captured page belongs to fixed isolated release`,value.dom.url.startsWith(baseURL),[value.file]);
  yes(`${name}: actual rendered body captured`,typeof value.dom.body==='string'&&value.dom.body.length>0,[value.file]);
}
yes('fresh launcher records exact bundle and resource size',body('fresh-fixed-launcher').includes(bundle)&&body('fresh-fixed-launcher').includes('62 项')&&body('fresh-fixed-launcher').includes('60,964,100 字节'),evidence('fresh-fixed-launcher'));
for(const name of ['prepared-62-resources','stopped-server-cold-launcher'])yes(`${name}: all 62 checked`,body(name).includes('已检查 62 项资源，可以打开工作台'),evidence(name));
hidden('unprepared-completion-gated');
yes('unprepared page states resource gate',body('unprepared-completion-gated').includes('编译资源未校验'),evidence('unprepared-completion-gated'));
for(const name of ['trusted-resource-ready','offline-workbench-trusted'])yes(`${name}: local release trust shown`,body(name).includes('本版本离线资源已校验'),evidence(name));

const alpha='fresh-alpha-dot-auto',beta='fresh-beta-type-change';
visibleCandidates(alpha,['alphaValue','alphaCount'],['betaValue']);
visibleCandidates(beta,['betaValue'],['alphaValue','alphaCount']);
yes('counterfactual keeps both type declarations but changes receiver',source(alpha).includes('struct PersonBeta')&&source(beta).includes('struct PersonAlpha')&&source(alpha).includes('PersonAlpha value;')&&source(beta).includes('PersonBeta value;'),evidence(alpha,beta));
yes('Chinese and non-BMP text precede alpha caret',source(alpha).slice(0,field(alpha).selectionStart).includes('中文😀'),evidence(alpha));
equal('alpha member caret is at source end',[field(alpha).selectionStart,field(alpha).selectionEnd],[source(alpha).length,source(alpha).length],evidence(alpha));
yes('Down keyboard selection marks actual alphaValue option selected',/class="completion-option is-selected"[^>]*title="int alphaValue"[^>]*aria-selected="true"/u.test(get('alpha-keyboard-selection').dom.popup),evidence('alpha-keyboard-selection'));
equal('Tab inserts exactly one member and no legacy indent/newline',source('tab-single-insertion'),source(alpha)+'alphaValue',evidence(alpha,'tab-single-insertion'));
equal('Tab caret follows exact insertion',[field('tab-single-insertion').selectionStart,field('tab-single-insertion').selectionEnd],[source('tab-single-insertion').length,source('tab-single-insertion').length],evidence('tab-single-insertion'));
equal('one native undo restores exact source',source('native-undo-one-step'),source(alpha),evidence(alpha,'native-undo-one-step'));
equal('one native redo restores exact completion',source('native-redo-one-step'),source('tab-single-insertion'),evidence('tab-single-insertion','native-redo-one-step'));
equal('warm completion to compile retains exact completed program',source('warm-completion-compile-run-exit17'),source('fresh-completed-program-before-compile'),evidence('fresh-completed-program-before-compile','warm-completion-compile-run-exit17'));
equal('warm completion to compile actual exit 17 output section',output('warm-completion-compile-run-exit17'),'exit · 返回 17\n尚无输出',evidence('warm-completion-compile-run-exit17'));
yes('actual debug entry pauses in user source with real stack',body('offline-debug-entry').includes('已暂停 · main.cpp:3:1')&&body('offline-debug-entry').includes('main · main.cpp:3:1'),evidence('offline-debug-entry'));
yes('exploratory second step actually ended and is not member-value evidence',body('offline-debug-step-value').includes('已结束')&&output('offline-debug-step-value')==='exit · 返回 17\n尚无输出',evidence('offline-debug-step-value'));
yes('explicit return breakpoint pauses at main.cpp line 4',body('offline-breakpoint-expanded-member').includes('已暂停 · main.cpp:4:1'),evidence('offline-breakpoint-expanded-member'));
yes('expanded member variable block reads alphaValue int 17',body('offline-breakpoint-expanded-member').includes('\nalphaValue\nint\n17\n'),evidence('offline-breakpoint-expanded-member'));
equal('snapshot source is actually readonly',field('readonly-debug-snapshot-gated').readOnly,true,evidence('readonly-debug-snapshot-gated'));
hidden('readonly-debug-snapshot-gated');
equal('mouse inserts betaValue exactly once',source('mouse-single-insertion'),source(beta)+'betaValue',evidence(beta,'mouse-single-insertion'));
visibleCandidates('middle-token-manual-prefix',['alphaCount','alphaValue']);
equal('manual caret splits al from OLD',source('middle-token-manual-prefix').slice(field('middle-token-manual-prefix').selectionStart),'OLD',evidence('middle-token-manual-prefix'));
equal('Enter replaces whole token once without newline/suffix',source('enter-full-token-single-edit'),source('middle-token-manual-prefix').replace('value.alOLD','value.alphaCount'),evidence('middle-token-manual-prefix','enter-full-token-single-edit'));
for(const [fixture,name] of [['comment','comment-automatic-suppressed'],['string-literal','string-literal-automatic-suppressed'],['decimal','decimal-automatic-suppressed']]){
  const marked=await read(`fixtures/completion-independent/${fixture}.cpp`),pieces=marked.split('/*<cc>*/');
  equal(`${fixture}: original marker appears exactly once`,pieces.length,2,[`fixtures/completion-independent/${fixture}.cpp`]);
  equal(`${fixture}: exact original fixture source`,source(name),pieces.join(''),evidence(name));
  equal(`${fixture}: exact original fixture caret`,[field(name).selectionStart,field(name).selectionEnd],[pieces[0].length,pieces[0].length],evidence(name));
  hidden(name);
}
visibleCandidates('namespace-scope-real-candidates',['scopedValue','scopedOther']);
hidden('escape-closes-candidates');
equal('Escape retains source exactly',source('escape-closes-candidates'),source('namespace-scope-real-candidates'),evidence('namespace-scope-real-candidates','escape-closes-candidates'));
visibleCandidates('arrow-real-member',['arrowOnly']);
yes('actual arrow source is a pointer receiver',source('arrow-real-member').endsWith('pointer->'),evidence('arrow-real-member'));
hidden('language-change-dismisses-old-popup');
equal('language switch is C11 in actual select',field('language-change-dismisses-old-popup','language').value,'c',evidence('language-change-dismisses-old-popup'));
equal('language switch retains exact source',source('language-change-dismisses-old-popup'),source('arrow-real-member'),evidence('arrow-real-member','language-change-dismisses-old-popup'));
visibleCandidates('c11-real-member',['cOnly']);
equal('C11 still selected during real member result',field('c11-real-member','language').value,'c',evidence('c11-real-member'));
yes('C11 file display is main.c',body('c11-real-member').includes('\nmain.c\n'),evidence('c11-real-member'));
visibleCandidates('user-inc-translation-unit-real-member',['fromDriver']);
equal('user.inc source has no declaration for fromDriver',source('user-inc-translation-unit-real-member'),'int answer(){return cross.',evidence('user-inc-translation-unit-real-member'));
yes('actual selected user include path shown',body('user-inc-translation-unit-real-member').includes('\nuser.inc\n'),evidence('user-inc-translation-unit-real-member'));
yes('actual driver declares receiver and includes user.inc',source('file-change-dismisses-old-popup').includes('struct PersonAcross { int fromDriver; };')&&source('file-change-dismisses-old-popup').includes('PersonAcross cross;')&&source('file-change-dismisses-old-popup').includes('#include "user.inc"'),evidence('file-change-dismisses-old-popup'));
hidden('file-change-dismisses-old-popup');
for(const name of ['pattern-real-function-signature','narrow-ctrlspace-pattern']){
  visibleCandidates(name,['Pattern']);
  yes(`${name}: int Pattern(int value) signature rendered`,body(name).includes('\nPattern\nint Pattern(int value)\n'),evidence(name));
}
visibleCandidates('narrow-multiple-real-members',['rowOne','rowTwo','rowThree','rowFour','rowFive','rowSix']);
equal('ten real row options captured',labels('narrow-multiple-real-members').length,10,evidence('narrow-multiple-real-members'));
hidden('focus-find-dismisses-old-candidates');
equal('moving focus does not mutate source',source('focus-find-dismisses-old-candidates'),source('narrow-multiple-real-members'),evidence('narrow-multiple-real-members','focus-find-dismisses-old-candidates'));
hidden('find-shortcut-does-not-compile');
equal('find shortcut does not alter source',source('find-shortcut-does-not-compile'),source('focus-find-dismisses-old-candidates'),evidence('focus-find-dismisses-old-candidates','find-shortcut-does-not-compile'));
equal('find shortcut leaves previous stopped output',output('find-shortcut-does-not-compile'),'stop\n尚无输出',evidence('find-shortcut-does-not-compile'));

const tolerance=0.05;
const contains=(outer,inner)=>inner.left>=outer.left-tolerance&&inner.right<=outer.right+tolerance&&inner.top>=outer.top-tolerance&&inner.bottom<=outer.bottom+tolerance;
for(const filename of ['desktop-popup-geometry.json','narrow-popup-geometry.json','narrow-rows-geometry.json']){
  const geometry=await json(resolve(directory,filename)),ref=[filename];
  equal(`${filename}: popup is visible`,geometry.hidden,false,ref);
  yes(`${filename}: footer positive height`,geometry.footer.height>0,ref);
  yes(`${filename}: footer inside popup`,contains(geometry.popup,geometry.footer),ref);
  yes(`${filename}: entire popup inside source editor`,contains(geometry.editor,geometry.popup),ref);
  yes(`${filename}: entire popup inside viewport`,contains({left:0,top:0,right:geometry.viewport.width,bottom:geometry.viewport.height},geometry.popup),ref);
  yes(`${filename}: footer follows list without clipping`,Math.abs(geometry.footer.top-geometry.list.bottom)<tolerance&&geometry.footer.bottom<=geometry.popup.bottom+tolerance,ref);
  yes(`${filename}: list retains touch row`,geometry.list.height>=44,ref);
  if(geometry.rows){equal('narrow rows: ten actual row rectangles',geometry.rows.length,10,ref);yes('narrow rows: each touch row at least 44px',geometry.rows.every(row=>row.height>=44),ref);yes('narrow rows: list clips overflowing rows while footer remains outside list',geometry.rows.at(-1).bottom>geometry.list.bottom&&geometry.footer.top>=geometry.list.bottom-tolerance,ref);}
}

visibleCandidates('before-import-old-popup',['rowOne']);
const imported=await read(resolve(directory,'imported-source.cpp'));
equal('actual import matches original file exactly',source('actual-import-invalidates-old-popup'),imported,evidence('actual-import-invalidates-old-popup'));
hidden('actual-import-invalidates-old-popup');
yes('import saved as version 19',body('actual-import-invalidates-old-popup').includes('草稿已保存 · 版本 19'),evidence('actual-import-invalidates-old-popup'));
visibleCandidates('manual-button-imported-token',['savedValue']);
equal('manual button keeps imported source unchanged',source('manual-button-imported-token'),imported,evidence('manual-button-imported-token'));
equal('manual button caret is between saved and WRONG',source('manual-button-imported-token').slice(field('manual-button-imported-token').selectionStart,field('manual-button-imported-token').selectionStart+5),'WRONG',evidence('manual-button-imported-token'));
const completed=imported.replace('value.savedWRONG','value.savedValue');
equal('import completion changes complete token exactly once',source('imported-token-confirmed'),completed,evidence('imported-token-confirmed'));
equal('compiled imported source is exact confirmed source',source('imported-completion-offline-output23'),completed,evidence('imported-completion-offline-output23'));
equal('actual imported run output and exit 23',output('imported-completion-offline-output23'),'exit · 返回 23\nperson05-final=23\n',evidence('imported-completion-offline-output23'));
equal('cold reopening restores completed source exactly',source('stopped-server-cold-draft-restored'),completed,evidence('stopped-server-cold-draft-restored'));
yes('cold reopening restores saved version 20',body('stopped-server-cold-draft-restored').includes('草稿已保存 · 版本 20'),evidence('stopped-server-cold-draft-restored'));
yes('cold reopening requires local trust revalidation',body('stopped-server-cold-draft-restored').includes('编译资源未校验')&&body('stopped-server-cold-draft-restored').includes('校验本地资源后启用代码提示'),evidence('stopped-server-cold-draft-restored'));
for(const filename of ['console-before-cold.json','console-cold-reopened.json'])equal(`${filename}: no recorded console messages`,await json(resolve(directory,filename)),[],[filename]);
for(const filename of ['stopped-listener.json','final-listener.json']){
  const listener=await json(resolve(directory,filename));equal(`${filename}: test origin port`,listener.Port,4255,[filename]);equal(`${filename}: own server listener count`,listener.ListenerCount,0,[filename]);
}
await read('tests/verify-completion-browser-evidence.mjs');
const result={target,bundle,baseURL,kind:'read-only-browser-evidence-consistency',rawObservationCount:files.length,
  observationFiles:files,checks:checks.length,passed:checks.filter(value=>value.verdict==='passed').length,failed:checks.filter(value=>value.verdict==='failed').length,
  notes:[
    '42 raw captures are observations, not 42 individually passing tests. Number 002 is duplicated by a REPL counter capture; names and filenames identify records.',
    'A retained popup HTML fragment is not proof of visibility. Positive candidate assertions additionally require the footer/signatures in actual rendered body; negative assertions inspect rendered body.',
    '015 records exploration that had already exited 17; its expectation string is not met and is not evidence of a step-time alphaValue read. 016 provides the explicit breakpoint/member evidence.',
    'Server listener zero and cache cold reopening prove the recorded desktop stopped-server experiment, not physical network disconnection, Safari/iPad, or storage durability.',
    'This verifier checks captured visible results and exact sources. Actual input actions and worker lifecycle are supported by the separately recorded browser work and independent controlled lifecycle tests; it does not infer those solely from a final DOM snapshot.'
  ],inputs,assertions:checks};
await writeFile(resolve(directory,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({target,rawObservations:files.length,assertions:result.checks,passed:result.passed,failed:result.failed},null,2));
if(result.failed){for(const failure of checks.filter(value=>value.verdict==='failed'))console.error(failure.label,failure.message);process.exitCode=1;}

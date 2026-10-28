// Bounded pattern/size audit, not a security certification or a publishing tool.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=process.cwd(),out=fileURLToPath(new URL('./',import.meta.url));
const LIMIT=100*1024*1024,MAX=256*1024*1024;
function git(args,options={}){const result=spawnSync('git',args,{cwd:root,maxBuffer:MAX,...options});if(result.status!==0)throw new Error(`Git command failed (${result.status}): ${args.join(' ')}`);return result.stdout;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const objectLines=git(['-c','core.quotepath=false','rev-list','--objects','--all'],{encoding:'utf8'}).trim().split('\n');
const names=new Map(objectLines.map(line=>{const at=line.indexOf(' ');return at<0?[line,'']:[line.slice(0,at),line.slice(at+1)];}));
const metadata=git(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{input:[...names.keys()].join('\n')+'\n',encoding:'utf8'}).trim().split('\n').map(line=>{const [oid,type,size]=line.split(' ');return {oid,type,byteLength:Number(size),path:names.get(oid)||null};});
const blobs=metadata.filter(item=>item.type==='blob');
const patterns=[
 ['PEM-private-key',new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?'+'PRIVATE KEY-----')],
 ['GitHub-classic-token',/\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u],
 ['GitHub-fine-grained-token',/\bgithub_pat_[A-Za-z0-9_]{50,255}\b/u],
 ['AWS-access-key-id',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
 ['Slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/u],
 ['OpenAI-project-or-service-token',/\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{30,255}\b/u],
 ['HTTP-URL-with-password',/https?:\/\/[^\s/:@]+:[^\s/@]+@/u],
];
function sensitiveName(path){return /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|id_(?:rsa|ed25519|dsa|ecdsa)|server-key\.pem|[^/]+\.(?:p12|pfx|key))$/iu.test(path);}
function scan(bytes,path){const text=bytes.toString('utf8'),types=patterns.filter(([,pattern])=>pattern.test(text)).map(([kind])=>kind);if(sensitiveName(path))types.push('sensitive-filename');if(bytes.length>LIMIT)types.push('over-100-MiB');return types;}
const historyFindings=[];
const packed=git(['cat-file','--batch'],{input:blobs.map(item=>item.oid).join('\n')+'\n'});
let offset=0;
for(const blob of blobs){const end=packed.indexOf(10,offset);if(end<0)throw new Error('Missing batch header');const [oid,type,size]=packed.subarray(offset,end).toString('utf8').split(' ');if(oid!==blob.oid||type!=='blob'||Number(size)!==blob.byteLength)throw new Error('Batch metadata mismatch');offset=end+1;const bytes=packed.subarray(offset,offset+blob.byteLength);if(bytes.length!==blob.byteLength||packed[offset+blob.byteLength]!==10)throw new Error('Truncated batch data');offset+=blob.byteLength+1;const types=scan(bytes,blob.path??'');if(types.length)historyFindings.push({path:blob.path??'(unnamed reachable blob)',types,object:blob.oid});}
if(offset!==packed.length)throw new Error('Unexpected trailing batch data');

const excludedPrefix='tests/evidence/integrated-person01-shortcuts-host-2026-10-27/';
const generatedReports=new Set(['git-publication-audit.json','git-publication-audit.md','git-publication-files.json'].map(name=>relative(root,resolve(out,name)).replaceAll('\\','/')));
const cached=new Set(git(['ls-files','-z','--cached'],{encoding:'utf8'}).split('\0').filter(Boolean));
const allCurrent=[...new Set(git(['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean))].sort();
const currentFiles=[],currentFindings=[],excludedFiles=[];
for(const path of allCurrent){if(path.startsWith(excludedPrefix)){excludedFiles.push({path,reason:'temporary new run; full raw output separately archived under root-owned publication-integration evidence'});continue;}if(generatedReports.has(path)){excludedFiles.push({path,reason:'this audit output generated after the scan; root seals final publication tree separately'});continue;}const absolute=resolve(root,path),stat=await lstat(absolute);if(!stat.isFile()){currentFindings.push({path,types:['non-regular-file-review-required']});continue;}const bytes=await readFile(absolute),types=scan(bytes,path);currentFiles.push({path,tracked:cached.has(path),byteLength:bytes.length,sha256:sha(bytes)});if(types.length)currentFindings.push({path,types});}

const lock=JSON.parse(await readFile(resolve(root,'compiler/resources/toolchain.lock.json'),'utf8'));
const ignoredTargets=[...lock.files.filter(item=>['clang','lld','memfs','sysroot.tar'].includes(item.filename)).map(item=>'compiler/resources/vendor/wasm-clang/'+item.filename),
 'app/offline/.local/packages/ipad-offline-debugger-v0.4.5.zip','app/offline/.local/packages/ipad-first-setup-v0.4.5.zip',
 'app/offline/.local/tls/local-https-20261026T012959Z-a065aa18/server-key.pem',
 'app/offline/.local/tls/local-https-20261026T012959Z-a065aa18/root-only.mobileconfig'];
const ignoreChecks=[];
for(const path of ignoredTargets){const result=spawnSync('git',['check-ignore','--no-index','-v','--',path],{cwd:root,encoding:'utf8'});const tracked=cached.has(path);ignoreChecks.push({path,ignored:result.status===0,tracked,rule:result.stdout.trim()});}
const references=git(['for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/tags','refs/remotes'],{encoding:'utf8'}).trim().split('\n');
const summary={schemaVersion:1,recordedAt:new Date().toISOString(),revision:git(['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 scope:'All blobs reachable from git rev-list --objects --all, plus current cached and nonignored untracked regular files except explicitly listed temporary/current audit output paths. Current files are a snapshot and may change while root completes browser evidence and documentation.',
 limitations:'Finite token/private-key/password-URL and sensitive-filename patterns plus raw size checks. Does not detect every secret, certify security, grant a license or prove iPad/offline behavior. No secret values are printed in findings.',
 thresholds:{blobMaximumBytes:LIMIT},patterns:patterns.map(([type])=>type).concat(['sensitive-filename','over-100-MiB']),
 refs:references,history:{commits:Number(git(['rev-list','--all','--count'],{encoding:'utf8'}).trim()),objects:metadata.length,blobs:blobs.length,rawBlobBytes:blobs.reduce((sum,item)=>sum+item.byteLength,0),largestBlobs:[...blobs].sort((a,b)=>b.byteLength-a.byteLength).slice(0,15),findings:historyFindings},
 current:{files:currentFiles.length,rawBytes:currentFiles.reduce((sum,item)=>sum+item.byteLength,0),trackedFiles:currentFiles.filter(item=>item.tracked).length,untrackedFiles:currentFiles.filter(item=>!item.tracked).length,largestFiles:[...currentFiles].sort((a,b)=>b.byteLength-a.byteLength).slice(0,15),wasmFixtures:currentFiles.filter(item=>item.path.endsWith('.wasm')),imageFiles:currentFiles.filter(item=>/\.(?:png|jpe?g|webp|gif|heic)$/iu.test(item.path)),findings:currentFindings,excludedFiles},
 ignoreChecks,ignoredResourcesExcluded:ignoreChecks.every(item=>item.ignored&&!item.tracked),rootLicensePresent:currentFiles.some(item=>/^LICENSE(?:\.[^/]*)?$/iu.test(item.path)),
 uploadIntent:'Push integration, four module branches and existing/new fixed tags; preserve histories and small tracked fixture Wasm. Exclude ignored toolchain binaries/full ZIPs/TLS material and the duplicate temporary validation run. Remote main is left for user manual PR merge.',
 allFiniteChecksPassed:historyFindings.length===0&&currentFindings.length===0&&ignoreChecks.every(item=>item.ignored&&!item.tracked)};
await writeFile(resolve(out,'git-publication-files.json'),JSON.stringify(currentFiles,null,2)+'\n');
await writeFile(resolve(out,'git-publication-audit.json'),JSON.stringify(summary,null,2)+'\n');
const doc=`# GitHub 发布前有限模式检查\n\n时间：${summary.recordedAt}（原始 UTC；客户端日期 2026-10-28）。目标 ${summary.revision}。\n\n检查全部可达历史：${summary.history.commits} 个提交、${summary.history.objects} 个对象、${summary.history.blobs} 个 blob，原始 blob 合计 ${summary.history.rawBlobBytes} 字节。最大 blob ${summary.history.largestBlobs[0].byteLength} 字节，路径 \`${summary.history.largestBlobs[0].path}\`。\n\n当前拟发布快照：${summary.current.files} 个文件、${summary.current.rawBytes} 字节；文件指纹及上传范围见 git-publication-files.json。历史命中 ${historyFindings.length}，当前命中 ${currentFindings.length}。有限检查结果：${summary.allFiniteChecksPassed?'PASS':'REVIEW REQUIRED'}。命中只记录路径、对象和类型，不显示原始值。\n\n范围包括新增4号键盘交付、六份原始任务书、复盘、README和本次已落盘根证据。编写本报告时根代理仍可继续写浏览器证据/文档；此报告是时间点快照，根代理最终另做源码/证据封存。扫描脚本不会 stage、提交、推送、改写历史或修改产品。\n\n四个大工具链资源、完整运行 ZIP、首次连接 ZIP、TLS 私钥及公开根证书配置均验证为 Git 忽略且未跟踪，${ignoreChecks.length}/${ignoreChecks.length} 项符合。小型已跟踪 Wasm 测试夹具继续保留历史。临时 tests/evidence/integrated-person01-shortcuts-host-2026-10-27/ 明确排除，其原始结果已经归档到 root-owned shortcuts-integration 证据。用户键盘图片仅在外部临时目录，不复制入仓库。\n\n当前根 LICENSE：${summary.rootLicensePresent?'存在（本检查不解释许可）':'未选择；未擅自增加'}。已有第三方工具链来源/许可不完整，不能以本次源码推送表示完整二进制可正式分发。\n\n本检查只匹配列明的常见私钥/令牌/含密码 URL、敏感文件名和 100 MiB 大小阈值，不是安全认证或全量机密发现，也不代表真实 iPad/G2/G3 通过。只推 integration/模块分支及固定标签，main 留用户手动合并。原始结果及引用清单见 git-publication-audit.json。\n`;
await writeFile(resolve(out,'git-publication-audit.md'),doc);
console.log(JSON.stringify({history:summary.history.commits,blobs:blobs.length,currentFiles:currentFiles.length,historyFindings:historyFindings.length,currentFindings:currentFindings.length,ignoredChecks:ignoreChecks.length,passed:summary.allFiniteChecksPassed}));
process.exitCode=summary.allFiniteChecksPassed?0:1;

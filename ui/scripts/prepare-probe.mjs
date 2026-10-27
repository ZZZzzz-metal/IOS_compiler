// Development packaging only; the product resource bundle remains owned by 1.
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {createIntegrationCandidate} from '../../app/integration/candidate.mjs';
const root=new URL('../../',import.meta.url);
const candidate=await createIntegrationCandidate();
const capabilities=JSON.parse(await readFile(new URL('contracts/capabilities.json',root),'utf8'));
await mkdir(new URL('ui/.local/',root),{recursive:true});
await writeFile(new URL('ui/.local/candidate.json',root),JSON.stringify({
  profile:candidate.profile,resources:candidate.resources,lock:candidate.lock,capabilities,
  declaration:'Development prototype only; iPad cold start and full offline package are unverified.'
},null,2)+'\n');
console.log(`UI prototype resources checked: ${candidate.resources.length}. Product route remains unfrozen.`);

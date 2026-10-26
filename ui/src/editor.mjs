const escape=text=>text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
/** Keep editable requests separate from the adapter's authoritative snapshot bindings. */
export function breakpointView({snapshotMode=false,requested=[],bindings=[],sourceUnchanged=false,sessionMatchesSnapshot=false}={}){
  if(snapshotMode)return {readOnly:true,entries:sessionMatchesSnapshot?bindings:[]};
  return {readOnly:false,entries:requested.map(bp=>{
    const binding=sourceUnchanged&&sessionMatchesSnapshot?bindings.find(item=>item.breakpointId===bp.breakpointId):null;
    return {breakpointId:bp.breakpointId,requested:bp.requested,status:binding?.status??'pending',actual:binding?.actual??[],...(binding?.reason?{reason:binding.reason}:{})};
  })};
}
export function highlight(text,currentLine){
  const re=/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:int|long|short|void|char|float|double|bool|auto|const|unsigned|signed|return|if|else|while|for|do|break|continue|struct|class|public|private|protected|using|namespace|include|template|typename|switch|case|default|sizeof|nullptr|true|false|new|delete|static)\b|\b\d+(?:\.\d+)?\b)/g;
  let result='',offset=0;
  for(const match of text.matchAll(re)){
    result+=escape(text.slice(offset,match.index));const token=match[0];
    const kind=token.startsWith('/')?'comment':/^['"]/.test(token)?'string':/^\d/.test(token)?'number':'keyword';
    // Close spans on each newline so current-line wrappers stay structurally valid.
    result+=token.split('\n').map(part=>`<span class="syntax-${kind}">${escape(part)}</span>`).join('\n');offset=match.index+token.length;
  }
  result+=escape(text.slice(offset));
  return result.split('\n').map((line,index)=>index+1===currentLine?`<span class="execution-line">${line||' '}</span>`:line).join('\n')+'\n';
}
export function indentSelection(text,start,end,outdent=false){
  const lineStart=start===0?0:text.lastIndexOf('\n',start-1)+1;
  const selectionEnd=end>start&&text[end-1]==='\n'?end-1:end;
  const next=text.indexOf('\n',selectionEnd),lineEnd=next<0?text.length:next;
  const block=text.slice(lineStart,lineEnd),lines=block.split('\n');
  const changed=lines.map(line=>outdent?line.replace(/^(?: {1,4}|\t)/,''):'    '+line);
  const delta=changed.join('\n').length-block.length;
  const firstDelta=changed[0].length-lines[0].length;
  return {text:text.slice(0,lineStart)+changed.join('\n')+text.slice(lineEnd),start:Math.max(lineStart,start+firstDelta),end:Math.max(lineStart,end+delta)};
}

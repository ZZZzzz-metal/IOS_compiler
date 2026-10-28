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

const shortcutRows = [
  ['start', '启动 / 继续', { key: 'F5' }, { key: '5', code: 'Digit5', ctrl: true }],
  ['run', '编译运行', { key: 'F5', ctrl: true }, { key: '6', code: 'Digit6', ctrl: true }],
  ['stop', '停止', { key: 'F5', shift: true }, { key: '5', code: 'Digit5', ctrl: true, shift: true }],
  ['breakpoint', '切换断点', { key: 'F9' }, { key: '9', code: 'Digit9', ctrl: true }],
  ['stepOver', '单步跳过', { key: 'F10' }, { key: '0', code: 'Digit0', ctrl: true }],
  ['stepInto', '单步进入', { key: 'F11' }, { key: '-', code: 'Minus', ctrl: true }],
  ['stepOut', '单步跳出', { key: 'F11', shift: true }, { key: '-', code: 'Minus', ctrl: true, shift: true }],
];

function defineShortcut(action, label, scheme, binding) {
  const ctrl = binding.ctrl ?? false, shift = binding.shift ?? false;
  // ARIA describes physical key combinations, including Shift+5 rather than %:
  // https://www.w3.org/TR/wai-aria-1.2/#aria-keyshortcuts
  const aria = `${ctrl ? 'Control+' : ''}${shift ? 'Shift+' : ''}${binding.key}`;
  return Object.freeze({ action, label, scheme, ...binding, ctrl, shift,
    display: aria.replace('Control+', 'Ctrl+'), aria });
}

/** Read-only definitions shared by dispatch, tooltips and aria-keyshortcuts. */
export const shortcutDefinitions = Object.freeze(shortcutRows.flatMap(([action, label, standard, alternative]) => [
  defineShortcut(action, label, 'standard', standard),
  defineShortcut(action, label, 'control-number', alternative),
]));

function shortcutEnabled(definition, scheme) {
  return definition.scheme === 'standard' || scheme === 'control-number';
}

/** Resolves an intent only. The caller owns state checks and event consumption. */
export function resolveShortcut(event, scheme = 'control-number') {
  if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
      event.altKey || event.metaKey || event.getModifierState?.('AltGraph')) return null;
  const match = shortcutDefinitions.find(definition => shortcutEnabled(definition, scheme) &&
    Boolean(event.ctrlKey) === definition.ctrl && Boolean(event.shiftKey) === definition.shift &&
    (definition.code ? event.code === definition.code : event.key === definition.key));
  return match?.action ?? null;
}

/** Unknown schemes retain the standard keys and never silently enable alternatives. */
export function shortcutLabels(scheme = 'control-number') {
  const labels = {};
  for (const definition of shortcutDefinitions) {
    if (!shortcutEnabled(definition, scheme)) continue;
    const previous = labels[definition.action];
    labels[definition.action] = previous
      ? { display: `${previous.display} / ${definition.display}`, aria: `${previous.aria} ${definition.aria}` }
      : { display: definition.display, aria: definition.aria };
  }
  return labels;
}

import {normalizeSourceText} from '../../compiler/src/source.mjs';

const integerOffset=(offset,length)=>Number.isSafeInteger(offset)&&offset>=0&&offset<=length;
function unicodeBoundary(text,offset){
  if(!integerOffset(offset,text.length))return false;
  const left=text.charCodeAt(offset-1),right=text.charCodeAt(offset);
  return !(left>=0xd800&&left<=0xdbff&&right>=0xdc00&&right<=0xdfff);
}
function countAtOrBefore(sorted,offset){
  let low=0,high=sorted.length;
  while(low<high){const middle=(low+high)>>>1;if(sorted[middle]<=offset)low=middle+1;else high=middle;}
  return low;
}

/** UTF16 boundaries, with the same BOM/newline normalization as the compiler snapshot.
 * Sparse CRLF checkpoints avoid allocating two full-size maps for a large draft.
 * Snapshot zero maps after the leading BOM, so replacement never deletes that BOM.
 */
export function createCompletionOffsetMap(editorText){
  const text=normalizeSourceText(editorText),bom=editorText.startsWith('\uFEFF')?1:0;
  const editorEnds=[],snapshotEnds=[];
  for(let offset=bom;offset<editorText.length;offset++){
    if(editorText[offset]==='\r'&&editorText[offset+1]==='\n'){
      const end=offset+2;editorEnds.push(end);snapshotEnds.push(end-bom-editorEnds.length);offset++;
    }
  }
  const isEditorBoundary=offset=>unicodeBoundary(editorText,offset)&&
    !(editorText[offset-1]==='\r'&&editorText[offset]==='\n');
  const isSnapshotBoundary=offset=>unicodeBoundary(text,offset);
  return Object.freeze({text,isEditorBoundary,isSnapshotBoundary,
    editorToSnapshot(offset){
      if(!isEditorBoundary(offset))throw new RangeError('Editor offset must be a UTF16 and newline boundary');
      return Math.max(0,offset-bom-countAtOrBefore(editorEnds,offset));
    },
    snapshotToEditor(offset){
      if(!isSnapshotBoundary(offset))throw new RangeError('Snapshot offset must be a UTF16 boundary');
      return offset+bom+countAtOrBefore(snapshotEnds,offset);
    }});
}

/** Use one native textarea editing transaction, retaining its browser undo history.
 * The existing input handler owns saving. Only a changed edit without an input
 * event uses onEdited; unsupported browsers retain their original source/selection.
 * Never emulate this with value/setRangeText, which would silently lose native undo.
 */
export function applyCompletionEdit({source,start,end,text,onEdited,document=source?.ownerDocument}={}){
  if(!source||typeof source.value!=='string'||source.readOnly||source.disabled||source.isConnected===false)
    return {applied:false,reason:'unavailable',inputObserved:false};
  const original=source.value;
  let map;
  try{map=createCompletionOffsetMap(original);normalizeSourceText(text);}
  catch{return {applied:false,reason:'invalid-text',inputObserved:false};}
  if(start>end||!map.isEditorBoundary(start)||!map.isEditorBoundary(end))
    return {applied:false,reason:'invalid-range',inputObserved:false};
  const desired=original.slice(0,start)+text+original.slice(end),caret=start+text.length;
  const selection={start:source.selectionStart,end:source.selectionEnd,direction:source.selectionDirection??'none',
    top:source.scrollTop,left:source.scrollLeft};
  if(typeof document?.execCommand!=='function')return {applied:false,reason:'unsupported',inputObserved:false};
  source.focus({preventScroll:true});
  if(document.activeElement!==source||source.value!==original||source.readOnly||source.disabled||source.isConnected===false)
    return {applied:false,reason:'context-changed',inputObserved:false};
  if(desired===original){source.setSelectionRange(caret,caret);return {applied:true,changed:false,reason:'unchanged',inputObserved:false};}
  let inputObserved=false;
  const observe=event=>{if(event.target===source&&source.value!==original)inputObserved=true;};
  source.addEventListener('input',observe,true);
  try{
    source.setSelectionRange(start,end);
    if(source.value!==original)return {applied:false,reason:'context-changed',inputObserved:false};
    // A false return does not prove that no edit happened; inspect the actual text.
    try{document.execCommand('insertText',false,text);}catch{/* Inspect below, without a second insertion. */}
  }finally{source.removeEventListener('input',observe,true);}
  if(source.value===original){
    source.setSelectionRange(selection.start,selection.end,selection.direction);
    source.scrollTop=selection.top;source.scrollLeft=selection.left;
    return {applied:false,reason:'unsupported',inputObserved};
  }
  if(!inputObserved)onEdited?.();
  if(source.value!==desired)return {applied:false,changed:true,reason:'unexpected-edit',inputObserved};
  source.setSelectionRange(caret,caret);
  return {applied:true,changed:true,inputObserved};
}

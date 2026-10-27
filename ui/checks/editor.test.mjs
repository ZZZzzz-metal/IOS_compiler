import test from 'node:test';
import assert from 'node:assert/strict';
import {highlight,indentSelection} from '../src/editor.mjs';
test('highlight escapes source markup and keeps multiline comments inside valid per-line spans',()=>{
  const text=highlight('/* a\nb */\nconst char* text="<img onerror=x>";',2);
  assert.ok(!text.includes('<img'));
  assert.ok(text.includes('&lt;img onerror=x&gt;'));
  assert.ok(text.includes('<span class="execution-line"><span class="syntax-comment">b */</span></span>'));
});
test('indent at the beginning of an empty first line does not duplicate the newline',()=>{
  assert.deepEqual(indentSelection('\nabc',0,0),{text:'    \nabc',start:4,end:4});
});
test('multiline indent and outdent exclude the line after a selected newline',()=>{
  const indented=indentSelection('a\nb\nc',0,4);
  assert.equal(indented.text,'    a\n    b\nc');
  assert.equal(indentSelection(indented.text,indented.start,indented.end,true).text,'a\nb\nc');
});

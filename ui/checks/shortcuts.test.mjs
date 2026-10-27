import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutDefinitions, resolveShortcut, shortcutLabels } from '../src/editor.mjs';

function keyEvent(key, options = {}) {
  return { key, code: key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, keyCode: 0,
    getModifierState: () => false, ...options };
}

const standard = [
  ['F5', {}, 'start'],
  ['F5', { ctrlKey: true }, 'run'],
  ['F5', { shiftKey: true }, 'stop'],
  ['F9', {}, 'breakpoint'],
  ['F10', {}, 'stepOver'],
  ['F11', {}, 'stepInto'],
  ['F11', { shiftKey: true }, 'stepOut'],
];
const alternative = [
  ['5', 'Digit5', false, 'start'],
  ['6', 'Digit6', false, 'run'],
  ['%', 'Digit5', true, 'stop'],
  ['9', 'Digit9', false, 'breakpoint'],
  ['0', 'Digit0', false, 'stepOver'],
  ['-', 'Minus', false, 'stepInto'],
  ['_', 'Minus', true, 'stepOut'],
];

test('standard F-key commands remain available in both supported schemes', () => {
  for (const scheme of ['standard', 'control-number']) {
    for (const [key, modifiers, action] of standard) {
      assert.equal(resolveShortcut(keyEvent(key, modifiers), scheme), action, `${scheme}: ${JSON.stringify([key, modifiers])}`);
    }
  }
});

test('function key modifiers are exact: unsupported combinations cannot restart or step', () => {
  const expected = {
    F5: ['start', 'run', 'stop', null],
    F9: ['breakpoint', null, null, null],
    F10: ['stepOver', null, null, null],
    F11: ['stepInto', null, 'stepOut', null],
  };
  for (const [key, actions] of Object.entries(expected)) {
    for (let modifiers = 0; modifiers < 4; modifiers++) {
      assert.equal(resolveShortcut(keyEvent(key, { ctrlKey: Boolean(modifiers & 1), shiftKey: Boolean(modifiers & 2) })),
        actions[modifiers], `${key}: modifier mask ${modifiers}`);
    }
  }
  assert.equal(resolveShortcut(keyEvent('F5', { ctrlKey: true, shiftKey: true })), null,
    'Ctrl+Shift+F5 is not supported and must never be treated as restart');
  assert.equal(resolveShortcut(keyEvent('F10', { ctrlKey: true })), null,
    'Ctrl+F10 run-to-cursor is not implemented');
  assert.equal(resolveShortcut(keyEvent('F12')), null);
  assert.equal(resolveShortcut(keyEvent('f5')), null);
});

test('default alternatives use physical codes even when Shift changes the resulting character', () => {
  for (const [key, code, shiftKey, action] of alternative) {
    assert.equal(resolveShortcut(keyEvent(key, { code, ctrlKey: true, shiftKey })), action);
    assert.equal(resolveShortcut(keyEvent('different-layout-character', { code, ctrlKey: true, shiftKey })), action,
      `${code} must not depend on the generated character`);
  }
});

test('alternatives do not fall back to typed digits, numpad keys or missing physical codes', () => {
  for (const code of ['Numpad5', 'KeyT', '', undefined]) {
    assert.equal(resolveShortcut(keyEvent('5', { code, ctrlKey: true })), null);
  }
  assert.equal(resolveShortcut(keyEvent('5', { code: 'Digit6', ctrlKey: true })), 'run',
    'physical Digit6 wins over the resulting character 5');
  assert.equal(resolveShortcut(keyEvent('F5', { code: 'Digit9', ctrlKey: true })), 'run',
    'an explicit standard F5 key still resolves by its standard key value');
  for (const code of ['Digit5', 'Digit6', 'Digit9', 'Digit0', 'Minus']) {
    assert.equal(resolveShortcut(keyEvent('5', { code })), null, `${code} requires Control`);
  }
  for (const code of ['Digit6', 'Digit9', 'Digit0']) {
    assert.equal(resolveShortcut(keyEvent('different', { code, ctrlKey: true, shiftKey: true })), null,
      `${code} has no shifted command`);
  }
});

test('standard-only and unknown schemes disable physical alternatives without disabling F keys', () => {
  for (const scheme of ['standard', 'disabled', '', null]) {
    for (const [key, code, shiftKey] of alternative) {
      assert.equal(resolveShortcut(keyEvent(key, { code, ctrlKey: true, shiftKey }), scheme), null);
    }
    assert.equal(resolveShortcut(keyEvent('F5'), scheme), 'start');
  }
});

test('Alt, Meta and AltGraph prevent commands in either scheme', () => {
  const examples = [keyEvent('F5'), keyEvent('%', { code: 'Digit5', ctrlKey: true, shiftKey: true })];
  for (const event of examples) {
    assert.equal(resolveShortcut({ ...event, altKey: true }), null);
    assert.equal(resolveShortcut({ ...event, metaKey: true }), null);
    assert.equal(resolveShortcut({ ...event, getModifierState: modifier => modifier === 'AltGraph' }), null,
      'AltGraph must be rejected even when altKey is false');
  }
});

test('already consumed, composing, legacy IME and repeated events never dispatch', () => {
  const examples = [keyEvent('F5'), keyEvent('_', { code: 'Minus', ctrlKey: true, shiftKey: true })];
  for (const event of examples) {
    for (const flags of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      assert.equal(resolveShortcut({ ...event, ...flags }), null, JSON.stringify(flags));
    }
  }
  assert.equal(resolveShortcut(null), null);
  assert.equal(resolveShortcut(undefined), null);
});

test('resolution neither consumes nor mutates an event and does not depend on Fn state', () => {
  let calls = 0;
  const event = Object.freeze(keyEvent('F5', {
    preventDefault() { calls++; }, stopPropagation() { calls++; },
    getModifierState: modifier => modifier === 'Fn',
  }));
  assert.equal(resolveShortcut(event), 'start');
  assert.equal(calls, 0);
  assert.equal(event.defaultPrevented, false);
  assert.equal(resolveShortcut({ key: 'F9' }), 'breakpoint', 'minimal event-like inputs do not require DOM globals');
});

test('shared labels expose exact standard and alternative combinations with valid ARIA modifiers', () => {
  assert.deepEqual(shortcutLabels(), {
    start: { display: 'F5 / Ctrl+5', aria: 'F5 Control+5' },
    run: { display: 'Ctrl+F5 / Ctrl+6', aria: 'Control+F5 Control+6' },
    stop: { display: 'Shift+F5 / Ctrl+Shift+5', aria: 'Shift+F5 Control+Shift+5' },
    breakpoint: { display: 'F9 / Ctrl+9', aria: 'F9 Control+9' },
    stepOver: { display: 'F10 / Ctrl+0', aria: 'F10 Control+0' },
    stepInto: { display: 'F11 / Ctrl+-', aria: 'F11 Control+-' },
    stepOut: { display: 'Shift+F11 / Ctrl+Shift+-', aria: 'Shift+F11 Control+Shift+-' },
  });
  assert.deepEqual(shortcutLabels('standard'), {
    start: { display: 'F5', aria: 'F5' }, run: { display: 'Ctrl+F5', aria: 'Control+F5' },
    stop: { display: 'Shift+F5', aria: 'Shift+F5' }, breakpoint: { display: 'F9', aria: 'F9' },
    stepOver: { display: 'F10', aria: 'F10' }, stepInto: { display: 'F11', aria: 'F11' },
    stepOut: { display: 'Shift+F11', aria: 'Shift+F11' },
  });
  assert.deepEqual(shortcutLabels('unknown'), shortcutLabels('standard'));
  assert.equal(shortcutDefinitions.length, 14);
  for (const definition of shortcutDefinitions) {
    assert.equal(typeof definition.label, 'string');
    assert.ok(definition.label.length > 0);
    assert.ok(shortcutLabels()[definition.action].aria.split(' ').includes(definition.aria));
    assert.ok(!definition.aria.includes('%') && !definition.aria.includes('_'));
  }
});

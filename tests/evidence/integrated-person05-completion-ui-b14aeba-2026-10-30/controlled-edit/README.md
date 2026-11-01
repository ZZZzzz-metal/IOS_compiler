# Independent editor policy checks

Fixed target: b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34.

Run: node tests/completion-ui-edit-independent.mjs

23/23 scenarios; 339 checks. Controlled editor/native-command transports and explicit geometry only. Actual browser native undo, CSS layout, input method, keyboard routing and device behavior must be separately observed. No product module was patched.

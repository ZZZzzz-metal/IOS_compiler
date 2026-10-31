# Independent automatic-trigger negative consumer check

Command: `node tests/completion-ui-negative-independent.mjs`. Fixed source 912a23bf14cd6e48a0adb7ec119f4ce86bc58f93. Output uses exclusive create and refuses overwrite.

The exact original comment/string-literal/decimal sources are loaded from the fixture manifest, their marker is removed and used as the UTF16 caret. The actual controller input() receives enabled/focused/non-composing context. After 450ms (public editor automatic delay 300ms), provider-call count, phase and items are recorded and checked. Each controller is disposed. This is a controlled consumer check, separate from the actual-browser no-popup observations and actual semantic provider evidence.

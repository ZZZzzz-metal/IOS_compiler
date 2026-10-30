# Person 05 controlled completion races

Run: `node tests/completion-ui-races-independent.mjs run02` at b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34.

This directory uses real exported controller/editor/popup/edit modules with a purpose-built event, geometry and provider transport. Geometry, insertText and provider responses are controlled inputs. It does not establish native undo, real Worker termination, browser layout, physical IME or iPad behavior. Root performs the separate actual-browser/package checks.

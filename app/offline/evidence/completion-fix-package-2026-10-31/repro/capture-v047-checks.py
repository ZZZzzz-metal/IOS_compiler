import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

repo = Path.cwd()
out = repo / 'app/offline/evidence/completion-fix-package-2026-10-31'
out.mkdir(parents=True, exist_ok=True)
def save(name, data):
    with (out / name).open('xb') as target:
        target.write(data)
def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
def digest(data):
    return hashlib.sha256(data).hexdigest()
save('.gitattributes', b'* -text\n')
archives = []
for path in sorted((repo / 'app/offline/.local/packages').glob('*.zip')):
    data = path.read_bytes()
    archives.append({'file': path.name, 'byteLength': len(data), 'sha256': digest(data)})
assert len(archives) == 16, len(archives)
save('prior-archives.json', encoded(archives))
inputs = ['app/offline/build.mjs', 'app/offline/serve.mjs', 'contracts/capabilities.json',
          'docs/architecture/IPAD-USER-MANUAL.md', 'package.json', 'package-lock.json', 'ui/COMPLETION.md']
save('check-inputs.json', encoded([{'path': p, 'byteLength': len((repo/p).read_bytes()), 'sha256': digest((repo/p).read_bytes())} for p in inputs]))
commands = []
for name, args in [('mandatory-check', ['npm.cmd', 'run', 'check']), ('mandatory-test', ['npm.cmd', 'test']), ('offline', ['npm.cmd', 'run', 'test:offline'])]:
    start = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(args, cwd=repo, capture_output=True)
    save(name+'.stdout.txt', result.stdout)
    save(name+'.stderr.txt', result.stderr)
    commands.append({'name': name, 'command': args, 'startedAt': start, 'endedAt': datetime.now(timezone.utc).isoformat(), 'exitCode': result.returncode,
                     'stdoutSha256': digest(result.stdout), 'stderrSha256': digest(result.stderr)})
    print(name, 'exit', result.returncode, flush=True)
save('checks.json', encoded({'baseRevision': subprocess.check_output(['git','rev-parse','HEAD'], cwd=repo).decode().strip(), 'uncommittedRootInputs': True, 'commands': commands}))
assert all(item['exitCode'] == 0 for item in commands), commands

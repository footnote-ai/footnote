/**
 * @description: Builds the local production image with a revision-safe context bundle.
 * @footnote-scope: test
 * @footnote-module: TestBuild
 * @footnote-risk: medium - A weak local build check can hide deployment packaging failures.
 * @footnote-ethics: medium - The image must preserve honest evidence provenance.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const run = (command, args) =>
    execFileSync(command, args, { cwd: repositoryRoot, stdio: 'inherit' });

run('node', ['scripts/prepare-project-context-bundle.mjs']);
const revision = execFileSync(
    'git',
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    { cwd: repositoryRoot, encoding: 'utf8' }
).trim();
run('docker', [
    'compose',
    '-f',
    'deploy/compose.yml',
    '-f',
    'deploy/compose.dev-build.yml',
    'build',
    '--build-arg',
    `FOOTNOTE_CONTEXT_COMMIT_SHA=${revision}`,
]);

const verificationScript = `
const fs = require('node:fs');
const bundleRoot = '/app/.footnote/context-bundle';
const expectedRevision = process.env.EXPECTED_REVISION;
const revision = fs.readFileSync(bundleRoot + '/revision.txt', 'utf8').trim();
const manifest = JSON.parse(fs.readFileSync('/app/.footnote/context-manifest.json', 'utf8'));
if (revision !== expectedRevision) throw new Error('Context bundle revision mismatch.');
if (fs.existsSync('/app/.git')) throw new Error('Runtime image unexpectedly contains .git.');
for (const entry of manifest) {
  fs.readFileSync(bundleRoot + '/' + entry.path, 'utf8');
}
console.log('Verified packaged context bundle:', manifest.length, 'files at', revision);
`;
run('docker', [
    'run',
    '--rm',
    '--env',
    `EXPECTED_REVISION=${revision}`,
    'footnote:dev-local',
    'node',
    '-e',
    verificationScript,
]);

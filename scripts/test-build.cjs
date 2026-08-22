/**
 * @description: Builds the local production image with a revision-safe context bundle.
 * @footnote-scope: test
 * @footnote-module: TestBuild
 * @footnote-risk: medium - A weak local build check can hide deployment packaging failures.
 * @footnote-ethics: medium - The image must preserve honest evidence provenance.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { runCommand } = require('./lib/run-command.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const run = (command, args) => {
    const result = runCommand(command, args, {
        cwd: repositoryRoot,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${result.status}.`);
    }
};

const runPnpm = (args) => {
    if (process.platform !== 'win32') {
        run('pnpm', args);
        return;
    }
    const pnpmScript = path.join(
        path.dirname(process.execPath),
        'node_modules',
        'corepack',
        'dist',
        'pnpm.js'
    );
    if (require('node:fs').existsSync(pnpmScript)) {
        run(process.execPath, [pnpmScript, ...args]);
        return;
    }
    run('pnpm.cmd', args);
};

runPnpm(['context:bundle']);
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

const imageReference = process.env.FOOTNOTE_IMAGE_REF ?? 'footnote:dev-local';
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
    imageReference,
    'node',
    '-e',
    verificationScript,
]);

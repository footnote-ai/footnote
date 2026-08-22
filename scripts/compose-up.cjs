/**
 * @description: Builds and starts the local Compose server with a revision-safe context bundle.
 * @footnote-scope: utility
 * @footnote-module: ComposeUp
 * @footnote-risk: medium - A missing build argument can produce false provenance in local images.
 * @footnote-ethics: medium - Local evidence must retain an honest source revision.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runCommand } = require('./lib/run-command.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const composeFiles = [
    '-f',
    'deploy/compose.yml',
    '-f',
    'deploy/compose.dev-build.yml',
];
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
    if (fs.existsSync(pnpmScript)) {
        run(process.execPath, [pnpmScript, ...args]);
        return;
    }
    run('pnpm.cmd', args);
};

runPnpm(['context:bundle']);
const revision = fs
    .readFileSync(
        path.join(
            repositoryRoot,
            '.footnote',
            'context-bundle',
            'revision.txt'
        ),
        'utf8'
    )
    .trim();
run('docker', [
    'compose',
    ...composeFiles,
    'build',
    '--build-arg',
    `FOOTNOTE_CONTEXT_COMMIT_SHA=${revision}`,
]);
run('docker', ['compose', ...composeFiles, 'up', ...process.argv.slice(2)]);

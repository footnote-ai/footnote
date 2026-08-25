/**
 * @description: Verifies operator target discovery uses the canonical Fly manifest instead of a root-level duplicate.
 * @footnote-scope: test
 * @footnote-module: DeploymentTargetTests
 * @footnote-risk: medium - Reintroducing the duplicate manifest can route commands to an invalid deployment path.
 * @footnote-ethics: medium - Operator actions must resolve to the reviewed deployment authority.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveDeploymentTarget } = require('./lib/deployment-target.cjs');

test('uses the canonical deploy/fly/server.toml manifest', () => {
    const repositoryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-deployment-target-')
    );
    const deployDirectory = path.join(repositoryRoot, 'deploy', 'fly');
    fs.mkdirSync(deployDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(repositoryRoot, 'fly.toml'),
        "app = 'legacy-footnote'\n"
    );
    fs.writeFileSync(
        path.join(deployDirectory, 'server.toml'),
        "app = 'canonical-footnote'\n"
    );

    const previousFlyApp = process.env.FLY_APP_NAME;
    const previousSettingsPath = process.env.FOOTNOTE_SETTINGS_PATH;
    delete process.env.FLY_APP_NAME;
    delete process.env.FOOTNOTE_SETTINGS_PATH;

    try {
        assert.deepEqual(
            resolveDeploymentTarget({ argv: [], repoRoot: repositoryRoot }),
            {
                target: 'fly',
                flyApp: 'canonical-footnote',
                localPort: 3000,
                settingsPath: path.join(repositoryRoot, 'footnote.yaml'),
            }
        );
    } finally {
        if (previousFlyApp === undefined) {
            delete process.env.FLY_APP_NAME;
        } else {
            process.env.FLY_APP_NAME = previousFlyApp;
        }
        if (previousSettingsPath === undefined) {
            delete process.env.FOOTNOTE_SETTINGS_PATH;
        } else {
            process.env.FOOTNOTE_SETTINGS_PATH = previousSettingsPath;
        }
        fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
});

test('the checked-in repository has no root-level Fly manifest', () => {
    assert.equal(
        fs.existsSync(path.resolve(__dirname, '..', 'fly.toml')),
        false
    );
});

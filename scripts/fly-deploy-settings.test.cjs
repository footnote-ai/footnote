/**
 * @description: Verifies the canonical Fly deployment synchronizes runtime settings before releasing a new image.
 * @footnote-scope: test
 * @footnote-module: FlyDeploySettingsTests
 * @footnote-risk: medium - A missing synchronization step can leave a persistent Machine on stale execution limits.
 * @footnote-ethics: medium - Stale runtime controls can cause users to receive misleading budget failures.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(
    __dirname,
    '..',
    '.github',
    'workflows',
    'fly-deploy.yml'
);

test('syncs canonical footnote.yaml before deploying the Fly image', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const syncIndex = workflow.indexOf('FOOTNOTE_SETTINGS_SHA256=');
    const deployIndex = workflow.indexOf('flyctl deploy');

    assert.ok(syncIndex >= 0, 'workflow must verify the remote settings hash');
    assert.ok(deployIndex >= 0, 'workflow must deploy the Fly image');
    assert.ok(
        syncIndex < deployIndex,
        'remote settings must be synchronized before the image deploy'
    );
    assert.match(workflow.slice(0, deployIndex), /footnote\.yaml/u);
    assert.match(workflow.slice(0, deployIndex), /sha256sum/u);
    assert.match(workflow.slice(0, deployIndex), /flyctl ssh console/u);
    assert.match(
        workflow.slice(0, deployIndex),
        /Fly CLI returned exit code[\s\S]*?exit 1/u
    );
});

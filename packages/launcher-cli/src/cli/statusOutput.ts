/**
 * @description: Runtime status rendering helpers for launcher operator output.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliStatusOutput
 * @footnote-risk: low - Rendering issues affect visibility but not runtime mutation.
 * @footnote-ethics: low - Clear status output supports transparent operation.
 */

import {
    formatMessage,
    type LauncherMetadata,
    type StatusResult,
} from '@footnote/launcher-core';
import type { CliDependencies } from './types.js';

export const printStatus = (
    dependencies: CliDependencies,
    status: StatusResult,
    metadata: LauncherMetadata | null,
    configRoot: string
): void => {
    const lines: string[] = [];

    lines.push(formatMessage('info', 'runtime: docker'));
    lines.push(formatMessage('info', `state: ${status.state}`));
    lines.push(formatMessage('info', `configRoot: ${configRoot}`));

    if (status.port !== undefined && status.url) {
        lines.push(formatMessage('info', `url: ${status.url}`));
        lines.push(formatMessage('info', `port: ${status.port}`));
    } else if (metadata?.lastKnown) {
        lines.push(formatMessage('info', `url: ${metadata.lastKnown.url}`));
        lines.push(formatMessage('info', `port: ${metadata.lastKnown.port}`));
    }

    const imageRef = status.imageRef ?? metadata?.lastKnown?.imageRef;
    if (imageRef) {
        lines.push(formatMessage('info', `image: ${imageRef}`));
    }

    const tag = status.tag ?? metadata?.lastKnown?.tag ?? metadata?.defaultTag;
    if (tag) {
        lines.push(formatMessage('info', `tag: ${tag}`));
    }

    lines.push(formatMessage('info', `container: ${status.containerName}`));
    lines.push(formatMessage('info', `volume: ${status.volumeName}`));

    if (status.state !== 'not_found') {
        lines.push(
            formatMessage(
                status.ownershipMatches ? 'info' : 'warn',
                `ownershipLabels: ${status.ownershipMatches ? 'matched' : 'mismatch'}`
            )
        );
    }

    dependencies.writeStdout(`${lines.join('\n')}\n`);
};

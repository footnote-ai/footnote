/**
 * @description: Setup bootstrap event extraction and URL resolution helpers for launcher setup flow.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliSetupEvents
 * @footnote-risk: medium - Incorrect event handling can block first-setup discovery.
 * @footnote-ethics: medium - Correct setup link handling supports informed operator onboarding.
 */

import {
    isSetupBootstrapEventUsable,
    parseSetupBootstrapEventLine,
    type FootnoteRuntime,
    type LauncherMetadata,
    type SetupBootstrapEvent,
} from '@footnote/launcher-core';
import { DEFAULT_CONTAINER_NAME, LAUNCHER_ID } from '../constants.js';

export const readUsableSetupEventFromMetadata = (
    metadata: LauncherMetadata | null,
    allowMetadataFallback: boolean
): SetupBootstrapEvent | null => {
    if (!allowMetadataFallback) {
        return null;
    }
    const setupEvent = metadata?.setup?.lastBootstrapEvent;
    if (!setupEvent) {
        return null;
    }
    if (!isSetupBootstrapEventUsable(setupEvent)) {
        return null;
    }
    return {
        event: 'footnote.setup.bootstrap',
        setupPath: setupEvent.setupPath,
        setupUrl: setupEvent.setupUrl,
        expiresAt: setupEvent.expiresAt,
    };
};

export const captureLatestSetupEventFromRuntimeLogs = async ({
    runtime,
    configRoot,
    configRootHash,
    instance,
}: {
    runtime: FootnoteRuntime;
    configRoot: string;
    configRootHash: string;
    instance: string;
}): Promise<SetupBootstrapEvent | null> => {
    const lines = runtime.logs({
        configRoot,
        configRootHash,
        instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        follow: false,
    });
    let latest: SetupBootstrapEvent | null = null;
    for await (const line of lines) {
        const parsed = parseSetupBootstrapEventLine(line.text);
        if (parsed) {
            latest = parsed;
        }
    }
    return latest;
};

export const resolveSetupUrlForLauncher = ({
    setupEvent,
    runtimeUrl,
}: {
    setupEvent: SetupBootstrapEvent;
    runtimeUrl?: string;
}): string => {
    if (!runtimeUrl) {
        return setupEvent.setupUrl;
    }
    try {
        const baseUrl = new URL(runtimeUrl);
        return new URL(setupEvent.setupPath, baseUrl).toString();
    } catch {
        return setupEvent.setupUrl;
    }
};

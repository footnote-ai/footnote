/**
 * @description: Parses backend setup bootstrap log events for launcher setup-link discovery.
 * @footnote-scope: utility
 * @footnote-module: LauncherSetupEvent
 * @footnote-risk: medium - Parse failures can block first-setup link discovery in launcher workflows.
 * @footnote-ethics: medium - Correct setup-link parsing supports clear, operator-controlled first-run onboarding.
 */

export type SetupBootstrapEvent = {
    event: 'footnote.setup.bootstrap';
    setupPath: string;
    setupUrl: string;
    expiresAt: string;
};

const SETUP_EVENT_PREFIX = '[SETUP_EVENT]';
const ESCAPE_CHAR_CODE = 27;

const stripAnsi = (input: string): string => {
    let output = '';
    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        if (code === ESCAPE_CHAR_CODE) {
            while (index < input.length && input[index] !== 'm') {
                index += 1;
            }
            continue;
        }
        output += input[index];
    }
    return output;
};

export const parseSetupBootstrapEventLine = (
    line: string
): SetupBootstrapEvent | null => {
    const normalizedLine = stripAnsi(line);
    const markerIndex = normalizedLine.indexOf(SETUP_EVENT_PREFIX);
    if (markerIndex < 0) {
        return null;
    }

    const jsonText = normalizedLine
        .slice(markerIndex + SETUP_EVENT_PREFIX.length)
        .trim();
    if (!jsonText.startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(jsonText) as Partial<SetupBootstrapEvent>;
        if (
            parsed.event !== 'footnote.setup.bootstrap' ||
            typeof parsed.setupPath !== 'string' ||
            parsed.setupPath.length === 0 ||
            typeof parsed.setupUrl !== 'string' ||
            parsed.setupUrl.length === 0 ||
            typeof parsed.expiresAt !== 'string' ||
            Number.isNaN(Date.parse(parsed.expiresAt))
        ) {
            return null;
        }

        return {
            event: 'footnote.setup.bootstrap',
            setupPath: parsed.setupPath,
            setupUrl: parsed.setupUrl,
            expiresAt: parsed.expiresAt,
        };
    } catch {
        return null;
    }
};

export const isSetupBootstrapEventUsable = (
    setupEvent: Pick<SetupBootstrapEvent, 'expiresAt'>,
    nowMs: number = Date.now()
): boolean => Date.parse(setupEvent.expiresAt) > nowMs;

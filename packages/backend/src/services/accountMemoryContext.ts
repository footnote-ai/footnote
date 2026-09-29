/**
 * @description: Resolves explicitly saved account memories for one chat without
 * accepting an account identifier from the caller.
 * @footnote-scope: core
 * @footnote-module: AccountMemoryContext
 * @footnote-risk: high - Principal resolution errors could expose another account's private memory.
 * @footnote-ethics: high - User-authored memories remain optional, bounded, and advisory.
 */
import type {
    AccountSession,
    DiscordAccountConnectionService,
} from './accountAuth.js';

const MAX_MEMORY_ITEMS = 10;
const MAX_MEMORY_CHARS = 4_000;
const MAX_MEMORY_TEXT_CHARS = 2_000;

export type AdvisoryUserMemoryContext = {
    memories: string[];
    status:
        | 'not_applicable'
        | 'empty'
        | 'retrieved'
        | 'unavailable'
        | 'failed'
        | 'corrupt';
};

/**
 * Selects memories only for a validated web session or a trusted, linked
 * Discord identity. Failure is deliberately non-blocking for ordinary chat.
 */
export const resolveAdvisoryUserMemories = (input: {
    surface: 'web' | 'discord';
    session: Pick<AccountSession, 'accountId'> | null;
    trustedDiscordUserId: string | undefined;
    accountAuthService: Pick<
        DiscordAccountConnectionService,
        'findAccountByDiscordUserId'
    > | null;
    accountStore: { listMemories: (accountId: string) => unknown[] } | null;
}): AdvisoryUserMemoryContext => {
    let accountId: string | undefined;
    if (input.surface === 'web') {
        accountId = input.session?.accountId;
    } else if (
        input.trustedDiscordUserId !== undefined &&
        input.accountAuthService !== null
    ) {
        try {
            accountId = input.accountAuthService.findAccountByDiscordUserId(
                input.trustedDiscordUserId
            )?.id;
        } catch {
            return { memories: [], status: 'failed' };
        }
    }

    if (!accountId) return { memories: [], status: 'not_applicable' };
    if (input.accountStore === null) {
        return { memories: [], status: 'unavailable' };
    }

    let storedMemories: unknown[];
    try {
        storedMemories = input.accountStore.listMemories(accountId);
    } catch {
        return { memories: [], status: 'failed' };
    }
    if (!Array.isArray(storedMemories)) {
        return { memories: [], status: 'corrupt' };
    }

    const memories: string[] = [];
    let chars = 0;
    let corrupt = false;
    // AccountStore returns stable oldest-first order; recent explicit choices
    // take precedence when the context budget cannot fit every saved memory.
    for (const memory of [...storedMemories].reverse()) {
        if (
            !memory ||
            typeof memory !== 'object' ||
            !('text' in memory) ||
            typeof memory.text !== 'string' ||
            memory.text.trim().length === 0 ||
            memory.text.length > MAX_MEMORY_TEXT_CHARS
        ) {
            corrupt = true;
            continue;
        }
        const text = memory.text.trim();
        if (
            memories.length >= MAX_MEMORY_ITEMS ||
            chars + text.length > MAX_MEMORY_CHARS
        ) {
            break;
        }
        memories.push(text);
        chars += text.length;
    }

    return {
        memories,
        status: corrupt
            ? 'corrupt'
            : memories.length > 0
              ? 'retrieved'
              : 'empty',
    };
};

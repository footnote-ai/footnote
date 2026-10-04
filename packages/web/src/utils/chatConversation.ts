/**
 * @description: Assembles chronological browser chat history for the shared chat request.
 * @footnote-scope: utility
 * @footnote-module: ChatConversation
 * @footnote-risk: low - Incorrect request assembly can lose or duplicate public chat turns.
 * @footnote-ethics: medium - The browser sends user-authored conversation content to the backend.
 */

import type { ChatConversationMessage } from '@footnote/contracts/web';

// Completed history is user/assistant pairs, so keep an even number of prior messages
// and leave the current user turn last. This stays below the shared 64-message limit
// without sending a dangling assistant turn at the start of the request.
const MAX_PRIOR_MESSAGES = 62;

export const buildChatConversation = (
    completedConversation: readonly ChatConversationMessage[],
    currentUserInput: string
): ChatConversationMessage[] => [
    ...completedConversation.slice(-MAX_PRIOR_MESSAGES),
    { role: 'user', content: currentUserInput },
];

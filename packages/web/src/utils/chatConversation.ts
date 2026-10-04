/**
 * @description: Assembles chronological browser chat history for the shared chat request.
 * @footnote-scope: utility
 * @footnote-module: ChatConversation
 * @footnote-risk: low - Incorrect request assembly can lose or duplicate public chat turns.
 * @footnote-ethics: medium - The browser sends user-authored conversation content to the backend.
 */

import type { ChatConversationMessage } from '@footnote/contracts/web';

// Leave room for the current user turn while staying below the shared 64-message transport limit.
const MAX_PRIOR_MESSAGES = 62;

export const buildChatConversation = (
    completedConversation: readonly ChatConversationMessage[],
    currentUserInput: string
): ChatConversationMessage[] => [
    ...completedConversation.slice(-MAX_PRIOR_MESSAGES),
    { role: 'user', content: currentUserInput },
];

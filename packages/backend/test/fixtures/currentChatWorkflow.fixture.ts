/**
 * @description: Approximation of the current chat path used to test the workflow core. It is not used at runtime.
 * @footnote-scope: test
 * @footnote-module: CurrentChatWorkflowFixture
 * @footnote-risk: low - This fixture only checks the cutover target shape.
 * @footnote-ethics: low - It cannot affect live chat behavior.
 */
import type { Step, Workflow } from '../../src/services/workflowCore/types.js';

const step = (definition: Step): Step => definition;

export const CURRENT_CHAT_WORKFLOW_FIXTURE: Workflow = {
    id: 'chat-reviewed',
    start: 'plan',
    steps: {
        plan: step({
            activity: { deliberation: 'plan' },
            output: { name: 'plan' },
            next: {
                continue: 'retrieve',
                failed: 'defaultPlan',
                terminal: 'finish',
            },
            maxRuns: 1,
            maxAttempts: 2,
        }),
        defaultPlan: step({
            output: { name: 'plan' },
            next: { continue: 'retrieve', failed: 'finish' },
            maxRuns: 1,
        }),
        retrieve: step({
            activity: { tool: 'one-or-more' },
            input: [{ name: 'plan' }],
            output: { name: 'evidence' },
            next: {
                available: 'presentation',
                failed: 'presentation',
                clarification: 'finish',
            },
            maxRuns: 1,
        }),
        presentation: step({
            activity: { deliberation: 'none' },
            input: [{ name: 'plan' }, { name: 'evidence', optional: true }],
            output: { name: 'presentation', requiredOn: ['admitted'] },
            next: { admitted: 'write', skipped: 'write', failed: 'write' },
            maxRuns: 1,
        }),
        write: step({
            input: [
                { name: 'plan' },
                { name: 'evidence', optional: true },
                { name: 'presentation', optional: true },
                { name: 'draft', optional: true },
                { name: 'review', optional: true },
                { name: 'revisionPlan', optional: true },
            ],
            output: { name: 'draft' },
            next: { generated: 'review', failed: 'finish' },
            maxRuns: 3,
            maxAttempts: 2,
        }),
        review: step({
            activity: { deliberation: 'review' },
            input: [{ name: 'draft' }, { name: 'evidence', optional: true }],
            output: { name: 'review' },
            next: { done: 'finish', revise: 'replan', failed: 'finish' },
            maxRuns: 3,
            maxAttempts: 2,
        }),
        replan: step({
            activity: { deliberation: 'plan' },
            input: [{ name: 'plan' }, { name: 'draft' }, { name: 'review' }],
            output: { name: 'revisionPlan', requiredOn: ['continue'] },
            next: { continue: 'write', skipped: 'write', failed: 'finish' },
            maxRuns: 2,
            maxAttempts: 2,
        }),
        finish: step({
            input: [
                { name: 'draft', optional: true },
                { name: 'plan', optional: true },
                { name: 'evidence', optional: true },
                { name: 'review', optional: true },
            ],
            output: { name: 'answer' },
            next: { done: null, failed: null },
            maxRuns: 1,
        }),
    },
};

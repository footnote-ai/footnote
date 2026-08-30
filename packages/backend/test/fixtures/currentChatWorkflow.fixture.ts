/**
 * @description: Approximation of the current chat path used to test the workflow core. It is not used at runtime.
 * @footnote-scope: test
 * @footnote-module: CurrentChatWorkflowFixture
 * @footnote-risk: low - This fixture only checks the cutover target shape.
 * @footnote-ethics: low - It cannot affect live chat behavior.
 */
import type { Workflow } from '@footnote/contracts';

export const CURRENT_CHAT_WORKFLOW_FIXTURE = {
    id: 'chat',
    start: 'plan',
    steps: {
        plan: {
            activity: { deliberation: 'plan' },
            output: { name: 'plan' },
            next: {
                continue: 'retrieve',
                failed: 'defaultPlan',
                terminal: 'finish',
            },
            maxIterations: 1,
            maxAttempts: 2,
        },
        defaultPlan: {
            output: { name: 'plan' },
            next: { continue: 'retrieve', failed: 'finish' },
            maxIterations: 1,
        },
        retrieve: {
            activity: { tool: 'one-or-more' },
            input: [{ name: 'plan' }],
            output: { name: 'evidence' },
            next: {
                available: 'presentation',
                failed: 'presentation',
                clarification: 'finish',
            },
            maxIterations: 1,
        },
        presentation: {
            input: [{ name: 'plan' }, { name: 'evidence', optional: true }],
            output: { name: 'presentation', on: ['admitted'] },
            next: { admitted: 'write', skipped: 'write', failed: 'write' },
            maxIterations: 1,
        },
        write: {
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
            maxIterations: 3,
            maxAttempts: 2,
        },
        review: {
            activity: { deliberation: 'review' },
            input: [{ name: 'draft' }, { name: 'evidence', optional: true }],
            output: { name: 'review' },
            next: { done: 'finish', revise: 'replan', failed: 'finish' },
            maxIterations: 3,
            maxAttempts: 2,
        },
        replan: {
            activity: { deliberation: 'plan' },
            input: [{ name: 'plan' }, { name: 'draft' }, { name: 'review' }],
            output: { name: 'revisionPlan', on: ['continue'] },
            next: { continue: 'write', skipped: 'write', failed: 'finish' },
            maxIterations: 2,
            maxAttempts: 2,
        },
        finish: {
            input: [
                { name: 'draft', optional: true },
                { name: 'plan', optional: true },
            ],
            output: { name: 'answer' },
            next: { done: null, failed: null },
            maxIterations: 1,
        },
    },
} satisfies Workflow;

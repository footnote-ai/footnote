/**
 * @description: Approximation of the current chat path used to test the workflow core. It is not used at runtime.
 * @footnote-scope: test
 * @footnote-module: ReviewedChatWorkflowFixture
 * @footnote-risk: low - This fixture only checks the cutover target shape.
 * @footnote-ethics: low - It cannot affect live chat behavior.
 */
import type { Step, Workflow } from '../../src/services/workflowCore/types.js';

const step = (definition: Step): Step => definition;

export const REVIEWED_CHAT_WORKFLOW_FIXTURE: Workflow = {
    id: 'chat-reviewed',
    start: 'plan',
    steps: {
        plan: step({
            id: 'plan',
            handler: 'plan',
            activity: { deliberation: 'plan' },
            input: [{ kind: 'context' }],
            output: { name: 'plan' },
            transitions: {
                continue: { kind: 'step', stepId: 'retrieve' },
                failed: { kind: 'step', stepId: 'defaultPlan' },
                terminal: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 1,
            maxAttempts: 2,
        }),
        defaultPlan: step({
            id: 'defaultPlan',
            handler: 'defaultPlan',
            input: [{ kind: 'context' }],
            output: { name: 'plan' },
            transitions: {
                continue: { kind: 'step', stepId: 'retrieve' },
                failed: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 1,
        }),
        retrieve: step({
            id: 'retrieve',
            handler: 'retrieve',
            activity: { tool: 'one-or-more' },
            input: [{ kind: 'context' }, { kind: 'result', name: 'plan' }],
            output: { name: 'evidence' },
            transitions: {
                available: { kind: 'step', stepId: 'presentation' },
                failed: { kind: 'step', stepId: 'presentation' },
                clarification: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 1,
        }),
        presentation: step({
            id: 'presentation',
            handler: 'presentation',
            activity: { deliberation: 'none' },
            input: [
                { kind: 'context' },
                { kind: 'result', name: 'plan' },
                { kind: 'result', name: 'evidence', optional: true },
            ],
            output: { name: 'presentation', requiredOn: ['admitted'] },
            transitions: {
                admitted: { kind: 'step', stepId: 'write' },
                skipped: { kind: 'step', stepId: 'write' },
                failed: { kind: 'step', stepId: 'write' },
            },
            maxRuns: 1,
        }),
        write: step({
            id: 'write',
            handler: 'write',
            input: [
                { kind: 'context' },
                { kind: 'result', name: 'plan' },
                { kind: 'result', name: 'evidence', optional: true },
                { kind: 'result', name: 'presentation', optional: true },
                { kind: 'result', name: 'draft', optional: true },
                { kind: 'result', name: 'review', optional: true },
                { kind: 'result', name: 'revisionPlan', optional: true },
            ],
            output: { name: 'draft' },
            transitions: {
                generated: { kind: 'step', stepId: 'review' },
                failed: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 3,
            maxAttempts: 2,
        }),
        review: step({
            id: 'review',
            handler: 'review',
            activity: { deliberation: 'review' },
            input: [
                { kind: 'result', name: 'draft' },
                { kind: 'result', name: 'evidence', optional: true },
            ],
            output: { name: 'review' },
            transitions: {
                done: { kind: 'step', stepId: 'finish' },
                revise: { kind: 'step', stepId: 'replan' },
                failed: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 3,
            maxAttempts: 2,
        }),
        replan: step({
            id: 'replan',
            handler: 'replan',
            activity: { deliberation: 'plan' },
            input: [
                { kind: 'context' },
                { kind: 'result', name: 'plan' },
                { kind: 'result', name: 'draft' },
                { kind: 'result', name: 'review' },
            ],
            output: { name: 'revisionPlan', requiredOn: ['continue'] },
            transitions: {
                continue: { kind: 'step', stepId: 'write' },
                skipped: { kind: 'step', stepId: 'write' },
                failed: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 2,
            maxAttempts: 2,
        }),
        finish: step({
            id: 'finish',
            handler: 'finish',
            input: [
                { kind: 'result', name: 'draft', optional: true },
                { kind: 'result', name: 'plan', optional: true },
                { kind: 'result', name: 'evidence', optional: true },
                { kind: 'result', name: 'review', optional: true },
            ],
            output: { name: 'answer' },
            transitions: { done: { kind: 'end' }, failed: { kind: 'end' } },
            maxRuns: 1,
        }),
    },
};

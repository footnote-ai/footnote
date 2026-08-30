/**
 * @description: Describes the current reviewed chat topology as a non-live
 * runtime proof; chat still uses the existing workflow engine.
 * @footnote-scope: core
 * @footnote-module: ReviewedChatWorkflow
 * @footnote-risk: medium - An inaccurate proof can mislead the later production cutover.
 * @footnote-ethics: high - Keeping the proof non-live avoids changing review and fail-open behavior prematurely.
 */
import type { Step, Workflow } from './types.js';

const step = (definition: Step): Step => definition;

/**
 * Coarse topology for the existing reviewed path. `presentation` is one
 * executor-owned step: it generates a candidate and applies deterministic
 * admissibility before the authoritative write. Provider routing, prompt
 * assembly, and live StepRecord compatibility remain in the existing engine.
 */
export const CURRENT_REVIEWED_CHAT_WORKFLOW: Workflow = {
    id: 'chat-reviewed',
    version: 'v1',
    start: 'plan',
    steps: {
        plan: step({
            id: 'plan',
            executor: 'model',
            kind: 'plan',
            input: [{ kind: 'context' }],
            output: { name: 'plan' },
            transitions: {
                continue: { kind: 'step', stepId: 'context' },
                failed: { kind: 'step', stepId: 'defaultPlan' },
                terminal: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 1,
            maxAttempts: 2,
        }),
        defaultPlan: step({
            id: 'defaultPlan',
            executor: 'code',
            input: [{ kind: 'context' }],
            output: { name: 'plan' },
            transitions: { continue: { kind: 'step', stepId: 'context' } },
            maxRuns: 1,
        }),
        context: step({
            id: 'context',
            executor: 'context',
            kind: 'tool',
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
            executor: 'model',
            kind: 'presentation',
            input: [
                { kind: 'context' },
                { kind: 'result', name: 'plan' },
                { kind: 'result', name: 'evidence', optional: true },
            ],
            output: { name: 'presentation' },
            transitions: {
                admitted: { kind: 'step', stepId: 'write' },
                skipped: { kind: 'step', stepId: 'write' },
                failed: { kind: 'step', stepId: 'write' },
            },
            maxRuns: 1,
        }),
        write: step({
            id: 'write',
            executor: 'model',
            kind: 'generate',
            input: [
                { kind: 'context' },
                { kind: 'result', name: 'plan' },
                { kind: 'result', name: 'evidence', optional: true },
                { kind: 'result', name: 'presentation', optional: true },
                { kind: 'result', name: 'draft', optional: true },
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
            executor: 'model',
            kind: 'assess',
            input: [
                { kind: 'result', name: 'draft' },
                { kind: 'result', name: 'evidence', optional: true },
            ],
            output: { name: 'review' },
            transitions: {
                done: { kind: 'step', stepId: 'finish' },
                revise: { kind: 'step', stepId: 'write' },
                failed: { kind: 'step', stepId: 'finish' },
            },
            maxRuns: 3,
            maxAttempts: 2,
        }),
        finish: step({
            id: 'finish',
            executor: 'code',
            kind: 'finalize',
            input: [{ kind: 'result', name: 'draft', optional: true }],
            output: { name: 'answer' },
            transitions: { done: { kind: 'end' }, failed: { kind: 'end' } },
            maxRuns: 1,
        }),
    },
};

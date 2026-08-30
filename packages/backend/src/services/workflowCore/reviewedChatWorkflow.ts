/**
 * @description: Describes the current reviewed chat topology as a non-live
 * proof for the workflow foundation; chat still uses the legacy engine.
 * @footnote-scope: core
 * @footnote-module: ReviewedChatWorkflow
 * @footnote-risk: medium - An inaccurate proof can mislead the later production cutover.
 * @footnote-ethics: high - Keeping the proof non-live avoids changing review and fail-open behavior prematurely.
 */
import type { Workflow, Step } from './types.js';

const step = (definition: Step): Step => definition;

/**
 * Coarse topology for the existing reviewed path. Runtime routing chains,
 * prompt assembly, and current StepRecord compatibility details remain in the
 * live engine until the separate cutover work.
 */
export const CURRENT_REVIEWED_CHAT_WORKFLOW: Workflow = {
    id: 'chat-reviewed',
    version: 'v1',
    start: 'plan',
    limits: {
        source: 'execution-contract',
    },
    steps: {
        plan: step({
            id: 'plan',
            executor: 'model',
            resource: 'deliberation',
            input: {
                inputType: 'Context',
                references: [{ kind: 'context' }],
            },
            output: {
                name: 'plan',
                outputType: 'Plan',
            },
            transitions: {
                continue: { kind: 'step', stepId: 'context' },
                terminal: { kind: 'finish' },
                failed: { kind: 'step', stepId: 'context' },
            },
            maxRuns: 1,
            maxAttempts: 2,
        }),
        context: step({
            id: 'context',
            executor: 'context',
            resource: 'tool',
            input: {
                inputType: 'Context + Plan',
                references: [
                    { kind: 'context' },
                    { kind: 'result', name: 'plan' },
                ],
            },
            output: {
                name: 'evidence',
                outputType: 'Evidence',
            },
            transitions: {
                available: { kind: 'step', stepId: 'style' },
                failed: { kind: 'step', stepId: 'style' },
                clarification: { kind: 'finish' },
            },
            maxRuns: 1,
        }),
        style: step({
            id: 'style',
            executor: 'model',
            input: {
                inputType: 'Context + Plan + Evidence',
                references: [
                    { kind: 'context' },
                    { kind: 'result', name: 'plan' },
                    { kind: 'result', name: 'evidence', optional: true },
                ],
            },
            output: {
                name: 'style',
                outputType: 'Style',
            },
            transitions: {
                generated: { kind: 'step', stepId: 'checkStyle' },
                skipped: { kind: 'step', stepId: 'write' },
                failed: { kind: 'step', stepId: 'write' },
            },
            maxRuns: 2,
            maxAttempts: 2,
        }),
        checkStyle: step({
            id: 'checkStyle',
            executor: 'code',
            input: {
                inputType: 'Style',
                references: [{ kind: 'result', name: 'style' }],
            },
            output: {
                name: 'styleCheck',
                outputType: 'Check',
            },
            transitions: {
                accepted: { kind: 'step', stepId: 'write' },
                rejected: { kind: 'step', stepId: 'write' },
                retry: { kind: 'step', stepId: 'style' },
                failed: { kind: 'step', stepId: 'write' },
            },
            maxRuns: 2,
        }),
        write: step({
            id: 'write',
            executor: 'model',
            input: {
                inputType: 'Context + Plan + Evidence? + Style? + Draft?',
                references: [
                    { kind: 'context' },
                    { kind: 'result', name: 'plan' },
                    { kind: 'result', name: 'evidence', optional: true },
                    { kind: 'result', name: 'style', optional: true },
                    { kind: 'result', name: 'draft', optional: true },
                ],
            },
            output: {
                name: 'draft',
                outputType: 'Draft',
            },
            transitions: {
                generated: { kind: 'step', stepId: 'review' },
                failed: { kind: 'finish' },
            },
            maxRuns: 2,
            maxAttempts: 2,
        }),
        review: step({
            id: 'review',
            executor: 'model',
            resource: 'deliberation',
            input: {
                inputType: 'Draft + Evidence?',
                references: [
                    { kind: 'result', name: 'draft' },
                    { kind: 'result', name: 'evidence', optional: true },
                ],
            },
            output: {
                name: 'review',
                outputType: 'Review',
            },
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
            input: {
                inputType: 'Draft?',
                references: [{ kind: 'result', name: 'draft', optional: true }],
            },
            output: {
                name: 'answer',
                outputType: 'Answer',
            },
            transitions: {
                done: { kind: 'finish' },
                failed: { kind: 'finish' },
            },
            maxRuns: 1,
        }),
    },
};

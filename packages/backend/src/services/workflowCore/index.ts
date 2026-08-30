/**
 * @description: Exposes the non-live workflow foundation as one backend-owned
 * runtime seam for definitions, execution, transitions, and bounded records.
 * @footnote-scope: core
 * @footnote-module: WorkflowCore
 * @footnote-risk: medium - Export drift can make the future cutover depend on private implementation details.
 * @footnote-ethics: high - The exported seam keeps workflow authority explicit and bounded.
 */
export { executeWorkflow, resolveTransition } from './engine.js';
export type { TransitionResolution } from './engine.js';
export { CURRENT_REVIEWED_CHAT_WORKFLOW } from './reviewedChatWorkflow.js';
export {
    result,
    type Attempt,
    type AttemptResult,
    type AttemptUsage,
    type ExecuteInput,
    type Executor,
    type ExecutorInput,
    type ExecutorKind,
    type Executors,
    type InputRef,
    type Result,
    type Run,
    type RunResult,
    type RunTermination,
    type Step,
    type Transition,
    type Workflow,
} from './types.js';
export type {
    ExecutionLimits,
    ExecutionReservation,
} from '../workflowEngine/limits.js';

/**
 * @description: Exposes the non-live workflow foundation as one backend-owned
 * seam for definitions, execution, transitions, and bounded run records.
 * @footnote-scope: core
 * @footnote-module: WorkflowCore
 * @footnote-risk: medium - Export drift can make the future cutover depend on private implementation details.
 * @footnote-ethics: high - The exported seam keeps workflow authority explicit and bounded.
 */
export { executeWorkflow, resolveTransition } from './engine.js';
export type { WorkflowTransitionResolution } from './engine.js';
export { CURRENT_REVIEWED_CHAT_WORKFLOW } from './reviewedChatWorkflow.js';
export {
    result,
    type AttemptRecord,
    type AttemptUsage,
    type ExecuteWorkflowInput,
    type ExecutionAttemptResult,
    type ExecutorRegistry,
    type Result,
    type ResultContract,
    type StepExecutionInput,
    type StepExecutor,
    type StepInput,
    type StepRecord,
    type TypedStepExecutor,
    type Workflow,
    type WorkflowExecutionResult,
    type WorkflowExecutorKind,
    type WorkflowInputReference,
    type WorkflowLimitsReference,
    type WorkflowRun,
    type WorkflowStepResource,
    type Step,
    type WorkflowTermination,
    type WorkflowTransition,
} from './types.js';
export type { ExecutionLimits } from '../workflowEngine/limits.js';

/**
 * @description: Exposes the non-live workflow foundation as one backend-owned
 * runtime seam for definitions, execution, and bounded records.
 * @footnote-scope: core
 * @footnote-module: WorkflowCore
 * @footnote-risk: medium - Export drift can make the future cutover depend on private implementation details.
 * @footnote-ethics: high - The exported seam keeps workflow authority explicit and bounded.
 */
export { executeWorkflow } from './engine.js';
export {
    result,
    type Attempt,
    type AttemptResult,
    type AttemptUsage,
    type ExecuteInput,
    type StepHandler,
    type StepHandlerInput,
    type StepHandlers,
    type ResultRef,
    type Result,
    type Run,
    type RunResult,
    type RunTermination,
    type Step,
    type Workflow,
} from './types.js';
export type {
    ExecutionLimits,
    ExecutionReservation,
} from '../workflowEngine/limits.js';

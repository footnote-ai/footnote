/**
 * @description: Defines portable Workflow topology and resource declarations.
 * Execution records and handlers remain backend-owned.
 * @footnote-scope: interface
 * @footnote-module: WorkflowContracts
 * @footnote-risk: medium - Topology drift can change bounded workflow behavior.
 * @footnote-ethics: high - Explicit workflow boundaries keep execution authority inspectable.
 */

export type ResultRef = {
    name: string;
    optional?: boolean;
};

export type StepOutput = {
    /** Saves the handler's Result under this name. */
    name: string;
    /** Successful outcomes that produce this Result. All do when omitted. */
    on?: readonly string[];
};

export type WorkflowActivity = {
    tool?: 'one-or-more';
    deliberation?: 'general' | 'plan' | 'review';
};

export type Step = {
    /** Resources this Step may use. */
    activity?: WorkflowActivity;
    input?: readonly ResultRef[];
    output?: StepOutput;
    next: Readonly<Record<string, string | null>>;
    maxIterations?: number;
    maxAttempts?: number;
};

export type Workflow = {
    id: string;
    start: string;
    steps: Readonly<Record<string, Step>>;
};

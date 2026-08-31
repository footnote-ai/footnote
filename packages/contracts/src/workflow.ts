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
    /** Stores this Step's Result under this name. */
    name: string;
    /** Outcomes that produce this Result. All outcomes do when omitted. */
    on?: readonly string[];
};

export type StepActivity = {
    tool?: 'one-or-more';
    deliberation?: 'general' | 'plan' | 'review';
};

export type Step = {
    /** Resources this Step may use. */
    activity?: StepActivity;
    /** Whether a failed optional Step consumes one workflow-step allowance. */
    countsAsWorkflowStep?: 'always' | 'successful' | 'never';
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

/**
 * @description: Prints one-line progress updates for response-comparison runs.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonProgress
 * @footnote-risk: medium - Misleading output can hide paid work or failed attempts.
 * @footnote-ethics: medium - Reviewers need accurate status before trusting results.
 */

export type ResponseComparisonProgressStage =
    'candidate' | 'authoritative' | 'assessment' | 'revision';

export type ResponseComparisonStageProgress = {
    stage: ResponseComparisonProgressStage;
    status: 'running' | 'completed' | 'failed';
    durationMs?: number;
    reason?: string;
    decision?: 'finalize' | 'revise';
};

type ResponseComparisonProgressBase = {
    attemptIndex: number;
    totalAttempts: number;
    conditionId: string;
    caseId: string;
    repeat: number;
    repeatCount: number;
};

export type ResponseComparisonProgressEvent =
    | (ResponseComparisonProgressBase & {
          kind: 'attempt_started';
          candidateLabel?: string;
          authoritativeLabel: string;
      })
    | (ResponseComparisonProgressBase & {
          kind: 'stage_started';
          stage: ResponseComparisonProgressStage;
      })
    | (ResponseComparisonProgressBase & {
          kind: 'stage_finished';
          stage: ResponseComparisonProgressStage;
          status: 'completed' | 'failed';
          durationMs: number;
          reason?: string;
          decision?: 'finalize' | 'revise';
      })
    | (ResponseComparisonProgressBase & {
          kind: 'attempt_finished';
          status: 'completed' | 'failed' | 'not_tested';
          durationMs: number;
          costUsd?: number;
          reason?: string;
          completedAttempts: number;
          failedAttempts: number;
          notTestedAttempts: number;
          remainingAttempts: number;
      });

const durationLabel = (durationMs: number): string =>
    `${(durationMs / 1000).toFixed(1)}s`;

const stageLabel = (stage: ResponseComparisonProgressStage): string =>
    stage.padEnd(14, ' ');

const finishedStageLabel = (
    event: Extract<ResponseComparisonProgressEvent, { kind: 'stage_finished' }>
): string => {
    if (event.status === 'completed') {
        return `${event.decision ?? 'done'} · ${durationLabel(event.durationMs)}`;
    }
    if (event.reason?.toLowerCase().includes('timeout'))
        return `TIMEOUT · ${durationLabel(event.durationMs)} · ${event.reason}`;
    return `FAILED · ${durationLabel(event.durationMs)} · ${event.reason ?? 'unknown failure'}`;
};

/** Creates the default one-line-per-transition console reporter. */
export const createResponseComparisonProgressReporter =
    (input: {
        write: (line: string) => void;
    }): ((event: ResponseComparisonProgressEvent) => void) =>
    (event) => {
        const prefix = `[${event.attemptIndex}/${event.totalAttempts}] ${event.conditionId} · ${event.caseId} · repeat ${event.repeat}/${event.repeatCount}`;
        if (event.kind === 'attempt_started') {
            input.write(prefix);
            input.write(
                `  Models: ${event.candidateLabel ?? 'no candidate'} → ${event.authoritativeLabel}`
            );
            return;
        }
        if (event.kind === 'stage_started') {
            input.write(`  ${stageLabel(event.stage)}running`);
            return;
        }
        if (event.kind === 'stage_finished') {
            input.write(
                `  ${stageLabel(event.stage)}${finishedStageLabel(event)}`
            );
            return;
        }
        const cost =
            event.costUsd === undefined
                ? ''
                : ` · $${event.costUsd.toFixed(4)}`;
        const notTested =
            event.notTestedAttempts > 0
                ? `, ${event.notTestedAttempts} not tested`
                : '';
        const failure =
            event.status === 'failed' && event.reason !== undefined
                ? ` · ${event.reason}`
                : '';
        input.write(
            `  ${event.status.padEnd(14, ' ')}${durationLabel(event.durationMs)}${cost}${failure} · overall ${event.completedAttempts}/${event.totalAttempts} (${event.failedAttempts} failed, ${event.remainingAttempts} left${notTested})`
        );
    };

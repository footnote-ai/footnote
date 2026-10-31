/**
 * @description: Installs local SDK diagnostics for intercepted Voice integration tests.
 * @footnote-scope: test
 * @footnote-module: VoiceObservabilityFixture
 * @footnote-risk: low - Test-only diagnostics must not export synthetic traffic.
 * @footnote-ethics: low - Only synthetic content is captured.
 */
import { AgentRegistry, createVoltAgentObservability } from '@voltagent/core';

export const installVoiceTestObservability = () => {
    const observability = createVoltAgentObservability({
        serviceName: 'voice-shared-runtime-test',
        flushOnFinishStrategy: 'never',
        voltOpsSync: { sampling: { strategy: 'never' } },
        spanProcessors: [],
        logProcessors: [],
    });
    AgentRegistry.getInstance().setGlobalObservability(observability);
    return observability;
};

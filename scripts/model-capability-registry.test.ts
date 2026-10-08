/**
 * @description: Validates the evidence-backed model registry and its derived current-assessment view.
 * @footnote-scope: test
 * @footnote-module: ModelCapabilityRegistryTests
 * @footnote-risk: low - Checks documentation data integrity without affecting runtime behavior.
 * @footnote-ethics: medium - Prevents unsupported model claims from being presented as evidence.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type FactNature =
    | 'measured'
    | 'provider-reported'
    | 'derived'
    | 'maintainer judgment'
    | 'unavailable';

type Fact<T> = {
    value: T | null;
    nature: FactNature;
    source: string;
};

type RegistrySource = {
    id: string;
    kind: 'documentation';
    path: string;
    commit: string;
};

type RegistryModel = {
    id: string;
    recordedAt: string;
    family: Fact<string>;
    revision: Fact<string>;
};

type RegistryDeployment = {
    id: string;
    recordedAt: string;
    modelId: string;
    role: Fact<string>;
    artifact: Fact<string>;
    artifactDigest: Fact<string>;
    quantization: Fact<string>;
    provider: Fact<string>;
    capabilities: {
        supportedOllamaThinkingControls: Fact<Array<boolean | string>>;
    };
    runtime: { name: Fact<string>; version: Fact<string> };
    deployment: { environment: Fact<string>; hardware: Fact<string> };
    artifactSize: Fact<string>;
};

type RegistryEvaluation = {
    id: string;
    scope: string;
    assessedAt: string;
    modelId: string | null;
    deploymentId: string | null;
    status: Fact<string>;
    observedAt: string | null;
    evidence: string[];
};

type RegistryAssessment = {
    id: string;
    date: string;
    target: string;
    recommendation: string;
    nature: FactNature;
    evidence: string[];
    supersedes: string | null;
};

type ModelCapabilityRegistry = {
    version: 1;
    sources: RegistrySource[];
    models: RegistryModel[];
    deployments: RegistryDeployment[];
    evaluations: RegistryEvaluation[];
    assessments: RegistryAssessment[];
};

const registryPath = path.resolve('docs/status/model-capability-registry.json');
const registry = JSON.parse(
    readFileSync(registryPath, 'utf8')
) as ModelCapabilityRegistry;

function assertUniqueIds(items: ReadonlyArray<{ id: string }>): void {
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
}

function assertFact<T>(fact: Fact<T>, sourceIds: ReadonlySet<string>): void {
    assert.ok(
        [
            'measured',
            'provider-reported',
            'derived',
            'maintainer judgment',
            'unavailable',
        ].includes(fact.nature)
    );
    assert.ok(sourceIds.has(fact.source));
    if (fact.nature === 'unavailable') {
        assert.equal(fact.value, null);
    } else {
        assert.notEqual(fact.value, null);
    }
}

function assertDateOnly(value: string): void {
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(Date.parse(value)));
    assert.equal(new Date(value).toISOString().slice(0, 10), value);
}

function validateRegistry(value: ModelCapabilityRegistry): void {
    assert.equal(value.version, 1);
    assertUniqueIds(value.sources);
    assertUniqueIds(value.models);
    assertUniqueIds(value.deployments);
    assertUniqueIds(value.evaluations);
    assertUniqueIds(value.assessments);

    const sourceIds = new Set(value.sources.map((source) => source.id));
    const modelIds = new Set(value.models.map((model) => model.id));
    const deploymentIds = new Set(
        value.deployments.map((deployment) => deployment.id)
    );
    const deploymentsById = new Map(
        value.deployments.map((deployment) => [deployment.id, deployment])
    );
    const assessmentIds = new Set(
        value.assessments.map((assessment) => assessment.id)
    );

    for (const source of value.sources) {
        assert.ok(existsSync(path.resolve(source.path)), source.path);
    }
    for (const model of value.models) {
        assertDateOnly(model.recordedAt);
        assertFact(model.family, sourceIds);
        assertFact(model.revision, sourceIds);
    }
    for (const deployment of value.deployments) {
        assertDateOnly(deployment.recordedAt);
        assert.ok(modelIds.has(deployment.modelId));
        assertFact(deployment.role, sourceIds);
        assertFact(deployment.artifact, sourceIds);
        assertFact(deployment.artifactDigest, sourceIds);
        assertFact(deployment.quantization, sourceIds);
        assertFact(deployment.provider, sourceIds);
        assertFact(
            deployment.capabilities.supportedOllamaThinkingControls,
            sourceIds
        );
        assertFact(deployment.runtime.name, sourceIds);
        assertFact(deployment.runtime.version, sourceIds);
        assertFact(deployment.deployment.environment, sourceIds);
        assertFact(deployment.deployment.hardware, sourceIds);
        assertFact(deployment.artifactSize, sourceIds);
    }
    for (const evaluation of value.evaluations) {
        assertDateOnly(evaluation.assessedAt);
        assert.ok(
            evaluation.modelId === null || modelIds.has(evaluation.modelId)
        );
        assert.ok(
            evaluation.deploymentId === null ||
                deploymentIds.has(evaluation.deploymentId)
        );
        if (evaluation.modelId !== null && evaluation.deploymentId !== null) {
            assert.equal(
                deploymentsById.get(evaluation.deploymentId)?.modelId,
                evaluation.modelId,
                `deployment ${evaluation.deploymentId} must belong to model ${evaluation.modelId}`
            );
        }
        assertFact(evaluation.status, sourceIds);
        for (const sourceId of evaluation.evidence) {
            assert.ok(sourceIds.has(sourceId));
        }
    }
    for (const assessment of value.assessments) {
        assertDateOnly(assessment.date);
        assert.ok(
            assessment.evidence.every((sourceId) => sourceIds.has(sourceId))
        );
        assert.ok(
            assessment.supersedes === null ||
                (assessmentIds.has(assessment.supersedes) &&
                    value.assessments.some(
                        (prior) =>
                            prior.id === assessment.supersedes &&
                            prior.date < assessment.date
                    ))
        );
    }
}

function currentAssessments(
    assessments: ReadonlyArray<RegistryAssessment>
): RegistryAssessment[] {
    const supersededIds = new Set(
        assessments.flatMap((assessment) =>
            assessment.supersedes === null ? [] : [assessment.supersedes]
        )
    );
    return assessments.filter(
        (assessment) => !supersededIds.has(assessment.id)
    );
}

function renderCurrentModelMap(value: ModelCapabilityRegistry): string {
    const current = currentAssessments(value.assessments);
    const sourceById = new Map(
        value.sources.map((source) => [source.id, source])
    );
    const modelById = new Map(value.models.map((model) => [model.id, model]));
    const lines = [
        '# Current model deployment map',
        '',
        'This view is generated from the versioned registry. It records current evidence and maintainer judgments; it is not a universal ranking or production routing policy.',
        '',
        '## Current assessment',
        '',
    ];

    for (const assessment of current) {
        const evidenceLinks = assessment.evidence.map((sourceId) => {
            const source = sourceById.get(sourceId);
            assert.ok(source, `assessment source ${sourceId} must exist`);
            return `[${sourceId}](./${path.basename(source.path)})`;
        });
        lines.push(
            `- **${assessment.date} — ${assessment.target} (${assessment.nature}):** ${assessment.recommendation}`,
            `  Evidence: ${evidenceLinks.join(', ')}.`
        );
    }

    lines.push(
        '',
        '## Deployments',
        '',
        'Every deployment in the current local Ollama cohort is experimental. No per-deployment production recommendation or live result is recorded.',
        ''
    );

    for (const deployment of value.deployments) {
        const model = modelById.get(deployment.modelId);
        assert.ok(model, `deployment model ${deployment.modelId} must exist`);
        const unknowns: string[] = [];
        if (model.revision.value === null) unknowns.push('model revision');
        if (deployment.artifactDigest.value === null)
            unknowns.push('artifact digest');
        if (deployment.runtime.version.value === null)
            unknowns.push('Ollama version');
        if (
            deployment.capabilities.supportedOllamaThinkingControls.value ===
            null
        ) {
            unknowns.push('supported Ollama thinking controls');
        }
        const evidence = Array.from(
            new Set([
                deployment.role.source,
                deployment.artifact.source,
                deployment.runtime.version.source,
                deployment.capabilities.supportedOllamaThinkingControls.source,
            ])
        );
        const evidenceLinks = evidence.map((sourceId) => {
            const source = sourceById.get(sourceId);
            assert.ok(source, `deployment source ${sourceId} must exist`);
            return `[${sourceId}](./${path.basename(source.path)})`;
        });

        lines.push(
            `### ${deployment.id}`,
            '',
            `- **Model:** ${model.family.value} — ${deployment.artifact.value}`,
            `- **Role:** ${deployment.role.value} (${deployment.role.nature})`,
            `- **Runtime:** ${deployment.provider.value}; ${deployment.deployment.environment.value}; ${deployment.quantization.value}; ${deployment.artifactSize.value}.`,
            `- **Hardware:** ${deployment.deployment.hardware.value}.`,
            `- **Unknown:** ${unknowns.join(', ')}.`,
            `- **Evidence:** ${evidenceLinks.join(', ')}.`,
            ''
        );
    }

    const liveEvaluation = value.evaluations.find(
        (evaluation) => evaluation.scope === 'live provider/model evaluation'
    );
    if (liveEvaluation) {
        lines.push(
            '## Live evaluation',
            '',
            `${liveEvaluation.status.value}; no observation date or model/deployment is linked.`,
            ''
        );
    }

    return lines.join('\n');
}

test('registry separates deployments, preserves unknowns, and cites checked-in evidence', () => {
    validateRegistry(registry);

    assert.equal(registry.models.length, 4);
    assert.equal(registry.deployments.length, 4);
    assert.ok(
        registry.models.some(
            (model) =>
                model.revision.value === null &&
                model.revision.nature === 'unavailable'
        )
    );
    assert.equal(registry.models[1]?.revision.nature, 'unavailable');
    assert.equal(
        registry.deployments[1]?.artifactDigest.value,
        'd0f50978e07996f96480c90a4b789b7988d91a9c015aa84f5cfb5ff7d5d2ece4'
    );
    assert.equal(registry.evaluations[0]?.status.value, 'not run or scheduled');
    assert.equal(registry.assessments[0]?.supersedes, null);
});

test('registry allows multiple deployments and derives only unsuperseded assessments', () => {
    const originalDeployment = registry.deployments[0];
    const originalAssessment = registry.assessments[0];
    assert.ok(originalDeployment);
    assert.ok(originalAssessment);

    const priorAssessment: RegistryAssessment = {
        ...originalAssessment,
        id: 'prior-assessment',
        date: '2026-09-01',
    };
    const currentAssessment: RegistryAssessment = {
        ...originalAssessment,
        id: 'current-assessment',
        date: '2026-09-12',
        supersedes: priorAssessment.id,
    };
    const extendedRegistry: ModelCapabilityRegistry = {
        ...registry,
        deployments: [
            ...registry.deployments,
            { ...originalDeployment, id: 'second-deployment-for-same-model' },
        ],
        assessments: [priorAssessment, currentAssessment],
    };

    validateRegistry(extendedRegistry);
    assert.equal(
        extendedRegistry.deployments.filter(
            (deployment) => deployment.modelId === originalDeployment.modelId
        ).length,
        2
    );
    assert.deepEqual(currentAssessments(extendedRegistry.assessments), [
        currentAssessment,
    ]);
});

test('current model map is a deterministic projection that preserves unknowns and avoids ranking', () => {
    assert.equal(
        renderCurrentModelMap(registry),
        readFileSync('docs/status/model-capability-map.md', 'utf8')
    );
});

test('registry rejects an evaluation deployment linked to a different model', () => {
    const evaluation = registry.evaluations[0];
    const model = registry.models[0];
    const deployment = registry.deployments[1];
    assert.ok(evaluation);
    assert.ok(model);
    assert.ok(deployment);

    const invalidRegistry: ModelCapabilityRegistry = {
        ...registry,
        evaluations: [
            {
                ...evaluation,
                modelId: model.id,
                deploymentId: deployment.id,
            },
        ],
    };
    assert.throws(
        () => validateRegistry(invalidRegistry),
        /must belong to model/
    );
});

test('registry rejects impossible date-only values', () => {
    const model = registry.models[0];
    assert.ok(model);

    const invalidRegistry: ModelCapabilityRegistry = {
        ...registry,
        models: [
            { ...model, recordedAt: '2026-02-30' },
            ...registry.models.slice(1),
        ],
    };
    assert.throws(() => validateRegistry(invalidRegistry));
});

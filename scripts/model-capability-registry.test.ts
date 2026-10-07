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
    const assessmentIds = new Set(
        value.assessments.map((assessment) => assessment.id)
    );

    for (const source of value.sources) {
        assert.ok(existsSync(path.resolve(source.path)), source.path);
    }
    for (const model of value.models) {
        assert.ok(Number.isFinite(Date.parse(model.recordedAt)));
        assertFact(model.family, sourceIds);
        assertFact(model.revision, sourceIds);
    }
    for (const deployment of value.deployments) {
        assert.ok(Number.isFinite(Date.parse(deployment.recordedAt)));
        assert.ok(modelIds.has(deployment.modelId));
        assertFact(deployment.role, sourceIds);
        assertFact(deployment.artifact, sourceIds);
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
        assert.ok(Number.isFinite(Date.parse(evaluation.assessedAt)));
        assert.ok(
            evaluation.modelId === null || modelIds.has(evaluation.modelId)
        );
        assert.ok(
            evaluation.deploymentId === null ||
                deploymentIds.has(evaluation.deploymentId)
        );
        assertFact(evaluation.status, sourceIds);
        for (const sourceId of evaluation.evidence) {
            assert.ok(sourceIds.has(sourceId));
        }
    }
    for (const assessment of value.assessments) {
        assert.ok(Number.isFinite(Date.parse(assessment.date)));
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

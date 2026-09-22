/**
 * @description: Compares Footnote's assess parser with the pinned BAML parser over identical synthetic fixtures.
 * Provider failures are represented as unresolved transport cases rather than fabricated parser results.
 * @footnote-scope: test
 * @footnote-module: BamlAssessSemanticEquivalence
 * @footnote-risk: high - Collapsed failure semantics could hide workflow policy differences.
 * @footnote-ethics: high - Fixtures are synthetic and no provider or private content is contacted.
 */
import fs from 'node:fs';
import path from 'node:path';

import { b } from './baml_client/index.js';
import {
    parseReviewDecisionOutputResult,
    type ReviewDecisionParseFailureReason,
} from '../../packages/backend/src/services/workflowEngine/reviewDecision.js';

type FixtureKind = 'text_output' | 'provider_failure';

type EquivalenceFixture = {
    name: string;
    kind: FixtureKind;
    output?: string;
    policySignificance: string;
};

export type EquivalenceRow = {
    case: string;
    kind: FixtureKind;
    currentFootnoteClassification:
        'success' | ReviewDecisionParseFailureReason | 'not_applicable';
    bamlParseResult: 'success' | 'error' | 'not_run';
    bamlErrorType: string | null;
    bamlErrorDetail: string | null;
    bamlErrorDetailAvailable: boolean;
    bamlParsedValue: Record<string, unknown> | null;
    informationLost: boolean | null;
    extraRecoveryPerformed: boolean;
    policySignificance: string;
};

export type EquivalenceReport = {
    toolchain: {
        baml: '0.226.2';
        generatedClient: 'typescript';
        currentParser: 'Footnote reviewDecision.ts';
    };
    conditionalValidation: {
        representedInBaml: boolean;
        assertions: string[];
        finding: string;
    };
    rows: EquivalenceRow[];
};

const validFinalize = JSON.stringify({
    reviewDecision: 'finalize',
    reviewReason: 'The draft is complete.',
});

const validRevise = JSON.stringify({
    reviewDecision: 'revise',
    reviewReason: 'The citation needs tightening.',
    revisionInstruction: 'Name the source before stating the conclusion.',
});

const maximumShape = JSON.stringify({
    reviewDecision: 'revise',
    reviewReason: 'The draft needs one bounded correction.',
    revisionInstruction: 'Add the missing provenance sentence.',
    traceAlignment: 'misaligned',
    traceAlignmentReason: 'The citation does not support the claim yet.',
    finalTemperament: {
        tightness: 1,
        rationale: 2,
        attribution: 3,
        caution: 4,
        extent: 5,
    },
    moduleHints: ['grounding.citation_strict'],
    concerns: {
        length: 'ok',
        style: 'too_stiff',
        evidence: 'needs_caution',
    },
    routingHints: ['cost.cheaper_path'],
});

const fixtures: EquivalenceFixture[] = [
    {
        name: 'valid_finalize',
        kind: 'text_output',
        output: validFinalize,
        policySignificance: 'Valid finalize decision should remain equivalent.',
    },
    {
        name: 'valid_revise',
        kind: 'text_output',
        output: validRevise,
        policySignificance: 'Valid revise decision should remain equivalent.',
    },
    {
        name: 'optional_fields_absent',
        kind: 'text_output',
        output: validFinalize,
        policySignificance: 'Omitted optional fields must remain valid.',
    },
    {
        name: 'maximum_expected_shape',
        kind: 'text_output',
        output: maximumShape,
        policySignificance:
            'All bounded optional fields should remain representable.',
    },
    {
        name: 'empty_output',
        kind: 'text_output',
        output: '   ',
        policySignificance:
            'Empty output is a distinct fail-open parser reason.',
    },
    {
        name: 'malformed_json',
        kind: 'text_output',
        output: '{"reviewDecision":"finalize"',
        policySignificance:
            'Malformed syntax must remain distinct from schema failure.',
    },
    {
        name: 'invalid_json',
        kind: 'text_output',
        output: '{"reviewDecision":"finalize",}',
        policySignificance:
            'Invalid JSON syntax must remain distinct from non-object output.',
    },
    {
        name: 'non_object_json',
        kind: 'text_output',
        output: '[]',
        policySignificance:
            'Non-object output must remain distinct from invalid JSON.',
    },
    {
        name: 'wrong_enum',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'maybe',
            reviewReason: 'Unknown decision.',
        }),
        policySignificance:
            'Unknown decisions must not enter workflow normalization.',
    },
    {
        name: 'wrong_primitive_type',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 42,
        }),
        policySignificance: 'Primitive type errors must remain schema-invalid.',
    },
    {
        name: 'extra_unexpected_structure',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            unexpected: { nested: true },
        }),
        policySignificance:
            'Current passthrough behavior and BAML omission require explicit comparison.',
    },
    {
        name: 'incomplete_object',
        kind: 'text_output',
        output: JSON.stringify({ reviewDecision: 'finalize' }),
        policySignificance:
            'Missing required fields must not become a valid decision.',
    },
    {
        name: 'refusal_text',
        kind: 'text_output',
        output: 'I cannot review this draft.',
        policySignificance:
            'Refusal text needs a stable parser/runtime classification.',
    },
    {
        name: 'fenced_json',
        kind: 'text_output',
        output: `\`\`\`json\n${validFinalize}\n\`\`\``,
        policySignificance:
            'Recovery of fenced JSON changes compatibility behavior.',
    },
    {
        name: 'incomplete_revise',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'revise',
            reviewReason: 'Needs more work.',
        }),
        policySignificance:
            'revisionInstruction is required for revise decisions.',
    },
    {
        name: 'misaligned_without_reason_or_temperament',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            traceAlignment: 'misaligned',
        }),
        policySignificance:
            'Misalignment requires both explanation and temperament context.',
    },
    {
        name: 'misaligned_without_temperament',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            traceAlignment: 'misaligned',
            traceAlignmentReason: 'The citation is weak.',
        }),
        policySignificance:
            'A reason alone does not satisfy the misalignment contract.',
    },
    {
        name: 'invalid_temperament_axis',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            finalTemperament: { tightness: 6 },
        }),
        policySignificance:
            'Temperament axes remain bounded to the documented scale.',
    },
    {
        name: 'invalid_nested_concern_enum',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            concerns: { style: 'too_verbose' },
        }),
        policySignificance: 'Nested concern enums must not silently widen.',
    },
    {
        name: 'unsupported_structured_output',
        kind: 'provider_failure',
        policySignificance:
            'Transport capability failure is outside text parsing and remains unresolved offline.',
    },
    {
        name: 'incomplete_generation_finish_reason',
        kind: 'provider_failure',
        policySignificance:
            'Provider finish state must remain visible to Footnote attempt accounting.',
    },
    {
        name: 'transport_unavailable',
        kind: 'provider_failure',
        policySignificance:
            'Transport failure must not be collapsed into schema-invalid output.',
    },
    {
        name: 'generic_provider_runtime_error',
        kind: 'provider_failure',
        policySignificance:
            'Generic runtime failure remains a provider/attempt concern, not parser output.',
    },
];

const classifyCurrentParser = (
    output: string
): { classification: EquivalenceRow['currentFootnoteClassification'] } => {
    const result = parseReviewDecisionOutputResult(output);
    return result.isOk()
        ? { classification: 'success' }
        : { classification: result.error.reason };
};

const parseWithBaml = (
    output: string
): Pick<
    EquivalenceRow,
    | 'bamlParseResult'
    | 'bamlErrorType'
    | 'bamlErrorDetail'
    | 'bamlErrorDetailAvailable'
    | 'bamlParsedValue'
> => {
    try {
        const parsed = b.parse.Assess(output);
        return {
            bamlParseResult: 'success',
            bamlErrorType: null,
            bamlErrorDetail: null,
            bamlErrorDetailAvailable: false,
            bamlParsedValue: JSON.parse(JSON.stringify(parsed)) as Record<
                string,
                unknown
            >,
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            bamlParseResult: 'error',
            bamlErrorType: error instanceof Error ? error.name : 'unknown',
            bamlErrorDetail: detail.slice(0, 320),
            bamlErrorDetailAvailable: detail.trim().length > 0,
            bamlParsedValue: null,
        };
    }
};

const compareFixture = (fixture: EquivalenceFixture): EquivalenceRow => {
    if (fixture.kind === 'provider_failure' || fixture.output === undefined) {
        return {
            case: fixture.name,
            kind: fixture.kind,
            currentFootnoteClassification: 'not_applicable',
            bamlParseResult: 'not_run',
            bamlErrorType: null,
            bamlErrorDetail: null,
            bamlErrorDetailAvailable: false,
            bamlParsedValue: null,
            informationLost: null,
            extraRecoveryPerformed: false,
            policySignificance: fixture.policySignificance,
        };
    }

    const current = classifyCurrentParser(fixture.output);
    const baml = parseWithBaml(fixture.output);
    const currentSucceeded = current.classification === 'success';
    const bamlSucceeded = baml.bamlParseResult === 'success';
    return {
        case: fixture.name,
        kind: fixture.kind,
        currentFootnoteClassification: current.classification,
        ...baml,
        informationLost:
            currentSucceeded !== bamlSucceeded ||
            (!currentSucceeded && baml.bamlErrorType !== null),
        extraRecoveryPerformed: !currentSucceeded && bamlSucceeded,
        policySignificance: fixture.policySignificance,
    };
};

/**
 * Runs the offline semantic-equivalence matrix without invoking a provider.
 * Provider failures remain explicit unresolved rows instead of being simulated as parser failures.
 */
export const runSemanticEquivalenceMatrix = (): EquivalenceReport => ({
    toolchain: {
        baml: '0.226.2',
        generatedClient: 'typescript',
        currentParser: 'Footnote reviewDecision.ts',
    },
    conditionalValidation: {
        representedInBaml: true,
        assertions: [
            'revision_instruction_when_revising',
            'trace_reason_when_misaligned',
            'temperament_when_misaligned',
        ],
        finding:
            'BAML block assertions reject the tested conditional-invalid fixtures, but optional null values cause assertion-evaluation errors rather than a clean Footnote-equivalent validation result. The generated TypeScript surface still exposes generic errors rather than Footnote review-decision failure envelopes.',
    },
    rows: fixtures.map(compareFixture),
});

const writeReport = (report: EquivalenceReport): void => {
    const outputDirectory = path.resolve('artifacts/baml-assess-725');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, 'semantic-equivalence.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
};

if (process.argv[1]?.endsWith('offline-equivalence.ts')) {
    const report = runSemanticEquivalenceMatrix();
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
}

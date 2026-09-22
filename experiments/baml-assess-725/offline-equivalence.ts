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
    layeredFootnoteClassification:
        'success' | ReviewDecisionParseFailureReason | 'not_run';
    layeredClassificationMatchesCurrent: boolean | null;
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
    parserStrictness: {
        documentedCapabilities: string[];
        strictModeLocated: boolean;
        finding: string;
    };
    maintenanceSurface: {
        currentFootnote: {
            contractFileLines: number;
            compatibilityTestLines: number;
            independentlyMaintainedSemanticLocations: number;
        };
        bamlPrototype: {
            bamlSourceLines: number;
            generatedClientLines: number;
            adapterAndSemanticValidationLinesRetained: number;
            independentlyMaintainedSemanticLocations: number;
        };
        finding: string;
    };
    contractChangeErgonomics: {
        scenario: string;
        currentUpdatePoints: string[];
        bamlUpdatePoints: string[];
        currentUpdatePointCount: number;
        bamlUpdatePointCount: number;
        generatedArtifacts: string[];
        finding: string;
    };
    rows: EquivalenceRow[];
};

const countLines = (relativePath: string): number => {
    const filePath = path.resolve(relativePath);
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length - 1;
};

const countTypeScriptLines = (relativeDirectory: string): number => {
    const directoryPath = path.resolve(relativeDirectory);
    return fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .reduce(
            (total, entry) =>
                total + countLines(path.join(relativeDirectory, entry.name)),
            0
        );
};

const bamlSourceLines = [
    'experiments/baml-assess-725/baml_src/types.baml',
    'experiments/baml-assess-725/baml_src/functions.baml',
    'experiments/baml-assess-725/baml_src/clients.baml',
    'experiments/baml-assess-725/baml_src/generators.baml',
].reduce((total, filePath) => total + countLines(filePath), 0);

const maintenanceSurface: EquivalenceReport['maintenanceSurface'] = {
    currentFootnote: {
        contractFileLines: countLines(
            'packages/backend/src/services/workflowEngine/reviewDecision.ts'
        ),
        compatibilityTestLines: countLines(
            'packages/backend/test/workflowEngine/review-decision.test.ts'
        ),
        independentlyMaintainedSemanticLocations: 8,
    },
    bamlPrototype: {
        bamlSourceLines,
        generatedClientLines: countTypeScriptLines(
            'experiments/baml-assess-725/baml_client'
        ),
        adapterAndSemanticValidationLinesRetained: countLines(
            'packages/backend/src/services/workflowEngine/reviewDecision.ts'
        ),
        independentlyMaintainedSemanticLocations: 7,
    },
    finding:
        'The prototype co-locates the typed declaration and prompt, but it did not demonstrate deletion of the Footnote parser, semantic validator, normalizer, failure classifier, or compatibility tests. The lower modeled location count is therefore authoring consolidation, not proven semantic-code deletion.',
};

const contractChangeErgonomics: EquivalenceReport['contractChangeErgonomics'] =
    {
        scenario:
            'Hypothetical reviewConfidence integer constrained to 1..5 and required only when reviewDecision is revise; the change was modeled without modifying production files.',
        currentUpdatePoints: [
            'ReviewDecision TypeScript contract/schema',
            'native structured-output JSON schema',
            'default prompt contract text',
            'normalizer and conditional semantic validation',
            'failure-classification assertions',
            'parser compatibility fixtures',
        ],
        bamlUpdatePoints: [
            'BAML class field and conditional @@assert',
            'generated TypeScript client regeneration',
            'Footnote adapter/semantic validator and failure mapping',
            'provider structured-output integration if transport schema changes',
            'equivalence and compatibility fixtures',
        ],
        currentUpdatePointCount: 6,
        bamlUpdatePointCount: 5,
        generatedArtifacts: ['baml_client/*.ts'],
        finding:
            'BAML reduces declaration duplication only if the Footnote-owned semantic validator and failure mapping are already factored as reusable layers. In this prototype they are not removed; the simulated change still crosses nearly the same policy boundaries, plus code generation and provider integration.',
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
        name: 'null_required_decision',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: null,
            reviewReason: 'The draft is complete.',
        }),
        policySignificance:
            'Null in a required decision field must remain schema-invalid.',
    },
    {
        name: 'null_optional_revision_instruction',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'revise',
            reviewReason: 'Needs one correction.',
            revisionInstruction: null,
        }),
        policySignificance:
            'Null optional fields must still obey conditional revise semantics.',
    },
    {
        name: 'numeric_string_temperament',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            finalTemperament: { tightness: '3' },
        }),
        policySignificance:
            'Numeric strings must not silently become bounded numeric axes.',
    },
    {
        name: 'negative_temperament_axis',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            finalTemperament: { tightness: -1 },
        }),
        policySignificance:
            'Temperament lower bounds remain policy-significant.',
    },
    {
        name: 'enum_casing_variant',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'FINALIZE',
            reviewReason: 'The draft is complete.',
        }),
        policySignificance:
            'Enum casing must not silently widen decision states.',
    },
    {
        name: 'malformed_nested_array',
        kind: 'text_output',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            concerns: [],
        }),
        policySignificance:
            'Nested shape errors must remain distinguishable from omission.',
    },
    {
        name: 'prose_before_json',
        kind: 'text_output',
        output: `Here is the decision:\n${validFinalize}`,
        policySignificance:
            'Leading prose is a compatibility boundary, not a valid object.',
    },
    {
        name: 'prose_after_json',
        kind: 'text_output',
        output: `${validFinalize}\nThis is the end.`,
        policySignificance:
            'Trailing prose must not be hidden by a permissive parser.',
    },
    {
        name: 'multiple_json_objects',
        kind: 'text_output',
        output: `${validFinalize}${validFinalize}`,
        policySignificance:
            'Multiple objects must not be collapsed into one policy decision.',
    },
    {
        name: 'valid_object_after_garbage',
        kind: 'text_output',
        output: `garbage ${validFinalize}`,
        policySignificance:
            'Recovery after leading garbage changes parser compatibility semantics.',
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
            layeredFootnoteClassification: 'not_run',
            layeredClassificationMatchesCurrent: null,
            policySignificance: fixture.policySignificance,
        };
    }

    const current = classifyCurrentParser(fixture.output);
    const baml = parseWithBaml(fixture.output);
    const currentSucceeded = current.classification === 'success';
    const bamlSucceeded = baml.bamlParseResult === 'success';
    const layered = baml.bamlParsedValue
        ? classifyCurrentParser(JSON.stringify(baml.bamlParsedValue))
        : { classification: 'not_run' as const };
    return {
        case: fixture.name,
        kind: fixture.kind,
        currentFootnoteClassification: current.classification,
        ...baml,
        informationLost:
            currentSucceeded !== bamlSucceeded ||
            (!currentSucceeded && baml.bamlErrorType !== null),
        extraRecoveryPerformed: !currentSucceeded && bamlSucceeded,
        layeredFootnoteClassification: layered.classification,
        layeredClassificationMatchesCurrent: bamlSucceeded
            ? layered.classification === current.classification
            : null,
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
    parserStrictness: {
        documentedCapabilities: [
            'BAML @@assert and @assert provide strict value and cross-field validation.',
            'BAML @check preserves values while exposing non-throwing check results.',
            'The parser is documented as forgiving and can recover minor formatting or thought-token noise.',
            'BamlValidationError exposes a generic parse/validation failure boundary.',
        ],
        strictModeLocated: false,
        finding:
            'Current official documentation and the pinned 0.226.2 TypeScript runtime expose assertions/checks and parser recovery, but no parser-wide strict/coercion switch was located. Field assertions can enforce ranges after coercion; they cannot recover the original primitive type or rejected wrapper once parsing has normalized it.',
    },
    maintenanceSurface,
    contractChangeErgonomics,
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

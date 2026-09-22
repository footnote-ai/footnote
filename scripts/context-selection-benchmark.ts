/**
 * @description: Replays a synthetic, structurally faithful Discord corpus
 * against deterministic context-selection baselines and unavailable-model gates.
 * @footnote-scope: utility
 * @footnote-module: ContextSelectionBenchmark
 * @footnote-risk: medium - Incorrect benchmark accounting could support a false architecture decision.
 * @footnote-ethics: high - The corpus is synthetic so private Discord content never enters committed fixtures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export type ContextSelectionMethod =
    | 'current_window'
    | 'recency_reply_expansion'
    | 'recency_author_continuation'
    | 'bm25'
    | 'bm25_reply_expansion'
    | 'bm25_graph_expansion'
    | 'hash_embedding_proxy'
    | 'existing_cross_encoder'
    | 'openjev';

export type BenchmarkMessage = {
    id: string;
    authorId: string;
    text: string;
    replyToId?: string;
};

export type ContextBenchmarkCase = {
    id: string;
    category:
        | 'trigger_only'
        | 'immediate_predecessor'
        | 'several_turns_back'
        | 'old_relevant_history'
        | 'reply_ancestry'
        | 'one_relevant_branch'
        | 'simultaneous_conversations'
        | 'topic_switch'
        | 'pronoun_reference'
        | 'same_author_continuation'
        | 'paraphrased_reference'
        | 'scattered_context'
        | 'irrelevant_high_similarity'
        | 'historical_context_not_recovered'
        | 'coreference_ambiguous'
        | 'semantic_paraphrase'
        | 'misleading_overlap_hard'
        | 'topic_resumption'
        | 'speaker_sensitive'
        | 'negative_historical_match';
    latestUserInput: string;
    triggerReplyToId?: string;
    messages: BenchmarkMessage[];
    necessaryMessageIds: string[];
    usefulMessageIds: string[];
    distractingMessageIds: string[];
};

export type SelectionResult = {
    method: ContextSelectionMethod;
    status: 'completed' | 'unavailable';
    messageIds: string[];
    candidateCount: number;
    retrievalDepth: number;
    branchExpansions: number;
    expansionDepth?: number;
    latencyMs: number | null;
    reason?: string;
};

export type CaseMetric = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    method: ContextSelectionMethod;
    status: SelectionResult['status'];
    necessaryRecoveredCount: number;
    necessaryCount: number;
    usefulSelectedCount: number;
    selectedCount: number;
    distractingSelectedCount: number;
    historicalNecessaryRecoveredCount: number;
    historicalNecessaryCount: number;
    necessaryRecall: number | null;
    usefulContextPrecision: number | null;
    distractingContextRate: number | null;
    finalMessageCount: number;
    estimatedInputTokens: number;
    candidateCount: number;
    retrievalDepth: number;
    historicalDistanceRecovery: number | null;
    branchExpansionCount: number;
    latencyMs: number | null;
    reason?: string;
};

export type AggregateMetric = {
    method: ContextSelectionMethod;
    completedCases: number;
    unavailableCases: number;
    necessaryMessageRecall: number | null;
    necessaryMessageRecall95Ci: [number, number] | null;
    usefulContextPrecision: number | null;
    usefulContextPrecision95Ci: [number, number] | null;
    distractingContextRate: number | null;
    averageFinalMessageCount: number | null;
    averageEstimatedInputTokens: number | null;
    averageCandidateCount: number | null;
    averageRetrievalDepth: number | null;
    historicalDistanceRecovery: number | null;
    averageBranchExpansionCount: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
};

export type CategoryAggregateMetric = {
    category: ContextBenchmarkCase['category'];
    method: ContextSelectionMethod;
    caseCount: number;
    necessaryMessageRecall: number | null;
    usefulContextPrecision: number | null;
    distractingContextRate: number | null;
    averageFinalMessageCount: number | null;
    averageEstimatedInputTokens: number | null;
    p95LatencyMs: number | null;
};

export type ContextGraphEdge =
    'reply' | 'adjacent' | 'same_author' | 'trigger_reply';

export type GraphExpansionOptions = {
    budget: number;
    seedCount?: number;
    maxDepth?: number;
    edges?: readonly ContextGraphEdge[];
};

export type BenchmarkReport = {
    benchmark: {
        issue: 717;
        generatedAt: string;
        corpus: 'synthetic_structurally_faithful';
        caseCount: number;
        messageCount: number;
        contextWindowSize: 24;
        tokenEstimate: 'ceil(utf8_characters / 4)';
        categoryCounts: Record<string, number>;
        fixtureProvenance: string;
        limitations: string[];
    };
    methods: AggregateMetric[];
    categoryMetrics: CategoryAggregateMetric[];
    cases: CaseMetric[];
};

const CONTEXT_WINDOW_SIZE = 24;
const CORPUS_CASE_COUNT = 100;
const MESSAGE_COUNT = 40;
const TOKEN_ESTIMATE_DIVISOR = 4;

const SCENARIOS: Array<ContextBenchmarkCase['category']> = [
    'trigger_only',
    'immediate_predecessor',
    'several_turns_back',
    'old_relevant_history',
    'reply_ancestry',
    'one_relevant_branch',
    'simultaneous_conversations',
    'topic_switch',
    'pronoun_reference',
    'same_author_continuation',
    'paraphrased_reference',
    'scattered_context',
    'irrelevant_high_similarity',
    'historical_context_not_recovered',
    'coreference_ambiguous',
    'semantic_paraphrase',
    'misleading_overlap_hard',
    'topic_resumption',
    'speaker_sensitive',
    'negative_historical_match',
];

const createMessage = (
    caseNumber: number,
    messageNumber: number,
    text: string,
    authorId = messageNumber % 2 === 0 ? 'alex' : 'sam',
    replyToId?: string
): BenchmarkMessage => ({
    id: `case-${caseNumber}-message-${messageNumber}`,
    authorId,
    text,
    ...(replyToId === undefined ? {} : { replyToId }),
});

const messageId = (caseNumber: number, messageNumber: number): string =>
    `case-${caseNumber}-message-${messageNumber}`;

const buildMessages = (caseNumber: number): BenchmarkMessage[] =>
    Array.from({ length: MESSAGE_COUNT }, (_, messageNumber) =>
        createMessage(
            caseNumber,
            messageNumber,
            `unrelated channel chatter ${messageNumber}: the weather and weekend plans are unchanged.`
        )
    );

const replaceMessage = (
    messages: BenchmarkMessage[],
    caseNumber: number,
    messageNumber: number,
    text: string,
    authorId?: string,
    replyToId?: string
): void => {
    messages[messageNumber] = createMessage(
        caseNumber,
        messageNumber,
        text,
        authorId,
        replyToId
    );
};

const buildScenario = (
    caseNumber: number,
    category: ContextBenchmarkCase['category']
): ContextBenchmarkCase => {
    const messages = buildMessages(caseNumber);
    const necessaryMessageIds: string[] = [];
    const usefulMessageIds: string[] = [];
    const distractingMessageIds: string[] = [];
    let latestUserInput = 'Can anyone help with the next step?';
    let triggerReplyToId: string | undefined;

    const necessary = (...numbers: number[]): void => {
        necessaryMessageIds.push(
            ...numbers.map((number) => messageId(caseNumber, number))
        );
    };
    const useful = (...numbers: number[]): void => {
        usefulMessageIds.push(
            ...numbers.map((number) => messageId(caseNumber, number))
        );
    };
    const distracting = (...numbers: number[]): void => {
        distractingMessageIds.push(
            ...numbers.map((number) => messageId(caseNumber, number))
        );
    };

    switch (category) {
        case 'trigger_only':
            latestUserInput = 'Thanks, I found the answer in the local manual.';
            break;
        case 'immediate_predecessor':
            replaceMessage(
                messages,
                caseNumber,
                39,
                'The deploy is blocked because DATABASE_URL is missing from the staging environment.'
            );
            latestUserInput =
                'How should we fix the staging DATABASE_URL deploy block?';
            necessary(39);
            break;
        case 'several_turns_back':
            replaceMessage(
                messages,
                caseNumber,
                30,
                'The staged rollout uses the canary worker before the general worker.'
            );
            replaceMessage(
                messages,
                caseNumber,
                31,
                'We agreed to watch the canary error rate for ten minutes.'
            );
            latestUserInput =
                'Should we keep watching the canary before expanding the staged rollout?';
            necessary(30, 31);
            useful(32);
            break;
        case 'old_relevant_history':
            replaceMessage(
                messages,
                caseNumber,
                2,
                'The migration uses the blue-green rollback marker named amber-17.'
            );
            latestUserInput =
                'What does the amber-17 rollback marker mean for this migration?';
            necessary(2);
            useful(3);
            break;
        case 'reply_ancestry': {
            const parentId = messageId(caseNumber, 5);
            replaceMessage(
                messages,
                caseNumber,
                5,
                'We decided to retain the audit export for seven days before deletion.'
            );
            replaceMessage(
                messages,
                caseNumber,
                39,
                'Yes, that retention window is the one I meant.',
                'sam',
                parentId
            );
            latestUserInput =
                'Can you restate the retention decision from this reply thread?';
            triggerReplyToId = messageId(caseNumber, 39);
            necessary(5, 39);
            useful(6);
            break;
        }
        case 'one_relevant_branch':
            replaceMessage(
                messages,
                caseNumber,
                15,
                'The billing branch is waiting on the invoice hash, not the unrelated UI work.'
            );
            replaceMessage(
                messages,
                caseNumber,
                16,
                'The invoice hash is recorded in the billing branch review.',
                'sam',
                messageId(caseNumber, 15)
            );
            latestUserInput =
                'Where is the invoice hash for the billing branch review?';
            necessary(15, 16);
            distracting(20, 21, 22);
            break;
        case 'simultaneous_conversations':
            replaceMessage(
                messages,
                caseNumber,
                10,
                'The API team is testing the webhook signature with fixture HMAC-42.'
            );
            replaceMessage(
                messages,
                caseNumber,
                28,
                'The documentation team is updating the webhook troubleshooting page.'
            );
            latestUserInput =
                'What is the status of the webhook signature test and the troubleshooting page?';
            necessary(10, 28);
            useful(11, 29);
            distracting(12, 13);
            break;
        case 'topic_switch':
            replaceMessage(
                messages,
                caseNumber,
                24,
                'The current topic is the cache invalidation checklist for the image worker.'
            );
            latestUserInput =
                'What remains on the image worker cache invalidation checklist?';
            necessary(24);
            distracting(20, 21);
            break;
        case 'pronoun_reference':
            replaceMessage(
                messages,
                caseNumber,
                4,
                'The blue-green deployment is the one with the amber rollback marker.'
            );
            replaceMessage(
                messages,
                caseNumber,
                35,
                'The deployment is still paused while we inspect the marker.'
            );
            latestUserInput = 'Should we roll it back now?';
            necessary(4, 35);
            break;
        case 'same_author_continuation':
            replaceMessage(
                messages,
                caseNumber,
                14,
                'I will keep the local generator loaded while the benchmark runs.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                15,
                'That means the assessor must be loaded on demand.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                16,
                'The assessor should load only after the generator benchmark finishes.',
                'alex'
            );
            latestUserInput =
                'Given my previous note, when should the assessor load?';
            necessary(14, 15, 16);
            break;
        case 'paraphrased_reference':
            replaceMessage(
                messages,
                caseNumber,
                7,
                'The deployment can return to its prior release using marker amber-17.'
            );
            latestUserInput =
                'Which token returns the blue-green release to its previous version?';
            necessary(7);
            useful(8);
            break;
        case 'scattered_context':
            replaceMessage(
                messages,
                caseNumber,
                3,
                'The release gate requires the signed manifest.'
            );
            replaceMessage(
                messages,
                caseNumber,
                18,
                'The manifest is generated after the dependency lockfile check.'
            );
            replaceMessage(
                messages,
                caseNumber,
                37,
                'The signed manifest is uploaded only after both checks pass.'
            );
            latestUserInput =
                'Which steps must pass before uploading the signed release manifest?';
            necessary(3, 18, 37);
            break;
        case 'irrelevant_high_similarity':
            replaceMessage(
                messages,
                caseNumber,
                8,
                'The provenance review keeps the canonical trace artifact for the response.'
            );
            replaceMessage(
                messages,
                caseNumber,
                30,
                'The provenance review is about an unrelated archived response artifact.'
            );
            replaceMessage(
                messages,
                caseNumber,
                31,
                'The archived response artifact is not part of this current review.'
            );
            latestUserInput =
                'Which artifact does the current provenance review keep?';
            necessary(8);
            distracting(30, 31);
            break;
        case 'historical_context_not_recovered':
            replaceMessage(
                messages,
                caseNumber,
                0,
                'The old incident used a temporary rollback plan that is now closed.'
            );
            replaceMessage(
                messages,
                caseNumber,
                39,
                'The current incident is waiting for a fresh owner assignment.'
            );
            latestUserInput =
                'Who owns the current incident now that the old rollback plan is closed?';
            necessary(39);
            distracting(0);
            break;
        case 'coreference_ambiguous':
            replaceMessage(
                messages,
                caseNumber,
                4,
                'Alex compared the cedar worker, which handles documents, with the redwood worker for images.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                12,
                'Jordan said the redwood worker is slower but safer for the archive queue.',
                'jordan'
            );
            replaceMessage(
                messages,
                caseNumber,
                31,
                'I meant the cedar worker when I said that one was easier to operate.',
                'alex'
            );
            latestUserInput = 'Which one did Alex say was easier to operate?';
            necessary(4, 31);
            distracting(12);
            break;
        case 'semantic_paraphrase':
            replaceMessage(
                messages,
                caseNumber,
                6,
                'I favor keeping inference on-device because private prompts stay inside our deployment boundary.',
                'alex'
            );
            latestUserInput = 'Why did Alex favor the local option?';
            necessary(6);
            useful(7);
            break;
        case 'misleading_overlap_hard':
            replaceMessage(
                messages,
                caseNumber,
                5,
                'For the archive project, the redwood worker handles the image queue and the cedar worker handles documents.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                27,
                'The redwood worker image queue is healthy in the unrelated thumbnail project.',
                'sam'
            );
            replaceMessage(
                messages,
                caseNumber,
                33,
                'The archive image worker is not the thumbnail worker even though both mention the same queue.',
                'sam'
            );
            latestUserInput =
                'Which worker handles images for the archive project?';
            necessary(5);
            distracting(27, 33);
            break;
        case 'topic_resumption':
            replaceMessage(
                messages,
                caseNumber,
                4,
                'We agreed that the audit export remains available for seven days.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                20,
                'The unrelated image worker needs a cache warmup before launch.',
                'sam'
            );
            replaceMessage(
                messages,
                caseNumber,
                35,
                'Back to the earlier choice: I still prefer the shorter retention period.',
                'alex'
            );
            latestUserInput = 'Does that still apply to the export?';
            necessary(4, 35);
            distracting(20);
            break;
        case 'speaker_sensitive':
            replaceMessage(
                messages,
                caseNumber,
                8,
                'I recommend keeping the audit export for seven days.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                19,
                'I recommend keeping the audit export for thirty days.',
                'jordan'
            );
            latestUserInput = 'What did Alex recommend for the audit export?';
            necessary(8);
            distracting(19);
            break;
        case 'negative_historical_match':
            replaceMessage(
                messages,
                caseNumber,
                1,
                'The old image worker used the cedar queue before that project was retired.',
                'alex'
            );
            replaceMessage(
                messages,
                caseNumber,
                38,
                'The current image worker uses the redwood queue after the migration.',
                'alex'
            );
            latestUserInput = 'Which queue does the current image worker use?';
            necessary(38);
            distracting(1);
            break;
    }

    return {
        id: `context-selection-${caseNumber.toString().padStart(3, '0')}`,
        category,
        latestUserInput,
        ...(triggerReplyToId === undefined ? {} : { triggerReplyToId }),
        messages,
        necessaryMessageIds,
        usefulMessageIds,
        distractingMessageIds,
    };
};

/**
 * Builds the committed synthetic corpus. Each category is repeated to reach
 * the issue's target of about 100 turns without retaining private transcripts.
 */
export const buildBenchmarkCorpus = (): ContextBenchmarkCase[] =>
    Array.from({ length: CORPUS_CASE_COUNT }, (_, index) => {
        const category = SCENARIOS[index % SCENARIOS.length];
        if (category === undefined) {
            throw new Error(`Missing scenario for case ${index}.`);
        }
        return buildScenario(index + 1, category);
    });

const tokenize = (value: string): string[] =>
    value.toLocaleLowerCase('en-US').match(/[a-z0-9]+/g) ?? [];

const selectTopMessageIds = (
    messages: BenchmarkMessage[],
    scores: Map<string, number>,
    limit: number
): string[] =>
    messages
        .map((message, index) => ({
            message,
            index,
            score: scores.get(message.id) ?? 0,
        }))
        .sort(
            (left, right) =>
                right.score - left.score || right.index - left.index
        )
        .slice(0, Math.min(limit, messages.length))
        .map(({ message }) => message.id);

const selectCurrentWindow = (
    entry: ContextBenchmarkCase,
    budget = CONTEXT_WINDOW_SIZE
): SelectionResult => ({
    method: 'current_window',
    status: 'completed',
    messageIds: entry.messages.slice(-budget).map((message) => message.id),
    candidateCount: entry.messages.length,
    retrievalDepth: budget,
    branchExpansions: 0,
    latencyMs: null,
});

const selectRecencyWithReplyExpansion = (
    entry: ContextBenchmarkCase,
    budget?: number
): SelectionResult => {
    const selected = new Set(
        entry.messages
            .slice(-(budget ?? CONTEXT_WINDOW_SIZE))
            .map((message) => message.id)
    );
    const byId = new Map(
        entry.messages.map((message) => [message.id, message])
    );
    const pending = entry.messages
        .filter(
            (message) =>
                selected.has(message.id) && message.replyToId !== undefined
        )
        .map((message) => message.replyToId as string);
    let branchExpansions = 0;

    if (
        entry.triggerReplyToId !== undefined &&
        !selected.has(entry.triggerReplyToId)
    ) {
        pending.push(entry.triggerReplyToId);
    }

    while (pending.length > 0) {
        const currentId = pending.pop();
        if (currentId === undefined || selected.has(currentId)) {
            continue;
        }
        const current = byId.get(currentId);
        if (
            current === undefined ||
            selected.has(currentId) ||
            (budget !== undefined && selected.size >= budget)
        ) {
            continue;
        }
        selected.add(current.id);
        branchExpansions += 1;
        if (
            current.replyToId !== undefined &&
            !selected.has(current.replyToId)
        ) {
            pending.push(current.replyToId);
        }
    }

    return {
        method: 'recency_reply_expansion',
        status: 'completed',
        messageIds: entry.messages
            .filter((message) => selected.has(message.id))
            .map((message) => message.id),
        candidateCount: entry.messages.length,
        retrievalDepth: budget ?? CONTEXT_WINDOW_SIZE,
        branchExpansions,
        latencyMs: null,
    };
};

const selectRecencyWithAuthorContinuation = (
    entry: ContextBenchmarkCase,
    budget?: number
): SelectionResult => {
    const selected = new Set(
        entry.messages
            .slice(-(budget ?? CONTEXT_WINDOW_SIZE))
            .map((message) => message.id)
    );
    let branchExpansions = 0;
    let expanded = true;

    while (expanded) {
        expanded = false;
        for (const [index, message] of entry.messages.entries()) {
            if (!selected.has(message.id)) {
                continue;
            }
            const predecessor = entry.messages[index - 1];
            if (budget !== undefined && selected.size >= budget) {
                break;
            }
            if (
                predecessor !== undefined &&
                predecessor.authorId === message.authorId &&
                !selected.has(predecessor.id)
            ) {
                selected.add(predecessor.id);
                branchExpansions += 1;
                expanded = true;
            }
        }
    }

    return {
        method: 'recency_author_continuation',
        status: 'completed',
        messageIds: entry.messages
            .filter((message) => selected.has(message.id))
            .map((message) => message.id),
        candidateCount: entry.messages.length,
        retrievalDepth: budget ?? CONTEXT_WINDOW_SIZE,
        branchExpansions,
        latencyMs: null,
    };
};

const scoreBm25 = (entry: ContextBenchmarkCase): Map<string, number> => {
    const queryTokens = tokenize(entry.latestUserInput);
    const documents = entry.messages.map((message) => tokenize(message.text));
    const documentFrequency = new Map<string, number>();
    for (const document of documents) {
        for (const token of new Set(document)) {
            documentFrequency.set(
                token,
                (documentFrequency.get(token) ?? 0) + 1
            );
        }
    }
    const averageLength =
        documents.reduce((total, document) => total + document.length, 0) /
        Math.max(1, documents.length);
    const scores = new Map<string, number>();
    const k1 = 1.2;
    const b = 0.75;

    for (const [index, document] of documents.entries()) {
        const counts = new Map<string, number>();
        for (const token of document) {
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
        let score = 0;
        for (const token of queryTokens) {
            const frequency = counts.get(token) ?? 0;
            if (frequency === 0) {
                continue;
            }
            const documentCount = documentFrequency.get(token) ?? 0;
            const inverseDocumentFrequency = Math.log(
                1 +
                    (documents.length - documentCount + 0.5) /
                        (documentCount + 0.5)
            );
            score +=
                inverseDocumentFrequency *
                ((frequency * (k1 + 1)) /
                    (frequency +
                        k1 *
                            (1 -
                                b +
                                b *
                                    (document.length /
                                        Math.max(1, averageLength)))));
        }
        const message = entry.messages[index];
        if (message !== undefined) {
            scores.set(message.id, score);
        }
    }
    return scores;
};

const hashToken = (token: string): number => {
    let hash = 2166136261;
    for (const character of token) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const createHashEmbedding = (text: string): number[] => {
    const vector = Array.from({ length: 128 }, () => 0);
    for (const token of tokenize(text)) {
        const index = hashToken(token) % vector.length;
        vector[index] += 1;
        for (let offset = 0; offset < token.length - 2; offset += 1) {
            const trigramIndex =
                hashToken(token.slice(offset, offset + 3)) % vector.length;
            vector[trigramIndex] += 0.25;
        }
    }
    return vector;
};

const cosineSimilarity = (left: number[], right: number[]): number => {
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
        const leftValue = left[index] ?? 0;
        const rightValue = right[index] ?? 0;
        dot += leftValue * rightValue;
        leftMagnitude += leftValue * leftValue;
        rightMagnitude += rightValue * rightValue;
    }
    return leftMagnitude === 0 || rightMagnitude === 0
        ? 0
        : dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

const selectScored = (
    method: 'bm25' | 'hash_embedding_proxy',
    entry: ContextBenchmarkCase,
    budget = CONTEXT_WINDOW_SIZE
): SelectionResult => {
    const queryVector = createHashEmbedding(entry.latestUserInput);
    const scores =
        method === 'bm25'
            ? scoreBm25(entry)
            : new Map(
                  entry.messages.map((message) => [
                      message.id,
                      cosineSimilarity(
                          queryVector,
                          createHashEmbedding(message.text)
                      ),
                  ])
              );
    return {
        method,
        status: 'completed',
        messageIds: selectTopMessageIds(entry.messages, scores, budget),
        candidateCount: entry.messages.length,
        retrievalDepth: entry.messages.length,
        branchExpansions: 0,
        latencyMs: null,
    };
};

const selectBm25WithReplyExpansion = (
    entry: ContextBenchmarkCase,
    budget?: number
): SelectionResult => {
    const selected = new Set(
        selectTopMessageIds(
            entry.messages,
            scoreBm25(entry),
            budget ?? CONTEXT_WINDOW_SIZE
        )
    );
    const byId = new Map(
        entry.messages.map((message) => [message.id, message])
    );
    const pending = entry.messages
        .filter(
            (message) =>
                selected.has(message.id) && message.replyToId !== undefined
        )
        .map((message) => message.replyToId as string);
    if (entry.triggerReplyToId !== undefined) {
        pending.push(entry.triggerReplyToId);
    }

    let branchExpansions = 0;
    while (
        pending.length > 0 &&
        (budget === undefined || selected.size < budget)
    ) {
        const currentId = pending.pop();
        if (currentId === undefined || selected.has(currentId)) {
            continue;
        }
        const current = byId.get(currentId);
        if (current === undefined) {
            continue;
        }
        selected.add(current.id);
        branchExpansions += 1;
        if (current.replyToId !== undefined) {
            pending.push(current.replyToId);
        }
    }

    return {
        method: 'bm25_reply_expansion',
        status: 'completed',
        messageIds: entry.messages
            .filter((message) => selected.has(message.id))
            .map((message) => message.id),
        candidateCount: entry.messages.length,
        retrievalDepth: entry.messages.length,
        branchExpansions,
        latencyMs: null,
    };
};

export const selectBm25GraphExpansionWithEdges = (
    entry: ContextBenchmarkCase,
    options: GraphExpansionOptions
): SelectionResult => {
    const graphSeedCount = Math.min(options.seedCount ?? 12, options.budget);
    const edges = new Set<ContextGraphEdge>(
        options.edges ?? ['reply', 'adjacent', 'same_author', 'trigger_reply']
    );
    const selected = new Set(
        selectTopMessageIds(entry.messages, scoreBm25(entry), graphSeedCount)
    );
    const byId = new Map(
        entry.messages.map((message, index) => [message.id, { message, index }])
    );
    const pending: Array<{ id: string; depth: number }> = [];
    const enqueue = (id: string, depth: number): void => {
        pending.push({ id, depth });
    };
    for (const messageId of selected) {
        const indexed = byId.get(messageId);
        if (indexed === undefined) {
            continue;
        }
        if (edges.has('reply') && indexed.message.replyToId !== undefined) {
            enqueue(indexed.message.replyToId, 1);
        }
        const predecessor = entry.messages[indexed.index - 1];
        const successor = entry.messages[indexed.index + 1];
        if (edges.has('adjacent') && predecessor !== undefined) {
            enqueue(predecessor.id, 1);
        }
        if (edges.has('adjacent') && successor !== undefined) {
            enqueue(successor.id, 1);
        }
        if (
            edges.has('same_author') &&
            predecessor !== undefined &&
            predecessor.authorId === indexed.message.authorId
        ) {
            enqueue(predecessor.id, 1);
        }
        if (
            edges.has('trigger_reply') &&
            entry.triggerReplyToId !== undefined
        ) {
            enqueue(entry.triggerReplyToId, 1);
        }
    }

    let branchExpansions = 0;
    let expansionDepth = 0;
    while (pending.length > 0 && selected.size < options.budget) {
        const current = pending.shift();
        if (current === undefined || selected.has(current.id)) {
            continue;
        }
        const indexed = byId.get(current.id);
        if (indexed === undefined) {
            continue;
        }
        selected.add(current.id);
        branchExpansions += 1;
        expansionDepth = Math.max(expansionDepth, current.depth);
        if (
            current.depth < (options.maxDepth ?? Number.POSITIVE_INFINITY) &&
            edges.has('reply') &&
            indexed.message.replyToId !== undefined
        ) {
            enqueue(indexed.message.replyToId, current.depth + 1);
        }
        const predecessor = entry.messages[indexed.index - 1];
        if (
            edges.has('same_author') &&
            predecessor !== undefined &&
            predecessor.authorId === indexed.message.authorId
        ) {
            enqueue(predecessor.id, current.depth + 1);
        }
        if (
            edges.has('trigger_reply') &&
            entry.triggerReplyToId !== undefined
        ) {
            enqueue(entry.triggerReplyToId, current.depth + 1);
        }
    }

    return {
        method: 'bm25_graph_expansion',
        status: 'completed',
        messageIds: entry.messages
            .filter((message) => selected.has(message.id))
            .map((message) => message.id),
        candidateCount: entry.messages.length,
        retrievalDepth: entry.messages.length,
        branchExpansions,
        expansionDepth,
        latencyMs: null,
    };
};

const selectBm25WithGraphExpansion = (
    entry: ContextBenchmarkCase
): SelectionResult =>
    selectBm25GraphExpansionWithEdges(entry, {
        budget: CONTEXT_WINDOW_SIZE,
    });

/**
 * Selects a bounded context pack. Model-backed methods are intentionally
 * unavailable by default; missing judgment infrastructure must fail open to
 * the current deterministic path rather than silently change production input.
 */
export const selectContext = (
    method: ContextSelectionMethod,
    entry: ContextBenchmarkCase
): SelectionResult => {
    const startedAt = performance.now();
    let result: SelectionResult;
    switch (method) {
        case 'current_window':
            result = selectCurrentWindow(entry);
            break;
        case 'recency_reply_expansion':
            result = selectRecencyWithReplyExpansion(entry);
            break;
        case 'recency_author_continuation':
            result = selectRecencyWithAuthorContinuation(entry);
            break;
        case 'bm25':
            result = selectScored(method, entry);
            break;
        case 'bm25_reply_expansion':
            result = selectBm25WithReplyExpansion(entry);
            break;
        case 'bm25_graph_expansion':
            result = selectBm25WithGraphExpansion(entry);
            break;
        case 'hash_embedding_proxy':
            result = selectScored(method, entry);
            break;
        case 'existing_cross_encoder':
            result = {
                method,
                status: 'unavailable',
                messageIds: [],
                candidateCount: entry.messages.length,
                retrievalDepth: 0,
                branchExpansions: 0,
                latencyMs: null,
                reason: 'No cross-encoder or reranker dependency is configured in Footnote.',
            };
            break;
        case 'openjev':
            result = {
                method,
                status: 'unavailable',
                messageIds: [],
                candidateCount: entry.messages.length,
                retrievalDepth: 0,
                branchExpansions: 0,
                latencyMs: null,
                reason: 'OpenJEV is not configured or invoked by this benchmark harness.',
            };
            break;
    }

    if (result.status === 'completed') {
        result.latencyMs = performance.now() - startedAt;
    }
    return result;
};

/**
 * Runs the deterministic methods with an explicit message budget for offline
 * cost curves. This is benchmark-only and does not alter production context.
 */
export const selectContextAtBudget = (
    method: ContextSelectionMethod,
    entry: ContextBenchmarkCase,
    budget: number
): SelectionResult => {
    if (!Number.isInteger(budget) || budget <= 0) {
        throw new Error(`Context budget must be a positive integer: ${budget}`);
    }
    const startedAt = performance.now();
    let result: SelectionResult;
    switch (method) {
        case 'current_window':
            result = selectCurrentWindow(entry, budget);
            break;
        case 'recency_reply_expansion':
            result = selectRecencyWithReplyExpansion(entry, budget);
            break;
        case 'recency_author_continuation':
            result = selectRecencyWithAuthorContinuation(entry, budget);
            break;
        case 'bm25':
            result = selectScored(method, entry, budget);
            break;
        case 'bm25_reply_expansion':
            result = selectBm25WithReplyExpansion(entry, budget);
            break;
        case 'bm25_graph_expansion':
            result = selectBm25GraphExpansionWithEdges(entry, { budget });
            break;
        case 'hash_embedding_proxy':
            result = selectScored(method, entry, budget);
            break;
        case 'existing_cross_encoder':
        case 'openjev':
            result = selectContext(method, entry);
            break;
    }
    if (result.status === 'completed') {
        result.latencyMs = performance.now() - startedAt;
    }
    return result;
};

const estimateInputTokens = (
    entry: ContextBenchmarkCase,
    messageIds: readonly string[]
): number => {
    const selected = new Set(messageIds);
    const selectedCharacters = entry.messages
        .filter((message) => selected.has(message.id))
        .reduce((total, message) => total + message.text.length, 0);
    return Math.ceil(selectedCharacters / TOKEN_ESTIMATE_DIVISOR);
};

const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

const wilsonInterval = (
    successes: number,
    trials: number
): [number, number] | null => {
    if (trials === 0) {
        return null;
    }
    const z = 1.96;
    const proportion = successes / trials;
    const denominator = 1 + (z * z) / trials;
    const centre = proportion + (z * z) / (2 * trials);
    const margin =
        z *
        Math.sqrt(
            (proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials
        );
    return [
        Math.max(0, (centre - margin) / denominator),
        Math.min(1, (centre + margin) / denominator),
    ];
};

const percentile = (
    values: number[],
    percentileValue: number
): number | null => {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
    );
    return sorted[index] ?? null;
};

export const buildCaseMetric = (
    entry: ContextBenchmarkCase,
    result: SelectionResult
): CaseMetric => {
    if (result.status === 'unavailable') {
        return {
            caseId: entry.id,
            category: entry.category,
            method: result.method,
            status: result.status,
            necessaryRecoveredCount: 0,
            necessaryCount: entry.necessaryMessageIds.length,
            usefulSelectedCount: 0,
            selectedCount: 0,
            distractingSelectedCount: 0,
            historicalNecessaryRecoveredCount: 0,
            historicalNecessaryCount: 0,
            necessaryRecall: null,
            usefulContextPrecision: null,
            distractingContextRate: null,
            finalMessageCount: 0,
            estimatedInputTokens: 0,
            candidateCount: result.candidateCount,
            retrievalDepth: result.retrievalDepth,
            historicalDistanceRecovery: null,
            branchExpansionCount: 0,
            latencyMs: null,
            reason: result.reason,
        };
    }

    const selected = new Set(result.messageIds);
    const necessary = new Set(entry.necessaryMessageIds);
    const useful = new Set([
        ...entry.necessaryMessageIds,
        ...entry.usefulMessageIds,
    ]);
    const distracting = new Set(entry.distractingMessageIds);
    const olderNecessary = new Set(
        entry.necessaryMessageIds.filter((messageIdValue) => {
            const messageIndex = entry.messages.findIndex(
                (message) => message.id === messageIdValue
            );
            return messageIndex < entry.messages.length - CONTEXT_WINDOW_SIZE;
        })
    );
    const selectedCount = selected.size;
    const necessaryRecoveredCount = [...necessary].filter((messageIdValue) =>
        selected.has(messageIdValue)
    ).length;
    const usefulSelectedCount = [...selected].filter((messageIdValue) =>
        useful.has(messageIdValue)
    ).length;
    const distractingSelectedCount = [...selected].filter((messageIdValue) =>
        distracting.has(messageIdValue)
    ).length;
    const historicalNecessaryRecoveredCount = [...olderNecessary].filter(
        (messageIdValue) => selected.has(messageIdValue)
    ).length;
    return {
        caseId: entry.id,
        category: entry.category,
        method: result.method,
        status: result.status,
        necessaryRecoveredCount,
        necessaryCount: necessary.size,
        usefulSelectedCount,
        selectedCount,
        distractingSelectedCount,
        historicalNecessaryRecoveredCount,
        historicalNecessaryCount: olderNecessary.size,
        necessaryRecall: ratio(necessaryRecoveredCount, necessary.size),
        usefulContextPrecision: ratio(usefulSelectedCount, selectedCount),
        distractingContextRate: ratio(distractingSelectedCount, selectedCount),
        finalMessageCount: selectedCount,
        estimatedInputTokens: estimateInputTokens(entry, result.messageIds),
        candidateCount: result.candidateCount,
        retrievalDepth: result.retrievalDepth,
        historicalDistanceRecovery: ratio(
            historicalNecessaryRecoveredCount,
            olderNecessary.size
        ),
        branchExpansionCount: result.branchExpansions,
        latencyMs: result.latencyMs,
    };
};

export const aggregateMetrics = (
    method: ContextSelectionMethod,
    metrics: CaseMetric[]
): AggregateMetric => {
    const completed = metrics.filter((metric) => metric.status === 'completed');
    const availableNecessary = completed.filter(
        (metric) => metric.necessaryRecall !== null
    );
    const availablePrecision = completed.filter(
        (metric) => metric.usefulContextPrecision !== null
    );
    const necessaryNumerator = availableNecessary.reduce(
        (total, metric) => total + metric.necessaryRecoveredCount,
        0
    );
    const necessaryDenominator = availableNecessary.reduce(
        (total, metric) => total + metric.necessaryCount,
        0
    );
    const precisionNumerator = availablePrecision.reduce(
        (total, metric) => total + metric.usefulSelectedCount,
        0
    );
    const precisionDenominator = availablePrecision.reduce(
        (total, metric) => total + metric.selectedCount,
        0
    );
    const average = (values: number[]): number | null =>
        values.length === 0
            ? null
            : values.reduce((total, value) => total + value, 0) / values.length;

    const distractingValues = completed
        .map((metric) => metric.distractingContextRate)
        .filter((value): value is number => value !== null);
    const historicalValues = completed
        .map((metric) => metric.historicalDistanceRecovery)
        .filter((value): value is number => value !== null);
    const latencyValues = completed
        .map((metric) => metric.latencyMs)
        .filter((value): value is number => value !== null);

    return {
        method,
        completedCases: completed.length,
        unavailableCases: metrics.length - completed.length,
        necessaryMessageRecall: ratio(necessaryNumerator, necessaryDenominator),
        necessaryMessageRecall95Ci: wilsonInterval(
            necessaryNumerator,
            necessaryDenominator
        ),
        usefulContextPrecision: ratio(precisionNumerator, precisionDenominator),
        usefulContextPrecision95Ci: wilsonInterval(
            precisionNumerator,
            precisionDenominator
        ),
        distractingContextRate: average(distractingValues),
        averageFinalMessageCount: average(
            completed.map((metric) => metric.finalMessageCount)
        ),
        averageEstimatedInputTokens: average(
            completed.map((metric) => metric.estimatedInputTokens)
        ),
        averageCandidateCount: average(
            completed.map((metric) => metric.candidateCount)
        ),
        averageRetrievalDepth: average(
            completed.map((metric) => metric.retrievalDepth)
        ),
        historicalDistanceRecovery: average(historicalValues),
        averageBranchExpansionCount: average(
            completed.map((metric) => metric.branchExpansionCount)
        ),
        p50LatencyMs: percentile(latencyValues, 50),
        p95LatencyMs: percentile(latencyValues, 95),
    };
};

const aggregateCategoryMetrics = (
    cases: CaseMetric[]
): CategoryAggregateMetric[] =>
    METHODS.flatMap((method) =>
        SCENARIOS.map((category) => {
            const categoryCases = cases.filter(
                (metric) =>
                    metric.method === method && metric.category === category
            );
            const aggregate = aggregateMetrics(method, categoryCases);
            return {
                category,
                method,
                caseCount: categoryCases.length,
                necessaryMessageRecall: aggregate.necessaryMessageRecall,
                usefulContextPrecision: aggregate.usefulContextPrecision,
                distractingContextRate: aggregate.distractingContextRate,
                averageFinalMessageCount: aggregate.averageFinalMessageCount,
                averageEstimatedInputTokens:
                    aggregate.averageEstimatedInputTokens,
                p95LatencyMs: aggregate.p95LatencyMs,
            };
        })
    );

const METHODS: ContextSelectionMethod[] = [
    'current_window',
    'recency_reply_expansion',
    'recency_author_continuation',
    'bm25',
    'bm25_reply_expansion',
    'bm25_graph_expansion',
    'hash_embedding_proxy',
    'existing_cross_encoder',
    'openjev',
];

/**
 * @description: Executes each context-selection method over the supplied corpus.
 * Produces case-level and aggregate metrics for benchmark comparison.
 * @footnote-scope: utility
 * @footnote-module: ContextSelectionBenchmark
 * @footnote-risk: medium - Incorrect aggregate metrics could support a false architecture decision.
 * @footnote-ethics: high - Results influence context handling while synthetic fixtures avoid private transcript use.
 */
export const runBenchmark = (
    corpus: ContextBenchmarkCase[] = buildBenchmarkCorpus()
): BenchmarkReport => {
    const cases: CaseMetric[] = [];
    for (const method of METHODS) {
        for (const entry of corpus) {
            cases.push(buildCaseMetric(entry, selectContext(method, entry)));
        }
    }
    return {
        benchmark: {
            issue: 717,
            generatedAt: new Date().toISOString(),
            corpus: 'synthetic_structurally_faithful',
            caseCount: corpus.length,
            messageCount: corpus.reduce(
                (total, entry) => total + entry.messages.length,
                0
            ),
            contextWindowSize: CONTEXT_WINDOW_SIZE,
            tokenEstimate: 'ceil(utf8_characters / 4)',
            categoryCounts: Object.fromEntries(
                SCENARIOS.map((category) => [
                    category,
                    corpus.filter((entry) => entry.category === category)
                        .length,
                ])
            ),
            fixtureProvenance:
                'synthetic_structurally_faithful_discord_shapes; no private transcripts',
            limitations: [
                'All fixtures are synthetic; no private production transcript is committed.',
                'The hash embedding is a dependency-free lexical feature proxy, not a neural embedding model.',
                'No cross-encoder is configured in the current Footnote checkout.',
                'OpenJEV is not configured or invoked by this benchmark harness; the harness records it as unavailable.',
                'The hardened categories are synthetic approximations of observed Discord shapes, not private transcript excerpts.',
                'Latency is local JavaScript harness time, not Discord or provider end-to-end latency.',
            ],
        },
        methods: METHODS.map((method) =>
            aggregateMetrics(
                method,
                cases.filter((metric) => metric.method === method)
            )
        ),
        categoryMetrics: aggregateCategoryMetrics(cases),
        cases,
    };
};

const formatMetric = (value: number | null): string =>
    value === null ? 'n/a' : value.toFixed(3);

const writeReport = (report: BenchmarkReport): void => {
    const outputDirectory = path.resolve('artifacts/context-selection-717');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, 'results.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
    const summary = [
        '# Context-selection benchmark #717',
        '',
        `Generated: ${report.benchmark.generatedAt}`,
        `Corpus: ${report.benchmark.caseCount} synthetic cases / ${report.benchmark.messageCount} messages`,
        '',
        '| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | Avg candidates | Avg depth | Avg branches | p95 ms | Unavailable |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.methods.map(
            (metric) =>
                `| ${metric.method} | ${formatMetric(metric.necessaryMessageRecall)} | ${formatMetric(metric.usefulContextPrecision)} | ${formatMetric(metric.distractingContextRate)} | ${formatMetric(metric.averageFinalMessageCount)} | ${formatMetric(metric.averageEstimatedInputTokens)} | ${formatMetric(metric.averageCandidateCount)} | ${formatMetric(metric.averageRetrievalDepth)} | ${formatMetric(metric.averageBranchExpansionCount)} | ${formatMetric(metric.p95LatencyMs)} | ${metric.unavailableCases} |`
        ),
        '',
        '## By category',
        '',
        '| Category | Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | p95 ms |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.categoryMetrics.map(
            (metric) =>
                `| ${metric.category} | ${metric.method} | ${formatMetric(metric.necessaryMessageRecall)} | ${formatMetric(metric.usefulContextPrecision)} | ${formatMetric(metric.distractingContextRate)} | ${formatMetric(metric.averageFinalMessageCount)} | ${formatMetric(metric.averageEstimatedInputTokens)} | ${formatMetric(metric.p95LatencyMs)} |`
        ),
        '',
        '## Interpretation',
        '',
        '- The current window is the fail-open baseline and remains the production behavior; this benchmark does not change it.',
        '- Reply expansion is deterministic and should be considered separately from semantic judgment because it has no model availability or privacy dependency.',
        '- BM25 and the hash-embedding proxy are offline comparison baselines, not evidence that a neural model is unnecessary.',
        '- Cross-encoder and OpenJEV rows are explicit unavailable gates, not zero-quality scores.',
        '',
        '## Reproduction',
        '',
        '```text',
        'pnpm eval:context-selection',
        '```',
        '',
        'The JSON artifact contains case-level metrics and the exact limitations recorded by the harness.',
    ].join('\n');
    fs.writeFileSync(
        path.join(outputDirectory, 'summary.md'),
        `${summary}\n`,
        'utf8'
    );
};

if (process.argv[1]?.endsWith('context-selection-benchmark.ts')) {
    const report = runBenchmark();
    writeReport(report);
    console.log(
        JSON.stringify(
            {
                issue: report.benchmark.issue,
                cases: report.benchmark.caseCount,
                host: os.hostname(),
                methods: report.methods.map((metric) => ({
                    method: metric.method,
                    recall: metric.necessaryMessageRecall,
                    precision: metric.usefulContextPrecision,
                    unavailable: metric.unavailableCases,
                })),
            },
            null,
            2
        )
    );
}

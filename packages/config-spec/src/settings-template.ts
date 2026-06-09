/**
 * @description: Builds and renders the canonical full footnote.yaml template with comments and environment-aware defaults.
 * @footnote-scope: interface
 * @footnote-module: SettingsTemplate
 * @footnote-risk: high - Template drift can misconfigure first-run environments across backend, launcher, and setup flows.
 * @footnote-ethics: medium - Clear defaults and comments improve operator understanding of governance-sensitive settings.
 */

import {
    settingsSpecEntries,
    type SettingsDefaultValue,
    type SettingsSpecEntry,
    type SettingsValueKind,
} from './settings-spec.js';

export type TemplateTarget = 'local' | 'fly' | 'auto';

export type ResolvedTemplateTarget = 'local' | 'fly';

export type TemplatePrimitive = string | number | boolean;

export type TemplateRenderedDefault =
    | TemplatePrimitive
    | readonly string[]
    | Readonly<Record<string, number>>;

export type TemplateField = {
    envKey: string;
    path: readonly string[];
    kind: SettingsValueKind;
    sourceSection: string;
    comment: string;
    defaultKind: 'literal' | 'derived' | 'none' | 'runtime';
    renderedDefault: TemplateRenderedDefault;
};

export type TemplateModel = {
    target: ResolvedTemplateTarget;
    fields: TemplateField[];
};

const FLY_INTERNAL_BACKEND_BASE_URL = 'http://footnote-backend.internal:3000';
const DEFAULT_LOCAL_BACKEND_BASE_URL = 'http://localhost:3000';
const DEFAULT_LOCAL_WEB_BASE_URL = 'http://localhost:8080';

const OPERATOR_ROOT_ORDER = [
    'deployment',
    'server',
    'web',
    'urls',
    'openai',
    'prompts',
    'backend',
    'bot-interaction',
    'catch-up',
    'context-manager',
    'engagement',
    'image',
    'reflect',
    'threads',
    'chat-workflow',
    'turnstile',
    'rate-limits',
    'storage',
    'logging',
    'alerts',
    'trace',
    'admin',
    'webhooks',
    'discord-bots',
] as const;

const ROOT_GROUP_LABELS: Record<string, string> = {
    deployment: 'Deployment',
    server: 'Server',
    web: 'Web',
    urls: 'Urls',
    openai: 'OpenAI and Provider Behavior',
    prompts: 'Model Profiles',
    backend: 'Services and Workflow Knobs',
    'bot-interaction': 'Services and Workflow Knobs',
    'catch-up': 'Services and Workflow Knobs',
    'context-manager': 'Services and Workflow Knobs',
    engagement: 'Services and Workflow Knobs',
    image: 'Services and Workflow Knobs',
    reflect: 'Services and Workflow Knobs',
    threads: 'Services and Workflow Knobs',
    'chat-workflow': 'Services and Workflow Knobs',
    turnstile: 'Turnstile',
    'rate-limits': 'Rate Limits',
    storage: 'Storage',
    logging: 'Logging',
    alerts: 'Alerts',
    trace: 'Trace, Trust Graph, and Runtime Metadata',
    admin: 'Services and Workflow Knobs',
    webhooks: 'Services and Workflow Knobs',
    'discord-bots': 'Discord Bots',
};

const resolveRootOrder = (root: string): number => {
    const index = OPERATOR_ROOT_ORDER.indexOf(
        root as (typeof OPERATOR_ROOT_ORDER)[number]
    );
    return index >= 0 ? index : OPERATOR_ROOT_ORDER.length + 100;
};

const toTitleCase = (value: string): string =>
    value
        .split('-')
        .filter((segment) => segment.length > 0)
        .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
        .join(' ');

const parseFlyAppName = (env: NodeJS.ProcessEnv): string | null => {
    const raw = env.FLY_APP_NAME;
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const resolveDeploymentFlyApp = (env: NodeJS.ProcessEnv): string =>
    parseFlyAppName(env) ?? '';

export const resolveTemplateTarget = (
    env: NodeJS.ProcessEnv
): ResolvedTemplateTarget => (parseFlyAppName(env) ? 'fly' : 'local');

const resolveLocalBackendBaseUrl = (env: NodeJS.ProcessEnv): string => {
    const rawPort = env.PORT?.trim();
    if (!rawPort || !/^\d+$/.test(rawPort)) {
        return DEFAULT_LOCAL_BACKEND_BASE_URL;
    }

    const parsedPort = Number(rawPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        return DEFAULT_LOCAL_BACKEND_BASE_URL;
    }

    return `http://localhost:${parsedPort}`;
};

const resolveDerivedDefault = ({
    envKey,
    target,
    env,
}: {
    envKey: string;
    target: ResolvedTemplateTarget;
    env: NodeJS.ProcessEnv;
}): TemplateRenderedDefault | null => {
    if (envKey === 'BACKEND_BASE_URL') {
        return target === 'fly'
            ? FLY_INTERNAL_BACKEND_BASE_URL
            : resolveLocalBackendBaseUrl(env);
    }

    if (envKey === 'WEB_BASE_URL') {
        if (target === 'fly') {
            const flyAppName = parseFlyAppName(env);
            return flyAppName
                ? `https://${flyAppName}.fly.dev`
                : 'https://<FLY_APP_NAME>.fly.dev';
        }

        return DEFAULT_LOCAL_WEB_BASE_URL;
    }

    return null;
};

const normalizeEmptyDefault = (
    kind: SettingsValueKind
): TemplateRenderedDefault => {
    switch (kind) {
        case 'boolean':
            return false;
        case 'integer':
        case 'number':
            return 0;
        case 'csv':
            return [];
        case 'json':
            return {};
        case 'enum':
        case 'string':
        default:
            return '';
    }
};

const resolveRenderedDefault = ({
    entry,
    target,
    env,
}: {
    entry: SettingsSpecEntry;
    target: ResolvedTemplateTarget;
    env: NodeJS.ProcessEnv;
}): TemplateRenderedDefault => {
    if (entry.defaultKind === 'literal' && entry.defaultValue !== undefined) {
        return entry.defaultValue;
    }

    if (entry.defaultKind === 'literal' && entry.templateDefaultValue) {
        return entry.templateDefaultValue as TemplateRenderedDefault;
    }

    if (entry.defaultKind === 'derived') {
        const derived = resolveDerivedDefault({
            envKey: entry.envKey,
            target,
            env,
        });
        if (derived !== null) {
            return derived;
        }
    }

    return normalizeEmptyDefault(entry.kind);
};

const buildFieldComment = ({
    entry,
    target,
}: {
    entry: SettingsSpecEntry;
    target: ResolvedTemplateTarget;
}): string => {
    const baseComment = entry.description.replace(/\s+/g, ' ').trim();

    if (entry.defaultKind === 'derived') {
        const defaultRule =
            target === 'fly'
                ? 'Fly target default applied.'
                : 'Local target default applied.';
        return `${baseComment} ${defaultRule}`;
    }

    if (entry.defaultKind === 'none') {
        return `${baseComment} No canonical default is defined; template uses a safe placeholder.`;
    }

    if (entry.defaultKind === 'runtime') {
        return `${baseComment} Runtime-derived default is represented as a safe placeholder.`;
    }

    return baseComment;
};

const resolveGroupTitle = (root: string): string =>
    ROOT_GROUP_LABELS[root] ?? toTitleCase(root);

const sortTemplateFields = (fields: TemplateField[]): TemplateField[] => {
    return [...fields].sort((left, right) => {
        const leftRoot = left.path[0] ?? '';
        const rightRoot = right.path[0] ?? '';
        const rootOrderDelta =
            resolveRootOrder(leftRoot) - resolveRootOrder(rightRoot);
        if (rootOrderDelta !== 0) {
            return rootOrderDelta;
        }

        const rootCompare = leftRoot.localeCompare(rightRoot);
        if (rootCompare !== 0) {
            return rootCompare;
        }

        return left.path.join('.').localeCompare(right.path.join('.'));
    });
};

export const buildSettingsTemplateModel = ({
    target,
    env,
}: {
    target: TemplateTarget;
    env: NodeJS.ProcessEnv;
}): TemplateModel => {
    const resolvedTarget =
        target === 'auto' ? resolveTemplateTarget(env) : target;

    const fields: TemplateField[] = settingsSpecEntries.map((entry) => {
        return {
            envKey: entry.envKey,
            path: entry.path,
            kind: entry.kind,
            sourceSection: entry.section,
            comment: buildFieldComment({ entry, target: resolvedTarget }),
            defaultKind: entry.defaultKind,
            renderedDefault: resolveRenderedDefault({
                entry,
                target: resolvedTarget,
                env,
            }),
        };
    });

    const sortedFields = sortTemplateFields(fields);

    return {
        target: resolvedTarget,
        fields: sortedFields,
    };
};

const quoteString = (value: string): string => {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
};

const renderScalar = (value: TemplatePrimitive): string => {
    if (typeof value === 'string') {
        return quoteString(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return String(value);
};

const isStringArray = (
    value: TemplateRenderedDefault
): value is readonly string[] => Array.isArray(value);

const isNumberRecord = (
    value: TemplateRenderedDefault
): value is Readonly<Record<string, number>> => {
    if (Array.isArray(value)) {
        return false;
    }

    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return Object.values(value).every((entry) => typeof entry === 'number');
};

const renderValueLines = ({
    key,
    value,
    indent,
}: {
    key: string;
    value: TemplateRenderedDefault;
    indent: number;
}): string[] => {
    const padding = ' '.repeat(indent);

    if (isStringArray(value)) {
        if (value.length === 0) {
            return [`${padding}${key}: []`];
        }

        return [
            `${padding}${key}:`,
            ...value.map((entry) => `${padding}    - ${renderScalar(entry)}`),
        ];
    }

    if (isNumberRecord(value)) {
        const entries = Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right)
        );
        if (entries.length === 0) {
            return [`${padding}${key}: {}`];
        }

        return [
            `${padding}${key}:`,
            ...entries.map(
                ([entryKey, entryValue]) =>
                    `${padding}    ${entryKey}: ${renderScalar(entryValue)}`
            ),
        ];
    }

    return [`${padding}${key}: ${renderScalar(value as TemplatePrimitive)}`];
};

type TreeNode = {
    children: Map<string, TreeNode>;
    field?: TemplateField;
};

const createTreeNode = (): TreeNode => ({ children: new Map() });

const createPathTree = (fields: readonly TemplateField[]): TreeNode => {
    const root = createTreeNode();

    for (const field of fields) {
        let cursor = root;
        for (const segment of field.path) {
            const next = cursor.children.get(segment) ?? createTreeNode();
            cursor.children.set(segment, next);
            cursor = next;
        }
        cursor.field = field;
    }

    return root;
};

const renderNode = ({
    node,
    key,
    indent,
}: {
    node: TreeNode;
    key: string;
    indent: number;
}): string[] => {
    const lines: string[] = [];
    const hasChildren = node.children.size > 0;

    if (hasChildren) {
        lines.push(`${' '.repeat(indent)}${key}:`);

        const orderedChildren = [...node.children.entries()].sort(
            ([left], [right]) => left.localeCompare(right)
        );

        for (const [childKey, childNode] of orderedChildren) {
            if (childNode.field) {
                lines.push(
                    `${' '.repeat(indent + 4)}# ${childNode.field.comment}`
                );
                lines.push(
                    ...renderValueLines({
                        key: childKey,
                        value: childNode.field.renderedDefault,
                        indent: indent + 4,
                    })
                );
                continue;
            }

            lines.push(
                ...renderNode({
                    node: childNode,
                    key: childKey,
                    indent: indent + 4,
                })
            );
        }

        return lines;
    }

    if (!node.field) {
        lines.push(`${' '.repeat(indent)}${key}: {}`);
        return lines;
    }

    lines.push(`${' '.repeat(indent)}# ${node.field.comment}`);
    lines.push(
        ...renderValueLines({ key, value: node.field.renderedDefault, indent })
    );
    return lines;
};

const renderGroupHeader = (title: string): string[] => [
    '# -----------------------------------------------------------------------------',
    `# ${title}`,
    '# -----------------------------------------------------------------------------',
];

const renderDiscordBotsBlock = (): string[] => [
    '# Discord bot supervisor entries. Keep env key names only, never secret values.',
    'discord-bots: []',
    '# Example discord bot entry (uncomment and edit):',
    '# discord-bots:',
    '#     - id: main-discord',
    '#       enabled: true',
    '#       required: false',
    '#       credentials:',
    '#         discord-token-env: DISCORD_TOKEN',
    '#         discord-client-id-env: DISCORD_CLIENT_ID',
    '#         discord-guild-ids-env: DISCORD_GUILD_IDS',
    '#         discord-user-id-env: DISCORD_USER_ID',
    '#         incident-secret-env: INCIDENT_PSEUDONYMIZATION_SECRET',
    '#       profile:',
    '#         id: main',
    '#         display-name: Footnote',
    '#         overlay-path: ""',
    '#         mention-aliases: []',
];

const renderDeploymentBlock = (
    target: ResolvedTemplateTarget,
    env: NodeJS.ProcessEnv
): string[] => [
    '# Operator tooling metadata. Runtime behavior must not depend on this block.',
    'deployment:',
    `    target: ${quoteString(target)}`,
    `    fly-app: ${quoteString(
        target === 'fly' ? resolveDeploymentFlyApp(env) : ''
    )}`,
];

export const renderSettingsTemplateYaml = ({
    target,
    env,
    lineEnding = '\n',
}: {
    target: TemplateTarget;
    env: NodeJS.ProcessEnv;
    lineEnding?: '\n' | '\r\n';
}): string => {
    const model = buildSettingsTemplateModel({ target, env });

    const grouped = new Map<string, TemplateField[]>();
    for (const field of model.fields) {
        const root = field.path[0] ?? 'misc';
        const next = grouped.get(root) ?? [];
        next.push(field);
        grouped.set(root, next);
    }

    const rootOrder = [...grouped.keys()].sort((left, right) => {
        const leftOrder = resolveRootOrder(left);
        const rightOrder = resolveRootOrder(right);
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.localeCompare(right);
    });

    const lines: string[] = [
        '# Footnote canonical settings template',
        '# Runtime settings live here. Keep secrets in env vars or your secret manager.',
        '# Edit keys in kebab-case. This file is validated by the backend settings parser.',
        `# Template target: ${model.target}`,
        '',
        '# Canonical document version',
        'version: 1',
        '',
        ...renderGroupHeader(resolveGroupTitle('deployment')),
        ...renderDeploymentBlock(model.target, env),
    ];

    for (const root of rootOrder) {
        const rootFields = grouped.get(root);
        if (!rootFields || rootFields.length === 0) {
            continue;
        }

        lines.push('');
        lines.push(...renderGroupHeader(resolveGroupTitle(root)));

        const tree = createPathTree(rootFields);
        const rootNode = tree.children.get(root);
        if (!rootNode) {
            continue;
        }

        lines.push(...renderNode({ node: rootNode, key: root, indent: 0 }));
    }

    lines.push('');
    lines.push(...renderGroupHeader(resolveGroupTitle('discord-bots')));
    lines.push(...renderDiscordBotsBlock());

    return `${lines.join(lineEnding)}${lineEnding}`;
};

export type { SettingsSpecEntry, SettingsValueKind, SettingsDefaultValue };

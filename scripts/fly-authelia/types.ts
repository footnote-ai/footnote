/**
 * @description: Defines the narrow seams shared by the Authelia provisioning implementation and its adapters.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaTypes
 * @footnote-risk: medium - A widened seam could expose credential-bearing implementation details to callers.
 * @footnote-ethics: high - Typed seams keep identity provisioning decisions explicit and reviewable.
 */

export type AuthMode = 'preserve' | 'authelia';

export type CommandSpec = {
    command: string;
    args: string[];
    stdin?: string;
    env?: Record<string, string>;
};

export type CommandResult = {
    code: number;
    stdout: string;
    stderr: string;
};

export type CommandRunner = {
    run: (spec: CommandSpec) => Promise<CommandResult>;
    runInteractive: (spec: CommandSpec) => Promise<CommandResult>;
};

export type Prompt = {
    text: (message: string) => Promise<string>;
};

export type Fetcher = (
    input: string,
    init?: RequestInit
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type ProvisionOptions = {
    mode: AuthMode;
    repositoryRoot: string;
    serverConfigPath: string;
    prompt?: Prompt;
    runner?: CommandRunner;
    fetcher?: Fetcher;
    stateRoot?: string;
};

export type ServerDefaults = {
    footnoteAppName: string;
    primaryRegion: string;
    publicUrl: string;
};

export type SafeState = {
    version: 1;
    provider: 'authelia';
    providerVersion: string;
    image: string;
    authAppName: string;
    footnoteAppName: string;
    region: string;
    issuerUrl: string;
    redirectUri: string;
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
    clientSecretHash: string;
    secretNames: string[];
    manifestPath: string;
    configurationPath: string;
    usersPath: string;
};

export type ExistingState = SafeState;

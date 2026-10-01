/**
 * @description: Serializable request and response contracts for explicit Discord account connection.
 * @footnote-scope: interface
 * @footnote-module: DiscordAccountContracts
 * @footnote-risk: medium - Contract drift can expose identity inputs or break account linking.
 * @footnote-ethics: high - These shapes bound the privacy-sensitive connection flow.
 */
import { z } from 'zod';

const discordId = z.string().regex(/^\d{17,20}$/);
export const DiscordAccountStartRequestSchema = z
    .object({
        discordUserId: discordId,
        discordUsername: z.string().min(1).max(32),
    })
    .strict();
export const DiscordAccountStatusRequestSchema = z
    .object({ discordUserId: discordId })
    .strict();
export const DiscordAccountConfirmRequestSchema = z
    .object({ discordUserId: discordId, code: z.string().regex(/^\d{8}$/) })
    .strict();
export const DiscordAccountExchangeRequestSchema = z
    .object({ capability: z.string().min(32).max(128) })
    .strict();
export const DiscordAccountConsentRequestSchema = z.object({}).strict();
export const DiscordAccountStartResponseSchema = z
    .object({
        connectionUrl: z.string().url(),
        expiresAt: z.string().datetime(),
    })
    .strict();
export const DiscordAccountStatusResponseSchema = z
    .object({ connected: z.boolean() })
    .strict();
/** @api.operationId: getAccountDiscordConnection @api.path: GET /api/account/discord-connection */
export const AccountDiscordConnectionResponseSchema = z
    .object({
        connected: z.boolean(),
        accounts: z.array(
            z.object({ username: z.string().nullable() }).strict()
        ),
    })
    .strict();
export const DiscordAccountConfirmResponseSchema = z
    .object({
        result: z.enum([
            'linked',
            'already-linked',
            'conflict',
            'invalid',
            'wrong-code',
            'attempts-exhausted',
            'unavailable',
        ]),
    })
    .strict();
export const DiscordConnectionStateResponseSchema = z
    .object({
        state: z.enum([
            'waiting-for-sign-in',
            'waiting-for-approval',
            'waiting-for-discord-confirmation',
            'expired',
            'none',
        ]),
        code: z
            .string()
            .regex(/^\d{8}$/)
            .optional(),
    })
    .strict();
export const DiscordAccountConsentResponseSchema = z
    .object({ code: z.string().regex(/^\d{8}$/) })
    .strict();

export type DiscordAccountStartRequest = z.infer<
    typeof DiscordAccountStartRequestSchema
>;
export type DiscordAccountStatusRequest = z.infer<
    typeof DiscordAccountStatusRequestSchema
>;
export type DiscordAccountConfirmRequest = z.infer<
    typeof DiscordAccountConfirmRequestSchema
>;
export type DiscordAccountExchangeRequest = z.infer<
    typeof DiscordAccountExchangeRequestSchema
>;
export type DiscordAccountStartResponse = {
    connectionUrl: string;
    expiresAt: string;
};
export type DiscordAccountStatusResponse = { connected: boolean };
/** @api.operationId: getAccountDiscordConnection @api.path: GET /api/account/discord-connection */
export type AccountDiscordConnectionResponse = {
    connected: boolean;
    accounts: Array<{ username: string | null }>;
};
export type DiscordAccountConfirmResponse = {
    result:
        | 'linked'
        | 'already-linked'
        | 'conflict'
        | 'invalid'
        | 'wrong-code'
        | 'attempts-exhausted'
        | 'unavailable';
};
export type DiscordConnectionStateResponse = {
    state:
        | 'waiting-for-sign-in'
        | 'waiting-for-approval'
        | 'waiting-for-discord-confirmation'
        | 'expired'
        | 'none';
    code?: string;
};

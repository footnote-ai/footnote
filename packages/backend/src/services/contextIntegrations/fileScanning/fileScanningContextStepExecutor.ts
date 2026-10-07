/**
 * @description: File scanning context-step executor for attachment grounding.
 * Scans image attachments with the backend image-description task and reports
 * non-image files as structured advisory context.
 * @footnote-scope: core
 * @footnote-module: FileScanningContextStepExecutor
 * @footnote-risk: medium - Incorrect attachment handling can reduce grounding quality for attachment-driven prompts.
 * @footnote-ethics: medium - Attachment summaries can influence assistant claims, so this path stays fail-open and explicit about uncertainty.
 */
import type { Citation } from '@footnote/contracts/policy';
import type { InternalImageDescriptionTaskService } from '../../internalText.js';
import {
    buildAttachmentCitation,
    getAttachmentsFromUnknownInput,
    isImageAttachment,
} from '../../attachments/attachmentContext.js';
import {
    buildExecutedContextStepResult,
    buildSkippedContextStepResult,
    runNonBlockingIntegrationTask,
} from '../contextStepExecution.js';
import type {
    ContextStepExecutor,
    ContextStepExecutorInput,
    ContextStepResult,
} from '../../workflowCore/reviewedChatWorkflow.js';
import {
    ConversationImageContextStore,
    imageContextIntegrationStatus,
    isImageContextReference,
    isImageContextRefresh,
    type ImageContextScope,
} from './conversationImageContextStore.js';

type FileScanningExecutorLogger = {
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

type CreateFileScanningContextStepExecutorOptions = {
    imageDescriptionTaskService?: InternalImageDescriptionTaskService | null;
    imageContextStore?: ConversationImageContextStore;
    logger: FileScanningExecutorLogger;
};

const FILE_SCAN_TOOL_NAME = 'file_scan';

export const createFileScanningContextStepExecutor = ({
    imageDescriptionTaskService,
    imageContextStore,
    logger,
}: CreateFileScanningContextStepExecutorOptions): ContextStepExecutor => {
    const execute: ContextStepExecutor = async (
        input: ContextStepExecutorInput
    ): Promise<ContextStepResult> => {
        const attachmentList = getAttachmentsFromUnknownInput(
            input.request.input?.attachments
        );
        const userContext =
            typeof input.request.input?.latestUserInput === 'string'
                ? input.request.input.latestUserInput.trim()
                : '';
        const scopeValue = input.request.input?.imageContextScope;
        const imageContextScope =
            typeof scopeValue === 'object' && scopeValue !== null
                ? (scopeValue as ImageContextScope)
                : undefined;
        const refersToImage = isImageContextReference(userContext);
        const refresh = isImageContextRefresh(userContext);

        if (!input.request.requested || !input.request.eligible) {
            return buildSkippedContextStepResult({
                toolName: FILE_SCAN_TOOL_NAME,
                reasonCode: input.request.reasonCode ?? 'tool_not_requested',
            });
        }

        if (attachmentList.length === 0) {
            const lookup = imageContextStore?.lookup({
                scope: imageContextScope,
                toolName: 'file_scan',
                refersToImage,
                refresh,
            });
            if (lookup?.status === 'reused') {
                return {
                    ...lookup.result,
                    integrationContext: imageContextIntegrationStatus(
                        'file_scan',
                        'reused'
                    ),
                };
            }
            return buildSkippedContextStepResult({
                toolName: FILE_SCAN_TOOL_NAME,
                reasonCode: 'tool_not_used',
                ...(lookup !== undefined && {
                    integrationContext: imageContextIntegrationStatus(
                        'file_scan',
                        lookup.status
                    ),
                }),
            });
        }

        const imageAttachments = attachmentList.filter(isImageAttachment);
        const imageAttachment =
            imageAttachments.length === 1 ? imageAttachments[0] : undefined;
        const lookup = imageAttachment
            ? imageContextStore?.lookup({
                  scope: imageContextScope,
                  toolName: 'file_scan',
                  imageUrl: imageAttachment.url,
                  refersToImage,
                  refresh,
              })
            : undefined;
        if (lookup?.status === 'reused') {
            return {
                ...lookup.result,
                integrationContext: imageContextIntegrationStatus(
                    'file_scan',
                    'reused'
                ),
            };
        }
        if (lookup?.status === 'expired') {
            return buildSkippedContextStepResult({
                toolName: FILE_SCAN_TOOL_NAME,
                reasonCode: 'tool_not_used',
                integrationContext: imageContextIntegrationStatus(
                    'file_scan',
                    'expired'
                ),
            });
        }

        const evidenceContent: string[] = [];
        const sources: Citation[] = [];
        let successfulImageScans = 0;
        let failedImageScans = 0;

        for (const [index, attachment] of attachmentList.entries()) {
            const contentType = attachment.contentType?.toLowerCase() ?? '';
            if (isImageAttachment(attachment)) {
                if (!imageDescriptionTaskService) {
                    failedImageScans += 1;
                    evidenceContent.push(
                        `[Attachment ${index + 1}] image present but image scanning is unavailable in this runtime.`
                    );
                    sources.push(
                        buildAttachmentCitation({
                            attachment,
                            title: `Attachment ${index + 1} (image)`,
                            snippet: 'Image scanning unavailable at runtime.',
                        })
                    );
                    continue;
                }

                const taskResult = await runNonBlockingIntegrationTask({
                    integrationName: FILE_SCAN_TOOL_NAME,
                    logger,
                    contextStepInput: input,
                    onErrorMessage:
                        'file_scan: image-description task failed; continuing without image grounding.',
                    task: () =>
                        imageDescriptionTaskService.runImageDescriptionTask({
                            task: 'image_description',
                            imageUrl: attachment.url,
                            ...(userContext.length > 0 && {
                                context: userContext,
                            }),
                        }),
                });
                if (taskResult.status === 'executed') {
                    successfulImageScans += 1;
                    const response = taskResult.value;
                    evidenceContent.push(
                        `[Attachment ${index + 1}] ${response.result.description}`
                    );
                    sources.push(
                        buildAttachmentCitation({
                            attachment,
                            title: `Attachment ${index + 1} (image)`,
                            snippet:
                                'Backend image-description context integration.',
                        })
                    );
                } else {
                    failedImageScans += 1;
                    evidenceContent.push(
                        `[Attachment ${index + 1}] image scan failed; continue without image-grounded details.`
                    );
                    sources.push(
                        buildAttachmentCitation({
                            attachment,
                            title: `Attachment ${index + 1} (image)`,
                            snippet:
                                'Image scan failed while keeping response flow non-blocking.',
                        })
                    );
                }
                continue;
            }

            const normalizedType =
                contentType.length > 0 ? contentType : 'unknown';
            evidenceContent.push(
                `[Attachment ${index + 1}] non-image file attached (${normalizedType}).`
            );
            sources.push(
                buildAttachmentCitation({
                    attachment,
                    title: `Attachment ${index + 1} (file)`,
                    snippet: `Detected file attachment (${normalizedType}).`,
                })
            );
        }

        const providerDisposition =
            failedImageScans === 0
                ? refresh
                    ? 'refreshed'
                    : 'scanned'
                : successfulImageScans === 0
                  ? imageDescriptionTaskService === undefined ||
                    imageDescriptionTaskService === null
                      ? 'provider_unavailable'
                      : 'provider_failed'
                  : 'provider_partial';
        const result = buildExecutedContextStepResult({
            toolName: FILE_SCAN_TOOL_NAME,
            evidence: {
                content: evidenceContent,
            },
            sources,
            integrationContext: imageContextIntegrationStatus(
                'file_scan',
                (imageContextScope === undefined ||
                    imageAttachment === undefined) &&
                    failedImageScans === 0
                    ? 'not_retained'
                    : providerDisposition
            ),
        });
        if (imageAttachment && failedImageScans === 0) {
            imageContextStore?.record({
                scope: imageContextScope,
                imageUrl: imageAttachment.url,
                result,
            });
        }
        return result;
    };

    return execute;
};

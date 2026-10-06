/**
 * @description: Shares ordinary local chat fixtures between browser checks.
 * @footnote-scope: test
 * @footnote-module: ChatBrowserTestHelpers
 * @footnote-risk: low - Helpers only prepare controlled browser requests.
 * @footnote-ethics: low - Fixtures use public synthetic response data.
 */
import {
    expect,
    type FrameLocator,
    type Locator,
    type Page,
} from '@playwright/test';
import ordinaryAnswer from './fixtures/ordinary-text-answer.json';

export const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

export const configureRuntime = async (page: Page): Promise<void> => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
};

export const response = (message: string) => ({
    ...ordinaryAnswer.response,
    message,
});

export const responseWithCitation = (
    message: string,
    responseId: string,
    title: string,
    url: string,
    snippet: string
) => ({
    ...ordinaryAnswer.response,
    message,
    metadata: {
        ...ordinaryAnswer.response.metadata,
        responseId,
        citations: [{ title, url, snippet }],
    },
});

export const expectTurnSource = async (
    turn: Locator,
    responseId: string,
    sourceTitle: string,
    sourceUrl: string,
    otherTurnSourceTitle: string
): Promise<Locator> => {
    const footnote = turn.locator('.canonical-response-footnote');
    await expect(footnote).toHaveAttribute('data-response-id', responseId);
    await footnote
        .getByRole('button', { name: 'Sources', exact: true })
        .click();
    await expect(
        footnote.getByRole('link', { name: sourceTitle })
    ).toHaveAttribute('href', sourceUrl);
    await expect(
        footnote.getByRole('link', { name: otherTurnSourceTitle })
    ).toHaveCount(0);
    return footnote;
};

export const readEmbedHeights = (page: Page): Promise<number[]> =>
    page.evaluate(
        () =>
            (window as Window & { __footnoteEmbedHeights?: number[] })
                .__footnoteEmbedHeights ?? []
    );

export const latestEmbedHeight = async (page: Page): Promise<number> =>
    Math.max(...(await readEmbedHeights(page)));

export type EmbedHostContent = {
    beforeFrameHeight?: number;
    afterFrameHeight?: number;
};

export const mountSizedEmbed = async (
    page: Page,
    content: EmbedHostContent = {}
): Promise<FrameLocator> => {
    await page.goto('/');
    await page.evaluate((hostContent) => {
        const addHostContent = (height: number, label: string): void => {
            const content = document.createElement('div');
            content.style.height = `${height}px`;
            content.textContent = label;
            document.body.append(content);
        };
        const beforeHeight = hostContent.beforeFrameHeight ?? 0;
        const afterHeight = hostContent.afterFrameHeight ?? 0;
        if (beforeHeight > 0) {
            addHostContent(beforeHeight, 'Host content before the chat');
        }

        const parent = window as Window & { __footnoteEmbedHeights?: number[] };
        parent.__footnoteEmbedHeights = [];
        window.addEventListener('message', (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { type?: string; height?: number };
            if (data.type !== 'footnote-embed-height' || !data.height) {
                return;
            }
            parent.__footnoteEmbedHeights?.push(data.height);
            const frame = document.getElementById(
                'footnote-chat-frame'
            ) as HTMLIFrameElement | null;
            if (frame) frame.style.height = `${data.height}px`;
        });
        const frame = document.createElement('iframe');
        frame.id = 'footnote-chat-frame';
        frame.title = 'Footnote chat';
        frame.src = '/embed';
        frame.style.width = '100%';
        frame.style.height = '300px';
        document.body.append(frame);

        if (afterHeight > 0) {
            addHostContent(afterHeight, 'Host content after the chat');
        }
    }, content);
    return page.frameLocator('#footnote-chat-frame');
};

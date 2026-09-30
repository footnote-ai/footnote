/**
 * @description: Renders saved memories and their account-page controls.
 * @footnote-scope: web
 * @footnote-module: MemorySection
 * @footnote-risk: low - This section presents account-scoped memory controls without owning retrieval authority.
 * @footnote-ethics: high - Clear memory controls preserve user agency over saved personal context.
 */

import type { FormEvent } from 'react';
import type { AccountMemory } from '@footnote/contracts/web';

export type MemoryReadState = 'loading' | 'ready' | 'error';
export type MemoryWriteError = 'save' | 'forget' | 'limit' | null;

type MemorySectionProps = {
    memories: AccountMemory[];
    text: string;
    readState: MemoryReadState;
    writeError: MemoryWriteError;
    busy: boolean;
    onTextChange: (value: string) => void;
    onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onForget: (memoryId: string) => Promise<void>;
    onRetry: () => void;
};

const MemorySection = ({
    memories,
    text,
    readState,
    writeError,
    busy,
    onTextChange,
    onSave,
    onForget,
    onRetry,
}: MemorySectionProps): JSX.Element => {
    const errorMessage =
        writeError === 'limit'
            ? 'Memory limit reached. Forget one to save another.'
            : writeError === 'save'
              ? 'The memory could not be saved. Please try again.'
              : writeError === 'forget'
                ? 'Memory could not be removed. Please try again.'
                : null;

    return (
        <section
            className="account-page__section"
            aria-labelledby="account-memories-heading"
        >
            <h2 id="account-memories-heading">Memory</h2>
            <p>Things you've asked Footnote to remember for future chats.</p>
            <form
                className="account-page__memory-form"
                onSubmit={(event) => void onSave(event)}
            >
                <label htmlFor="account-memory-text">Add a memory</label>
                <textarea
                    id="account-memory-text"
                    value={text}
                    maxLength={2000}
                    required
                    onChange={(event) => onTextChange(event.target.value)}
                />
                <button
                    className="account-page__action account-page__action--primary"
                    type="submit"
                    disabled={
                        busy ||
                        readState !== 'ready' ||
                        text.trim().length === 0
                    }
                >
                    Save memory
                </button>
            </form>
            {errorMessage ? (
                <p className="account-page__error" role="alert">
                    {errorMessage}
                </p>
            ) : null}
            {readState === 'ready' ? (
                <p className="account-page__count">
                    {memories.length} of 50 saved
                </p>
            ) : null}
            {readState === 'loading' ? (
                <p role="status">Loading saved memories…</p>
            ) : null}
            {readState === 'error' ? (
                <div>
                    <p className="account-page__error" role="alert">
                        Saved memories could not be loaded.
                    </p>
                    <button
                        className="account-page__action"
                        type="button"
                        onClick={onRetry}
                    >
                        Try again
                    </button>
                </div>
            ) : null}
            {readState === 'ready' && memories.length === 0 ? (
                <p>No saved memories.</p>
            ) : null}
            {readState === 'ready' && memories.length > 0 ? (
                <ul className="account-page__memory-list">
                    {memories.map((memory) => (
                        <li key={memory.id}>
                            <p>{memory.text}</p>
                            <button
                                className="account-page__action"
                                type="button"
                                disabled={busy}
                                onClick={() => void onForget(memory.id)}
                            >
                                Forget
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
};

export default MemorySection;

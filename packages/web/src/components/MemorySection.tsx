/**
 * @description: Renders saved memories and their account-page controls.
 * @footnote-scope: web
 * @footnote-module: MemorySection
 * @footnote-risk: medium - Account-scoped memory controls invoke private write operations.
 * @footnote-ethics: high - Clear edit and forget controls preserve user agency over personal context.
 */

import { useRef, useState, type FormEvent } from 'react';
import type { AccountMemory } from '@footnote/contracts/web';
import AccountIcon from './AccountIcon.js';

export type MemoryReadState = 'loading' | 'ready' | 'error';
export type MemoryWriteError = 'save' | 'edit' | 'forget' | 'limit' | null;

type MemorySectionProps = {
    memories: AccountMemory[];
    readState: MemoryReadState;
    writeError: MemoryWriteError;
    busy: boolean;
    onClearError: () => void;
    onSave: (text: string) => Promise<boolean>;
    onEdit: (memoryId: string, text: string) => Promise<boolean>;
    onForget: (memoryId: string) => Promise<void>;
    onRetry: () => void;
};

const MemorySection = ({
    memories,
    readState,
    writeError,
    busy,
    onClearError,
    onSave,
    onEdit,
    onForget,
    onRetry,
}: MemorySectionProps): JSX.Element => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [editor, setEditor] = useState<{
        memoryId: string | null;
        text: string;
    } | null>(null);
    const errorMessage =
        writeError === 'limit'
            ? 'Memory limit reached. Forget one to save another.'
            : writeError === 'save'
              ? 'The memory could not be saved. Please try again.'
              : writeError === 'edit'
                ? 'The memory could not be updated. Please try again.'
                : writeError === 'forget'
                  ? 'Memory could not be removed. Please try again.'
                  : null;

    const openEditor = (memoryId: string | null, text = ''): void => {
        onClearError();
        setEditor({ memoryId, text });
        dialogRef.current?.showModal();
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!editor || busy) return;
        const save = editor.memoryId
            ? onEdit(editor.memoryId, editor.text)
            : onSave(editor.text);
        void save.then((saved) => {
            if (saved) dialogRef.current?.close();
        });
    };

    return (
        <section
            className="account-page__section"
            aria-labelledby="account-memories-heading"
        >
            <div className="account-page__section-heading">
                <h2 id="account-memories-heading">Memory</h2>
                <button
                    aria-label="Add memory"
                    className="account-page__action account-page__icon-action"
                    disabled={busy || readState !== 'ready'}
                    title="Add memory"
                    type="button"
                    onClick={() => openEditor(null)}
                >
                    <AccountIcon name="add" />
                </button>
            </div>
            <p>Things you've asked Footnote to remember for future chats.</p>
            {writeError === 'forget' ? (
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
                            <div className="account-page__memory-actions">
                                <button
                                    aria-label={`Edit memory: ${memory.text}`}
                                    className="account-page__action account-page__icon-action"
                                    disabled={busy}
                                    title="Edit memory"
                                    type="button"
                                    onClick={() =>
                                        openEditor(memory.id, memory.text)
                                    }
                                >
                                    <AccountIcon name="edit" />
                                </button>
                                <button
                                    aria-label={`Forget memory: ${memory.text}`}
                                    className="account-page__action account-page__icon-action"
                                    disabled={busy}
                                    title="Forget memory"
                                    type="button"
                                    onClick={() => void onForget(memory.id)}
                                >
                                    <AccountIcon name="delete" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}
            <dialog
                aria-labelledby="account-memory-dialog-title"
                className="account-page__memory-dialog"
                onClose={() => setEditor(null)}
                ref={dialogRef}
            >
                <h3 id="account-memory-dialog-title">
                    {editor?.memoryId ? 'Edit memory' : 'Add a memory'}
                </h3>
                <form
                    className="account-page__memory-form"
                    onSubmit={handleSubmit}
                >
                    <label htmlFor="account-memory-text">Memory</label>
                    <textarea
                        autoFocus
                        id="account-memory-text"
                        maxLength={2000}
                        required
                        value={editor?.text ?? ''}
                        onChange={(event) =>
                            setEditor((current) =>
                                current
                                    ? { ...current, text: event.target.value }
                                    : current
                            )
                        }
                    />
                    {errorMessage && writeError !== 'forget' ? (
                        <p className="account-page__error" role="alert">
                            {errorMessage}
                        </p>
                    ) : null}
                    <div className="account-page__actions">
                        <button
                            className="account-page__action account-page__action--primary"
                            disabled={busy}
                            type="submit"
                        >
                            {editor?.memoryId ? 'Save changes' : 'Save memory'}
                        </button>
                        <button
                            className="account-page__action"
                            type="button"
                            onClick={() => dialogRef.current?.close()}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </dialog>
        </section>
    );
};

export default MemorySection;

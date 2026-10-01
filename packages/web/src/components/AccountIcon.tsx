/**
 * @description: Supplies the small set of consistent Account action glyphs.
 * @footnote-scope: web
 * @footnote-module: AccountIcon
 * @footnote-risk: low - Decorative account controls render through fixed SVG paths.
 * @footnote-ethics: low - Accessible names remain on the parent controls.
 */

export type AccountIconName =
    'add' | 'edit' | 'delete' | 'disconnect' | 'download';

const AccountIcon = ({ name }: { name: AccountIconName }): JSX.Element => {
    const common = {
        fill: 'none',
        stroke: 'currentColor',
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        strokeWidth: 1.8,
    };

    return (
        <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            width="1.2em"
            height="1.2em"
            {...common}
        >
            {name === 'add' ? <path d="M12 5v14M5 12h14" /> : null}
            {name === 'edit' ? (
                <>
                    <path d="m16 4 4 4M4 20l4-.8L19.4 7.8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z" />
                </>
            ) : null}
            {name === 'delete' ? (
                <path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 11v6m4-6v6" />
            ) : null}
            {name === 'disconnect' ? (
                <>
                    <path d="m10 17 5-5-5-5M15 12H3" />
                    <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
                </>
            ) : null}
            {name === 'download' ? (
                <>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m7 10 5 5 5-5M12 15V3" />
                </>
            ) : null}
        </svg>
    );
};

export default AccountIcon;

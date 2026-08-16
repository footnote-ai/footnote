/**
 * @description: Reusable response selector with the existing fade transition and accessible dot navigation.
 * @footnote-scope: web
 * @footnote-module: ResponseCarousel
 * @footnote-risk: low - Selection errors affect inspection only, not answer authority.
 * @footnote-ethics: medium - The selected response must be clearly labeled so superseded text is not mistaken for the final answer.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

type ResponseCarouselProps<T> = {
    items: readonly T[];
    initialIndex?: number;
    getKey: (item: T, index: number) => string;
    getDotLabel: (item: T, index: number) => string;
    renderItem: (item: T, index: number) => ReactNode;
    ariaLabel: string;
    className?: string;
    dotsClassName?: string;
    dotClassName?: string;
    selectedDotClassName?: string;
    showPreviousNextControls?: boolean;
    previousLabel?: string;
    nextLabel?: string;
};

const normalizeInitialIndex = (length: number, index: number): number =>
    Math.min(Math.max(index, 0), Math.max(length - 1, 0));

/**
 * Shows one prepared response at a time. The delayed handoff preserves the
 * landing page transition while keeping dots and arrows keyboard accessible.
 */
const ResponseCarousel = <T,>({
    items,
    initialIndex = 0,
    getKey,
    getDotLabel,
    renderItem,
    ariaLabel,
    className = 'public-home__response',
    dotsClassName = 'public-home__scenario-dots',
    dotClassName = 'public-home__scenario-dot',
    selectedDotClassName = 'public-home__scenario-dot--selected',
    showPreviousNextControls = false,
    previousLabel = 'Show previous response version',
    nextLabel = 'Show next response version',
}: ResponseCarouselProps<T>): JSX.Element | null => {
    const [selectedIndex, setSelectedIndex] = useState(() =>
        normalizeInitialIndex(items.length, initialIndex)
    );
    const [isTransitioning, setIsTransitioning] = useState(false);
    const transitionTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        setSelectedIndex(normalizeInitialIndex(items.length, initialIndex));
    }, [initialIndex, items.length]);

    useEffect(
        () => () => {
            if (transitionTimeoutRef.current !== null) {
                window.clearTimeout(transitionTimeoutRef.current);
            }
        },
        []
    );

    if (items.length === 0) {
        return null;
    }

    const selectIndex = (nextIndex: number): void => {
        if (
            nextIndex === selectedIndex ||
            transitionTimeoutRef.current !== null ||
            nextIndex < 0 ||
            nextIndex >= items.length
        ) {
            return;
        }
        setIsTransitioning(true);
        transitionTimeoutRef.current = window.setTimeout(() => {
            setSelectedIndex(nextIndex);
            setIsTransitioning(false);
            transitionTimeoutRef.current = null;
        }, 180);
    };

    const selectedItem = items[selectedIndex]!;
    return (
        <div
            className="response-carousel"
            aria-label={ariaLabel}
            onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    selectIndex(selectedIndex - 1);
                }
                if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    selectIndex(selectedIndex + 1);
                }
            }}
        >
            <div
                className={`${className}${isTransitioning ? ` ${className}--transitioning` : ''}`}
            >
                {renderItem(selectedItem, selectedIndex)}
            </div>
            <div className="response-carousel__navigation">
                {showPreviousNextControls && (
                    <button
                        type="button"
                        className="response-carousel__control"
                        aria-label={previousLabel}
                        disabled={isTransitioning || selectedIndex === 0}
                        onClick={() => selectIndex(selectedIndex - 1)}
                    >
                        Previous
                    </button>
                )}
                <div className={dotsClassName} aria-label={ariaLabel}>
                    {items.map((item, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                            <button
                                key={getKey(item, index)}
                                type="button"
                                className={`${dotClassName}${isSelected ? ` ${selectedDotClassName}` : ''}`}
                                aria-label={getDotLabel(item, index)}
                                aria-pressed={isSelected}
                                disabled={isTransitioning}
                                onClick={() => selectIndex(index)}
                            />
                        );
                    })}
                </div>
                {showPreviousNextControls && (
                    <button
                        type="button"
                        className="response-carousel__control"
                        aria-label={nextLabel}
                        disabled={
                            isTransitioning ||
                            selectedIndex === items.length - 1
                        }
                        onClick={() => selectIndex(selectedIndex + 1)}
                    >
                        Next
                    </button>
                )}
            </div>
        </div>
    );
};

export default ResponseCarousel;

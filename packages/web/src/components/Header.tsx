/**
 * @description: Renders the sticky site header, section navigation, and utility controls.
 * @footnote-scope: web
 * @footnote-module: SiteHeader
 * @footnote-risk: low - Header regressions mostly affect navigation and discoverability across the site.
 * @footnote-ethics: low - Navigation clarity supports transparency, but this component does not process sensitive content.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

type SectionNavItem = {
    id: 'about' | 'demo' | 'get-started';
    label: string;
};

const SECTION_NAV_ITEMS: SectionNavItem[] = [
    {
        id: 'about',
        label: 'About',
    },
    {
        id: 'demo',
        label: 'Demo',
    },
    {
        id: 'get-started',
        label: 'Get started',
    },
];

const Header = (): JSX.Element => {
    const location = useLocation();
    const pathname = location.pathname;
    const hash = location.hash;
    const headerRef = useRef<HTMLElement | null>(null);
    const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

    const supportsSectionAnchors = pathname === '/' || pathname === '/embed';

    const sectionHrefPrefix = supportsSectionAnchors ? '#' : '/#';

    const sectionLinks = useMemo(
        () =>
            SECTION_NAV_ITEMS.map((item) => ({
                ...item,
                href: `${sectionHrefPrefix}${item.id}`,
            })),
        [sectionHrefPrefix]
    );

    useEffect(() => {
        const headerElement = headerRef.current;
        if (!headerElement) {
            return;
        }

        const bodyElement = document.body;
        const mobileViewport = window.matchMedia('(max-width: 640px)');

        const updateHeaderHeight = (): void => {
            if (mobileViewport.matches) {
                bodyElement.style.removeProperty(
                    '--fn-layout-site-header-height'
                );
                return;
            }

            const { height } = headerElement.getBoundingClientRect();
            const safeHeight = Math.ceil(height);
            bodyElement.style.setProperty(
                '--fn-layout-site-header-height',
                `${safeHeight}px`
            );
        };

        updateHeaderHeight();

        const observer = new ResizeObserver(() => {
            updateHeaderHeight();
        });
        observer.observe(headerElement);

        window.addEventListener('resize', updateHeaderHeight);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateHeaderHeight);
            bodyElement.style.removeProperty('--fn-layout-site-header-height');
        };
    }, []);

    useEffect(() => {
        if (!supportsSectionAnchors) {
            setActiveSectionId(null);
            return;
        }

        const rawHashId = hash.replace(/^#/, '').trim();
        let hashId: string;
        try {
            hashId = decodeURIComponent(rawHashId).trim();
        } catch {
            hashId = rawHashId;
        }

        if (hashId.length > 0) {
            setActiveSectionId(hashId);
        }

        const sectionElements = SECTION_NAV_ITEMS.map((item) =>
            document.getElementById(item.id)
        ).filter((element): element is HTMLElement => element !== null);

        if (sectionElements.length === 0) {
            return;
        }

        const sectionRatios = new Map<string, number>();
        sectionElements.forEach((sectionElement) => {
            sectionRatios.set(sectionElement.id, 0);
        });

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    sectionRatios.set(
                        entry.target.id,
                        entry.isIntersecting ? entry.intersectionRatio : 0
                    );
                });

                let nextActiveSectionId: string | null = null;
                let highestRatio = 0;
                sectionRatios.forEach((ratio, sectionId) => {
                    if (ratio > highestRatio) {
                        highestRatio = ratio;
                        nextActiveSectionId = sectionId;
                    }
                });

                if (nextActiveSectionId !== null) {
                    setActiveSectionId(nextActiveSectionId);
                }
            },
            {
                root: null,
                rootMargin: '-25% 0px -55% 0px',
                threshold: [0.2, 0.5, 0.8],
            }
        );

        sectionElements.forEach((sectionElement) => {
            observer.observe(sectionElement);
        });

        return () => {
            observer.disconnect();
        };
    }, [hash, supportsSectionAnchors]);

    return (
        <header
            ref={headerRef}
            className="site-header-sticky"
            aria-label="Site header"
        >
            <div className="site-header-sticky__inner">
                <div className="site-title-group">
                    <Link to="/" className="site-mark-link">
                        <p className="site-mark">Footnote</p>
                    </Link>
                </div>
                <nav className="site-nav" aria-label="Primary">
                    <ul className="site-nav__list">
                        {sectionLinks.map((item) => {
                            const isActive = activeSectionId === item.id;
                            return (
                                <li key={item.id} className="site-nav__item">
                                    <a
                                        className="site-nav__link"
                                        href={item.href}
                                        aria-current={
                                            isActive ? 'location' : undefined
                                        }
                                    >
                                        {item.label}
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                <div className="site-header-utils">
                    <a
                        className="site-nav__link site-nav__link--icon"
                        href="https://github.com/footnote-ai/footnote"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View source on GitHub"
                    >
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                        >
                            <path
                                fill="currentColor"
                                d="M12 .5A11.5 11.5 0 0 0 .5 12.2c0 5.23 3.39 9.68 8.1 11.25.6.12.82-.27.82-.58v-2.25c-3.29.73-3.98-1.63-3.98-1.63-.54-1.41-1.33-1.79-1.33-1.79-1.08-.76.08-.75.08-.75 1.2.09 1.83 1.26 1.83 1.26 1.06 1.87 2.79 1.33 3.47 1.01.11-.79.42-1.33.76-1.64-2.62-.31-5.37-1.35-5.37-6a4.76 4.76 0 0 1 1.23-3.32 4.43 4.43 0 0 1 .12-3.27s1.01-.33 3.3 1.27a11.19 11.19 0 0 1 6 0c2.29-1.6 3.3-1.27 3.3-1.27.45 1.03.5 2.22.12 3.27a4.76 4.76 0 0 1 1.23 3.32c0 4.66-2.76 5.68-5.39 5.98.43.38.81 1.11.81 2.25v3.34c0 .33.22.71.83.58a11.72 11.72 0 0 0 8.09-11.25A11.5 11.5 0 0 0 12 .5Z"
                            />
                        </svg>
                    </a>
                    <div
                        className="site-header-theme-toggle"
                        aria-label="Theme settings"
                    >
                        <ThemeToggle />
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;

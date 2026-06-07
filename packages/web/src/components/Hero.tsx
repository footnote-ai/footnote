/**
 * @description: Renders the primary interactive demo section and call to ask a live question.
 * @footnote-scope: web
 * @footnote-module: HeroSection
 * @footnote-risk: low - Hero regressions affect first impressions and CTA flow but do not break backend state.
 * @footnote-ethics: medium - The hero sets user expectations about privacy, honesty, and transparency.
 */

import AskMeAnything from './AskMeAnything';

type HeroProps = {
    sectionId?: string;
};

// Hero section introduces the live demo and keeps AskMeAnything as the primary interaction surface.
const Hero = ({ sectionId }: HeroProps): JSX.Element => (
    <section
        id={sectionId}
        className="hero landing-section"
        aria-labelledby="hero-title"
    >
        <div className="hero-copy">
            <p className="landing-kicker">Demo</p>
            <h2 id="hero-title" className="hero-title landing-title">
                <span className="hero-title__line">Answers you can check.</span>
            </h2>
            <p className="hero-subheader">
                Ask a question and see how the answer is supported.
            </p>
            <p className="hero-subheader">
                <span className="hero-subheader__line">
                    Sources, safety notes, and trace links appear when they are
                    available.
                </span>
            </p>
            <AskMeAnything />
        </div>
    </section>
);

export default Hero;

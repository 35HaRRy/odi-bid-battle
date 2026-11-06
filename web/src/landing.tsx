import { useEffect, useRef } from "react";
import { t, type Lang } from "./i18n";
import "./landing.css";

// Visible is the default: only enhance when both motion and observation work.
export function observeLanding(root: HTMLElement): () => void {
  if (typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return () => {};
  const cards = root.querySelectorAll<HTMLElement>(".landing-stage");
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });
  for (const card of cards) observer.observe(card);
  root.classList.add("landing-motion");
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const stop = () => { root.classList.remove("landing-motion"); observer.disconnect(); };
  preference.addEventListener?.("change", stop);
  return () => { stop(); preference.removeEventListener?.("change", stop); };
}

function StoryIcon({ stage }: { stage: number }) {
  const paths = [
    "M4 5h16v14H4z M8 9h8 M8 13h5 M8 17h8",
    "M6 20V4l6 2 6-2v10l-6 2-6-2 M3 20h6 M14 20h7",
    "M4 18h16 M8 14l8-8 M6 12l4 4 M14 4l4 4 M6 20v-2h12v2",
    "M6 4h12v5a6 6 0 0 1-12 0z M6 6H3v3a4 4 0 0 0 4 4 M18 6h3v3a4 4 0 0 1-4 4 M12 15v5 M8 20h8",
  ];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[stage]} /></svg>;
}

export function LandingPage({ lang, onStart }: { lang: Lang; onStart: () => void }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => root.current ? observeLanding(root.current) : undefined, []);
  const screenshots = ["catalog", "teams", "divan"];
  return <main className="landing-page" ref={root}>
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-hero-copy">
        <h1 id="landing-title">{t(lang, "landing_title")}<em>{t(lang, "landing_titleEnd")}</em></h1>
        <p>{t(lang, "landing_intro")}</p>
        <div className="landing-actions"><button className="primary" type="button" onClick={onStart}>{t(lang, "landing_start")}</button><a href="#landing-story">{t(lang, "landing_explore")} <span aria-hidden="true">↓</span></a></div>
        <p className="landing-private">{t(lang, "landing_private")}</p>
      </div>
      <ol className="landing-route" aria-label={t(lang, "landing_steps")}>
        {[0, 1, 2, 3].map(stage => <li key={stage}><a href={`#landing-stage-${stage}`}><StoryIcon stage={stage} /><span>{t(lang, `landing_step${stage}`)}</span><span className="landing-route-number" aria-hidden="true">{stage + 1}</span></a></li>)}
      </ol>
    </section>
    <section className="landing-story" id="landing-story" aria-labelledby="landing-story-title">
      <div className="landing-narrative"><h2 id="landing-story-title">{t(lang, "landing_story")}</h2><p>{t(lang, "landing_storyIntro")}</p><p className="landing-demo-note">{t(lang, "landing_demo")}</p></div>
      <div className="landing-stages">
        {[0, 1, 2, 3].map(stage => <article className="landing-stage" id={`landing-stage-${stage}`} key={stage} tabIndex={0} aria-labelledby={`landing-heading-${stage}`}>
          <div className="landing-stage-heading"><StoryIcon stage={stage} /><span aria-hidden="true">{stage + 1} / 4</span><h3 id={`landing-heading-${stage}`}>{t(lang, `landing_step${stage}`)}</h3></div>
          <p>{t(lang, `landing_detail${stage}`)}</p>
          {stage < 3 ? <figure><img src={`/landing/${screenshots[stage]}.webp`} width={1200} height={850} loading="lazy" decoding="async" alt={t(lang, `landing_alt${stage}`)} /><figcaption>{t(lang, `landing_caption${stage}`)}</figcaption></figure> : <div className="landing-result"><StoryIcon stage={3} /><p>{t(lang, "landing_result")}</p></div>}
        </article>)}
      </div>
    </section>
    <section className="landing-close" aria-labelledby="landing-close-title"><h2 id="landing-close-title">{t(lang, "landing_close")}</h2><p>{t(lang, "landing_closeIntro")}</p><button className="primary" type="button" onClick={onStart}>{t(lang, "landing_start")}</button><a href="#landing-title">{t(lang, "landing_top")}</a></section>
  </main>;
}

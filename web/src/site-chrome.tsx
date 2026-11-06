import type { AuthUser } from "./auth-api";
import { Icon } from "./icons";
import { t, type Lang } from "./i18n";
import "./site-chrome.css";

function Brand() {
  return <a className="site-brand" href="/"><img src="/logo.jpg" width={44} height={44} alt="" /><span>2 Ordular savaşı</span></a>;
}

export function SiteHeader({ lang, user, busy, blocked, onLanguage, onLink, onLogout }: {
  lang: Lang; user: AuthUser | null; busy: boolean; blocked: boolean;
  onLanguage: () => void; onLink: () => void; onLogout: () => void;
}) {
  const language = lang === "tr" ? "English" : "Türkçe";
  return <header className="site-header"><div className="site-inner">
    <Brand />
    <div className="site-controls">
      {user && <details className="account-menu">
        <summary className="site-icon-button" aria-label={t(lang, "auth_account")} title={t(lang, "auth_account")}><Icon name="user" /></summary>
        <div className="account-menu-content">
          <strong>{user.username}</strong>
          <button type="button" className="account-action" disabled={busy} onClick={onLink}><Icon name="link" /><span>{t(lang, "auth_link")}</span></button>
          <button type="button" className="account-action" disabled={busy} onClick={onLogout}><Icon name="logout" /><span>{t(lang, "auth_logout")}</span></button>
        </div>
      </details>}
      {blocked && <button type="button" className="site-icon-button" disabled={busy} onClick={onLogout} aria-label={t(lang, "auth_logout")} title={t(lang, "auth_logout")}><Icon name="logout" /></button>}
      <button type="button" className="language-button" aria-label={language} title={language} onClick={onLanguage}><Icon name="language" /><span lang={lang === "tr" ? "en" : "tr"}>{lang === "tr" ? "EN" : "TR"}</span></button>
    </div>
  </div></header>;
}

export function SiteFooter({ lang }: { lang: Lang }) {
  const links = [
    { icon: "globe", label: lang === "tr" ? "Web sitesi" : "Website", href: "https://hayrihabip.com/" },
    { icon: "github", label: "GitHub", href: "https://github.com/35HaRRy/odibb" },
    { icon: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/hayri-habip/" },
    { icon: "x", label: "X", href: "https://x.com/35_HaRRy" },
    { icon: "instagram", label: "Instagram", href: "https://www.instagram.com/hayrihabip/" },
  ] as const;
  return <footer className="site-footer"><div className="site-inner">
    <Brand />
    <nav className="social-links" aria-label={t(lang, "socialLinks")}>
      {links.map(({ icon, label, href }) => <a key={icon} className="site-icon-button" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}><Icon name={icon} /></a>)}
    </nav>
  </div></footer>;
}

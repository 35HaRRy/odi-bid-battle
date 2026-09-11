import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Auction, type TeamImagePayload } from "./api";
import { t, type Lang } from "./i18n";
import { parseGold, teamTotal } from "./team-format";

interface ImageEdit extends TeamImagePayload {
  url: string;
}

interface MemberEdit {
  key: string;
  id: string | null;
  name: string;
  goldText: string;
  avatar: ImageEdit | null;
}

interface TeamEdit {
  key: string;
  id: string | null;
  name: string;
  slogan: string;
  position: 0 | 1;
  flag: ImageEdit | null;
  members: MemberEdit[];
}

function imageEditOf(img: TeamImagePayload): ImageEdit {
  return { ...img, url: `data:${img.mime};base64,${img.data}` };
}

function blankMember(): MemberEdit {
  return { key: crypto.randomUUID(), id: null, name: "", goldText: "10", avatar: null };
}

function blankTeam(position: 0 | 1): TeamEdit {
  return {
    key: crypto.randomUUID(),
    id: null,
    name: "",
    slogan: "",
    position,
    flag: null,
    members: [blankMember()],
  };
}

function fileToImageEdit(file: File): Promise<ImageEdit> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const data = url.includes(",") ? url.slice(url.indexOf(",") + 1) : "";
      resolve({ data, mime: file.type || "image/png", name: file.name, url });
    };
    reader.readAsDataURL(file);
  });
}

export function DraftTeams({
  lang,
  auction,
  onBack,
  onNext,
}: {
  lang: Lang;
  auction: Auction;
  onBack: () => void;
  onNext: () => void;
}) {
  const [teams, setTeams] = useState<TeamEdit[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const flagInputs = useRef<(HTMLInputElement | null)[]>([]);
  const avatarInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .getAuctionTeams(auction.id)
      .then((saved) => {
        if (cancelled) return;
        if (saved.length === 2) {
          setTeams(
            saved.map((team) => ({
              key: crypto.randomUUID(),
              id: team.id,
              name: team.name,
              slogan: team.slogan ?? "",
              position: team.position,
              flag: imageEditOf(team.flag),
              members: team.members.map((m) => ({
                key: crypto.randomUUID(),
                id: m.id,
                name: m.name,
                goldText: String(m.initialGold),
                avatar: m.avatar ? imageEditOf(m.avatar) : null,
              })),
            })),
          );
        } else {
          setTeams([blankTeam(0), blankTeam(1)]);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(t(lang, "persistFail"));
      });
    return () => {
      cancelled = true;
    };
  }, [auction.id, lang]);

  function patchTeam(index: number, patch: Partial<TeamEdit>) {
    setTeams((prev) =>
      prev ? prev.map((team, i) => (i === index ? { ...team, ...patch } : team)) : prev,
    );
    setSavedNote(false);
  }

  function patchMember(teamIndex: number, key: string, patch: Partial<MemberEdit>) {
    setTeams((prev) =>
      prev
        ? prev.map((team, i) =>
            i === teamIndex
              ? { ...team, members: team.members.map((m) => (m.key === key ? { ...m, ...patch } : m)) }
              : team,
          )
        : prev,
    );
    setSavedNote(false);
  }

  async function chooseFlag(teamIndex: number, file: File | undefined) {
    if (!file) return;
    patchTeam(teamIndex, { flag: await fileToImageEdit(file) });
  }

  async function chooseAvatar(teamIndex: number, key: string, file: File | undefined) {
    if (!file) return;
    patchMember(teamIndex, key, { avatar: await fileToImageEdit(file) });
  }

  function transferMember(fromIndex: number, key: string) {
    setTeams((prev) => {
      if (!prev) return prev;
      const toIndex = fromIndex === 0 ? 1 : 0;
      const member = prev[fromIndex].members.find((m) => m.key === key);
      if (!member) return prev;
      return prev.map((team, i) => {
        if (i === fromIndex) return { ...team, members: team.members.filter((m) => m.key !== key) };
        if (i === toIndex) return { ...team, members: [...team.members, member] };
        return team;
      });
    });
    setSavedNote(false);
  }

  async function save() {
    if (!teams || saving) return;
    setSaving(true);
    setSaveError(null);
    setServerFields({});
    try {
      const saved = await api.saveAuctionTeams(
        auction.id,
        teams.map((team) => ({
          name: team.name,
          slogan: team.slogan,
          position: team.position,
          flag: team.flag ? { data: team.flag.data, mime: team.flag.mime, name: team.flag.name } : null,
          members: team.members.map((m) => {
            const gold = parseGold(m.goldText);
            return {
              name: m.name,
              initialGold: gold ?? 0,
              avatar: m.avatar ? { data: m.avatar.data, mime: m.avatar.mime, name: m.avatar.name } : null,
            };
          }),
        })),
      );
      setTeams(
        saved.map((team) => ({
          key: crypto.randomUUID(),
          id: team.id,
          name: team.name,
          slogan: team.slogan ?? "",
          position: team.position,
          flag: imageEditOf(team.flag),
          members: team.members.map((m) => ({
            key: crypto.randomUUID(),
            id: m.id,
            name: m.name,
            goldText: String(m.initialGold),
            avatar: m.avatar ? imageEditOf(m.avatar) : null,
          })),
        })),
      );
      setSavedNote(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const body = e.details as { fieldErrors?: { path: string; message: string }[] } | undefined;
        const mapped: Record<string, string> = {};
        for (const f of body?.fieldErrors ?? []) mapped[f.path] = f.message;
        setServerFields(mapped);
      }
      setSaveError(t(lang, "persistFail"));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="empty">{loadError}</p>;
  if (!teams) return <p className="empty">…</p>;

  const totals = teams.map(teamTotal);
  const equal = totals[0] === totals[1];

  return (
    <section aria-label={t(lang, "stepTeams")}>
      <div className="section-title">
        <div>
          <h2>{t(lang, "teamsTitle")}</h2>
          <p className="description">{t(lang, "teamsIntro")}</p>
        </div>
      </div>
      <div id="balance-banner">
        <div className={`balance-banner${equal ? "" : " error"}`} role="status">
          <div>
            <strong>{t(lang, equal ? "balanced" : "unbalanced")}</strong>
            <p>
              {t(lang, "difference")}: {Math.abs(totals[0] - totals[1])} {t(lang, "gold")}
            </p>
          </div>
          <div className="balance-total">
            <span>
              <b>{totals[0]}</b> {t(lang, "gold")}
            </span>
            <span>/</span>
            <span>
              <b>{totals[1]}</b> {t(lang, "gold")}
            </span>
          </div>
        </div>
      </div>
      <div className="split">
        {teams.map((team, ti) => (
          <section key={team.key} className="team-pane" aria-label={team.name || `${ti + 1}`}>
            <div className="team-head">
              <button
                type="button"
                className="flag-button"
                aria-label={`${t(lang, "flag")}: ${team.name}`}
                onClick={() => flagInputs.current[ti]?.click()}
              >
                {team.flag ? <img src={team.flag.url} alt="" /> : "🏳"}
              </button>
              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp,image/gif"
                ref={(el) => {
                  flagInputs.current[ti] = el;
                }}
                onChange={(e) => {
                  void chooseFlag(ti, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="team-heading-fields">
                <label>
                  {t(lang, "teamName")}
                  <input
                    value={team.name}
                    maxLength={200}
                    aria-invalid={!team.name.trim()}
                    onChange={(e) => patchTeam(ti, { name: e.target.value })}
                  />
                </label>
                {!team.name.trim() && <span className="field-error">{t(lang, "requiredName")}</span>}
                <input
                  className="slogan-input"
                  value={team.slogan}
                  maxLength={500}
                  aria-label={`${t(lang, "slogan")}: ${team.name}`}
                  placeholder={t(lang, "slogan")}
                  onChange={(e) => patchTeam(ti, { slogan: e.target.value })}
                />
                {!team.flag && <span className="field-error">{t(lang, "flagRequired")}</span>}
              </div>
            </div>
            <div className="member-columns">
              <span>{t(lang, "optional")}</span>
              <span>{t(lang, "memberName")}</span>
              <span>{t(lang, "initialGold")}</span>
              <span>{t(lang, "actions")}</span>
            </div>
            <div className="member-list" tabIndex={0} aria-label={`${team.name}: ${t(lang, "members")}`}>
              {team.members.map((m, mj) => {
                const gold = parseGold(m.goldText);
                const serverGoldError = serverFields[`teams[${ti}].members[${mj}].initialGold`];
                return (
                  <div key={m.key} className="member-row">
                    <button
                      type="button"
                      className="avatar"
                      aria-label={`${m.name}: ${t(lang, "avatar")}`}
                      onClick={() => avatarInputs.current[m.key]?.click()}
                    >
                      {m.avatar ? <img src={m.avatar.url} alt="" /> : (m.name.charAt(0) || "•")}
                    </button>
                    <input
                      type="file"
                      hidden
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      ref={(el) => {
                        avatarInputs.current[m.key] = el;
                      }}
                      onChange={(e) => {
                        void chooseAvatar(ti, m.key, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <div>
                      <input
                        value={m.name}
                        maxLength={200}
                        aria-label={`${t(lang, "memberName")}: ${m.name}`}
                        aria-invalid={!m.name.trim()}
                        onChange={(e) => patchMember(ti, m.key, { name: e.target.value })}
                      />
                      {!m.name.trim() && <span className="field-error name-error">{t(lang, "requiredName")}</span>}
                    </div>
                    <div>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={m.goldText}
                        aria-label={`${m.name}: ${t(lang, "initialGold")}`}
                        aria-invalid={gold === null}
                        onChange={(e) => patchMember(ti, m.key, { goldText: e.target.value })}
                      />
                      {(gold === null || serverGoldError) && (
                        <span className="field-error gold-error">{t(lang, "invalidGold")}</span>
                      )}
                    </div>
                    <div className="member-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${m.name}: ${t(lang, "moveMember")}`}
                        onClick={() => transferMember(ti, m.key)}
                      >
                        {ti === 0 ? "→" : "←"}
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${m.name}: ${t(lang, "removeMember")}`}
                        onClick={() =>
                          setTeams((prev) =>
                            prev
                              ? prev.map((tm, i) =>
                                  i === ti ? { ...tm, members: tm.members.filter((x) => x.key !== m.key) } : tm,
                                )
                              : prev,
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              {team.members.length === 0 && <p className="empty">{t(lang, "noMembers")}</p>}
            </div>
            <div className="team-end">
              <button type="button" className="secondary small-btn" onClick={() => patchTeam(ti, { members: [...team.members, blankMember()] })}>
                {t(lang, "addMember")}
              </button>
              <span>
                {team.members.length} {t(lang, "members")} · {t(lang, "total")} <b id={`team-total-${ti}`}>{totals[ti]}</b> {t(lang, "gold")}
              </span>
            </div>
          </section>
        ))}
      </div>
      {saveError && (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      )}
      {savedNote && <p className="save-note">{t(lang, "teamsSaved")}</p>}
      <div className="footer-left">
        <button type="button" className="secondary" onClick={onBack}>
          ← {t(lang, "stepList")}
        </button>
        <button type="button" className="quiet" disabled={saving} onClick={() => void save()}>
          {t(lang, "save")}
        </button>
        <button type="button" className="primary" onClick={onNext}>
          {t(lang, "stepReview")} →
        </button>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Auction, type SavedTeam } from "./api";
import { t, type Lang } from "./i18n";
import { parseGold, teamTotal, isTeamsFormValid } from "./team-format";

type ImageStatus = "existing" | "uploading" | "ready" | "failed";

interface ImageEdit {
  mime: string;
  name: string;
  previewUrl: string;
  status: ImageStatus;
  uploadId?: string;
  reuseTeamId?: string;
  reuseMemberId?: string;
  file?: File | null;
  error?: string | null;
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

function existingFlagOf(auctionId: string, team: SavedTeam): ImageEdit {
  return {
    mime: team.flag.mime,
    name: team.flag.name,
    previewUrl: api.teamImageUrl(team.flag),
    status: "existing",
    reuseTeamId: team.id,
  };
}

function existingAvatarOf(
  auctionId: string,
  teamId: string,
  member: SavedTeam["members"][number],
): ImageEdit | null {
  if (!member.avatar) return null;
  return {
    mime: member.avatar.mime,
    name: member.avatar.name,
    previewUrl: api.teamImageUrl(member.avatar),
    status: "existing",
    reuseMemberId: member.id,
  };
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

function uploadErrorMessage(lang: Lang, e: unknown): string {
  if (e instanceof ApiError && (e.status === 413 || e.message === "image too large")) {
    return t(lang, "tooLarge");
  }
  if (e instanceof ApiError && e.message) return e.message;
  return t(lang, "imageUploadFail");
}

export function DraftTeams({
  lang,
  auction,
  saveRef,
  onSaveDisabled,
}: {
  lang: Lang;
  auction: Auction;
  saveRef?: { current: (() => void) | null };
  onSaveDisabled?: (disabled: boolean) => void;
}) {
  const [teams, setTeams] = useState<TeamEdit[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const flagInputs = useRef<(HTMLInputElement | null)[]>([]);
  const avatarInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const flagSeq = useRef<number[]>([0, 0]);
  const avatarSeq = useRef<Record<string, number>>({});

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
              flag: existingFlagOf(auction.id, team),
              members: team.members.map((m) => ({
                key: crypto.randomUUID(),
                id: m.id,
                name: m.name,
                goldText: String(m.initialGold),
                avatar: existingAvatarOf(auction.id, team.id, m),
              })),
            })),
          );
        } else {
          setTeams([blankTeam(0), blankTeam(1)]);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(
            e instanceof ApiError && e.status === 413
              ? t(lang, "teamsTooLarge")
              : t(lang, "persistFail"),
          );
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

  function revokePreview(url: string | undefined) {
    if (url && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  async function runFlagUpload(teamIndex: number, file: File, seq: number) {
    try {
      const uploaded = await api.uploadTeamImage(auction.id, file);
      setTeams((prev) => {
        if (!prev) return prev;
        const current = prev[teamIndex]?.flag;
        if (current?.status === "uploading" && flagSeq.current[teamIndex] !== seq) return prev;
        const old = prev[teamIndex]?.flag?.previewUrl;
        const next = prev.map((team, i) =>
          i === teamIndex
            ? {
                ...team,
                flag: {
                  mime: uploaded.mime,
                  name: uploaded.name,
                  previewUrl: URL.createObjectURL(file),
                  status: "ready" as const,
                  uploadId: uploaded.uploadId,
                  file: null,
                  error: null,
                },
              }
            : team,
        );
        revokePreview(old);
        return next;
      });
    } catch (e) {
      setTeams((prev) => {
        if (!prev) return prev;
        if (flagSeq.current[teamIndex] !== seq) return prev;
        return prev.map((team, i) =>
          i === teamIndex && team.flag
            ? { ...team, flag: { ...team.flag, status: "failed" as const, error: uploadErrorMessage(lang, e), file } }
            : team,
        );
      });
    }
    setSavedNote(false);
  }

  function chooseFlag(teamIndex: number, file: File | undefined) {
    if (!file) return;
    const seq = (flagSeq.current[teamIndex] ?? 0) + 1;
    flagSeq.current[teamIndex] = seq;
    const previewUrl = URL.createObjectURL(file);
    setTeams((prev) => {
      if (!prev) return prev;
      revokePreview(prev[teamIndex]?.flag?.previewUrl);
      return prev.map((team, i) =>
        i === teamIndex
          ? {
              ...team,
              flag: {
                mime: file.type || "image/png",
                name: file.name,
                previewUrl,
                status: "uploading" as const,
                file,
                error: null,
              },
            }
          : team,
      );
    });
    void runFlagUpload(teamIndex, file, seq);
  }

  function retryFlag(teamIndex: number) {
    const file = teams?.[teamIndex]?.flag?.file;
    if (file) chooseFlag(teamIndex, file);
  }

  async function runAvatarUpload(teamIndex: number, key: string, file: File, seq: number) {
    try {
      const uploaded = await api.uploadTeamImage(auction.id, file);
      setTeams((prev) => {
        if (!prev) return prev;
        if ((avatarSeq.current[key] ?? 0) !== seq) return prev;
        const old = prev[teamIndex]?.members.find((m) => m.key === key)?.avatar?.previewUrl;
        const next = prev.map((team, i) =>
          i === teamIndex
            ? {
                ...team,
                members: team.members.map((m) =>
                  m.key === key
                    ? {
                        ...m,
                        avatar: {
                          mime: uploaded.mime,
                          name: uploaded.name,
                          previewUrl: URL.createObjectURL(file),
                          status: "ready" as const,
                          uploadId: uploaded.uploadId,
                          file: null,
                          error: null,
                        },
                      }
                    : m,
                ),
              }
            : team,
        );
        revokePreview(old);
        return next;
      });
    } catch (e) {
      setTeams((prev) => {
        if (!prev) return prev;
        if ((avatarSeq.current[key] ?? 0) !== seq) return prev;
        return prev.map((team, i) =>
          i === teamIndex
            ? {
                ...team,
                members: team.members.map((m) =>
                  m.key === key && m.avatar
                    ? { ...m, avatar: { ...m.avatar, status: "failed" as const, error: uploadErrorMessage(lang, e), file } }
                    : m,
                ),
              }
            : team,
        );
      });
    }
    setSavedNote(false);
  }

  function chooseAvatar(teamIndex: number, key: string, file: File | undefined) {
    if (!file) return;
    const seq = (avatarSeq.current[key] ?? 0) + 1;
    avatarSeq.current[key] = seq;
    const previewUrl = URL.createObjectURL(file);
    setTeams((prev) => {
      if (!prev) return prev;
      const old = prev[teamIndex]?.members.find((m) => m.key === key)?.avatar?.previewUrl;
      revokePreview(old);
      return prev.map((team, i) =>
        i === teamIndex
          ? {
              ...team,
              members: team.members.map((m) =>
                m.key === key
                  ? {
                      ...m,
                      avatar: {
                        mime: file.type || "image/png",
                        name: file.name,
                        previewUrl,
                        status: "uploading" as const,
                        file,
                        error: null,
                      },
                    }
                  : m,
              ),
            }
          : team,
      );
    });
    void runAvatarUpload(teamIndex, key, file, seq);
  }

  function retryAvatar(teamIndex: number, key: string) {
    const member = teams?.[teamIndex]?.members.find((m) => m.key === key);
    if (member?.avatar?.file) chooseAvatar(teamIndex, key, member.avatar.file);
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

  const imagesSettled = (list: TeamEdit[] | null): boolean => {
    if (!list) return false;
    return list.every(
      (team) =>
        (team.flag?.status === "existing" || team.flag?.status === "ready") &&
        team.members.every((m) => !m.avatar || m.avatar.status === "existing" || m.avatar.status === "ready"),
    );
  };

  async function save() {
    if (!teams || saving || !isTeamsFormValid(teams) || !imagesSettled(teams)) return;
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
          flag: team.flag?.uploadId
            ? { uploadId: team.flag.uploadId }
            : team.flag?.reuseTeamId
              ? { teamId: team.flag.reuseTeamId }
              : null,
          members: team.members.map((m) => {
            const gold = parseGold(m.goldText);
            return {
              name: m.name,
              initialGold: gold ?? 0,
              avatar: m.avatar?.uploadId
                ? { uploadId: m.avatar.uploadId }
                : m.avatar?.reuseMemberId
                  ? { memberId: m.avatar.reuseMemberId }
                  : null,
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
          flag: existingFlagOf(auction.id, team),
          members: team.members.map((m) => ({
            key: crypto.randomUUID(),
            id: m.id,
            name: m.name,
            goldText: String(m.initialGold),
            avatar: existingAvatarOf(auction.id, team.id, m),
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
      setSaveError(
        e instanceof ApiError && e.status === 413 ? t(lang, "teamsTooLarge") : t(lang, "persistFail"),
      );
    } finally {
      setSaving(false);
    }
  }

  const totals = teams ? teams.map(teamTotal) : [];
  const equal = totals.length === 2 && totals[0] === totals[1];
  const formValid = teams ? isTeamsFormValid(teams) : false;
  const settled = imagesSettled(teams);
  const saveDisabled = saving || !formValid || !settled;

  useEffect(() => {
    if (saveRef) {
      saveRef.current = teams
        ? () => {
            void save();
          }
        : null;
    }
  });

  useEffect(() => {
    onSaveDisabled?.(saveDisabled);
  }, [saveDisabled, onSaveDisabled]);

  if (loadError) return <p className="empty">{loadError}</p>;
  if (!teams) return <p className="empty">…</p>;

  return (
    <section aria-label={t(lang, "stepTeams")}>
      <div className="section-title">
        <div>
          <h2>{t(lang, "teamsTitle")}</h2>
          <p className="description">{t(lang, "teamsIntro")}</p>
          <p className="description">{t(lang, "singleFileLimitNote")}</p>
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
                title={team.flag ? t(lang, "changeImage") : t(lang, "uploadFlag")}
                onClick={() => flagInputs.current[ti]?.click()}
              >
                {team.flag ? <img src={team.flag.previewUrl} alt="" /> : "🏳"}
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
                  aria-invalid={!team.slogan.trim()}
                  placeholder={t(lang, "slogan")}
                  onChange={(e) => patchTeam(ti, { slogan: e.target.value })}
                />
                {!team.slogan.trim() && <span className="field-error">{t(lang, "sloganRequired")}</span>}
                {!team.flag && <span className="field-error">{t(lang, "flagRequired")}</span>}
                {team.flag?.status === "uploading" && (
                  <span className="description" role="status">{t(lang, "imageUploading")}</span>
                )}
                {team.flag?.status === "failed" && (
                  <span className="field-error" role="alert">
                    {team.flag.error ?? t(lang, "imageUploadFail")}{" "}
                    <button type="button" className="quiet" onClick={() => retryFlag(ti)}>
                      {t(lang, "retry")}
                    </button>
                  </span>
                )}
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
                      title={m.avatar ? t(lang, "changeImage") : t(lang, "uploadAvatar")}
                      onClick={() => avatarInputs.current[m.key]?.click()}
                    >
                      {m.avatar ? <img src={m.avatar.previewUrl} alt="" /> : (m.name.charAt(0) || "•")}
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
                      {m.avatar?.status === "uploading" && (
                        <span className="description" role="status">{t(lang, "imageUploading")}</span>
                      )}
                      {m.avatar?.status === "failed" && (
                        <span className="field-error" role="alert">
                          {m.avatar.error ?? t(lang, "imageUploadFail")}{" "}
                          <button type="button" className="quiet" onClick={() => retryAvatar(ti, m.key)}>
                            {t(lang, "retry")}
                          </button>
                        </span>
                      )}
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
              {team.members.length === 0 && <p className="field-error">{t(lang, "noMembers")}</p>}
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
    </section>
  );
}

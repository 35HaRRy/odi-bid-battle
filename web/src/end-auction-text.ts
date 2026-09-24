import type { Lang } from "./i18n";

export interface EndAuctionTeamText {
  name: string;
  slogan: string | null;
  members: string[];
}

function memberBlock(members: string[]): string {
  const list = members.length > 0 ? `\t${members.join("\n\t")}` : "\t";
  return `\t....\n${list}\n\t....`;
}

export function buildSingleTeamText(
  lang: Lang,
  position: 0 | 1,
  team: EndAuctionTeamText,
): string {
  const slogan = team.slogan ?? "";
  if (lang === "en") {
    const ordinal = position === 0 ? "first" : "second";
    return [
      `Name of ${ordinal} team: "${team.name}" olacak. Catchphrase of "${team.name}": "${slogan}". Also, members of thids team are like these:`,
      memberBlock(team.members),
    ].join("\n");
  }
  const ordinal = position === 0 ? "Birinci" : "İkinci";
  return [
    `${ordinal} takımın adı: "${team.name}" olacak. "${team.name}" takımının sloganı "${slogan}". Ayrıca bu takmın üyeleri şu şekilde:`,
    memberBlock(team.members),
  ].join("\n");
}

export function buildEndAuctionClipboardText(
  lang: Lang,
  first: EndAuctionTeamText,
  second: EndAuctionTeamText,
): string {
  return [buildSingleTeamText(lang, 0, first), buildSingleTeamText(lang, 1, second)].join("\n");
}

function replaceAll(haystack: string, needle: string, value: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(value);
}

export function buildSimulationPromptText(
  lang: Lang,
  opts: {
    template: string;
    battlefieldName: string;
    first: EndAuctionTeamText;
    second: EndAuctionTeamText;
  },
): string {
  const firstText = buildSingleTeamText(lang, 0, opts.first);
  const secondText = buildSingleTeamText(lang, 1, opts.second);
  const template = opts.template ?? "";
  if (template.trim() === "") return `${firstText}\n${secondText}`;
  let out = template;
  out = replaceAll(out, "{{Savaş alanı}}", opts.battlefieldName);
  out = replaceAll(out, "{{Savaş alanı}}", opts.battlefieldName);
  out = replaceAll(out, "{{1.takım metni}}", firstText);
  out = replaceAll(out, "{{1.takım metni}}", firstText);
  out = replaceAll(out, "{{2.takım metni}}", secondText);
  out = replaceAll(out, "{{2.takım metni}}", secondText);
  return out;
}

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

export function buildEndAuctionClipboardText(
  lang: Lang,
  first: EndAuctionTeamText,
  second: EndAuctionTeamText,
): string {
  const s1 = first.slogan ?? "";
  const s2 = second.slogan ?? "";
  if (lang === "en") {
    return [
      `Name of first team: "${first.name}" olacak. Catchphrase of "${first.name}": "${s1}". Also, members of thids team are like these:`,
      memberBlock(first.members),
      `Name of second team: "${second.name}" olacak. Catchphrase of "${second.name}": "${s2}". Also, members of thids team are like these:`,
      memberBlock(second.members),
    ].join("\n");
  }
  return [
    `Birinci takımın adı: "${first.name}" olacak. "${first.name}" takımının sloganı "${s1}". Ayrıca bu takmın üyeleri şu şekilde:`,
    memberBlock(first.members),
    `İkinci takımın adı: "${second.name}" olacak. "${second.name}" takımının sloganı "${s2}". Ayrıca bu takmın üyeleri şu şekilde:`,
    memberBlock(second.members),
  ].join("\n");
}

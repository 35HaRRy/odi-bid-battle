import { describe, expect, it } from "vitest";
import {
  addEntryToDraft,
  createAuctionDraft,
  removeEntryFromDraft,
  renameDraft,
  reorderEntryInDraft,
  syncFollowedDraft,
  createAuctionTeam,
  addTeamMember,
  transferMember,
  calculateTeamTotal,
  validateTeamBalance,
  validateAuctionPreparation,
  type AuctionTeam,
  type AuctionTeamMember,
} from "../src/domain.js";

describe("auction draft", () => {
  it("creates a draft following the source list entries", () => {
    const d = createAuctionDraft("Taslak 1", ["c1", "c2"], "list-1");
    expect(d.name).toBe("Taslak 1");
    expect(d.followsSource).toBe(true);
    expect(d.entries).toEqual(["c1", "c2"]);
    expect(d.sourceListId).toBe("list-1");
  });

  it("rename alone forks the draft (independent copy)", () => {
    const d = createAuctionDraft("A", ["c1"], "list-1");
    renameDraft(d, "B");
    expect(d.name).toBe("B");
    expect(d.followsSource).toBe(false);
  });

  it("followed drafts mirror source reorder; forked drafts do not", () => {
    const a = createAuctionDraft("A", ["c1", "c2"], "list-1");
    const b = createAuctionDraft("B", ["c1", "c2"], "list-1");
    renameDraft(b, "B2"); // fork b
    syncFollowedDraft(a, ["c2", "c1"]);
    syncFollowedDraft(b, ["c2", "c1"]);
    expect(a.entries).toEqual(["c2", "c1"]);
    expect(b.entries).toEqual(["c1", "c2"]);
  });

  it("local list edits fork before applying", () => {
    const d = createAuctionDraft("A", ["c1"], "list-1");
    addEntryToDraft(d, "c2");
    expect(d.followsSource).toBe(false);
    expect(d.entries).toEqual(["c1", "c2"]);
    expect(() => addEntryToDraft(d, "c2")).toThrow(/duplicate/i);
    removeEntryFromDraft(d, "c1");
    expect(d.entries).toEqual(["c2"]);
  });

  it("reorders draft entries", () => {
    const d = createAuctionDraft("A", ["c1", "c2", "c3"], null);
    reorderEntryInDraft(d, "c1", 2);
    expect(d.entries).toEqual(["c2", "c3", "c1"]);
  });

  it("draft with missing battlefield/team is still saveable", () => {
    const d = createAuctionDraft("", [], null);
    expect(d.battlefieldId).toBeNull();
    expect(d.name).toBe("");
  });
});

describe("auction teams domain", () => {
  it("creates a team and calculates total gold", () => {
    const team = createAuctionTeam("a-1", "Kuzey", 0, {
      flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" },
    });
    addTeamMember(team, "Elif", 10);
    addTeamMember(team, "Deniz", 15);
    expect(team.name).toBe("Kuzey");
    expect(team.members).toHaveLength(2);
    expect(calculateTeamTotal(team.members)).toBe(25);
  });

  it("validates team balance", () => {
    const t1 = createAuctionTeam("a-1", "T1", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    const t2 = createAuctionTeam("a-1", "T2", 1, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    addTeamMember(t1, "A", 10);
    addTeamMember(t2, "B", 20);
    expect(validateTeamBalance(t1, t2).valid).toBe(false);
    expect(validateTeamBalance(t1, t2).error).toContain("10 vs 20");
    
    addTeamMember(t1, "C", 10);
    expect(validateTeamBalance(t1, t2).valid).toBe(true);
  });

  it("validates team names and slogans", () => {
    expect(() => createAuctionTeam("a-1", "", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } })).toThrow("team name is required");
    const t2 = createAuctionTeam("a-1", "Valid", 1, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" }, slogan: "Test slogan" });
    expect(t2.slogan).toBe("Test slogan");
  });

  it("validates team flags", () => {
    expect(() => createAuctionTeam("a-1", "T1", 0, {})).toThrow("flag is required");
    const t = createAuctionTeam("a-1", "T2", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    expect(t.flag.buffer.length).toBeGreaterThan(0);
  });

  it("validates member names and gold", () => {
    const team = createAuctionTeam("a-1", "T", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    
    expect(() => addTeamMember(team, "", 10)).toThrow("member name is required");
    expect(() => addTeamMember(team, "  ", 10)).toThrow("member name is required");
    expect(() => addTeamMember(team, "Name", 0)).toThrow("invalid initial gold");
    expect(() => addTeamMember(team, "Name", -1)).toThrow("invalid initial gold");
    expect(() => addTeamMember(team, "Name", 10.5)).toThrow("invalid initial gold");
    
    const member = addTeamMember(team, "Alice", 10);
    expect(member.name).toBe("Alice");
    expect(member.initialGold).toBe(10);
    expect(calculateTeamTotal(team.members)).toBe(10);
  });

  it("validates each team has at least one member", () => {
    const t1 = createAuctionTeam("a-1", "T1", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    const t2 = createAuctionTeam("a-1", "T2", 1, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });

    const draft = createAuctionDraft("A", [], null);
    const validation = validateAuctionPreparation(draft, [t1, t2]);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('team "T1" must have at least one member');
  });

  it("validates preparation with incomplete teams", () => {
    const teams: AuctionTeam[] = [
      {
        id: "1",
        auctionId: "a-1",
        name: "",
        slogan: null,
        flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" },
        position: 0,
        members: [],
        createdAt: new Date().toISOString(),
      },
    ];
    
    const draft = createAuctionDraft("A", [], null);
    const validation = validateAuctionPreparation(draft, teams);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("team name is required");
  });

  it("transfers member between teams", () => {
    const team1 = createAuctionTeam("a-1", "T1", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    const team2 = createAuctionTeam("a-1", "T2", 1, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });

    const alice = addTeamMember(team1, "Alice", 10);
    addTeamMember(team2, "Bob", 20);

    // move Alice out of team1 into team2
    team1.members = team1.members.filter((m) => m.id !== alice.id);
    team2.members.push({ ...alice, teamId: team2.id });

    expect(team1.members).toHaveLength(0);
    expect(team2.members.map((m) => m.name)).toContain("Alice");

    // reorder members within one team
    team2.members = transferMember(team2.members, alice.id, 0);
    expect(team2.members[0].name).toBe("Alice");
    expect(() => transferMember(team2.members, "missing", 0)).toThrow("member not found");
  });
});

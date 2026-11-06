import { afterEach, expect, it, vi } from "vitest";
import { createElement, Children, isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicFilter, ShareField, canEdit } from "./sharing";
import { api, setSessionCsrf, type Auction, type Candidate, type CandidateList, type DraftBattlefield } from "./api";
import { Catalog, CatalogPane, Lists, AuctionWorkspace } from "./App";
import { BattlefieldLibrary, BattlefieldPreparation, BattlefieldEditor } from "./battlefields";
import { t } from "./i18n";

// Exercise component handlers/effects using the repo's dependency-free hook-test pattern.
const hooks = vi.hoisted(() => ({ active: null as { values: unknown[]; cursor: number; effects: (() => void)[] } | null }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react,
    useState: (initial: unknown) => {
      if (!hooks.active) return react.useState(initial);
      const scope = hooks.active;
      const index = scope.cursor++;
      if (!(index in scope.values)) scope.values[index] = typeof initial === "function" ? initial() : initial;
      return [scope.values[index], (next: unknown) => { scope.values[index] = typeof next === "function" ? next(scope.values[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      if (!hooks.active) return react.useRef(initial);
      const index = hooks.active.cursor++;
      return hooks.active.values[index] ?? (hooks.active.values[index] = { current: initial });
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!hooks.active) return react.useEffect(effect, deps);
      const scope = hooks.active;
      const index = scope.cursor++;
      const previous = scope.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        scope.effects.push(() => { previous?.cleanup?.(); scope.values[index] = { deps, cleanup: effect() }; });
      }
    },
  };
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode), ...elements(child.props.action as ReactNode)] : []);
}
function mount(render: () => ReactNode) {
  const scope = { values: [] as unknown[], cursor: 0, effects: [] as (() => void)[] };
  return () => {
    scope.cursor = 0;
    hooks.active = scope;
    try { return render(); } finally { hooks.active = null; scope.effects.splice(0).forEach(effect => effect()); }
  };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const click = (element: ReactElement<Record<string, unknown>>) => (element.props.onClick as () => void)();
const button = (tree: ReactNode, label: string) => elements(tree).find(el => el.type === "button" && el.props.children === label)!;
const toggle = (tree: ReactNode, checked: boolean) => (elements(tree).find(el => el.type === PublicFilter)!.props.onChange as (value: boolean) => void)(checked);
const owned: Candidate = { id: "own", name: "Own candidate", ownerUserId: "alice", isOwner: true, isPublic: false };
const foreign: Candidate = { id: "foreign", name: "Shared candidate", ownerUserId: "bob", isOwner: false, isPublic: true };
const error = () => {};
const update = () => {};

const owner = { ownerUserId: "alice", isOwner: true, isPublic: false };

it.each(["catalog", "lists", "library", "preparation"])("%s filter recovery clears only its own load failure", async kind => {
  const onError = vi.fn();
  const method = kind === "catalog" ? "candidates" : kind === "lists" ? "lists" : "battlefields";
  vi.spyOn(api, method).mockRejectedValueOnce(new Error("filter failed")).mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "image/svg+xml" } })));
  const auction: Auction = { id: "auction", name: "Own", sourceListId: null, followsSource: false, entries: [], battlefieldId: null, simulationPromptTemplate: "", status: "draft" };
  const render = mount(() => kind === "catalog" ? Catalog({ lang: "en", userId: "alice", items: [], onItems: update, onError })
    : kind === "lists" ? Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError })
    : kind === "library" ? BattlefieldLibrary({ lang: "en", userId: "alice" })
    : BattlefieldPreparation({ lang: "en", userId: "alice", auction, onAuctionChange: update }));
  render(); await settle();
  expect(renderToStaticMarkup(render())).toContain(t("en", "persistFail"));
  toggle(render(), true); render(); await settle();
  expect(renderToStaticMarkup(render())).not.toContain(t("en", "persistFail"));
  expect(onError).not.toHaveBeenCalled();
});

it.each(["library", "preparation"])("%s filter success preserves an unrelated mutation failure", async kind => {
  const field = { ...owned, geography: "Geo", history: "Past", archivedAt: null };
  vi.spyOn(api, "battlefields").mockResolvedValue([field]);
  vi.spyOn(api, "archiveBattlefield").mockRejectedValue(new Error("mutation failed"));
  vi.spyOn(api, "setAuctionBattlefield").mockRejectedValue(new Error("mutation failed"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "image/svg+xml" } })));
  const auction: Auction = { id: "auction", name: "Own", sourceListId: null, followsSource: false, entries: [], battlefieldId: null, simulationPromptTemplate: "", status: "draft" };
  const render = mount(() => kind === "library" ? BattlefieldLibrary({ lang: "en", userId: "alice" })
    : BattlefieldPreparation({ lang: "en", userId: "alice", auction, onAuctionChange: update }));
  render(); await settle();
  if (kind === "library") {
    click(button(render(), t("en", "archive")));
    await (elements(render()).find(el => el.props.className === "danger")!.props.onClick as () => Promise<void>)();
  } else await (elements(render()).find(el => el.props.className === "battle-option")!.props.onClick as () => Promise<void>)();
  expect(renderToStaticMarkup(render())).toContain(t("en", "persistFail"));
  toggle(render(), true); render(); await settle();
  expect(renderToStaticMarkup(render())).toContain(t("en", "persistFail"));
});

afterEach(() => { hooks.active = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); setSessionCsrf(""); });

it("filter_defaults_private_and_is_independent", () => {
  let library = false;
  let picker = false;
  const first = PublicFilter({ checked: library, onChange: value => { library = value; }, lang: "en" });
  const second = PublicFilter({ checked: picker, onChange: value => { picker = value; }, lang: "en" });
  const inputs = (node: ReactNode): ReactElement<Record<string, unknown>>[] => Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child) ? [child, ...inputs(child.props.children as ReactNode)] : []);
  const input = inputs(first).find(child => child.type === "input")!;
  (input.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  expect(library).toBe(true);
  expect(picker).toBe(false);
  expect(renderToStaticMarkup(second)).not.toContain('checked=""');
  for (const lang of ["en", "tr"] as const) {
    const html = renderToStaticMarkup(createElement(ShareField, { checked: false, onChange: () => {}, lang }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<label");
    expect(html).not.toContain("shareRecord");
  }
});

it("only_owner_gets_edit_controls", () => {
  expect(canEdit(owner, "alice")).toBe(true);
  expect(canEdit({ ...owner, isOwner: true, isPublic: true }, "bob")).toBe(false);
  expect(canEdit({ ...owner, isOwner: false }, "alice")).toBe(true);
});

it("takes one contextual private child from a public list into an existing owned private list", async () => {
  const target: CandidateList = { ...owner, id: "target", name: "My private list", isDraft: false, entries: [] };
  const other: CandidateList = { ...owner, id: "other", name: "Other own list", isDraft: false, entries: [] };
  const source: CandidateList = { ...foreign, id: "source", name: "Public source", isDraft: false, entries: ["private-child", "unwanted-child"] };
  vi.spyOn(api, "lists").mockImplementation(async includePublic => includePublic ? [target, other, source] : [target, other]);
  vi.spyOn(api, "getCandidate").mockImplementation(async id => ({ ...foreign, id, name: id, isPublic: false }));
  const add = vi.spyOn(api, "addEntry").mockResolvedValue({ ...other, entries: ["private-child"] });
  const edit = vi.spyOn(api, "editList");
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  const sections = elements(render()).filter(el => el.type === "section" && el.props.className === "list-entry");
  click(button(sections.find(section => renderToStaticMarkup(section).includes("Public source")), t("en", "selectList")));
  let tree = render();
  const picker = elements(tree).find(el => el.type === "select" && el.props["aria-label"] === t("en", "targetOwnList"))!;
  expect(picker).toBeDefined();
  expect(picker.props.value).toBe("target");
  expect(renderToStaticMarkup(picker)).not.toContain("Public source");
  (picker.props.onChange as (event: unknown) => void)({ target: { value: "other" } });
  tree = render();
  const ordered = elements(tree).find(el => typeof el.type === "function" && el.props.readOnly === true && Array.isArray(el.props.entries))!;
  const rows = (ordered.type as (props: unknown) => ReactNode)(ordered.props);
  await (elements(rows).find(el => el.type === "button" && el.props["aria-label"] === `private-child: ${t("en", "addToOwnList")}`)!.props.onClick as () => Promise<void>)();
  expect(add).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledWith("other", "private-child", "source");
  expect(edit).not.toHaveBeenCalled();
});

it("shows the shared source on the left and switches the target editor on the right", async () => {
  const first: CandidateList = { ...owner, id: "first", name: "First", isDraft: false, entries: [owned.id] };
  const second: CandidateList = { ...first, id: "second", name: "Second", entries: [foreign.id] };
  const source: CandidateList = { ...foreign, id: "source", name: "Source", isDraft: false, entries: [foreign.id] };
  vi.spyOn(api, "lists").mockImplementation(async publicRecords => publicRecords ? [first, second, source] : [first, second]);
  const reorder = vi.spyOn(api, "reorder").mockResolvedValue(second);
  const remove = vi.spyOn(api, "removeEntry").mockResolvedValue({ ...second, entries: [] });
  const edit = vi.spyOn(api, "editListEntry").mockResolvedValue({ candidate: foreign, list: second });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [owned, foreign], onCandidates: update, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  const sourceCard = elements(render()).find(el => el.props.className === "list-entry" && renderToStaticMarkup(el).includes("Source"))!;
  click(button(sourceCard, t("en", "selectList")));
  const columns = () => {
    const split = elements(render()).find(el => el.props.className === "split")!;
    return Children.toArray(split.props.children as ReactNode).filter(isValidElement);
  };
  expect(columns()).toHaveLength(2);
  expect(elements(columns()[0]).some(el => el.type === "select")).toBe(false);
  let picker = elements(columns()[1]).find(el => el.type === "select")!;
  expect(picker.props.value).toBe("first");
  const editor = () => elements(columns()[1]).find(el => el.props.context && el.props.entries)!;
  expect(editor().props.entries).toEqual([owned.id]);
  (picker.props.onChange as (e: unknown) => void)({ target: { value: "second" } });
  expect(editor().props.entries).toEqual([foreign.id]);
  expect(editor().props.context).toEqual({ listId: "second" });
  await (editor().props.onReorder as (id: string, to: number) => Promise<void>)(foreign.id, 0);
  expect(reorder).toHaveBeenCalledWith("second", foreign.id, 0);
  (editor().props.onEdit as (id: string) => void)(foreign.id);
  const dialog = elements(render()).find(el => el.props.previewUrl)!;
  expect(dialog.props.previewUrl).toContain("listId=second");
  await (dialog.props.onSave as (name: string, file: null) => Promise<void>)("Edited", null);
  expect(edit).toHaveBeenCalledWith("second", foreign.id, "Edited", null);
  await (editor().props.onRemove as (id: string) => Promise<void>)(foreign.id);
  expect(remove).toHaveBeenCalledWith("second", foreign.id);
  expect(editor().props.entries).toEqual([]);
  click(button(columns()[1], t("en", "createAndAdd")));
  picker = elements(columns()[1]).find(el => el.type === "select")!;
  (picker.props.onChange as (e: unknown) => void)({ target: { value: "first" } });
  expect(elements(render()).some(el => el.type === "dialog")).toBe(false);
});

it("creates candidates in the selected target even if the target changes during creation", async () => {
  const first: CandidateList = { ...owner, id: "first", name: "First", isDraft: false, entries: [] };
  const second: CandidateList = { ...first, id: "second", name: "Second" };
  const source: CandidateList = { ...foreign, id: "source", name: "Source", isDraft: false, entries: [] };
  vi.spyOn(api, "lists").mockImplementation(async publicRecords => publicRecords ? [first, second, source] : [first, second]);
  let finish!: (candidate: Candidate) => void;
  vi.spyOn(api, "createCandidate").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const add = vi.spyOn(api, "addEntry").mockResolvedValue({ ...second, entries: [owned.id] });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  click(button(elements(render()).find(el => el.props.className === "list-entry" && renderToStaticMarkup(el).includes("Source")), t("en", "selectList")));
  const selectTarget = (value: string) => (elements(render()).find(el => el.type === "select")!.props.onChange as (e: unknown) => void)({ target: { value } });
  selectTarget("second");
  expect(button(render(), t("en", "createAndAdd"))).toBeDefined();
  click(button(render(), t("en", "createAndAdd")));
  (elements(render()).find(el => el.type === "input" && el.props["aria-label"] === t("en", "name"))!.props.onChange as (e: unknown) => void)({ target: { value: "New candidate" } });
  (elements(render()).find(el => el.props.onSelect)!.props.onSelect as (file: File) => void)(new File(["image"], "test.png"));
  (elements(render()).find(el => el.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  selectTarget("first");
  finish(owned); await settle();
  expect(add).toHaveBeenCalledWith("second", owned.id);
  expect(elements(render()).find(el => el.props.readOnly === true)!.props.context).toEqual({ listId: "source" });
});

it("clears the shared selection, scrolls to the heading, and can reopen it", async () => {
  const source: CandidateList = { ...foreign, id: "source", name: "Source", isDraft: false, entries: [] };
  vi.spyOn(api, "lists").mockResolvedValue([source]);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  const render = mount(() => Lists({ lang: "tr", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle();
  let tree = render();
  const close = elements(tree).find(el => el.type === "button" && el.props.title === "Seçimi kaldır");
  expect(close).toBeDefined();
  expect(close!.props["aria-label"]).toBe("Seçimi kaldır");
  const scrollIntoView = vi.fn();
  const heading = elements(tree).find(el => el.props.title === t("tr", "lists") && typeof el.type === "function")!;
  (heading.props.headingRef as { current: unknown }).current = { scrollIntoView };
  click(close!);
  expect(elements(render()).some(el => el.props.className === "split")).toBe(false);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  toggle(render(), true); render(); await settle();
  expect(elements(render()).some(el => el.props.className === "split")).toBe(false);
  click(button(render(), t("tr", "selectList")));
  tree = render();
  expect(elements(tree).some(el => el.props.className === "split")).toBe(true);
  expect(elements(tree).find(el => el.type === "select")!.props.disabled).toBe(true);
  expect(button(tree, t("tr", "createAndAdd"))).toBeUndefined();
});

it.each([false, true])("preserves the owned list editor when isPublic=%s", async isPublic => {
  const list: CandidateList = { ...owner, id: "own-list", name: "Own list", isPublic, isDraft: true, entries: [owned.id] };
  vi.spyOn(api, "lists").mockResolvedValue([list]);
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [owned], onCandidates: update, onError: error }));
  render(); await settle();
  const tree = render();
  expect(elements(tree).find(el => el.type === CatalogPane)!.props.addedIds).toEqual([owned.id]);
  expect(elements(tree).some(el => el.type === "select")).toBe(false);
  expect(button(tree, t("en", "createAndAdd"))).toBeDefined();
  expect(elements(tree).find(el => el.props.context && el.props.entries)!.props.context).toEqual({ listId: list.id });
});

it("picker state is independent, public data remains discoverable with an empty own catalog, and disabling hides it immediately", async () => {
  const requests = vi.spyOn(api, "candidates").mockImplementation(async includePublic => includePublic ? [foreign] : []);
  const props = { lang: "en" as const, userId: "alice", candidates: [], addedIds: [], onAdd: update, onEdit: update };
  const first = mount(() => CatalogPane(props));
  const second = mount(() => CatalogPane(props));
  first(); second(); await settle();
  expect(renderToStaticMarkup(first())).not.toContain(foreign.name);
  toggle(first(), true); first(); await settle();
  expect(renderToStaticMarkup(first())).toContain(foreign.name);
  expect(renderToStaticMarkup(second())).not.toContain(foreign.name);
  expect(requests.mock.calls.map(call => call[0])).toEqual([false, false, true]);
  expect(elements(first()).some(el => el.props["aria-label"] === `${foreign.name}: Edit`)).toBe(false);
  toggle(first(), false);
  expect(renderToStaticMarkup(first())).not.toContain(foreign.name);
});

it("a failed public picker request reports failure without losing the own catalog", async () => {
  vi.spyOn(api, "candidates").mockImplementation(async includePublic => {
    if (includePublic) throw new Error("synthetic failure");
    return [owned];
  });
  const render = mount(() => CatalogPane({ lang: "en", userId: "alice", candidates: [owned], addedIds: [], onAdd: update }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  const html = renderToStaticMarkup(render());
  expect(html).toContain('role="alert"');
  expect(html).toContain(t("en", "persistFail"));
  expect(html).toContain(owned.name);
});

it("catalog renders foreign roots read-only without widening the shared own-candidate cache", async () => {
  vi.spyOn(api, "candidates").mockImplementation(async publicRecords => publicRecords ? [owned, foreign] : [owned]);
  const onItems = vi.fn();
  const render = mount(() => Catalog({ lang: "en", userId: "alice", items: [owned], onItems, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  const html = renderToStaticMarkup(render());
  expect(html).toContain(foreign.name);
  expect(html).not.toContain(`${foreign.name}: Edit`);
  expect(html).toContain(`${owned.name}: Edit`);
  expect(onItems).not.toHaveBeenCalled();
  toggle(render(), false);
  expect(renderToStaticMarkup(render())).not.toContain(foreign.name);
});

it("selected revoked list and private historical entries stay readable without foreign mutation controls", async () => {
  const shared: CandidateList = { ...foreign, id: "shared-list", name: "Shared list", isDraft: true, entries: ["private-child"] };
  vi.spyOn(api, "lists").mockImplementation(async includePublic => includePublic ? [shared] : []);
  vi.spyOn(api, "getCandidate").mockResolvedValue({ ...foreign, id: "private-child", name: "Historical child", isPublic: false });
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle(); render(); await settle();
  const html = renderToStaticMarkup(render());
  expect(html).toContain("Shared list");
  expect(html).toContain("listId=shared-list");
  expect(html).not.toContain('class="ordered-actions"');
  expect(button(render(), "Archive")).toBeUndefined();
  expect(button(render(), "Edit")).toBeUndefined();
  expect(elements(render()).some(el => el.type === CatalogPane)).toBe(false);
  expect(button(render(), t("en", "useList"))).toBeDefined();
  toggle(render(), false); render(); await settle();
  const retained = renderToStaticMarkup(render());
  expect(retained).toContain("Historical child");
  expect(retained).toContain("listId=shared-list");
});

it("foreign_entry_edit_creates_private_copy", async () => {
  const list: CandidateList = { ...owner, id: "consumer", name: "Own list", isDraft: true, entries: [foreign.id] };
  const copy = { ...owned, id: "copy", name: "Changed" };
  vi.spyOn(api, "lists").mockResolvedValue([list]);
  vi.spyOn(api, "getCandidate").mockResolvedValue(foreign);
  const edit = vi.spyOn(api, "editListEntry").mockResolvedValue({ candidate: copy, list: { ...list, entries: [copy.id] } });
  const rootEdit = vi.spyOn(api, "editCatalogCandidate");
  const onCandidates = vi.fn();
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates, onError: error }));
  render(); await settle(); render(); await settle();
  const ordered = elements(render()).find(el => el.props.context && el.props.entries)!;
  (ordered.props.onEdit as (id: string) => void)(foreign.id);
  const dialog = elements(render()).find(el => el.props.previewUrl)!;
  expect(dialog.props.initialPublic).toBeUndefined();
  expect(dialog.props.previewUrl).toContain("listId=consumer");
  await (dialog.props.onSave as (name: string, file: null) => Promise<void>)("Changed", null);
  expect(edit).toHaveBeenCalledWith("consumer", foreign.id, "Changed", null);
  expect(rootEdit).not.toHaveBeenCalled();
  expect(onCandidates).toHaveBeenCalledWith([copy]);
  const replaced = elements(render()).find(el => el.props.context && el.props.entries)!;
  expect(replaced.props.entries).toEqual([copy.id]);
  expect(renderToStaticMarkup(render())).toContain("listId=consumer");
});

it("battlefield library ownership and retained selection do not depend on the public root picker", async () => {
  const field = { ...foreign, geography: "Geo", history: "Past", archivedAt: null };
  vi.spyOn(api, "battlefields").mockImplementation(async includePublic => includePublic ? [field] : []);
  const library = mount(() => BattlefieldLibrary({ lang: "en", userId: "alice" }));
  library(); await settle(); toggle(library(), true); library(); await settle();
  expect(renderToStaticMarkup(library())).toContain(foreign.name);
  expect(button(library(), "Edit")).toBeUndefined();
  expect(button(library(), "Archive")).toBeUndefined();
  toggle(library(), false);
  expect(renderToStaticMarkup(library())).not.toContain(foreign.name);
});

it("retains a revoked battlefield through the owned auction context and isolates two battlefield pickers", async () => {
  const field = { ...foreign, geography: "Geo", history: "Past", archivedAt: null };
  const requests = vi.spyOn(api, "battlefields").mockImplementation(async includePublic => includePublic ? [field] : []);
  vi.spyOn(api, "getDraftBattlefield").mockResolvedValue({ auctionId: "auction", battlefieldId: "revoked", name: "Historical field", geography: "Retained geo", history: "Retained history", hasCustomImage: true, archivedAt: "2026-01-01" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "image/svg+xml" } })));
  const auction = { id: "auction", name: "Own", sourceListId: null, followsSource: false, entries: [], battlefieldId: "revoked", simulationPromptTemplate: "", status: "draft" };
  const first = mount(() => BattlefieldPreparation({ lang: "en", userId: "alice", auction, onAuctionChange: update }));
  const second = mount(() => BattlefieldPreparation({ lang: "en", userId: "alice", auction: { ...auction, id: "another", battlefieldId: null }, onAuctionChange: update }));
  first(); second(); await settle();
  const html = renderToStaticMarkup(first());
  expect(html).toContain("Historical field");
  expect(html).toContain("/auctions/auction/battlefield/image");
  expect(html).toContain("Retained geo");
  toggle(first(), true); first(); await settle();
  expect(renderToStaticMarkup(first())).toContain(foreign.name);
  expect(renderToStaticMarkup(second())).not.toContain(foreign.name);
  expect(requests.mock.calls.map(call => call[0])).toEqual([false, false, true]);
  toggle(first(), false);
  const retained = renderToStaticMarkup(first());
  expect(retained).not.toContain(foreign.name);
  expect(retained).toContain("Historical field");
});

it("battlefield public filter preserves unsaved geography and history without reloading context", async () => {
  const auction: Auction = { id: "auction", name: "Own", sourceListId: null, followsSource: false, entries: [], battlefieldId: "field-a", simulationPromptTemplate: "", status: "draft" };
  vi.spyOn(api, "battlefields").mockResolvedValue([]);
  const context = vi.spyOn(api, "getDraftBattlefield").mockResolvedValue({ auctionId: auction.id, battlefieldId: "field-a", name: "Field A", geography: "Saved geography", history: "Saved history", hasCustomImage: false, archivedAt: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "image/svg+xml" } })));
  const render = mount(() => BattlefieldPreparation({ lang: "en", userId: "alice", auction, onAuctionChange: update }));
  render(); await settle();
  click(elements(render()).find(el => el.props["aria-label"] === t("en", "editTexts"))!);
  for (const [label, value] of [["geographyFeatures", "Unsaved geography"], ["historyPast", "Unsaved history"]]) {
    const input = elements(render()).find(el => el.type === "textarea" && el.props["aria-label"] === t("en", label))!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  }
  toggle(render(), true); render(); await settle();
  const inputs = elements(render()).filter(el => el.type === "textarea");
  expect(inputs.map(input => input.props.value)).toEqual(["Unsaved geography", "Unsaved history"]);
  expect(context).toHaveBeenCalledTimes(1);
});

it.each(["context", "fallback"] as const)("ignores a delayed A %s response after selecting B, including editable/save state", async source => {
  let auction: Auction = { id: "auction", name: "Own", sourceListId: null, followsSource: false, entries: [], battlefieldId: "field-a", simulationPromptTemplate: "", status: "draft" };
  const a: DraftBattlefield = { auctionId: auction.id, battlefieldId: "field-a", name: "Field A", geography: "A geography", history: "A history", hasCustomImage: false, archivedAt: null };
  const b: DraftBattlefield = { ...a, battlefieldId: "field-b", name: "Field B", geography: "B geography", history: "B history" };
  let finishA!: (value: DraftBattlefield) => void;
  const delayedA = new Promise<DraftBattlefield>(resolve => { finishA = resolve; });
  vi.spyOn(api, "battlefields").mockResolvedValue([a, b].map(field => ({ ...owner, id: field.battlefieldId, name: field.name, geography: field.geography, history: field.history, archivedAt: null })));
  vi.spyOn(api, "getDraftBattlefield").mockResolvedValue(b)
    .mockImplementationOnce(() => source === "context" ? delayedA : Promise.reject(new Error("synthetic contextual failure")));
  vi.spyOn(api, "getBattlefield").mockImplementation(async () => {
    const field = await delayedA;
    return { ...owner, id: field.battlefieldId, name: field.name, geography: field.geography, history: field.history, archivedAt: null };
  });
  vi.spyOn(api, "setAuctionBattlefield").mockResolvedValue({ ...auction, battlefieldId: b.battlefieldId });
  const save = vi.spyOn(api, "saveDraftBattlefield").mockResolvedValue(b);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "image/svg+xml" } })));
  const render = mount(() => BattlefieldPreparation({ lang: "en", userId: "alice", auction, onAuctionChange: updated => { auction = updated; } }));
  render(); await settle();
  const selectB = elements(render()).find(el => el.type === "button" && el.props.className === "battle-option" && elements(el.props.children as ReactNode).some(child => child.type === "strong" && child.props.children === b.name))!;
  await (selectB.props.onClick as () => Promise<void>)();
  render(); await settle();
  finishA(a); await settle();
  const detail = elements(render()).find(el => el.props.className === "map-embed")!;
  expect(detail.props.alt).toBe("Field B");
  click(elements(render()).find(el => el.props["aria-label"] === t("en", "editTexts"))!);
  expect(elements(render()).filter(el => el.type === "textarea").map(el => el.props.value)).toEqual(["B geography", "B history"]);
  await (button(render(), t("en", "save")).props.onClick as () => Promise<void>)();
  expect(save).toHaveBeenCalledWith(auction.id, { geography: "B geography", history: "B history" }, null);
});

it("candidate root create and edit forward sharing while closing creation resets to private", async () => {
  vi.spyOn(api, "candidates").mockResolvedValue([owned]);
  const create = vi.spyOn(api, "createCandidate").mockResolvedValue({ ...owned, id: "new" });
  const edit = vi.spyOn(api, "editCatalogCandidate").mockResolvedValue(owned);
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  const render = mount(() => Catalog({ lang: "en", userId: "alice", items: [owned], onItems: update, onError: error }));
  render(); await settle();
  click(button(render(), t("en", "newCandidate")));
  let tree = render();
  (elements(tree).find(el => el.type === ShareField)!.props.onChange as (value: boolean) => void)(true);
  (elements(tree).find(el => el.type === "input" && el.props["aria-label"] === t("en", "name"))!.props.onChange as (e: unknown) => void)({ target: { value: "Created" } });
  const file = new File(["synthetic"], "test.png");
  (elements(tree).find(el => el.props.onSelect)!.props.onSelect as (file: File) => void)(file);
  tree = render();
  (elements(tree).find(el => el.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  await settle();
  expect(create).toHaveBeenCalledWith("Created", file, true);
  click(button(render(), t("en", "newCandidate")));
  expect(elements(render()).find(el => el.type === ShareField)!.props.checked).toBe(false);
  click(button(render(), t("en", "cancel")));
  click(elements(render()).find(el => el.props["aria-label"] === `${owned.name}: Edit`)!);
  const dialog = elements(render()).find(el => el.props.previewUrl)!;
  expect(dialog.props.initialPublic).toBe(false);
  await (dialog.props.onSave as (name: string, file: null, isPublic: boolean) => Promise<void>)("Renamed", null, true);
  expect(edit).toHaveBeenCalledWith(owned.id, "Renamed", null, true);
});

it("list root create and edit forward checked sharing independently from its candidate picker", async () => {
  const list: CandidateList = { ...owner, id: "list", name: "List", isDraft: true, entries: [] };
  vi.spyOn(api, "lists").mockResolvedValue([list]);
  const create = vi.spyOn(api, "createList").mockResolvedValue({ ...list, id: "new" });
  const edit = vi.spyOn(api, "editList").mockResolvedValue({ ...list, isPublic: true });
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle(); click(button(render(), t("en", "newList")));
  let tree = render();
  (elements(tree).find(el => el.type === ShareField)!.props.onChange as (value: boolean) => void)(true);
  (elements(tree).find(el => el.type === "input")!.props.onChange as (e: unknown) => void)({ target: { value: "Created list" } });
  tree = render();
  (elements(tree).find(el => el.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  await settle(); expect(create).toHaveBeenCalledWith("Created list", true, true);
  click(button(render(), t("en", "newList")));
  expect(elements(render()).find(el => el.type === ShareField)!.props.checked).toBe(false);
  click(button(render(), t("en", "cancel")));
  click(button(render(), t("en", "edit")));
  (elements(render()).find(el => el.type === ShareField)!.props.onChange as (value: boolean) => void)(true);
  await (elements(render()).find(el => el.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  expect(edit).toHaveBeenCalledWith("list", "List", true);
  expect(elements(render()).find(el => el.type === CatalogPane)!.props).not.toHaveProperty("includePublic");
});

it("battlefield create and edit editors initialize sharing and forward explicit booleans", async () => {
  const field = { ...owned, geography: "Geo", history: "Past", archivedAt: null, isPublic: true };
  const save = vi.fn().mockResolvedValue(undefined);
  const render = mount(() => BattlefieldEditor({ lang: "en", initial: field, onSave: save, onClose: update }));
  expect(elements(render()).find(el => el.type === ShareField)!.props.checked).toBe(true);
  (elements(render()).find(el => el.type === ShareField)!.props.onChange as (value: boolean) => void)(false);
  await (elements(render()).find(el => el.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  expect(save).toHaveBeenCalledWith({ name: owned.name, geography: "Geo", history: "Past" }, null, false);
  const create = mount(() => BattlefieldEditor({ lang: "en", initial: null, onSave: save, onClose: update }));
  expect(elements(create()).find(el => el.type === ShareField)!.props.checked).toBe(false);
});

it("auction source-list picker opts in independently and auction draft/live/result selectors stay private", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const shared = { ...foreign, id: "shared-list", name: "Public source", isDraft: true, entries: [] };
  const lists = vi.spyOn(api, "lists").mockImplementation(async includePublic => includePublic ? [shared] : []);
  const auctions = vi.spyOn(api, "auctions").mockResolvedValue([]);
  const props = { lang: "en" as const, userId: "alice", candidates: [], onError: error, onOpenDraft: update, onOpenLive: update, onOpenResult: update, onBackToAuctions: update, onCandidates: update };
  const render = mount(() => AuctionWorkspace({ ...props, view: "auctions" }));
  render(); await settle(); click(button(render(), t("en", "createDraft")));
  expect(renderToStaticMarkup(render())).not.toContain("Public source");
  toggle(render(), true); render(); await settle();
  expect(renderToStaticMarkup(render())).toContain("Public source");
  toggle(render(), false);
  expect(renderToStaticMarkup(render())).not.toContain("Public source");
  expect(lists.mock.calls.map(call => call[0])).toEqual([false, true, false]);
  expect(auctions.mock.calls).toEqual([[]]);
  for (const view of ["draft", "live", "result"] as const) {
    const ownOnly = mount(() => AuctionWorkspace({ ...props, view }));
    const html = renderToStaticMarkup(ownOnly());
    expect(html).not.toContain("Include public records");
  }
});

it("sends explicit JSON and multipart sharing booleans and preserves omitted edits", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  setSessionCsrf("synthetic-csrf");
  await api.createList("List", true);
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toMatchObject({ isPublic: false });
  await api.editList("list", undefined, false);
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({ isPublic: false });
  await api.editList("list", "Renamed");
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({ name: "Renamed" });
  const file = new File(["synthetic"], "test.png", { type: "image/png" });
  await api.createCandidate("Candidate", file);
  expect(fetch.mock.calls.at(-1)![1].body.get("isPublic")).toBe("false");
  await api.editCatalogCandidate("candidate", "Name", null, true);
  expect(fetch.mock.calls.at(-1)![1].body.get("isPublic")).toBe("true");
  await api.editCatalogCandidate("candidate", "Name", null);
  expect(fetch.mock.calls.at(-1)![1].body.has("isPublic")).toBe(false);
  const fields = { name: "Field", geography: "Geo", history: "History" };
  await api.createBattlefield(fields, file, true);
  expect(fetch.mock.calls.at(-1)![1].body.get("isPublic")).toBe("true");
  await api.editBattlefield("field", fields, null, false);
  expect(fetch.mock.calls.at(-1)![1].body.get("isPublic")).toBe("false");
});

it("shared_copy_is_owned_and_private", async () => {
  const shared: CandidateList = { ...foreign, id: "shared", name: "Shared list", isDraft: true, entries: ["foreign-private"] };
  const copy: CandidateList = { ...owner, id: "copy", name: "Copy", isDraft: true, entries: ["foreign-private"] };
  vi.spyOn(api, "lists").mockImplementation(async includePublic => includePublic ? [shared] : []);
  const clone = vi.spyOn(api, "cloneList").mockResolvedValue(copy);
  const get = vi.spyOn(api, "getCandidate").mockResolvedValue({ ...foreign, id: "foreign-private", name: "Private child", isPublic: false });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  const render = mount(() => Lists({ lang: "en", userId: "alice", candidates: [], onCandidates: update, onError: error }));
  render(); await settle(); toggle(render(), true); render(); await settle();
  click(button(render(), t("en", "useList"))); await settle(); render(); await settle();
  expect(clone).toHaveBeenCalledWith("shared");
  const tree = render();
  const picker = elements(tree).find(el => el.type === CatalogPane)!;
  expect(picker.props.addedIds).toEqual(["foreign-private"]);
  expect(renderToStaticMarkup(tree)).toContain("listId=copy");
  expect(get).toHaveBeenCalledWith("foreign-private", { listId: "shared" });
  click(button(tree, t("en", "edit")));
  expect(elements(render()).find(el => el.type === ShareField)!.props.checked).toBe(false);
});

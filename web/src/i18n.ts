export type Lang = "tr" | "en";

const STRINGS: Record<Lang, Record<string, string>> = {
  tr: {
    catalog: "Aday Kataloğu",
    lists: "Aday Listeleri",
    auctions: "Müzayedeler",
    battlefields: "Savaş Alanları",
    draft: "Taslak",
    name: "Ad",
    image: "Görsel",
    create: "Oluştur",
    add: "Ekle",
    remove: "Çıkar",
    archive: "Arşivle",
    up: "Yukarı",
    down: "Aşağı",
    saveList: "Liste Kaydet",
    newList: "Yeni Liste",
    entries: "Kayıtlar",
    duplicate: "Aynı aday listede iki kez olamaz",
    persistFail: "Kaydetme başarısız: değişiklikler kaydedilmedi",
    comingSoon: "Bu dilimde pasif (issue #2 kapsamı dışı)",
    addExisting: "Mevcut aday ekle",
    createAndAdd: "Yeni aday oluştur ve ekle",
    language: "Dil",
  },
  en: {
    catalog: "Candidate Catalog",
    lists: "Candidate Lists",
    auctions: "Auctions",
    battlefields: "Battlefields",
    draft: "Draft",
    name: "Name",
    image: "Image",
    create: "Create",
    add: "Add",
    remove: "Remove",
    archive: "Archive",
    up: "Up",
    down: "Down",
    saveList: "Save list",
    newList: "New list",
    entries: "Entries",
    duplicate: "Same candidate cannot occur twice in one list",
    persistFail: "Save failed: changes were not saved",
    comingSoon: "Disabled in this slice (out of issue #2 scope)",
    addExisting: "Add existing candidate",
    createAndAdd: "Create new candidate and add",
    language: "Language",
  },
};

export function getLang(): Lang {
  const v = localStorage.getItem("obb-lang");
  return v === "en" ? "en" : "tr";
}

export function setLang(l: Lang): void {
  localStorage.setItem("obb-lang", l);
}

export function t(lang: Lang, key: string): string {
  return STRINGS[lang][key] ?? STRINGS.tr[key] ?? key;
}

# Public List Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Başkasına ait herkese açık listeler için kaynak/hedef kolonlarını ayırmak; kendi liste akışını korumak.

**Architecture:** `Lists` kaynak seçimini `active` ile, düzenlenen listeyi kendi liste akışında `active`, ortak liste akışında `targetList` ile belirler. Mevcut `OrderedEntries`, API işlemleri ve stiller yeniden kullanılır; kaynak salt okunur kalır.

**Tech Stack:** React, TypeScript, mevcut Vitest hook-test düzeni.

**Spec:** `docs/superpowers/specs/2026-11-05-public-list-selection-design.md`

## Global Constraints
- Kullanıcının kendi listesini seçtiği süreç değişmez.
- Yeni düzen yalnızca kullanıcıya ait olmayan listelerde geçerlidir.
- Backend, veri modeli ve bağımlılıklar değişmez.
- Türkçe ikon butonu title metni `Seçimi kaldır`; erişilebilir adı da bulunur.
- Kullanıcının mevcut, ilgisiz çalışma ağacı değişiklikleri korunur; otomatik commit yapılmaz.

## Review Focus
- Kullanıcıya ait herkese açık liste de eski akışı kullanır.
- Hedef listesi olmayan kullanıcı kaynak adaylarını okuyabilir ancak yeni aday ekleyemez.
- Hedef değişince düzenleme, silme, sıralama ve görsel bağlamı yeni hedefe geçer.
- Seçimi kaldırmak paneli kapatır; yeniden liste seçmek paneli tekrar açar.
- Hedef değişiminde açık aday formu kapanır; devam eden işlem başladığı listeye yazmaya devam eder.

## Uygulama sonucu
- [x] Task 1 uygulandı; yeni testlerde RED → GREEN doğrulandı.
- [x] Web testleri 137/137; typecheck, production build ve diff kontrolü başarılı.
- [x] Bağımsız son inceleme: engelleyici bulgu yok.
- [x] Mevcut kullanıcı değişiklikleri korundu; commit oluşturulmadı.
- [ ] Tarayıcıda oturumlu uçtan uca kontrol yapılmadı. Kök test komutu eksik test DB ayarı ve yerel PostgreSQL bağlantı hataları nedeniyle başarısız; web paketi ayrıca tamamen doğrulandı.

---

### Task 1: Kaynak/hedef panelini mevcut düzenleyiciye bağla

**Files:**
- Modify: `web/src/App.tsx` — `Lists`, panel, oluşturma/düzenleme hedefi ve başlığa kaydırma.
- Modify: `web/src/i18n.ts` — mevcut anahtar yoksa TR/EN seçim kaldırma etiketi.
- Modify only if necessary: `web/src/design.css` — mevcut split/başlık stilini koruyan dar kapsamlı hizalama.
- Test: `web/src/sharing.test.ts`.

**Interfaces:**
- Consumes: `Lists` mevcut props; `api.addEntry(targetId, candidateId, sourceListId?)`, `api.editListEntry`, `api.reorder`, `api.removeEntry`; mevcut `OrderedEntries` props.
- Produces: Değişmeyen dış arayüz; salt okunur kaynak ve seçili hedef düzenleyicisi.

- [ ] **Step 1: Regresyon testlerini yaz.** Mevcut mount/elements düzeniyle sol kaynak ve sağ hedef bölümünü, dropdown'un sağ kolonda olduğunu ve seçim değişince hedef entries/context değerlerini doğrula. Oluşturulan adayın yeni hedefe eklendiğini, kaynak ekleme işleminin sourceListId taşıdığını, hedef edit/remove/reorder işlemlerinin doğru liste kimliğini kullandığını doğrula. Sahip olunan private/public listelerin eski CatalogPane akışını, hedef liste yokluğunu, formun hedef değişiminde kapanmasını, seçim kaldırma title/aria-label ve panel kapanması/başlığa scroll/yeniden açılmasını test et.
- [ ] **Step 2: Testleri kırmızı doğrula.** `pnpm --dir web test -- src/sharing.test.ts`; yeni panel beklentileri mevcut kodda FAIL olmalı.
- [ ] **Step 3: En küçük uygulamayı yap.** `Lists` içinde kaynak seçimini ayrı tut, düzenleme hedefini seçili hedef listeye bağla ve aynı mevcut düzenleyiciyi kullan. Kaynak başlığına sağa dayalı kapatma ikonu ekle; ref ile sayfa başlığına kaydır. Hedef değişiminde açık aday formlarını kapat; oluşturma işleminde liste kimliğini async çağrıdan önce belirle. Kendi liste dalının davranışını değiştirme.
- [ ] **Step 4: Doğrula.** `pnpm --dir web test` ve `pnpm --dir web typecheck` PASS olmalı. Mümkünse tarayıcıda ortak liste seçimi, hedef değiştirme, aday oluşturma, kapatma/scroll ve dar ekran düzenini kontrol et; yapılmayan kontrolü raporla.
- [ ] **Step 5: Diff incele.** Yalnızca bu görevin değişikliklerini gözden geçir; ilgisiz çalışma ağacı değişikliklerini koru ve sonuçları bildir. Kullanıcı istemedikçe commit oluşturma.

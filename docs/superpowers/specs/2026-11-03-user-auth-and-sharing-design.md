# Kullanıcı girişi, sahiplik ve tanıtım sayfası

Durum: Kullanıcı tarafından onaylandı. Seçilen yaklaşım: mevcut Express API ve PostgreSQL içinde kimlik yönetimi.

## Amaç ve kapsam

Uygulama yalnızca oturum açmış kullanıcılar tarafından kullanılacak. Açılış/tanıtım sayfası ile giriş, kayıt ve hesap kurtarma uçları herkese açık olacak. Kullanıcılar kendi hazırlıklarını ve savaşlarını yönetecek; yalnızca aday, aday listesi ve savaş alanı kütüphanesindeki kayıtlarını isterlerse diğer giriş yapmış kullanıcılarla paylaşabilecek.

Bu, API, depolama katmanı, veritabanı şeması, arayüz, testler ve dağıtım ayarlarını kapsayan bir proje değişikliğidir. Çok kullanıcılı eşzamanlı Divan, yönetici paneli, abonelik, profil düzenleme ve hesap silme bu kapsamda değildir.

## Yaklaşımlar

1. Yönetilen kimlik sağlayıcısı: daha az kimlik güvenliği kodu, fakat harici servis bağımlılığı. Önerildi ancak seçilmedi.
2. Mevcut API ve PostgreSQL: kimlikler ve oturumlar mevcut altyapıda; daha fazla güvenlik sorumluluğu. Kullanıcının seçimi.

Mevcut React/Vite, Express, pg ve Vercel dağıtımı korunur. Kimlik güvenliği için gereken bağımlılıklar dışında yeni altyapı eklenmez; kriptografik protokol elle yazılmaz.

## Kimlik ve oturum

- Tek kompakt hesap ekranında Giriş/Kayıt geçişi ve Google ile giriş bulunur. Şifremi unuttum aynı ekran ailesinde ek bir durumdur; e-postadaki bağlantı yeni şifre formunu açar.
- Kayıtta kullanıcı adı, e-posta ve şifre gerekir. Giriş tek bir kullanıcı adı/e-posta alanı ve şifreyle yapılır. Kullanıcı adı normalleştirilmiş, büyük/küçük harften bağımsız benzersiz ASCII kimliğidir; e-posta ile belirsizliği önlemek için @ içermez. E-posta da normalleştirilmiş olarak benzersizdir.
- Şifreler geri çözülebilir şifreleme ile değil, kullanıcı başına rastgele salt ve sürümlenmiş maliyet parametreleri içeren güvenli bir şifre hash'iyle tutulur. Node crypto scrypt ilk tercihtir; maliyet ve eşzamanlılık sunucusuz ortamın bellek/zaman bütçesinde doğrulanır. Şifreler 12–128 karakterdir, kırpılmaz ve loglanmaz.
- Yerel kayıt e-posta doğrulama bağlantısıyla etkinleşir; doğrulama bekleme ve yeniden gönderme aynı kompakt ekrandadır. Doğrulama öncesinde uygulama verilerine erişilmez. Google'ın doğrulanmış e-posta kimliği bu adımı karşılar.
- Oturum, yüksek entropili opak rastgele belirteç ve sunucu tarafında yalnızca hash'inin saklanmasıyla kurulur. Tarayıcıda HttpOnly, production ortamında Secure, SameSite=Lax, Path=/ çerezi kullanılır; localStorage'a kimlik belirteci konmaz. Oturum 7 gün sonunda sona erer. Çıkış mevcut oturumu, şifre sıfırlama kullanıcının tüm oturumlarını geçersiz kılar.
- Durum değiştiren uçlarda CSRF koruması uygulanır; beklenen Origin ve oturuma bağlı CSRF belirteci doğrulanır. Giriş/kayıt uçları da çapraz site isteğine açık bırakılmaz. Geliştirmede izinli tek frontend origin'i ve credentials destekli CORS kullanılır.
- Giriş, kayıt, sıfırlama, doğrulama gönderimi ve OAuth girişlerinde IP/hesap bazlı, sunucusuz örnekler arasında ortak PostgreSQL destekli hız sınırlaması vardır. Hesap varlığını açıklamayan mesajlar, sabit zamanlı hash karşılaştırması ve olmayan hesap için eşdeğer hash işi kullanılır.
- Şifre sıfırlama ve doğrulama belirteçleri rastgele, süreli, tek kullanımlı ve veritabanında hash olarak tutulur; tüketim atomiktir. Sıfırlama bağlantısı 30 dakika, doğrulama bağlantısı 24 saat geçerlidir. Belirteçler loglara veya uygulama dışı referrer'a sızdırılmaz. Posta gönderimi başarısızsa kullanıcıya hesap varlığını açıklamayan yeniden deneme bilgisi gösterilir; sahte başarı akışı kurulmaz.

## Google ve e-posta entegrasyonu

- Google için sunucu taraflı authorization-code/OIDC akışı, state, nonce ve PKCE kullanılır. İmza, issuer, audience, süre, nonce ve doğrulanmış e-posta kontrolü bakımlı bir kütüphane ile yapılır. Google kimliği e-postayla değil issuer/subject ile eşlenir.
- Aynı e-postalı mevcut hesaba sessiz otomatik bağlama yapılmaz. Kullanıcı önce mevcut hesabıyla giriş yapar; hesap ekranındaki Google bağlama işlemi güncel kimlik doğrulaması gerektirir. Google ile açılan hesapta benzersiz kullanıcı adı otomatik üretilir; ek kayıt sayfası gerekmez. Yalnız Google kullanan doğrulanmış hesap, sıfırlama akışıyla yerel şifre belirleyebilir.
- Uygulama kalıcı Google erişim/yenileme belirteçleri istemez veya saklamaz; yalnız kimlik doğrulama kapsamları kullanılır.
- E-posta gönderimi için implementer seçimi: yapılandırılabilir SMTP ve bakımlı SMTP istemcisi. SMTP/Google sırları, uygulama adresi ve izinli origin dağıtım ortamından sağlanır. Veritabanında veya repoda servis sırrı tutulmaz. Ortam yapılandırılmadığında ilgili özellik açıklayıcı şekilde kullanılamaz; gizli geliştirme bypass'ı yoktur.
- Bu tasarım depodaki şifre/oturum/sıfırlama sırlarının açık saklanmasını önler; uygulamanın okuması gereken e-posta ve kayıt içeriklerini hash'leyerek kullanılamaz hale getirmez. Trafikte TLS, diskte şifreleme ve yedek güvenliği barındırma ayarlarıyla doğrulanmalıdır.

## Sahiplik ve paylaşım

- candidates, candidate_lists, battlefields ve auctions tablolarında zorunlu owner_user_id bulunur. İlk üçünde is_public varsayılan false olur. Auction alt kayıtlarının yetkisi üst auction sahibinden türetilir.
- Listeleme ve seçim alanları varsayılan yalnız benim kayıtlarım şeklindedir. Her alanın bağımsız, varsayılan kapalı “Herkese açık olanları da göster” checkbox'ı, benim kayıtlarım ile diğerlerinin public kayıtlarının birleşimini getirir; tekrar üretmez.
- Oluşturma/düzenleme ekranlarındaki “Tüm kullanıcılarla paylaş” checkbox'ı yalnız sahibine açıktır. Başkasının paylaşılan kaydında düzenleme, arşivleme, silme, sıralama, paylaşım değiştirme gibi işlemler bulunmaz; API de reddeder. Paylaşılan kaydı kendi listesinde/taslağında kullanmak mümkündür. Var olan kopyalama işlemi yeni kaydı mevcut kullanıcıya ait ve özel üretir.
- Public listeyi okuma/kullanma, listenin o anki adaylarını ve görsellerini de gerektirir. Özel alt adayların katalog kaydı veya sahipliği public yapılmaz; listeye bağlı salt okunur gösterim verilir. Kullanıcının erişebildiği liste/auction bağlamı dışında bu adayın doğrudan detay/görsel adresi erişim vermez. Bağlamsız public aday görünürlüğü yalnız adayın kendi public bayrağına bağlıdır.
- Dış kaynaklardan seçilen public içerik, kullanıcının kendi listesine/auction'ına alındığında kullanılan sürümüyle korunur. Kaynak sahibinin arşivlemesi, düzenlemesi veya paylaşımı kapatması daha önce kurulmuş referansları ve savaş geçmişini bozmaz; fakat yeni seçimlerde kaynağı erişilemez yapar. Private hale gelen kaydın yeni sürümleri bu eski erişimden görünmez. Gerektiğinde mevcut copy-on-edit/snapshot örüntüsü kullanılır; ADR-0001 korunur. Başkasının listesini takip eden taslak otomatik kaynak değişikliği takibi yerine oluşturulduğu anda bağımsızlaştırılır; kendi listelerini takip eden taslaklar mevcut davranışını korur.
- Kendi listesinde başkasından seçilmiş adayı düzenleme mevcut kopyalama davranışıyla kendi özel adayını oluşturur; kaynak kaydı değiştirmez. Paylaşılan listedeki başka kullanıcı adayının görünür sürümünü kendi listesine almak da bu yetkili bağlam üzerinden yapılır.
- Güncel Taslak, Divan, Savaşın sonucu ve mevcut auction liste/klonlama/ekip/bakiye/teklif/undo/görsel uçları yalnız auction sahibine açıktır. Public auction seçeneği yoktur.
- Yetki yalnız istemci düğmelerine dayanmaz: her okuma, yazma, görsel ve iç içe kaynak isteği API/repository sınırında kullanıcı bağlamıyla denetlenir. Kullanıcı kimliği istek gövdesinden alınmaz. Başkasının özel kaydı yokmuş gibi 404, oturumsuz API isteği 401 döner. Foreign-key referansları da erişim kontrolünden geçer.
- Kullanıcı değişiminde önceki kullanıcının state/cache/seçimleri temizlenir. API 401 alınırsa özel ekran boşaltılır ve girişe dönülür. Özel yanıtlar ve görseller public cache'e girmez.

## Mevcut verilerin geçişi

- Kullanıcının izniyle tek bir legacy sahip hesabı oluşturulur; tekrarlanabilir geçiş ikinci bir hesap yaratmaz. Bu hesap otomatik ayrıcalıklı yönetici değildir.
- Güvenli varsayılan: legacy hesap başlangıçta devre dışı/oturum açılamaz durumdadır, tahmin edilebilir veya ortak bir şifresi yoktur. Gerçek operatöre devretme gerekiyorsa e-posta adresi deployment sırasında güvenli provisioning komutuyla bağlanır, doğrulama/sıfırlama bağlantısıyla erişim açılır. Açık şifre çıktı olarak dahi üretilmez. Bu implementer önerisidir.
- Sahipsiz adaylar, aday listeleri ve savaş alanları bu hesaba atanır ve public yapılır. Mevcut auctions, ekipler, Divan ve sonuçlar aynı hesapta özel kalır; bu, ilk istekteki açık gizlilik şartını korur. Tarihçe ve görseller silinmez.
- Yeni kayıtlar özel başlar. Geçiş tekrar çalışınca yeni kullanıcı kayıtlarının sahibi veya paylaşımı değiştirilmez. Sahiplik backfill tamamlandıktan sonra NOT NULL, foreign-key ve indeksler uygulanır.
- Dağıtım bakım penceresinde yapılır: önce yedek ve doğrulanmış migration, sonra yeni API/UI birlikte açılır. Eski yetkisiz API'nin geçiş sonrasında erişilebilir kalmasına izin verilmez. Migration başarısızlığı transaction'ı geri alır; eski sürüme dönüşte korumasız API yeniden açılmaz.

## Tanıtım ve hesap arayüzü

- / açılış sayfası herkese açıktır; uygulamaya giriş CTA'sı oturum varsa uygulamaya, yoksa hesap ekranına götürür. Mevcut tab query bağlantıları girişten sonra güvenli aynı-origin hedefe döner; dış yönlendirme kabul edilmez.
- Kısa vurucu hero; Adaylarını seç → takımları kur → Divan'ı yönet → sonucu göster anlatımı; en fazla üç kontrollü demo ekran görüntüsü; diğer kartlarda ikonlar. Gerçek kullanıcı verisi ekran görüntülerinde kullanılmaz.
- Scroll ile kademeli görünme ve bir sticky anlatım bölümü; hover/focus ile küçük etkileşimler. Yerel CSS ve IntersectionObserver tercih edilir, animasyon kütüphanesi eklenmez. Mobilde sade dikey akış, prefers-reduced-motion ile hareketsiz alternatif, klavye ve ekran okuyucu desteği şarttır.
- Mevcut görsel dil ve Türkçe/İngilizce çeviri düzeni korunur. Yükleme, boş liste, hata, oturum süresi dolması ve servis yapılandırılmamış durumları tasarımın parçasıdır.
- Nihai yerleşim, ikon seçimi ve metin detayları implementer'a bırakılır. Kullanıcı isterse uygulama öncesinde tarayıcıda görsel taslak sunulur.

## Etkilenen yerler ve doğrulama

- db/schema.sql ve geçiş/provisioning araçları; API kimlik modülü/middleware, PgStore ve battlefield/team/live repository'leri; standalone ve Vercel giriş noktaları; tüm route/asset kontrolleri.
- web/src/api.ts istek/çerez/CSRF yönetimi ve DTO'lar; App, katalog/liste, battlefield, draft/ekip, Divan ve sonuç ekranları; hesap ve landing stilleri/çevirileri. Mevcut test fixture'ları kullanıcı sahipliğiyle güncellenir; testler için production bypass eklenmez.
- Testler: kayıt/giriş/çıkış, e-posta doğrulama, kullanıcı adı/e-posta çakışmaları, hash ve oturum saklama, geçersiz/eskimiş/tekrar kullanılan token, tüm oturumları iptal, CSRF, hız sınırı, Google state/nonce/issuer/audience ve hesap bağlama reddi.
- İki kullanıcıyla private/public okuma-yazma matrisi; URL/ID manipülasyonu, görsel ve iç içe kaynak sızıntıları, public liste içindeki private adaylar, paylaşımı kapatılmış/arşivlenmiş kaynakların eski referansları, kopyalama ve ADR-0001 tarihçe davranışı; tekrar çalıştırılan legacy geçişi.
- Typecheck, mevcut ve yeni testler, production build; tarayıcıda mobil/masaüstü hesap akışları, checkbox varsayılanları, oturum değişimi ve landing reduced-motion kontrolü.
- Gerçek Google ve SMTP uçtan uca doğrulaması dağıtım sırları sağlandığında yapılır. Sağlanmazsa mock/protokol testlerinin geçtiği, canlı entegrasyonun doğrulanmadığı açıkça raporlanır. Kimlik sırları ve token'lar log/fixture/commit içine girmez.

## Onay bekleyen kararlar

Seçilen API-içi yaklaşım onaylandı. Bu belgenin tamamı, legacy hesabının başlangıçta kilitli olması, mevcut auctions'ın özel kalması ve yerel kayıtta e-posta doğrulaması dahil uygulamaya geçmeden önce kullanıcı onayına sunulur.

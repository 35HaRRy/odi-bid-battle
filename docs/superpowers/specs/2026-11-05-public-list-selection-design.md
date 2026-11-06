# Herkese açık aday listesi seçim paneli

## Amaç ve kapsam
Başkasına ait herkese açık aday listesi seçildiğinde kaynak ve hedef listeyi yan yana göster. Kullanıcının kendi listesini seçtiği mevcut katalog/düzenleyici akışı değişmez.

## Onaylanan düzen
- Sol kolon kaynak listenin başlığını ve salt okunur adaylarını, hedefe ekleme kontrolleriyle gösterir.
- Başlığın sağındaki erişilebilir ikon butonunun title metni Türkçede `Seçimi kaldır` olur. Buton seçim panelini kapatır ve `Aday Listeleri` başlığına kaydırır.
- Sağ kolonun üstünde `Hedef listem` dropdown'u, altında seçilen kullanıcı listesinin mevcut aday düzenleyicisi yer alır. Dropdown yalnızca kullanıcının listelerini içerir; mevcut varsayılan hedef seçimi korunur.
- Dropdown değiştiğinde altındaki adaylar ve tüm düzenleme işlemlerinin hedefi değişir.
- `Yeni aday oluştur ve ekle` butonu korunur; oluşturulan aday seçili hedef listeye eklenir.
- Hedef liste yoksa kaynak okunabilir kalır; hedefe yazma/aday oluşturma sunulmaz.

## Yaklaşım
Mevcut `Lists` ve `OrderedEntries` bileşenlerini yeniden kullanmak seçildi: en küçük değişiklik, mevcut API ve izin kontrollerini korur. Ayrı bir ekran/bileşen ağacı eklemek aynı düzenleme mantığını çoğaltacağı için tercih edilmedi.

## Kısıtlar ve kapsam dışı
Backend, veri modeli ve bağımlılıklar değişmez. Kaynak liste düzenlenmez. Mevcut TR/EN çeviri ve responsive stiller kullanılır. Genel sayfa tasarımı ve hesap kabuğu değişiklikleri kapsam dışıdır.

## Uygulayıcı kararları
Mevcut sahiplik denetimi yeni akışın sınırıdır. Hedef seçimindeki varsayılan private-first davranış korunur. Açık aday düzenleme/oluşturma formu liste değişiminde kapatılarak yanlış listeye kayıt riski önlenir.

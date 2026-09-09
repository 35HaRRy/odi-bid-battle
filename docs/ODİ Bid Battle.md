# ODİ Bid Battle

Açık artırma takip ve sunum uygulamasıdır. Adaylar açık artırmaya çıkar. 2 taraf bulunur ve taraflar adaylara vererek adayları kendi listelerine eklerler. Uygulama, tek bir kullanıcının kontrolü ile bu sürecin görselleştirilip takip edilmesini sağlar. Bunu yaparken dikkat edilmesi gerekenler şöyle:

- Uygulama 2 kısımdan oluşur. İlki tanımlamalardır. [2.si](http://2.si) de açık artırma sürecidir.

#### Tanımlamalarda olması gerekenler

1. Açık artırma aday listesi oluşturma
    1. Listeye daha önce tanımlanmış aday eklenebilir, olan düzenlenerek eklenebilir veya yeni bir aday oluşturulup düzenlenebilinir.
    2. Aday oluşturma ekranı: adayın ismi ve görseli tanımlanıp düzenlenebilinir.
    3. Adayların listedeki sıralamaları değiştirilebilinir.
    4. Listedeki aday sayısı 4 ve 4’ten fazla çift sayıda olmalı.
2. Savaş alanı tanımlama: adı, görseli, coğrafi özellikleri ve tarihi geçmişi ile tanımlanıp düzenlenebilinir.
3. Açık artırma tanımlama: Yeni bir açık artırma başlatılmak istendiğinde şu adımlar takip edilir:
    1. Savaş alanı seçilir
    2. Tanımlı açık artırma aday listelerinden biri seçilir. 
    3. İstenirse seçili açık artırma aday listesinde her türlü değişiklik yapılır. Listede yapılan ilk değişiklik ile beraber seçili liste tüm bilgileri ile kopyalanarak yeni bir aday listesi oluşturulur. Yapılan ilk değişiklik ve bundan sonraki tüm değişiklikler bu listeye kaydedilir. Oluşturulan yeni listenin adı değiştirilebilinir.
    4. Seçili açık artırma aday listesinde yapılabilecek değişiklikler şöyle: aday çıkarma, aday düzenleme (düzenlenen aday yeni bir eleman olarak tanımlanır), yeni bir aday ekleme ve adayların sırasını değiştirme.
    5. Takım belirleme adımları:
        1. 2 tane takım tanımlamak için paneller gösterilir
        2. Takımın adı, bayrağı ve sloganı tanımlanıp düzenlenebilir. Toplam altın alanı takım üyelirinin altınları toplanarak hesaplanır.
        3. Takım panellerinden istenen miktarda üye tanımlanır
        4. Her bir takımda da en az 1 üye olmak zorundadır
        5. Üye bir panelden diğerine taşınabilir
        6. Üye tanımlanıp düzenlenebilir: adı, avatar (opsiyonel),  sahip olduğu başlangıç altın miktarı (varsayılan değer 10)

#### Açık artırma adımları ve olması gerekenler

1. Açık artırma tanımlanıp açık artırmayı başlat dendiğinde bu ekrana geçilir.
2. Ekranda gözükmesi gerekenler
    1. Takımlar: bayrakları, sloganları, kalan toplam altın miktarları ve aktif açık artırma altın teklifi
    2. Takımlar ile beraber üyeleri: adları, varsa avatarları, kalan altın miktarları ve aktif açık artırma altın teklifi
    3. Takımlar ile beraber kazandıkları adaylar: adları, satıın alındıkları altın miktarı
    4. Açık artırmadaki aktif aday ve görseli
    5. Son teklif veren takım ve teklif miktarı
3. Bu ekran ilk açıldığında sadece takımlar gözükür. Kullanıcı “Sıradaki adayı gönder” dediğinde açık artırma aday listesinden sırasıyla ilk aday gelir.
4. Açık artırma başlatıldığında ilk teklif verecek takım, tanımlama ekranlarında panel 1’de tanımlanmış takım olmalı
5. Sıradaki teklifi verecek takım belirtilmeli
6. Her yeni adaya teklif vermeye geçildiğinde teklif verecek ilk takım değişmeli
7. “Teklif verme süreci” nde sıra onlardayken takımın verdiği teklif o takımın üyelerinin verdiği altınların toplamı kadardır
8. Bu ekranın arka planı şu görsel “” olmalı. Bu görsel açık artırma aday listesinin ilk yarısının sonundaki eleman bir takıma gönderildiğinde açık artırmaya tanımlanmış savaş alanının göreseli ile değiştirilmeli.

#### Kullanıcının açık artırma sürecinde ekranda yapabilecekleri

- “Sıradaki adayı gönder” diyebilir ve teklif süreci başlar:
    1. Aktif aday herhangi bir takıma gönderilmeden bu süreç ilerletilemez
    2. Açık artırma aday listesinde sıradaki aday getirilir
    3. Aktif aday görseli ekrana yerleşir
    4. Son teklif veren takım alanı gösterilmez
    5. Sıradaki teklif verecek takım belirtilir → takımın üyelerinin aktif açık artırma altın teklifi alanları düzenlenebilir olur. Bu alanların başlangıç değeri 0 dır.
- “Teklif verme süreci” ni yönetir:
    1. Kullanıcı teklif verecek takımın üyelerinin aktif açık artırma altın teklifi alanlarını düzenleyerek hangi üyenin kaç altın vereceğini belirler
    2. Hiçbir üye kalan altın miktarından fazla teklifte bulunamaz
    3. Teklif vermeyen üye bulunabilir
    4. Takım üyelerinin aktif açık artırma altın teklifi miktarı hesaplanıp takımın aktif açık artırma altın teklifi alanına yazılır
    5. Kullanıcı “Takım için teklif verme sürecini tamamla” der. 
        1. Adaya teklif verecek takım sıfırdan büyük bir değer ile teklif vermek zorundadır. İlk teklifi sıradaki teklifi verecek takım pas geçemez
        2. Takımın toplam aktif açık artırma altın teklifi son tekliften yüksek değilse herhangi bir işlem yapılmaz ve hata gösterilir
        3. Değer yüksekse sıradaki adıma geçilir
    6. Teklif verme sırası diğer takıma geçer
        1. Teklifi vermiş takımın üyelerinin aktif açık artırma altın teklifi alanları tekrar label olur. Artık bu alanlar düzenlenemezdir.
        2. Sıradaki teklif verecek takım diğer olacağı için bu takımın üyelerinin aktif açık artırma altın teklifi alanları düzenlenebilir olur
        3. “Son teklif veren takım” ile “Sıradaki teklif verecek takım” metinleri ilgili değerler ile güncellenir
        4. Takım A teklif verip sırayı B'ye devrettiğinde, sıra tekrar A'ya döndüğünde A'nın üyelerinin aktif açık artırma altın teklifi alanlarının değerleri korunur. Sadece bu alanlar güncellenebilir olur.
- “Aktif adayın açık artırmasını tamamla” diyebilir:
    1. Aday son teklifi vermiş takımın listesine gider
    2. Aday, aktif aday görselinden kaldırılır ve yeni aday gelmez
    3. Açık artırmayı kazanmış takımın değerleri hesaplanır
        1. Takım aktif açık artırma altın teklifi değeri temizlenir
        2. Üyelerin verdikleri altın, sahip oldukları miktardan düşer
        3. Üyelerin aktif açık artırma altın teklifi değeri temizlenir
        4. Takımın kalan toplam altın miktarı hesaplanıp güncellenir
    4. Açık artırmayı kaybeden takımın değerleri hesaplanır
        1. Takımın aktif açık artırma altın teklifi değeri temizlenir
        2. Üyelerin sahip oldukları kalan altın miktarı değiştirilmez
        3. Üyelerin aktif açık artırma altın teklifi değeri temizlenir
    5. “Son teklif veren takım” ile “Sıradaki teklif verecek takım” metinleri kaldırılır
    6. Aday listesinde henüz gösterilmemiş aday varsa “Sıradaki adayı gönder” butonu gösterilir.
    7. Son aday da bir takıma gönderildiğinde “Savaş başlasın” butonu aktif olur
- “Savaş başlasın” butonunu kullanabilir
    1. Yeni bir ekrana geçilir
    2. Bu ekranda karşılıklı takımlar yerleşir.
    3. Takım isimleri, bayrakları ve sloganları altına takımların satın aldığı adaylar görselleri ile listelenir
# EsoCAD - Web CAD & GIS Platformu (JavaScript & Canvas / WebGL)

NCZ ve CBS (GIS) ekosisteminin tüm yeteneklerini modern HTML5, CSS3 ve saf ES6+ JavaScript ile web ortamına taşıyan yüksek performanslı CAD & GIS platformu.

## Özellikler

1. **NCZ Binary Parser (`NczScanner.js`)**:
   - Little-Endian NCZ binary blok ayrıştırma motoru
   - Point, Line, Polyline, Polygon, Circle, Arc, Text, Symbol, Pafta ve Smart Object çözümleri
   - Türkçe karakter kodlama (ISO-8859-9 / Windows-1254) desteği
   - Tabaka tablosu, Varsayılan kapalı tabakaları (LEX.ST8 / LEX.ST2) ve tabaka renkleri

2. **2D CAD & Harita Motoru (`CadView.js`)**:
   - Pürüzsüz kamera animasyonları (`easeOutCubic`)
   - Görünüm Geçmişi (Zoom Önceki / Sonraki - `Ctrl+Z` / `Ctrl+Y`)
   - Hedef Radar Beacon Reticle ile Koordinata Uçuş
   - Kuşbakışı Navigasyon (Minimap)
   - Dinamik Türkiye Standart Pafta ve Metrik Ölçek Çubuğu (1/500, 1/1000, 1/5000 vb.)
   - Orta fare tuşu (Wheel Click Drag Pan), Spacebar Hand Tool ve dokunmatik pinch-to-zoom
   - Akıllı Snap Motoru (Köşe, Orta, Kesişim, Dik, Yakın)
   - Parsel kenar uzunluklarını yazdırma & Köşe / Kenar / Semt (gon) tablosu

3. **GIS & Uydu Entegrasyonu**:
   - Türkiye Projeksiyonları: ITRF96 (TM27, TM30, TM33, TM36), ED50 ve UTM
   - Çoklu Altlık: Google Hibrit, Google Saf Uydu, Google Arazi (Terrain), Esri Ortofoto, CartoDB Koyu
   - Yük dengelemeli (mt0-mt3) hızlı karo motoru ve çift kademeli piramit önizleme
   - Google Earth KML ve CBS GeoJSON dışa aktarma

4. **TKGM Canlı MEGSİS Parsel Motoru**:
   - İl, İlçe, Mahalle, Ada, Parsel canlı sorgulama ve doğrudan haritaya çizim
   - Kalıcı Parsel Hafızası (LocalStorage) ve CAD (DXF) indirme


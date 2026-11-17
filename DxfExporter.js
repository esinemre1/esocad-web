/**
 * DxfExporter.js
 * Netcad NCZ Geometrilerini ve Tabakalarını AutoCAD DXF (R2000 / AC1015) Formatına Dönüştürücü
 */

// Netcad RGB renklerini en yakın AutoCAD Renk İndeksine (ACI 1-255) eşler
function rgbToAci(rgbStr) {
  if (!rgbStr) return 7; // Varsayılan Beyaz
  let r = 255, g = 255, b = 255;
  const m = rgbStr.match(/\d+/g);
  if (m && m.length >= 3) {
    r = parseInt(m[0], 10);
    g = parseInt(m[1], 10);
    b = parseInt(m[2], 10);
  }

  // Standart AutoCAD 7 Temel Renk Eşleşmesi
  if (r > 200 && g < 80 && b < 80) return 1;   // Kırmızı
  if (r > 200 && g > 200 && b < 80) return 2; // Sarı
  if (r < 80 && g > 180 && b < 80) return 3;  // Yeşil
  if (r < 80 && g > 200 && b > 200) return 4; // Camgöbeği (Cyan)
  if (r < 80 && g < 80 && b > 200) return 5;  // Mavi
  if (r > 200 && g < 80 && b > 200) return 6; // Magenta
  if (r > 200 && g > 200 && b > 200) return 7;// Beyaz
  if (r < 100 && g < 100 && b < 100) return 8;// Gri
  return 7;
}

export function exportEntitiesToDxf(entities, layers = [], layerColors = []) {
  const lines = [];

  // DXF Başlığı
  lines.push("0", "SECTION", "2", "HEADER");
  lines.push("9", "$ACADVER", "1", "AC1015"); // AutoCAD 2000
  lines.push("0", "ENDSEC");

  // Tabakalar Tablosu (TABLES - LAYER)
  lines.push("0", "SECTION", "2", "TABLES");
  lines.push("0", "TABLE", "2", "LAYER");
  lines.push("70", String(Math.max(1, layers.length)));

  const distinctLayers = new Set();
  entities.forEach(e => distinctLayers.add(e.layer));

  // Katman tanımlarını yaz
  layers.forEach((name, idx) => {
    const layerName = (name && name.trim().length > 0) ? name.trim().replace(/[\s\/\\\:\*\?\"\<\>\|]/g, "_") : `TABAKA_${idx}`;
    const aci = rgbToAci(layerColors[idx]);
    lines.push("0", "LAYER");
    lines.push("2", layerName);
    lines.push("70", "0");
    lines.push("62", String(aci)); // Renk
    lines.push("6", "CONTINUOUS");  // Çizgi tipi
  });

  // Eğer tabaka listesinde olmayan katman varsa ekle
  for (const lIdx of distinctLayers) {
    if (!layers[lIdx]) {
      lines.push("0", "LAYER");
      lines.push("2", `TABAKA_${lIdx}`);
      lines.push("70", "0");
      lines.push("62", "7");
      lines.push("6", "CONTINUOUS");
    }
  }

  lines.push("0", "ENDTAB");
  lines.push("0", "ENDSEC");

  // Geometriler Bölümü (ENTITIES)
  lines.push("0", "SECTION", "2", "ENTITIES");

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const layerName = (layers[e.layer] && layers[e.layer].trim().length > 0)
      ? layers[e.layer].trim().replace(/[\s\/\\\:\*\?\"\<\>\|]/g, "_")
      : `TABAKA_${e.layer}`;

    if (!e.points || e.points.length === 0) continue;

    switch (e.kind) {
      case "Point": {
        const p = e.points[0];
        lines.push("0", "POINT");
        lines.push("8", layerName);
        lines.push("10", p.x.toFixed(4)); // X = Easting
        lines.push("20", p.y.toFixed(4)); // Y = Northing
        lines.push("30", (p.z || 0).toFixed(4));
        if (e.text && e.text.trim().length > 0) {
          // Nokta Numarası / Adı Metni
          lines.push("0", "TEXT");
          lines.push("8", layerName);
          lines.push("10", (p.x + 0.5).toFixed(4));
          lines.push("20", (p.y + 0.5).toFixed(4));
          lines.push("30", (p.z || 0).toFixed(4));
          lines.push("40", "1.5"); // Metin Yüksekliği
          lines.push("1", e.text.trim());
        }
        break;
      }

      case "Line": {
        if (e.points.length < 2) break;
        const p1 = e.points[0];
        const p2 = e.points[1];
        lines.push("0", "LINE");
        lines.push("8", layerName);
        lines.push("10", p1.x.toFixed(4));
        lines.push("20", p1.y.toFixed(4));
        lines.push("30", (p1.z || 0).toFixed(4));
        lines.push("11", p2.x.toFixed(4));
        lines.push("21", p2.y.toFixed(4));
        lines.push("31", (p2.z || 0).toFixed(4));
        break;
      }

      case "Polyline":
      case "Polygon": {
        if (e.points.length < 2) break;
        const isClosed = (e.kind === "Polygon");
        lines.push("0", "LWPOLYLINE");
        lines.push("8", layerName);
        lines.push("90", String(e.points.length));
        lines.push("70", isClosed ? "1" : "0"); // 1 = Closed, 0 = Open
        for (let j = 0; j < e.points.length; j++) {
          const pt = e.points[j];
          lines.push("10", pt.x.toFixed(4));
          lines.push("20", pt.y.toFixed(4));
        }
        break;
      }

      case "Circle": {
        const center = e.points[0];
        const rad = Math.max(0.01, e.radius || 1);
        lines.push("0", "CIRCLE");
        lines.push("8", layerName);
        lines.push("10", center.x.toFixed(4));
        lines.push("20", center.y.toFixed(4));
        lines.push("30", (center.z || 0).toFixed(4));
        lines.push("40", rad.toFixed(4));
        break;
      }

      case "Arc": {
        const center = e.points[0];
        const rad = Math.max(0.01, e.radius || 1);
        // NCZ stores angles in radians CCW from +X axis. AutoCAD expects degrees 0..360.
        const startDeg = (((e.startAngle || 0) * 180.0 / Math.PI) % 360 + 360) % 360;
        const endDeg = (((e.endAngle || 0) * 180.0 / Math.PI) % 360 + 360) % 360;
        lines.push("0", "ARC");
        lines.push("8", layerName);
        lines.push("10", center.x.toFixed(4));
        lines.push("20", center.y.toFixed(4));
        lines.push("30", (center.z || 0).toFixed(4));
        lines.push("40", rad.toFixed(4));
        lines.push("50", startDeg.toFixed(2));
        lines.push("51", endDeg.toFixed(2));
        break;
      }

      case "Text": {
        const p = e.points[0];
        const textStr = (e.text || "").trim();
        if (textStr.length === 0) break;
        const h = Math.max(0.2, e.textHeight || 2.0);
        lines.push("0", "TEXT");
        lines.push("8", layerName);
        lines.push("10", p.x.toFixed(4));
        lines.push("20", p.y.toFixed(4));
        lines.push("30", (p.z || 0).toFixed(4));
        lines.push("40", h.toFixed(2));
        lines.push("1", textStr);
        if (e.rotation) {
          lines.push("50", e.rotation.toFixed(2));
        }
        break;
      }

      case "Symbol":
      case "Block": {
        const p = e.points[0];
        // Sembol merkezine küçük bir işaret ve ad
        lines.push("0", "POINT");
        lines.push("8", layerName);
        lines.push("10", p.x.toFixed(4));
        lines.push("20", p.y.toFixed(4));
        lines.push("30", (p.z || 0).toFixed(4));
        if (e.text && e.text.trim().length > 0) {
          lines.push("0", "TEXT");
          lines.push("8", layerName);
          lines.push("10", (p.x + 0.3).toFixed(4));
          lines.push("20", (p.y + 0.3).toFixed(4));
          lines.push("30", (p.z || 0).toFixed(4));
          lines.push("40", "1.2");
          lines.push("1", e.text.trim());
        }
        break;
      }
    }
  }

  lines.push("0", "ENDSEC");
  lines.push("0", "EOF");

  return lines.join("\r\n");
}

/**
 * Netcad Koordinat Cetveli (CSV / Excel formatında Y, X, Z)
 */
export function exportEntitiesToCsv(entities, layers = []) {
  const rows = [];
  rows.push(["SIRA_NO", "TABAKA", "GEOMETRI_TIPI", "NOKTA_ADI", "Y_SAGA_EASTING", "X_YUKARI_NORTHING", "Z_KOT"].join(";"));

  let rowNum = 1;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const layerName = layers[e.layer] || `Tabaka_${e.layer}`;
    if (!e.points) continue;

    for (let j = 0; j < e.points.length; j++) {
      const p = e.points[j];
      const ptName = e.text ? `${e.text}_${j + 1}` : `N_${rowNum}`;
      rows.push([
        rowNum++,
        `"${layerName}"`,
        e.kind,
        `"${ptName}"`,
        p.x.toFixed(3).replace(".", ","),
        p.y.toFixed(3).replace(".", ","),
        (p.z || 0).toFixed(3).replace(".", ",")
      ].join(";"));
    }
  }

  return "\uFEFF" + rows.join("\r\n"); // UTF-8 BOM ile Excel uyumlu
}

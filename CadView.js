/**
 * CadView.js - High-Performance Web CAD View Engine with Satellite Layer & Projection Support
 */

export class CadView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    // Enums
    this.FillMode = { NONE: 0, SOLID: 1, HATCH: 2 };
    this.QueryMode = {
      SELECT: "SELECT",
      AREA: "AREA",
      FREE_AREA: "FREE_AREA", // Serbest Çokgen Alanı Ölçümü
      LENGTH: "LENGTH",
      DISTANCE: "DISTANCE",
      POLYLINE: "POLYLINE",
      ANGLE: "ANGLE", // 3 Nokta ile Kırıklık Açısı (° / gon)
      PERPENDICULAR: "PERPENDICULAR", // Hatta Dik Ayak - Dik Boy Ölçümü
      COORDINATE: "COORDINATE",
      POINT_CAPTURE: "POINT_CAPTURE",
      LENGTH_LABEL: "LENGTH_LABEL"
    };

    // State
    this.entities = [];
    this.layers = [];
    this.layerColors = [];
    this.meta = [];
    this.hidden = new Set();
    this.hiddenTextLayers = new Set(); // Tabaka bazlı yazı/alan/numara gizleme kümesi
    this.hiddenPointNameLayers = new Set(); // Tabaka bazlı nokta adı/numarası gizleme kümesi
    this.lockedLayers = new Set();
    this.isolateState = null;
    this.selected = null;

    this.fillMode = this.FillMode.NONE;
    this.showAreas = true; // Drawing Texts (Sokak, ada, plan notları)
    this.showPointNames = true; // Nokta Adları / Numaraları (Açılır/Kapanır)
    this.textScale = 1.0; // Çizim Metinleri ve Nokta Adları Boyut Çarpanı (0.6x - 2.5x)
    this.showPoints = false;
    this.showElevations = false; // Z Kot Değerlerini Göster
    this.showEdgeLengths = false;
    this.topologyErrors = []; // Kapanmayan parsel ve açık uç hataları
    this.queryMode = this.QueryMode.SELECT;
    this.performanceMode = false;
    this.theme = "light"; // Varsayılan: Modern Beyaz & Turuncu CAD Teması

    // Viewport & Transform
    this.zoom = 1.0;
    this.ox = 0;
    this.oy = 0;
    this.minX = 0;
    this.maxX = 1;
    this.minY = 0;
    this.maxY = 1;
    this.maxZoom = 50000;

    // View History Stack (Zoom Önceki / Sonraki)
    this.viewHistory = [];
    this.viewHistoryIndex = -1;
    this.historyDebounceTimer = null;
    this.isHistoryNavigating = false;

    // Animated Camera (Yumuşak Kamera Uçuşu)
    this.animatingCamera = false;
    this.cameraAnimId = null;

    // Target Beacon (Koordinata Git Radar Efekti)
    this.activeBeacon = null;

    // Minimap Engine (Kuşbakışı Navigasyon)
    this.minimapCanvas = null;
    this.minimapCtx = null;
    this.minimapDragging = false;
    this.showMinimap = true;

    // Projection & Satellite Tile Engine (Açılışta Tam Türkiye Görünümü & Google Hibrit)
    this.projection = "ITRF33"; // Açılışta standart ulusal ITRF96 / TM33
    this.satelliteEnabled = true;
    this.satelliteProvider = 'google-hybrid'; // Google Hibrit Uydu ve Yol Katmanı
    this.satelliteOpacity = 0.90;
    this.tileCache = new Map();
    this.maxTileCache = 500;
    this.loadingTiles = new Set();
    this.failedTiles = new Map(); // url -> fail timestamp
    this.tileRenderTimer = null;
    this.activeTileRequests = 0;
    this.maxConcurrentTileRequests = 6;
    this.lastMinimapDraw = 0;
    this.navUpdateScheduled = false;

    this.snapEnabled = true;
    this.snapKinds = new Set(["KÖŞE", "ORTA", "KESİŞİM", "DİK", "YAKIN"]);
    this.measurePts = [];
    this.measureHoverPt = null;
    this.measureFinished = false;
    this.savedPoints = [];
    this.lengthLabels = [];
    this.snapHit = null;
    this.draggedMeasureGrip = null; // { type: 'vertex'|'midpoint', index: number }
    this.hoverMeasureGrip = null; // Fare altındaki tutamaç
    this.setbackPreview = null; // İmar Çekme Mesafesi Canlı Önizleme Nesnesi

    this.zoomWindow = false;
    this.zoomWindowStart = null;
    this.zoomWindowNow = null;

    this.boxSelect = false;
    this.boxSelectStart = null;
    this.boxSelectNow = null;

    this.lastWorldX = null;
    this.lastWorldY = null;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Spatial Grid for instant snap & hit testing with 100k+ entities
    this.spatialGrid = new Map();
    this.gridCellSize = 50;

    // Callbacks
    this.onSelectionChanged = null;
    this.onMeasureInfo = null;
    this.onNavigationInfo = null;
    this.onCoordUpdate = null;

    this.palette = [
      "rgb(255,170,55)",
      "rgb(80,200,255)",
      "rgb(110,220,130)",
      "rgb(255,110,130)",
      "rgb(210,150,255)",
      "rgb(255,220,90)",
      "rgb(100,230,220)"
    ];

    this.setupEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.requestRender();
  }

  setEntities(entities, layers = [], colors = [], layerVisibility = []) {
    this.entities = entities;
    this.layers = layers;
    this.layerColors = colors;
    this.layerVisibility = layerVisibility;
    this.hidden.clear();

    // Respect default closed/hidden layer states
    if (layerVisibility && layerVisibility.length > 0) {
      for (let i = 0; i < layers.length; i++) {
        if (layerVisibility[i] === false) {
          this.hidden.add(i);
        }
      }
    }
    this.selected = null;
    this.hiddenTextLayers = new Set();
    this.hiddenPointNameLayers = new Set();
    this.lengthLabels = [];
    this.measurePts = [];
    this.computeBounds();

    const totalPts = entities.reduce((acc, e) => acc + (e.points ? e.points.length : 0), 0);
    this.performanceMode = entities.length > 5000 || totalPts > 100000;

    if (this.performanceMode) {
      this.fillMode = this.FillMode.NONE;
      this.showPoints = false;
      this.showEdgeLengths = false;
    }

    this.rebuildSpatialIndex();

    this.viewHistory = [];
    this.viewHistoryIndex = -1;
    this.focusOnTurkey(false);
    this.preloadTurkeyTiles();
  }

  rebuildSpatialIndex() {
    this.computeBounds();
    const span = Math.max(this.maxX - this.minX, this.maxY - this.minY);
    this.gridCellSize = Math.max(10, span / 60);
    this.spatialGrid.clear();

    this.meta = this.entities.map((e, idx) => {
      const ps = e.points || [];
      const ar = (e.kind === "Polygon") ? this.calcArea(ps) : 0.0;
      const per = (e.kind === "Polygon") ? this.calcPerimeter(ps) : 0.0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let sumX = 0, sumY = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        sumX += p.x;
        sumY += p.y;
      }
      if (ps.length === 0) {
        minX = maxX = minY = maxY = 0;
      }

      const m = {
        idx,
        e,
        minX, maxX, minY, maxY,
        area: ar,
        perimeter: per,
        cx: ps.length ? sumX / ps.length : 0,
        cy: ps.length ? sumY / ps.length : 0
      };

      this.insertToGrid(m);
      return m;
    });
  }

  insertToGrid(m) {
    const cs = this.gridCellSize;
    const gx0 = Math.floor(m.minX / cs);
    const gx1 = Math.floor(m.maxX / cs);
    const gy0 = Math.floor(m.minY / cs);
    const gy1 = Math.floor(m.maxY / cs);

    if ((gx1 - gx0) * (gy1 - gy0) > 40) {
      const key = `${Math.floor(m.cx / cs)},${Math.floor(m.cy / cs)}`;
      if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
      this.spatialGrid.get(key).push(m);
      return;
    }

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx},${gy}`;
        let list = this.spatialGrid.get(key);
        if (!list) {
          list = [];
          this.spatialGrid.set(key, list);
        }
        list.push(m);
      }
    }
  }

  queryGrid(x, y, radius) {
    const cs = this.gridCellSize;
    const gx0 = Math.floor((x - radius) / cs);
    const gx1 = Math.floor((x + radius) / cs);
    const gy0 = Math.floor((y - radius) / cs);
    const gy1 = Math.floor((y + radius) / cs);

    const results = new Set();
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const list = this.spatialGrid.get(`${gx},${gy}`);
        if (list) {
          for (let i = 0; i < list.length; i++) {
            results.add(list[i]);
          }
        }
      }
    }
    return Array.from(results);
  }

  computeBounds() {
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
    let found = false;
    for (const e of this.entities) {
      if (!e.points) continue;
      for (let i = 0; i < e.points.length; i++) {
        const p = e.points[i];
        found = true;
        if (p.x < loX) loX = p.x;
        if (p.x > hiX) hiX = p.x;
        if (p.y < loY) loY = p.y;
        if (p.y > hiY) hiY = p.y;
      }
    }
    if (found) {
      this.minX = loX;
      this.maxX = hiX;
      this.minY = loY;
      this.maxY = hiY;
    } else {
      // Türkiye Coğrafi Sınırları (Açılış Standardı - 16:9 Oranlı)
      this.minX = -170000;
      this.maxX = 1530000;
      this.minY = 3840000;
      this.maxY = 4800000;
    }
  }

  bs() {
    if (this.width < 80 || this.height < 80) return 1.0;
    const dx = Math.max(0.001, this.maxX - this.minX);
    const dy = Math.max(0.001, this.maxY - this.minY);
    return Math.min((this.width - 70) / dx, (this.height - 70) / dy);
  }

  sx(x, y) {
    return ((35 + (x - this.minX) * this.bs() - this.width / 2) * this.zoom + this.width / 2 + this.ox);
  }

  sy(x, y) {
    return ((35 + (this.maxY - y) * this.bs() - this.height / 2) * this.zoom + this.height / 2 + this.oy);
  }

  worldAt(px, py) {
    const s = Math.max(0.000001, this.bs());
    const x = this.minX + ((px - this.width / 2.0 - this.ox) / this.zoom + this.width / 2.0 - 35.0) / s;
    const y = this.maxY - ((py - this.height / 2.0 - this.oy) / this.zoom + this.height / 2.0 - 35.0) / s;
    return { x, y, z: 0 };
  }

  // --- VIEW HISTORY & CAMERA ANIMATION ---
  pushViewHistory(force = false) {
    if (this.isHistoryNavigating) return;

    const current = { zoom: this.zoom, ox: this.ox, oy: this.oy };
    if (!force && this.viewHistory.length > 0 && this.viewHistoryIndex >= 0) {
      const last = this.viewHistory[this.viewHistoryIndex];
      const dz = Math.abs(last.zoom - current.zoom);
      const dp = Math.hypot(last.ox - current.ox, last.oy - current.oy);
      if (dz < 0.005 && dp < 2.0) return; // Değişim çok ufaksa kaydetme
    }

    if (this.historyDebounceTimer) clearTimeout(this.historyDebounceTimer);
    const doPush = () => {
      // Eğer geçmişte geri gidilmişse ve yeni işlem yapıldıysa ileri tarafı kes
      if (this.viewHistoryIndex < this.viewHistory.length - 1) {
        this.viewHistory = this.viewHistory.slice(0, this.viewHistoryIndex + 1);
      }
      this.viewHistory.push(current);
      if (this.viewHistory.length > 35) {
        this.viewHistory.shift();
      }
      this.viewHistoryIndex = this.viewHistory.length - 1;
    };

    if (force) {
      doPush();
    } else {
      this.historyDebounceTimer = setTimeout(doPush, 350);
    }
  }

  canZoomPrevious() {
    return this.viewHistoryIndex > 0;
  }

  canZoomNext() {
    return this.viewHistoryIndex < this.viewHistory.length - 1;
  }

  zoomPrevious() {
    if (!this.canZoomPrevious()) return false;
    this.viewHistoryIndex--;
    const state = this.viewHistory[this.viewHistoryIndex];
    this.isHistoryNavigating = true;
    this.animateTo(state.zoom, state.ox, state.oy, 260, () => {
      this.isHistoryNavigating = false;
    });
    return true;
  }

  zoomNext() {
    if (!this.canZoomNext()) return false;
    this.viewHistoryIndex++;
    const state = this.viewHistory[this.viewHistoryIndex];
    this.isHistoryNavigating = true;
    this.animateTo(state.zoom, state.ox, state.oy, 260, () => {
      this.isHistoryNavigating = false;
    });
    return true;
  }

  animateTo(targetZoom, targetOx, targetOy, duration = 280, callback = null) {
    if (this.cameraAnimId) {
      cancelAnimationFrame(this.cameraAnimId);
      this.cameraAnimId = null;
    }

    const startZoom = this.zoom;
    const startOx = this.ox;
    const startOy = this.oy;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      // easeOutCubic: 1 - pow(1 - t, 3)
      const ease = 1.0 - Math.pow(1.0 - progress, 3);

      this.zoom = startZoom + (targetZoom - startZoom) * ease;
      this.ox = startOx + (targetOx - startOx) * ease;
      this.oy = startOy + (targetOy - startOy) * ease;

      this.navUpdate();
      this.requestRender();

      if (progress < 1.0) {
        this.cameraAnimId = requestAnimationFrame(step);
      } else {
        this.zoom = targetZoom;
        this.ox = targetOx;
        this.oy = targetOy;
        this.cameraAnimId = null;
        this.navUpdate();
        this.requestRender();
        this.pushViewHistory();
        if (callback) callback();
      }
    };

    this.cameraAnimId = requestAnimationFrame(step);
  }

  fitToScreen(animate = true) {
    this.zoomWindow = false;
    this.zoomWindowStart = null;
    this.zoomWindowNow = null;
    if (animate && this.zoom !== 1.0) {
      this.animateTo(1.0, 0, 0, 300);
    } else {
      this.zoom = 1.0;
      this.ox = 0;
      this.oy = 0;
      this.navUpdate();
      this.requestRender();
      this.pushViewHistory();
    }
  }

  zoomAt(fx, fy, factor, animate = false) {
    const old = this.zoom;
    const next = Math.min(Math.max(0.01, this.zoom * factor), this.maxZoom);
    if (next === old) return;
    const r = next / old;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const targetOx = (fx - cx) - ((fx - cx) - this.ox) * r;
    const targetOy = (fy - cy) - ((fy - cy) - this.oy) * r;

    if (animate) {
      this.animateTo(next, targetOx, targetOy, 220);
    } else {
      this.zoom = next;
      this.ox = targetOx;
      this.oy = targetOy;
      this.navUpdate();
      this.requestRender();
      this.pushViewHistory();
    }
  }

  zoomIn() { this.zoomAt(this.width / 2, this.height / 2, 1.45, true); }
  zoomOut() { this.zoomAt(this.width / 2, this.height / 2, 1 / 1.45, true); }

  zoomToBounds(x0, x1, y0, y1, animate = true) {
    const w = Math.max(0.001, x1 - x0);
    const h = Math.max(0.001, y1 - y0);
    const base = Math.max(0.000001, this.bs());
    const targetZoom = Math.min(Math.max(0.01, Math.min((this.width * 0.85) / (w * base), (this.height * 0.85) / (h * base))), this.maxZoom);
    const cx = (x0 + x1) / 2.0;
    const cy = (y0 + y1) / 2.0;
    const projectCx = (this.minX + this.maxX) / 2.0;
    const projectCy = (this.minY + this.maxY) / 2.0;
    const targetOx = -((cx - projectCx) * base * targetZoom);
    const targetOy = ((cy - projectCy) * base * targetZoom);

    if (animate) {
      this.animateTo(targetZoom, targetOx, targetOy, 320);
    } else {
      this.zoom = targetZoom;
      this.ox = targetOx;
      this.oy = targetOy;
      this.navUpdate();
      this.requestRender();
      this.pushViewHistory();
    }
  }

  zoomToSelected() {
    if (!this.selected || !this.selected.points || !this.selected.points.length) return false;
    const ps = this.selected.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.zoomToBounds(minX, maxX, minY, maxY, true);
    return true;
  }

  // Tabakaya Odaklan (Zoom to Layer)
  zoomToLayer(layerIndex) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let count = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.layer !== layerIndex || !e.points || e.points.length === 0) continue;
      for (let j = 0; j < e.points.length; j++) {
        const p = e.points[j];
        count++;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (count === 0) return false;
    // Tabakayı görünür yap
    this.setLayerVisible(layerIndex, true);
    this.zoomToBounds(minX, maxX, minY, maxY, true);
    return true;
  }

  // Koordinata Git (Zoom to Coordinate with Pulse Beacon Radar)
  zoomToCoordinate(worldX, worldY, zoomFactor = null, label = "Hedef Nokta") {
    const base = Math.max(0.000001, this.bs());
    let targetZoom = zoomFactor;
    if (!targetZoom) {
      // Makul bir detay seviyesi: ~100m görüş alanı
      targetZoom = Math.min(this.maxZoom, Math.max(12.0, (this.width / (100 * base))));
    }

    const projectCx = (this.minX + this.maxX) / 2.0;
    const projectCy = (this.minY + this.maxY) / 2.0;
    const targetOx = -((worldX - projectCx) * base * targetZoom);
    const targetOy = ((worldY - projectCy) * base * targetZoom);

    // Radar Beacon başlat
    this.activeBeacon = {
      x: worldX,
      y: worldY,
      label: label,
      startTime: performance.now(),
      duration: 3800 // 3.8 saniye sürecek parıldama efekti
    };

    this.animateTo(targetZoom, targetOx, targetOy, 350, () => {
      this.requestRender();
    });
    return true;
  }

  startZoomWindow() {
    this.zoomWindow = true;
    this.zoomWindowStart = null;
    this.zoomWindowNow = null;
    if (this.onMeasureInfo) this.onMeasureInfo("ZOOM PENCERE • Haritada alanı sürükleyin");
  }

  cancelZoomWindow() {
    this.zoomWindow = false;
    this.zoomWindowStart = null;
    this.zoomWindowNow = null;
    this.updateCursor();
    this.requestRender();
  }

  startBoxSelect() {
    this.boxSelect = true;
    this.boxSelectStart = null;
    this.boxSelectNow = null;
    this.canvas.style.cursor = "crosshair";
    if (this.onMeasureInfo) this.onMeasureInfo("KUTU SEÇİMİ • Sol tıkla sürükleyerek seçim alanını belirleyin");
    this.requestRender();
  }

  cancelBoxSelect() {
    this.boxSelect = false;
    this.boxSelectStart = null;
    this.boxSelectNow = null;
    this.updateCursor();
    this.requestRender();
  }

  selectInBox(minX, maxX, minY, maxY) {
    let chosen = null;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (this.hidden.has(e.layer)) continue;
      if (!e.points || e.points.length === 0) continue;

      let inside = false;
      for (let pIdx = 0; pIdx < e.points.length; pIdx++) {
        const p = e.points[pIdx];
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          inside = true;
          break;
        }
      }
      if (inside) {
        chosen = e;
        if (e.kind === "Polygon") break; // Poligonları öncelikli seç
      }
    }

    if (chosen) {
      this.selected = chosen;
      if (this.onSelectionChanged) {
        this.onSelectionChanged({
          kind: chosen.kind,
          layer: chosen.layer,
          layerName: this.layers[chosen.layer] || `Tabaka ${chosen.layer}`,
          area: chosen.kind === "Polygon" ? this.calcArea(chosen.points) : 0,
          perimeter: chosen.kind === "Polygon" ? this.calcLength(chosen.points, true) : 0,
          pointsCount: chosen.points.length,
          tkgmId: chosen.tkgmId,
          x: chosen.points[0].x,
          y: chosen.points[0].y
        });
      }
      if (this.onMeasureInfo) {
        const desc = chosen.kind === "Polygon" ? `Alan: ${this.calcArea(chosen.points).toFixed(2)} m²` : `${chosen.points.length} nokta`;
        this.onMeasureInfo(`Kutu ile Seçildi • ${this.layers[chosen.layer] || 'Tabaka'} • ${desc}`);
      }
    } else {
      this.clearSelection();
      if (this.onMeasureInfo) this.onMeasureInfo("Kutu içinde seçilecek obje bulunamadı");
    }
  }

  selectAll() {
    if (this.entities.length === 0) {
      if (this.onMeasureInfo) this.onMeasureInfo("Çizimde seçilecek geometri yok");
      return 0;
    }
    const poly = this.entities.find(e => e.kind === "Polygon" && !this.hidden.has(e.layer));
    if (poly) {
      this.selected = poly;
      if (this.onSelectionChanged) {
        this.onSelectionChanged({
          kind: poly.kind,
          layer: poly.layer,
          layerName: this.layers[poly.layer] || `Tabaka ${poly.layer}`,
          area: this.calcArea(poly.points),
          perimeter: this.calcLength(poly.points, true),
          pointsCount: poly.points.length,
          tkgmId: poly.tkgmId,
          allCount: this.entities.length
        });
      }
      if (this.onMeasureInfo) {
        this.onMeasureInfo(`Tüm Çizim Seçildi • Toplam ${this.entities.length.toLocaleString()} obje`);
      }
      this.requestRender();
      return this.entities.length;
    }
    return 0;
  }

  toggleElevations() {
    this.showElevations = !this.showElevations;
    this.requestRender();
    return this.showElevations;
  }

  // Yazı & Nokta Adı Ölçeği Ayarla (0.6x - 2.5x)
  setTextScale(scale) {
    this.textScale = Math.max(0.5, Math.min(3.0, scale));
    this.requestRender();
    return this.textScale;
  }

  cycleTextScale() {
    const scales = [0.8, 1.0, 1.3, 1.7];
    const current = this.textScale || 1.0;
    let nextIdx = 0;
    for (let i = 0; i < scales.length; i++) {
      if (Math.abs(scales[i] - current) < 0.05) {
        nextIdx = (i + 1) % scales.length;
        break;
      }
    }
    return this.setTextScale(scales[nextIdx]);
  }

  findOpenPolygons() {
    this.topologyErrors = [];
    const endpoints = [];

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (this.hidden.has(e.layer)) continue;
      if (e.kind === "Line" && e.points.length >= 2) {
        endpoints.push({ x: e.points[0].x, y: e.points[0].y, layer: e.layer });
        endpoints.push({ x: e.points[1].x, y: e.points[1].y, layer: e.layer });
      } else if (e.kind === "Polyline" && e.points.length >= 2) {
        endpoints.push({ x: e.points[0].x, y: e.points[0].y, layer: e.layer });
        endpoints.push({ x: e.points[e.points.length - 1].x, y: e.points[e.points.length - 1].y, layer: e.layer });
      }
    }

    const eps = 0.05;
    for (let i = 0; i < endpoints.length; i++) {
      const p1 = endpoints[i];
      let matches = 0;
      for (let j = 0; j < endpoints.length; j++) {
        if (i === j) continue;
        const p2 = endpoints[j];
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) <= eps) {
          matches++;
          break;
        }
      }
      if (matches === 0) {
        this.topologyErrors.push(p1);
        if (this.topologyErrors.length >= 50) break;
      }
    }

    this.requestRender();
    return this.topologyErrors.length;
  }

  clearTopologyErrors() {
    this.topologyErrors = [];
    this.requestRender();
  }

  cycleFillMode() {
    if (this.fillMode === this.FillMode.NONE) this.fillMode = this.FillMode.SOLID;
    else if (this.fillMode === this.FillMode.SOLID) this.fillMode = this.FillMode.HATCH;
    else this.fillMode = this.FillMode.NONE;
    this.requestRender();
    return this.fillMode;
  }

  fillModeName() {
    switch (this.fillMode) {
      case this.FillMode.NONE: return "Yok";
      case this.FillMode.SOLID: return "Dolu";
      case this.FillMode.HATCH: return "Taralı";
    }
  }

  setLayerVisible(idx, v) {
    if (v) this.hidden.delete(idx);
    else this.hidden.add(idx);
    this.requestRender();
  }

  setAllLayersVisible(v) {
    this.hidden.clear();
    if (!v) {
      const distinct = new Set(this.entities.map(e => e.layer));
      for (const l of distinct) this.hidden.add(l);
    }
    this.requestRender();
  }

  isLayerVisible(idx) {
    return !this.hidden.has(idx);
  }

  setLayerColor(idx, colorHex) {
    if (!this.layerColors) this.layerColors = [];
    this.layerColors[idx] = colorHex;
    this.requestRender();
  }

  toggleLayerLock(idx) {
    if (this.lockedLayers.has(idx)) {
      this.lockedLayers.delete(idx);
      return false;
    } else {
      this.lockedLayers.add(idx);
      return true;
    }
  }

  isLayerLocked(idx) {
    return this.lockedLayers.has(idx);
  }

  // Tabaka Bazlı Yazı / Parsel No / Nokta Adı Aç/Kapat
  toggleLayerText(idx) {
    if (this.hiddenTextLayers.has(idx)) {
      this.hiddenTextLayers.delete(idx);
      this.requestRender();
      return true; // Yazılar açık
    } else {
      this.hiddenTextLayers.add(idx);
      this.requestRender();
      return false; // Yazılar kapalı
    }
  }

  isLayerTextVisible(idx) {
    return !this.hiddenTextLayers.has(idx);
  }

  setAllLayerTextsVisible(v) {
    this.hiddenTextLayers.clear();
    if (!v) {
      const distinct = new Set(this.entities.map(e => e.layer));
      for (const l of distinct) this.hiddenTextLayers.add(l);
    }
    this.requestRender();
  }

  // Tabaka Bazlı Nokta Adı / Numarası Aç/Kapat (Ayrı Ayrı Yönetim)
  toggleLayerPointNames(idx) {
    if (this.hiddenPointNameLayers.has(idx)) {
      this.hiddenPointNameLayers.delete(idx);
      this.requestRender();
      return true; // Bu tabakanın nokta adları açık
    } else {
      this.hiddenPointNameLayers.add(idx);
      this.requestRender();
      return false; // Bu tabakanın nokta adları kapalı
    }
  }

  isLayerPointNamesVisible(idx) {
    return !this.hiddenPointNameLayers.has(idx);
  }

  setAllLayerPointNamesVisible(v) {
    this.hiddenPointNameLayers.clear();
    if (!v) {
      const distinct = new Set(this.entities.map(e => e.layer));
      for (const l of distinct) this.hiddenPointNameLayers.add(l);
    }
    this.requestRender();
  }

  isolateLayer(idx) {
    if (this.isolateState && this.isolateState.layer === idx) {
      // Önceki duruma geri dön (Restore)
      this.hidden = new Set(this.isolateState.hidden);
      this.isolateState = null;
    } else {
      // Mevcut durumu sakla ve sadece bu tabakayı aç
      this.isolateState = {
        layer: idx,
        hidden: new Set(this.hidden)
      };
      const distinct = new Set(this.entities.map(e => e.layer));
      this.hidden.clear();
      for (const l of distinct) {
        if (l !== idx) this.hidden.add(l);
      }
    }
    this.requestRender();
    return this.isolateState !== null;
  }

  invertLayersVisibility() {
    const distinct = new Set(this.entities.map(e => e.layer));
    const newHidden = new Set();
    for (const l of distinct) {
      if (!this.hidden.has(l)) {
        newHidden.add(l);
      }
    }
    this.hidden = newHidden;
    this.requestRender();
  }

  addNewLayer(name, color = "#58a6ff") {
    if (!this.layers) this.layers = [];
    if (!this.layerColors) this.layerColors = [];
    const newIdx = this.layers.length;
    this.layers.push(name.trim() || `Tabaka ${newIdx}`);
    this.layerColors.push(color);
    this.hidden.delete(newIdx);
    this.requestRender();
    return newIdx;
  }

  selectLayerEntities(layerIdx) {
    let firstPoly = null;
    let count = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.layer === layerIdx) {
        count++;
        if (!firstPoly && e.kind === "Polygon") firstPoly = e;
      }
    }
    if (firstPoly) {
      this.selected = firstPoly;
      if (this.onSelectionChanged) {
        this.onSelectionChanged({
          kind: firstPoly.kind,
          layer: layerIdx,
          layerName: this.layerName(layerIdx),
          area: this.calcArea(firstPoly.points),
          perimeter: this.calcLength(firstPoly.points, true),
          pointsCount: firstPoly.points.length,
          allCount: count
        });
      }
      this.zoomToLayer(layerIdx);
    }
    this.requestRender();
    return count;
  }

  deleteLayerEntities(layerIdx) {
    const initialLen = this.entities.length;
    this.entities = this.entities.filter(e => e.layer !== layerIdx);
    const deletedCount = initialLen - this.entities.length;
    if (this.selected && this.selected.layer === layerIdx) {
      this.clearSelection();
    }
    this.rebuildSpatialIndex();
    this.requestRender();
    return deletedCount;
  }

  layerName(idx) {
    if (this.layers && this.layers[idx] && this.layers[idx].trim().length > 0) {
      return this.layers[idx];
    }
    return `Tabaka ${idx}`;
  }

  layerCounts() {
    const map = new Map();
    for (let i = 0; i < this.entities.length; i++) {
      const l = this.entities[i].layer;
      map.set(l, (map.get(l) || 0) + 1);
    }
    return map;
  }

  setQueryMode(mode) {
    this.queryMode = mode;
    this.measurePts = [];
    this.measureHoverPt = null;
    this.measureFinished = false;
    this.clearSelection();
    this.updateCursor();
    if (this.onMeasureInfo) this.onMeasureInfo(this.queryModeName());
  }

  updateCursor() {
    if (this.isMiddleDragging || (this.isDragging && this.hasMoved)) {
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (this.isSpacePressed) {
      this.canvas.style.cursor = "grab";
      return;
    }
    if (this.zoomWindow || this.boxSelect) {
      this.canvas.style.cursor = "crosshair";
      return;
    }
    if (this.queryMode === this.QueryMode.SELECT) {
      this.canvas.style.cursor = "pointer"; // Seç butonunda net el işareti!
      return;
    }
    if (this.queryMode === this.QueryMode.AREA) {
      this.canvas.style.cursor = "pointer";
      return;
    }
    this.canvas.style.cursor = "crosshair";
  }

  queryModeName() {
    switch (this.queryMode) {
      case this.QueryMode.SELECT: return "Seçim";
      case this.QueryMode.AREA: return "Kapalı Alan";
      case this.QueryMode.FREE_AREA: return "Serbest Çokgen Alanı";
      case this.QueryMode.LENGTH: return "Uzunluk";
      case this.QueryMode.DISTANCE: return "2 Nokta Mesafe";
      case this.QueryMode.POLYLINE: return "Kırık Hat";
      case this.QueryMode.ANGLE: return "3 Nokta Açı Ölçümü";
      case this.QueryMode.PERPENDICULAR: return "Hatta Dik Ayak - Dik Boy";
      case this.QueryMode.COORDINATE: return "Koordinat";
      case this.QueryMode.POINT_CAPTURE: return "Nokta Yakala";
      case this.QueryMode.LENGTH_LABEL: return "Uzunluk Yazdır";
      default: return this.queryMode;
    }
  }

  clearSelection() {
    this.selected = null;
    if (this.onSelectionChanged) this.onSelectionChanged(null);
    this.requestRender();
  }

  clearMeasure() {
    this.measurePts = [];
    this.measureHoverPt = null;
    this.measureFinished = false;
    this.requestRender();
    if (this.onMeasureInfo) this.onMeasureInfo("Ölçüm temizlendi");
  }

  finishMeasure() {
    if (this.queryMode === this.QueryMode.POLYLINE && this.measurePts.length >= 2) {
      this.measureFinished = true;
      this.measureHoverPt = null;
      const total = this.calcLength(this.measurePts, false);
      this.requestRender();
      if (this.onMeasureInfo) {
        this.onMeasureInfo(`✔ KIRIK HAT TAMAMLANDI • ${this.measurePts.length} Nokta • TOPLAM MESAFE: ${total.toFixed(3)} m (Çift tık / Sağ tıkla bitti)`);
      }
      return true;
    } else if (this.queryMode === this.QueryMode.FREE_AREA && this.measurePts.length >= 3) {
      this.measureFinished = true;
      this.measureHoverPt = null;
      const area = this.calcArea(this.measurePts);
      const per = this.calcLength(this.measurePts, true);
      this.requestRender();
      if (this.onMeasureInfo) {
        this.onMeasureInfo(`✔ ÇOKGEN ALANI TAMAMLANDI • ${this.measurePts.length} Köşe • ALAN: ${area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² • ÇEVRE: ${per.toFixed(2)} m`);
      }
      return true;
    }
    return false;
  }

  undoMeasure() {
    if (this.measureFinished) {
      // Eğer ölçüm tamamlanmışsa, tamamlanma kilidini açıp son noktadan devam et
      this.measureFinished = false;
      this.requestRender();
      this.updateMeasureInfo();
      return;
    }
    if (this.measurePts.length > 0) {
      this.measurePts.pop();
      this.requestRender();
      this.updateMeasureInfo();
    }
  }

  // Ölçüm Tutamaçlarını (Vertex Grips ve Midpoint Grips) Algılama
  findMeasureGrip(px, py) {
    if (!this.measurePts || this.measurePts.length === 0) return null;
    const isFreeArea = (this.queryMode === this.QueryMode.FREE_AREA);
    const isPolyline = (this.queryMode === this.QueryMode.POLYLINE);
    if (!isFreeArea && !isPolyline) return null;

    const threshold = 14; // Kolay yakalama için 14px tolerans

    // 1. Önce Köşe (Vertex) Tutamaçlarını Kontrol Et
    for (let i = 0; i < this.measurePts.length; i++) {
      const p = this.measurePts[i];
      const sx = this.sx(p.x, p.y);
      const sy = this.sy(p.x, p.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= threshold) {
        return { type: 'vertex', index: i, pt: p, screenX: sx, screenY: sy, dist: d };
      }
    }

    // 2. Ardından Kenar Orta Noktası (Midpoint) Tutamaçlarını Kontrol Et
    // Serbest çokgende tüm kapalı kenarlar; kırık hatta ardışık kenarlar
    const pts = this.measurePts;
    const edgeCount = isFreeArea ? (pts.length >= 3 ? pts.length : pts.length - 1) : pts.length - 1;

    for (let i = 0; i < edgeCount; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const midWorld = { x: (p1.x + p2.x) / 2.0, y: (p1.y + p2.y) / 2.0 };
      const sx = this.sx(midWorld.x, midWorld.y);
      const sy = this.sy(midWorld.x, midWorld.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= threshold) {
        return { type: 'midpoint', insertIndex: (i + 1), pt: midWorld, screenX: sx, screenY: sy, dist: d };
      }
    }

    return null;
  }

  // Ölçümdeki Bir Noktayı İptal Et / Sil
  deleteMeasurePoint(index) {
    if (!this.measurePts || index < 0 || index >= this.measurePts.length) return false;
    this.measurePts.splice(index, 1);
    this.draggedMeasureGrip = null;
    this.hoverMeasureGrip = null;

    if (this.queryMode === this.QueryMode.FREE_AREA) {
      if (this.measurePts.length < 3) {
        this.measureFinished = false;
        if (this.onMeasureInfo) {
          this.onMeasureInfo(`Köşe silindi. Çokgen için en az 3 köşe gereklidir (${this.measurePts.length} köşe kaldı).`);
        }
      } else {
        const area = this.calcArea(this.measurePts);
        const per = this.calcLength(this.measurePts, true);
        if (this.onMeasureInfo) {
          this.onMeasureInfo(`✔ Köşe silindi (${this.measurePts.length} Köşe) • ALAN: ${area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² • ÇEVRE: ${per.toFixed(2)} m`);
        }
      }
    } else if (this.queryMode === this.QueryMode.POLYLINE) {
      if (this.measurePts.length < 2) {
        this.measureFinished = false;
        if (this.onMeasureInfo) {
          this.onMeasureInfo(`Nokta silindi (${this.measurePts.length} nokta kaldı).`);
        }
      } else {
        const total = this.calcLength(this.measurePts, false);
        if (this.onMeasureInfo) {
          this.onMeasureInfo(`✔ Nokta silindi (${this.measurePts.length} Nokta) • TOPLAM: ${total.toFixed(3)} m`);
        }
      }
    }

    this.requestRender();
    return true;
  }

  clearLengthLabels() {
    this.lengthLabels = [];
    this.requestRender();
    if (this.onMeasureInfo) this.onMeasureInfo("Uzunluk yazıları temizlendi");
  }

  saveCurrentPoint() {
    let p = null;
    if (this.measurePts.length > 0) {
      p = this.measurePts[this.measurePts.length - 1];
    } else if (this.lastWorldX !== null && this.lastWorldY !== null) {
      p = { x: this.lastWorldX, y: this.lastWorldY };
    }
    if (p) {
      this.savedPoints.push({ x: p.x, y: p.y });
      this.requestRender();
      if (this.onMeasureInfo) {
        this.onMeasureInfo(`N${this.savedPoints.length} • Y ${p.y.toFixed(3)} • X ${p.x.toFixed(3)}`);
      }
    }
    return p;
  }

  addSavedPoint(y, x) {
    this.savedPoints.push({ x, y });
    this.requestRender();
    return this.savedPoints.length;
  }

  removeSavedPoint(index) {
    if (index >= 0 && index < this.savedPoints.length) {
      this.savedPoints.splice(index, 1);
      this.requestRender();
    }
  }

  clearSavedPoints() {
    this.savedPoints = [];
    this.requestRender();
  }

  zoomToSavedPoint(index) {
    const p = this.savedPoints[index];
    if (!p) return false;
    const span = Math.max(1.0, Math.max(this.maxX - this.minX, this.maxY - this.minY)) / 40.0;
    this.zoomToBounds(p.x - span, p.x + span, p.y - span, p.y + span);
    return true;
  }

  selectedParcelSummary() {
    const e = this.selected;
    if (!e || e.kind !== "Polygon" || !e.points || e.points.length < 3) return null;
    const a = this.calcArea(e.points);
    const per = this.calcPerimeter(e.points);
    return `Alan ${a.toFixed(2)} m² • Çevre ${per.toFixed(2)} m • ${e.points.length} köşe`;
  }

  drawParcelEdgeLengths(poly = null) {
    const e = poly || this.selected;
    if (!e || e.kind !== "Polygon" || !e.points || e.points.length < 2) return 0;
    this.lengthLabels = [];
    for (let i = 0; i < e.points.length; i++) {
      const a = e.points[i];
      const b = e.points[(i + 1) % e.points.length];
      const mid = { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
      this.lengthLabels.push({
        a, b, mid,
        value: Math.hypot(a.x - b.x, a.y - b.y)
      });
    }
    this.requestRender();
    return this.lengthLabels.length;
  }

  labelSelectedParcelEdges() {
    return this.drawParcelEdgeLengths(this.selected);
  }

  saveSelectedParcelCorners() {
    const e = this.selected;
    if (!e || e.kind !== "Polygon" || !e.points) return 0;
    let pts = e.points;
    if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.001) {
      pts = pts.slice(0, pts.length - 1);
    }
    let added = 0;
    for (const p of pts) {
      if (!this.savedPoints.some(sp => Math.hypot(sp.x - p.x, sp.y - p.y) < 0.001)) {
        this.savedPoints.push({ x: p.x, y: p.y });
        added++;
      }
    }
    this.requestRender();
    return added;
  }

  selectedParcelCornerTable() {
    const e = this.selected;
    if (!e || e.kind !== "Polygon" || !e.points || e.points.length < 3) return null;
    let pts = e.points;
    if (Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.001) {
      pts = pts.slice(0, pts.length - 1);
    }
    let s = "No       Y (Kuzey)     X (Doğu)     Kenar      Semt(g)\n";
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let gon = Math.atan2(dx, dy) * 200.0 / Math.PI;
      if (gon < 0) gon += 400.0;
      const len = Math.hypot(dx, dy);
      s += `N${String(i + 1).padEnd(3)} ${a.y.toFixed(3).padStart(12)} ${a.x.toFixed(3).padStart(12)} ${len.toFixed(3).padStart(9)} ${gon.toFixed(4).padStart(9)}\n`;
    }
    return s.trimEnd();
  }

  calcArea(pts) {
    if (!pts || pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2.0;
  }

  calcLength(pts, closed = false) {
    if (!pts || pts.length < 2) return 0;
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      s += Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    }
    if (closed && pts.length > 2) {
      s += Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    }
    return s;
  }

  calcPerimeter(pts) {
    return this.calcLength(pts, true);
  }

  // İmar Çekme Mesafesi / İç Ofset (Yapı Yaklaşma Sınırı) Hesaplama Motoru
  computePolygonSetback(points, distances) {
    if (!points || points.length < 3) return null;
    const n = points.length;

    // 1. Alan yönünü (Orientation) belirle (Shoelace formülü)
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      signedArea += (a.x * b.y - b.x * a.y);
    }
    const isCCW = (signedArea > 0);

    // 2. Her kenar için içe ötelenmiş doğru denklemini (A*x + B*y + C = 0) kur
    const lines = [];
    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      const ux = dx / len;
      const uy = dy / len;

      // İçeri bakan birim normal vektör (Inward unit normal)
      const nx = isCCW ? -uy : uy;
      const ny = isCCW ? ux : -ux;

      const dist = (Array.isArray(distances) ? (distances[i] !== undefined ? distances[i] : 3.0) : (distances || 3.0));

      // Ötelenmiş doğru üzerindeki bir nokta
      const ox = p1.x + nx * dist;
      const oy = p1.y + ny * dist;

      // Doğru denklemi: Ax + By + C = 0
      const A = nx;
      const B = ny;
      const C = -(nx * ox + ny * oy);

      lines.push({ A, B, C, dist, p1, p2, nx, ny, len });
    }

    if (lines.length < 3) return null;

    // 3. Ardışık doğruların kesişim noktalarını (yeni iç köşeleri) hesapla
    const newPoints = [];
    const numLines = lines.length;
    for (let i = 0; i < numLines; i++) {
      const L1 = lines[(i - 1 + numLines) % numLines];
      const L2 = lines[i];

      const det = L1.A * L2.B - L1.B * L2.A;
      if (Math.abs(det) < 1e-7) {
        newPoints.push({
          x: (L1.p2.x + L2.p1.x) / 2,
          y: (L1.p2.y + L2.p1.y) / 2
        });
      } else {
        const ix = (L1.B * L2.C - L2.B * L1.C) / det;
        const iy = (L2.A * L1.C - L1.A * L2.C) / det;
        newPoints.push({ x: ix, y: iy });
      }
    }

    // 4. Doğrulama: Yeni poligonun alanı pozitif ve orijinal alandan küçük olmalı
    let newSignedArea = 0;
    for (let i = 0; i < newPoints.length; i++) {
      const a = newPoints[i];
      const b = newPoints[(i + 1) % newPoints.length];
      newSignedArea += (a.x * b.y - b.x * a.y);
    }

    const newIsCCW = (newSignedArea > 0);
    const newArea = Math.abs(newSignedArea) / 2.0;
    const origArea = Math.abs(signedArea) / 2.0;

    if (newArea >= origArea || (newSignedArea !== 0 && newIsCCW !== isCCW) || newArea < 1.0) {
      return {
        success: false,
        error: "Girilen çekme mesafeleri parsel boyutunu aşıyor! Parsel içine bina oturumu sığmıyor.",
        origArea,
        newArea: 0,
        taks: 0,
        perimeter: 0,
        points: [],
        lines
      };
    }

    return {
      success: true,
      origArea,
      newArea,
      taks: (newArea / origArea) * 100,
      perimeter: this.calcLength(newPoints, true),
      points: newPoints,
      lines
    };
  }

  // İmar Çekme Önizlemesini Ayarla / Güncelle
  setSetbackPreview(previewData) {
    this.setbackPreview = previewData;
    this.requestRender();
  }

  // İmar Çekme Önizlemesini Temizle
  clearSetbackPreview() {
    this.setbackPreview = null;
    this.requestRender();
  }

  // Hesaplanan Yapı Oturum Alanını Çizime Yeni Bir Tabaka Olarak Kaydet
  commitSetbackAsEntity(setbackData, layerName = "YAPI_YAKLASMA") {
    if (!setbackData || !setbackData.points || setbackData.points.length < 3) return null;

    // Tabakayı bul veya oluştur
    let layerIdx = this.layers.indexOf(layerName);
    if (layerIdx === -1) {
      layerIdx = this.addNewLayer(layerName, "#e11d48"); // CAD yapı yaklaşma rengi
    }

    const newEntity = {
      kind: "Polygon",
      layer: layerIdx,
      points: setbackData.points.map(p => ({ x: p.x, y: p.y })),
      meta: {
        isSetback: true,
        origArea: setbackData.origArea,
        newArea: setbackData.newArea,
        taks: setbackData.taks,
        createdDate: new Date().toISOString()
      }
    };

    this.entities.push(newEntity);
    this.rebuildSpatialGrid();
    this.requestRender();

    return newEntity;
  }

  segmentDistance(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const vv = vx * vx + vy * vy;
    if (vv <= 0.0001) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  screenDistanceToEntity(x, y, e) {
    if (!e.points || e.points.length === 0) return Infinity;
    if (e.points.length < 2) {
      return Math.hypot(this.sx(e.points[0].x, e.points[0].y) - x, this.sy(e.points[0].x, e.points[0].y) - y);
    }
    let best = Infinity;
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i];
      const b = e.points[i + 1];
      best = Math.min(best, this.segmentDistance(x, y, this.sx(a.x, a.y), this.sy(a.x, a.y), this.sx(b.x, b.y), this.sy(b.y)));
    }
    if (e.kind === "Polygon") {
      const a = e.points[e.points.length - 1];
      const b = e.points[0];
      best = Math.min(best, this.segmentDistance(x, y, this.sx(a.x, a.y), this.sy(a.x, a.y), this.sx(b.x, b.y), this.sy(b.y)));
    }
    return best;
  }

  pointInPolygon(px, py, pts) {
    let inside = false;
    let j = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      const xi = this.sx(pts[i].x, pts[i].y);
      const yi = this.sy(pts[i].x, pts[i].y);
      const xj = this.sx(pts[j].x, pts[j].y);
      const yj = this.sy(pts[j].x, pts[j].y);
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 0.00001) + xi)) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  nearestOnSegment(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-18) return a;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    return { x: a.x + t * vx, y: a.y + t * vy, z: 0 };
  }

  intersection(a, b, c, d) {
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(den) < 1e-12) return null;
    const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
    const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: 0 };
  }

  snapPoint(px, py) {
    const raw = this.worldAt(px, py);
    if (!this.snapEnabled) {
      this.snapHit = null;
      return raw;
    }

    const searchRadiusWorld = (28 / (Math.max(0.000001, this.bs()) * this.zoom));
    const candidates = [];
    const segments = [];

    const localMetas = this.queryGrid(raw.x, raw.y, searchRadiusWorld);

    for (let mi = 0; mi < localMetas.length; mi++) {
      const m = localMetas[mi];
      const e = m.e;
      if (this.hidden.has(e.layer) || !this.visible(m) || e.kind === "Text") continue;

      for (let pi = 0; pi < e.points.length; pi++) {
        const p = e.points[pi];
        const d = Math.hypot(this.sx(p.x, p.y) - px, this.sy(p.x, p.y) - py);
        if (this.snapKinds.has("KÖŞE") && d <= 26) {
          candidates.push({ p, kind: "KÖŞE", distance: d });
        }
      }

      if (e.points.length > 1) {
        const n = (e.kind === "Polygon") ? e.points.length : e.points.length - 1;
        for (let i = 0; i < n; i++) {
          const p1 = e.points[i];
          const p2 = e.points[(i + 1) % e.points.length];
          segments.push([p1, p2]);

          const mid = { x: (p1.x + p2.x) / 2.0, y: (p1.y + p2.y) / 2.0 };
          const md = Math.hypot(this.sx(mid.x, mid.y) - px, this.sy(mid.x, mid.y) - py);
          if (this.snapKinds.has("ORTA") && md <= 24) {
            candidates.push({ p: mid, kind: "ORTA", distance: md });
          }

          const near = this.nearestOnSegment(raw, p1, p2);
          const nd = Math.hypot(this.sx(near.x, near.y) - px, this.sy(near.x, near.y) - py);
          if (this.snapKinds.has("YAKIN") && nd <= 18) {
            candidates.push({ p: near, kind: "YAKIN", distance: nd });
          }

          if (this.measurePts.length > 0) {
            const base = this.measurePts[this.measurePts.length - 1];
            const vx = p2.x - p1.x;
            const vy = p2.y - p1.y;
            const seg2 = vx * vx + vy * vy;
            if (seg2 > 1e-12) {
              const t = ((base.x - p1.x) * vx + (base.y - p1.y) * vy) / seg2;
              if (t >= 0 && t <= 1) {
                const foot = { x: p1.x + t * vx, y: p1.y + t * vy };
                const fd = Math.hypot(this.sx(foot.x, foot.y) - px, this.sy(foot.x, foot.y) - py);
                if (this.snapKinds.has("DİK") && fd <= 24) {
                  candidates.push({ p: foot, kind: "DİK", distance: fd });
                }
              }
            }
          }
        }
      }
    }

    const nearby = segments.filter(([p1, p2]) => {
      const d1 = Math.hypot(this.sx(p1.x, p1.y) - px, this.sy(p1.x, p1.y) - py);
      const d2 = Math.hypot(this.sx(p2.x, p2.y) - px, this.sy(p2.x, p2.y) - py);
      const near = this.nearestOnSegment(raw, p1, p2);
      const dn = Math.hypot(this.sx(near.x, near.y) - px, this.sy(near.x, near.y) - py);
      return Math.min(d1, d2) < 60 || dn < 26;
    }).slice(0, 25);

    for (let i = 0; i < nearby.length; i++) {
      for (let j = i + 1; j < nearby.length; j++) {
        const q = this.intersection(nearby[i][0], nearby[i][1], nearby[j][0], nearby[j][1]);
        if (q) {
          const d = Math.hypot(this.sx(q.x, q.y) - px, this.sy(q.x, q.y) - py);
          if (this.snapKinds.has("KESİŞİM") && d <= 24) {
            candidates.push({ p: q, kind: "KESİŞİM", distance: d });
          }
        }
      }
    }

    if (candidates.length > 0) {
      const priority = { "KESİŞİM": 0, "KÖŞE": 1, "DİK": 2, "ORTA": 3, "YAKIN": 4 };
      candidates.sort((a, b) => {
        const pa = priority[a.kind] ?? 5;
        const pb = priority[b.kind] ?? 5;
        if (pa !== pb) return pa - pb;
        return a.distance - b.distance;
      });
      this.snapHit = candidates[0];
      return this.snapHit.p;
    }

    this.snapHit = null;
    return raw;
  }

  visible(m) {
    const l = this.sx(m.minX, m.minY);
    const r = this.sx(m.maxX, m.maxY);
    const t = this.sy(m.minX, m.maxY);
    const b = this.sy(m.maxX, m.minY);
    return r >= -80 && l <= this.width + 80 && b >= -80 && t <= this.height + 80;
  }

  toggleTheme() {
    this.theme = (this.theme === "dark") ? "light" : "dark";
    this.requestRender();
    return this.theme;
  }

  color(layer) {
    const c = (this.layerColors && this.layerColors[layer] !== undefined && this.layerColors[layer] !== null)
      ? this.layerColors[layer]
      : (this.layerColors ? this.layerColors[layer - 1] : null);
    let col = c || this.palette[Math.abs(layer) % this.palette.length];

    // CAD/AutoCAD Color 7 / Dinamik Kontrast Motoru:
    // Koyu ekranda (#15181e) veya uyduda siyah/koyu kalemler görünmez -> CAD Beyazı (#f0f6fc) ve Parlak Mavi (#58a6ff)
    // Beyaz ekranda (#fbfcfd) beyaz çizgiler görünmez -> Koyu füme kalem (#161b22)
    if (col && typeof col === "string") {
      const m = col.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m) {
        const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (this.theme === "light" && !this.satelliteEnabled) {
          if (lum > 225) return "#161b22";
        } else {
          if (lum < 32) {
            if (b > 180 && r < 50 && g < 50) {
              return "#58a6ff";
            }
            return "#f0f6fc";
          }
        }
      } else if (col === "#000000" || col === "#000") {
        return (this.theme === "light" && !this.satelliteEnabled) ? "#161b22" : "#f0f6fc";
      } else if (col === "#ffffff" || col === "#fff") {
        return (this.theme === "light" && !this.satelliteEnabled) ? "#161b22" : "#ffffff";
      }
    }
    return col;
  }

  navUpdate(force = false) {
    if (force) {
      this._doNavUpdate();
      return;
    }
    if (this.navUpdateScheduled) return;
    this.navUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.navUpdateScheduled = false;
      this._doNavUpdate();
    });
  }

  _doNavUpdate() {
    const x = this.lastWorldX; // Easting (CAD Y: Sağa Değer)
    const y = this.lastWorldY; // Northing (CAD X: Yukarı Değer)
    let wgs = null;
    if (x !== null && y !== null && this.projection !== "NONE") {
      wgs = this.toWgs84(x, y);
    }
    if (this.onCoordUpdate) {
      this.onCoordUpdate({ zoom: this.zoom, x, y, wgs });
    }
    if (this.onNavigationInfo) {
      let coordStr = "";
      if (x !== null && y !== null) {
        let wgsStr = wgs ? `  [${wgs.lat.toFixed(5)}°K, ${wgs.lon.toFixed(5)}°D]` : "";
        coordStr = `  •  Y (Sağa): ${x.toFixed(2)}  X (Yukarı): ${y.toFixed(2)}${wgsStr}`;
      }
      this.onNavigationInfo(`ZOOM ${this.zoom.toFixed(2)}x${coordStr}`);
    }
  }

  updateMeasureInfo() {
    const total = this.calcLength(this.measurePts, false);
    if (!this.onMeasureInfo) return;

    if (this.queryMode === this.QueryMode.DISTANCE) {
      if (this.measurePts.length < 2) {
        this.onMeasureInfo("2 Nokta Mesafe • Başlangıç seçildi, bitiş noktasını seçin");
      } else {
        const a = this.measurePts[0];
        const b = this.measurePts[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        let az = Math.atan2(dy, dx) * 200.0 / Math.PI;
        if (az < 0) az += 400.0;
        let dzStr = "";
        if (a.z !== undefined && b.z !== undefined && (a.z !== 0 || b.z !== 0)) {
          const dz = b.z - a.z;
          const slope = d > 0.001 ? ((dz / d) * 100).toFixed(2) : "0.00";
          dzStr = ` • ΔZ ${dz.toFixed(2)} m (%${slope})`;
        }
        this.onMeasureInfo(`ΔY ${dy.toFixed(3)} • ΔX ${dx.toFixed(3)} • D ${d.toFixed(3)} m${dzStr} • Az ${az.toFixed(4)} gon`);
      }
    } else if (this.queryMode === this.QueryMode.POLYLINE) {
      if (this.measurePts.length < 2) {
        this.onMeasureInfo(`Kırık hat • ${this.measurePts.length} nokta (Sonraki noktaya tıklayın)`);
      } else {
        const a = this.measurePts[this.measurePts.length - 2];
        const b = this.measurePts[this.measurePts.length - 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let az = Math.atan2(dy, dx) * 200.0 / Math.PI;
        if (az < 0) az += 400.0;
        this.onMeasureInfo(`Kırık hat • ${this.measurePts.length} nokta • Σ ${total.toFixed(3)} m • Son ${Math.hypot(dx, dy).toFixed(3)} m • ${az.toFixed(4)} gon`);
      }
    } else if (this.queryMode === this.QueryMode.FREE_AREA) {
      if (this.measurePts.length < 3) {
        this.onMeasureInfo(`Serbest Alan • ${this.measurePts.length} nokta seçildi (En az 3 köşe seçin)`);
      } else {
        const area = this.calcArea(this.measurePts);
        const per = this.calcLength(this.measurePts, true);
        this.onMeasureInfo(`📐 Serbest Alan • ${this.measurePts.length} Köşe • Alan: ${area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² • Çevre: ${per.toFixed(2)} m`);
      }
    } else if (this.queryMode === this.QueryMode.ANGLE) {
      if (this.measurePts.length === 1) {
        this.onMeasureInfo("Açı Ölçümü • 1. Nokta seçildi, 2. Tepe (Köşe) noktasını seçin");
      } else if (this.measurePts.length === 2) {
        this.onMeasureInfo("Açı Ölçümü • 2. Tepe noktası seçildi, 3. Bitiş noktasını seçin");
      } else if (this.measurePts.length >= 3) {
        const A = this.measurePts[0];
        const B = this.measurePts[1];
        const C = this.measurePts[2];
        const v1x = A.x - B.x, v1y = A.y - B.y;
        const v2x = C.x - B.x, v2y = C.y - B.y;
        const d1 = Math.hypot(v1x, v1y);
        const d2 = Math.hypot(v2x, v2y);
        if (d1 > 1e-9 && d2 > 1e-9) {
          const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
          const clamped = Math.max(-1.0, Math.min(1.0, dot));
          const rad = Math.acos(clamped);
          const deg = rad * 180.0 / Math.PI;
          const gon = rad * 200.0 / Math.PI;
          this.onMeasureInfo(`📐 Köşe Açısı • α = ${deg.toFixed(4)}° (${gon.toFixed(4)} gon) • BA: ${d1.toFixed(2)} m • BC: ${d2.toFixed(2)} m`);
        }
      }
    } else if (this.queryMode === this.QueryMode.PERPENDICULAR) {
      if (this.measurePts.length === 1) {
        this.onMeasureInfo("Dik Ayak - Dik Boy • Hat başlangıç noktası seçildi, hat bitiş noktasını seçin");
      } else if (this.measurePts.length === 2) {
        this.onMeasureInfo("Dik Ayak - Dik Boy • Hat belirlendi, hatta dik düşülecek noktayı seçin");
      } else if (this.measurePts.length >= 3) {
        const A = this.measurePts[0];
        const B = this.measurePts[1];
        const C = this.measurePts[2];
        const vx = B.x - A.x, vy = B.y - A.y;
        const len2 = vx * vx + vy * vy;
        if (len2 > 1e-9) {
          const t = ((C.x - A.x) * vx + (C.y - A.y) * vy) / len2;
          const H = { x: A.x + t * vx, y: A.y + t * vy };
          const dPerp = Math.hypot(C.x - H.x, C.y - H.y);
          const dPar = t * Math.sqrt(len2);
          this.onMeasureInfo(`📍 Dik Boy: ${dPerp.toFixed(3)} m • Dik Ayak: ${dPar.toFixed(3)} m • H(Y: ${H.x.toFixed(3)}, X: ${H.y.toFixed(3)})`);
        }
      }
    } else {
      this.onMeasureInfo(this.queryModeName());
    }
  }

  // Satellite & Projection Engine
  setProjection(projCode) {
    this.projection = projCode;
    if (projCode !== "NONE" && this.entities.length === 0) {
      this.focusOnProjection();
    }
    this.requestRender();
  }

  toggleSatellite() {
    this.satelliteEnabled = !this.satelliteEnabled;
    this.requestRender();
    return this.satelliteEnabled;
  }

  setSatelliteProvider(provider) {
    this.satelliteProvider = provider;
    this.requestRender();
  }

  setSatelliteOpacity(alpha) {
    this.satelliteOpacity = Math.max(0.1, Math.min(1.0, alpha));
    this.requestRender();
  }

  focusOnProjection() {
    this.focusOnTurkey(false);
  }

  // Türkiye Haritasına ve Coğrafi Sınırlarına Odaklanma (Açılış Standardı)
  focusOnTurkey(animate = false) {
    this.projection = 'ITRF33';
    this.satelliteEnabled = true;
    this.satelliteProvider = 'google-hybrid';
    this.ensureProjDefs();

    // Tüm Türkiye Coğrafi Bounding Box (16:9 Ekran Oranına Tam Uyumlu Merkez Meridyen 33):
    // Merkez: Boylam 35.2° E, Enlem 39.0° N -> Easting: ~680,000 m, Northing: ~4,320,000 m
    // Batı-Doğu Açıklığı: 1,700,000 m (Edirne'den Iğdır'a)
    // Güney-Kuzey Açıklığı: 960,000 m (Hatay'dan Sinop'a)
    const cx = 680000;
    const cy = 4320000;
    const halfW = 850000;
    const halfH = 480000;

    this.minX = cx - halfW; // -170,000
    this.maxX = cx + halfW; // 1,530,000
    this.minY = cy - halfH; // 3,840,000
    this.maxY = cy + halfH; // 4,800,000

    this.zoomWindow = false;
    this.zoomWindowStart = null;
    this.zoomWindowNow = null;

    if (animate) {
      this.animateTo(1.0, 0, 0, 350);
    } else {
      this.zoom = 1.0;
      this.ox = 0;
      this.oy = 0;
      this.navUpdate();
      this.requestRender();
      this.pushViewHistory(true);
    }
  }

  detectProjection() {
    if (this.entities.length === 0) return null;
    const cx = (this.minX + this.maxX) / 2.0; // Easting (CAD Y)
    const cy = (this.minY + this.maxY) / 2.0; // Northing (CAD X)

    // Check Turkey bounding box (Northing: 3.9M - 4.7M, Easting: 200k - 800k)
    if (cy >= 3900000 && cy <= 4700000 && cx >= 200000 && cx <= 800000) {
      this.ensureProjDefs();
      try {
        const p33 = window.proj4('EPSG:7935', 'EPSG:4326', [cx, cy]);
        if (p33 && p33[0] >= 31.5 && p33[0] <= 34.5) return 'ITRF33';
        const p30 = window.proj4('EPSG:7934', 'EPSG:4326', [cx, cy]);
        if (p30 && p30[0] >= 28.5 && p30[0] <= 31.5) return 'ITRF30';
        const p36 = window.proj4('EPSG:7936', 'EPSG:4326', [cx, cy]);
        if (p36 && p36[0] >= 34.5 && p36[0] <= 37.5) return 'ITRF36';
        const p27 = window.proj4('EPSG:7933', 'EPSG:4326', [cx, cy]);
        if (p27 && p27[0] >= 25.5 && p27[0] <= 28.5) return 'ITRF27';
      } catch (e) {}
      return 'ITRF33';
    }
    return null;
  }

  ensureProjDefs() {
    if (typeof window.proj4 === 'undefined') return;
    if (!window.proj4.defs('EPSG:7935')) {
      // ITRF96 / TM (3-degree zones, GRS80 ellipsoid)
      window.proj4.defs('EPSG:7935', '+proj=tmerc +lat_0=0 +lon_0=33 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
      window.proj4.defs('EPSG:7934', '+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
      window.proj4.defs('EPSG:7936', '+proj=tmerc +lat_0=0 +lon_0=36 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
      window.proj4.defs('EPSG:7933', '+proj=tmerc +lat_0=0 +lon_0=27 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs');

      // ED50 / TM (Hayford 1924 / International ellipsoid)
      window.proj4.defs('ED50_TM33', '+proj=tmerc +lat_0=0 +lon_0=33 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121 +units=m +no_defs');
      window.proj4.defs('ED50_TM30', '+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121 +units=m +no_defs');
      window.proj4.defs('ED50_TM36', '+proj=tmerc +lat_0=0 +lon_0=36 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121 +units=m +no_defs');
      window.proj4.defs('ED50_TM27', '+proj=tmerc +lat_0=0 +lon_0=27 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121 +units=m +no_defs');

      // UTM (6-degree zones, WGS84)
      window.proj4.defs('UTM35', '+proj=utm +zone=35 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
      window.proj4.defs('UTM36', '+proj=utm +zone=36 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
      window.proj4.defs('UTM37', '+proj=utm +zone=37 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
    }
  }

  getProjEpsg() {
    switch (this.projection) {
      case 'ITRF30': return 'EPSG:7934';
      case 'ITRF36': return 'EPSG:7936';
      case 'ITRF27': return 'EPSG:7933';
      case 'ED50_TM33': return 'ED50_TM33';
      case 'ED50_TM30': return 'ED50_TM30';
      case 'ED50_TM36': return 'ED50_TM36';
      case 'ED50_TM27': return 'ED50_TM27';
      case 'UTM35': return 'UTM35';
      case 'UTM36': return 'UTM36';
      case 'UTM37': return 'UTM37';
      case 'ITRF33':
      default: return 'EPSG:7935';
    }
  }

  // Convert CAD Easting (X) and Northing (Y) to WGS84 (lon, lat) using Proj4
  toWgs84(worldX, worldY) {
    if (typeof window.proj4 === 'undefined' || this.projection === "NONE") return null;
    this.ensureProjDefs();
    const srcEpsg = this.getProjEpsg();

    try {
      // CAD coords: worldX = Easting (~500,000), worldY = Northing (~4,200,000)
      const res = window.proj4(srcEpsg, 'EPSG:4326', [worldX, worldY]);
      if (isNaN(res[0]) || isNaN(res[1])) return null;
      return { lon: res[0], lat: res[1] };
    } catch (e) {
      return null;
    }
  }

  // Convert WGS84 back to CAD coordinates
  fromWgs84(lon, lat) {
    if (typeof window.proj4 === 'undefined' || this.projection === "NONE") return null;
    this.ensureProjDefs();
    const srcEpsg = this.getProjEpsg();

    try {
      const res = window.proj4('EPSG:4326', srcEpsg, [lon, lat]);
      if (isNaN(res[0]) || isNaN(res[1])) return null;
      return { x: res[0], y: res[1] };
    } catch (e) {
      return null;
    }
  }

  // Convert WGS84 (lon, lat) to Google XYZ Tile coordinates at a given zoom level
  latLonToTile(lat, lon, z) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, z);
    const xtile = ((lon + 180) / 360) * n;
    const ytile = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
    return { x: xtile, y: ytile };
  }

  // Convert Tile coordinate to WGS84
  tileToLatLon(x, y, z) {
    const n = Math.pow(2, z);
    const lon = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lat, lon };
  }

  getTileUrl(tx, ty, z) {
    // Dynamic Google Subdomain Load Balancing (mt0, mt1, mt2, mt3)
    const sub = Math.abs((tx + ty) % 4);

    switch (this.satelliteProvider) {
      case 'google-satellite':
        return `https://mt${sub}.google.com/vt/lyrs=s&x=${tx}&y=${ty}&z=${z}`;
      case 'google-terrain':
        return `https://mt${sub}.google.com/vt/lyrs=p&x=${tx}&y=${ty}&z=${z}`;
      case 'google-roads':
        return `https://mt${sub}.google.com/vt/lyrs=m&x=${tx}&y=${ty}&z=${z}`;
      case 'osm': {
        const osmSub = ['a', 'b', 'c'][Math.abs((tx + ty) % 3)];
        return `https://${osmSub}.tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
      }
      case 'esri':
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      case 'carto-dark': {
        const cSub = ['a', 'b', 'c', 'd'][Math.abs((tx + ty) % 4)];
        return `https://${cSub}.basemaps.cartocdn.com/dark_all/${z}/${tx}/${ty}.png`;
      }
      case 'google-hybrid':
      default:
        return `https://mt${sub}.google.com/vt/lyrs=y&x=${tx}&y=${ty}&z=${z}`;
    }
  }

  scheduleTileRender() {
    if (this.tileRenderTimer) return;
    this.tileRenderTimer = setTimeout(() => {
      this.tileRenderTimer = null;
      this.requestRender();
    }, 65);
  }

  drawSatelliteTiles(ctx) {
    if (!this.satelliteEnabled || this.projection === "NONE") return;

    // Viewport 4 corners in world coordinates
    const c00 = this.worldAt(0, 0);
    const c10 = this.worldAt(this.width, 0);
    const c01 = this.worldAt(0, this.height);
    const c11 = this.worldAt(this.width, this.height);

    const w00 = this.toWgs84(c00.x, c00.y);
    const w10 = this.toWgs84(c10.x, c10.y);
    const w01 = this.toWgs84(c01.x, c01.y);
    const w11 = this.toWgs84(c11.x, c11.y);

    const validWgs = [w00, w10, w01, w11].filter(Boolean);
    if (validWgs.length < 2) return;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const w of validWgs) {
      if (w.lat < minLat) minLat = w.lat;
      if (w.lat > maxLat) maxLat = w.lat;
      if (w.lon < minLon) minLon = w.lon;
      if (w.lon > maxLon) maxLon = w.lon;
    }

    const midLatRad = ((minLat + maxLat) / 2.0) * (Math.PI / 180.0);
    const metersPerPx = 1.0 / (Math.max(0.000001, this.bs()) * this.zoom);
    let tileZoom = Math.round(Math.log2((156543.03 * Math.cos(midLatRad)) / Math.max(0.05, metersPerPx)));
    tileZoom = Math.min(20, Math.max(2, tileZoom));

    let t0 = this.latLonToTile(maxLat, minLon, tileZoom);
    let t1 = this.latLonToTile(minLat, maxLon, tileZoom);

    let minTX = Math.floor(Math.min(t0.x, t1.x));
    let maxTX = Math.ceil(Math.max(t0.x, t1.x));
    let minTY = Math.floor(Math.min(t0.y, t1.y));
    let maxTY = Math.ceil(Math.max(t0.y, t1.y));

    // Dynamic tile count clamping (Kare kare açılmayı ve aşırı karo yığılmasını önler)
    let totalTiles = (maxTX - minTX + 1) * (maxTY - minTY + 1);
    while (totalTiles > 64 && tileZoom > 2) {
      tileZoom--;
      t0 = this.latLonToTile(maxLat, minLon, tileZoom);
      t1 = this.latLonToTile(minLat, maxLon, tileZoom);
      minTX = Math.floor(Math.min(t0.x, t1.x));
      maxTX = Math.ceil(Math.max(t0.x, t1.x));
      minTY = Math.floor(Math.min(t0.y, t1.y));
      maxTY = Math.ceil(Math.max(t0.y, t1.y));
      totalTiles = (maxTX - minTX + 1) * (maxTY - minTY + 1);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = this.satelliteOpacity;

    const tilesToFetch = [];
    const midTX = (minTX + maxTX) / 2;
    const midTY = (minTY + maxTY) / 2;

    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let ty = minTY; ty <= maxTY; ty++) {
        const key = `${this.satelliteProvider}_${tileZoom}_${tx}_${ty}`;
        let img = this.tileCache.get(key);

        // Compute screen coordinates for this tile
        const tlLatLon = this.tileToLatLon(tx, ty, tileZoom);
        const brLatLon = this.tileToLatLon(tx + 1, ty + 1, tileZoom);

        const tlWorld = this.fromWgs84(tlLatLon.lon, tlLatLon.lat);
        const brWorld = this.fromWgs84(brLatLon.lon, brLatLon.lat);

        if (!tlWorld || !brWorld) continue;

        const sx0 = this.sx(tlWorld.x, tlWorld.y);
        const sy0 = this.sy(tlWorld.x, tlWorld.y);
        const sx1 = this.sx(brWorld.x, brWorld.y);
        const sy1 = this.sy(brWorld.x, brWorld.y);

        // Seam-free pixel alignment (sıfır boşluklu karo hizalama)
        const x0 = Math.floor(Math.min(sx0, sx1));
        const y0 = Math.floor(Math.min(sy0, sy1));
        const w = Math.ceil(Math.abs(sx1 - sx0)) + 1;
        const h = Math.ceil(Math.abs(sy1 - sy0)) + 1;

        if (img) {
          ctx.drawImage(img, x0, y0, w, h);
        } else {
          // 1. Fallback: 1-level parent tile while loading
          const parentKey = `${this.satelliteProvider}_${tileZoom - 1}_${tx >> 1}_${ty >> 1}`;
          const parentImg = this.tileCache.get(parentKey);
          if (parentImg) {
            const qx = (tx & 1) * 128;
            const qy = (ty & 1) * 128;
            ctx.drawImage(parentImg, qx, qy, 128, 128, x0, y0, w, h);
          } else {
            // 2. Fallback: 2-level grandparent tile
            const grandKey = `${this.satelliteProvider}_${tileZoom - 2}_${tx >> 2}_${ty >> 2}`;
            const grandImg = this.tileCache.get(grandKey);
            if (grandImg) {
              const gx = ((tx >> 1) & 1) * 128 + (tx & 1) * 64;
              const gy = ((ty >> 1) & 1) * 128 + (ty & 1) * 64;
              ctx.drawImage(grandImg, gx, gy, 64, 64, x0, y0, w, h);
            }
          }

          // Pan / sürükleme esnasında gereksiz HTTP isteklerini dondur (60 FPS koruması)
          if (!this.isDragging && !this.loadingTiles.has(key)) {
            const now = performance.now();
            const lastFail = this.failedTiles.get(key);
            if (!lastFail || (now - lastFail >= 8000)) {
              const dist = Math.hypot(tx - midTX, ty - midTY);
              tilesToFetch.push({ key, tx, ty, z: tileZoom, dist });
            }
          }
        }
      }
    }
    ctx.restore();

    // Merkeze en yakın karoları öncelikli olarak havuz sınırıyla (max 6 paralel) indir
    if (tilesToFetch.length > 0 && !this.isDragging) {
      tilesToFetch.sort((a, b) => a.dist - b.dist);
      for (const item of tilesToFetch) {
        if (this.activeTileRequests >= this.maxConcurrentTileRequests) break;
        if (this.loadingTiles.has(item.key)) continue;

        this.loadingTiles.add(item.key);
        this.activeTileRequests++;
        const tileImg = new Image();
        tileImg.crossOrigin = "anonymous";
        tileImg.src = this.getTileUrl(item.tx, item.ty, item.z);
        tileImg.onload = () => {
          this.activeTileRequests = Math.max(0, this.activeTileRequests - 1);
          this.loadingTiles.delete(item.key);
          this.failedTiles.delete(item.key);

          if (this.tileCache.size > this.maxTileCache) {
            let count = 0;
            for (const k of this.tileCache.keys()) {
              this.tileCache.delete(k);
              if (++count >= 25) break;
            }
          }
          this.tileCache.set(item.key, tileImg);
          this.scheduleTileRender();
        };
        tileImg.onerror = () => {
          this.activeTileRequests = Math.max(0, this.activeTileRequests - 1);
          this.loadingTiles.delete(item.key);
          this.failedTiles.set(item.key, performance.now());
        };
      }
    }
  }

  // Açılışta Türkiye Uydu Karolarını Önceden Yükleme (Kare Kare Açılmayı ve Boşluğu Önler)
  preloadTurkeyTiles() {
    // Zoom 5 seviyesindeki 9 temel Türkiye karosu (tüm ülkeyi tek parça örter)
    const z = 5;
    for (let tx = 18; tx <= 20; tx++) {
      for (let ty = 11; ty <= 13; ty++) {
        const key = `${this.satelliteProvider}_${z}_${tx}_${ty}`;
        if (this.tileCache.has(key) || this.loadingTiles.has(key)) continue;

        this.loadingTiles.add(key);
        const tileImg = new Image();
        tileImg.crossOrigin = "anonymous";
        tileImg.src = this.getTileUrl(tx, ty, z);
        tileImg.onload = () => {
          this.tileCache.set(key, tileImg);
          this.loadingTiles.delete(key);
          this.scheduleTileRender();
        };
        tileImg.onerror = () => {
          this.loadingTiles.delete(key);
        };
      }
    }
  }

  // Export CAD polygons and points to Google Earth KML
  exportKML() {
    if (this.projection === "NONE") {
      alert("KML dışa aktarmak için lütfen önce bir Projeksiyon (örn: ITRF96 / TM33) seçin.");
      return null;
    }
    const polygons = this.entities.filter(e => e.kind === "Polygon" && e.points && e.points.length >= 3);
    const points = this.entities.filter(e => (e.kind === "Point" || (e.points && e.points.length === 1)));

    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>EsoCAD_Proje_KML</name>\n`;
    kml += `    <Style id="polyStyle"><LineStyle><color>ff00ffff</color><width>2</width></LineStyle><PolyStyle><color>4d00ffff</color></PolyStyle></Style>\n`;
    kml += `    <Folder><name>Parseller (Alanlar)</name>\n`;

    for (let i = 0; i < polygons.length; i++) {
      const poly = polygons[i];
      let coords = "";
      for (const pt of poly.points) {
        const wgs = this.toWgs84(pt.x, pt.y);
        if (wgs) coords += `${wgs.lon.toFixed(7)},${wgs.lat.toFixed(7)},0 `;
      }
      const firstWgs = this.toWgs84(poly.points[0].x, poly.points[0].y);
      if (firstWgs) coords += `${firstWgs.lon.toFixed(7)},${firstWgs.lat.toFixed(7)},0`;

      const pName = poly.text || `Parsel ${i + 1}`;
      kml += `      <Placemark><name>${pName}</name><styleUrl>#polyStyle</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>\n`;
    }

    kml += `    </Folder>\n    <Folder><name>Noktalar</name>\n`;
    for (const pt of points) {
      const p = pt.points[0];
      const wgs = this.toWgs84(p.x, p.y);
      if (wgs) {
        const pName = pt.text || `Nokta`;
        kml += `      <Placemark><name>${pName}</name><Point><coordinates>${wgs.lon.toFixed(7)},${wgs.lat.toFixed(7)},0</coordinates></Point></Placemark>\n`;
      }
    }
    kml += `    </Folder>\n  </Document>\n</kml>`;
    return kml;
  }

  // Export to GeoJSON FeatureCollection
  exportGeoJSON() {
    if (this.projection === "NONE") {
      alert("GeoJSON dışa aktarmak için lütfen önce bir Projeksiyon (örn: ITRF96 / TM33) seçin.");
      return null;
    }
    const features = [];
    for (const e of this.entities) {
      if (e.kind === "Polygon" && e.points && e.points.length >= 3) {
        const ring = [];
        for (const pt of e.points) {
          const w = this.toWgs84(pt.x, pt.y);
          if (w) ring.push([Number(w.lon.toFixed(7)), Number(w.lat.toFixed(7))]);
        }
        if (ring.length >= 3) {
          ring.push([...ring[0]]);
          features.push({
            type: "Feature",
            properties: { kind: e.kind, layer: this.layerName(e.layer), name: e.text || "" },
            geometry: { type: "Polygon", coordinates: [ring] }
          });
        }
      } else if (e.kind === "Point" || (e.points && e.points.length === 1)) {
        const p = e.points[0];
        const w = this.toWgs84(p.x, p.y);
        if (w) {
          features.push({
            type: "Feature",
            properties: { kind: "Point", layer: this.layerName(e.layer), name: e.text || "" },
            geometry: { type: "Point", coordinates: [Number(w.lon.toFixed(7)), Number(w.lat.toFixed(7))] }
          });
        }
      }
    }
    return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
  }

  // TKGM MEGSİS Parsel Verisini CAD Çizimine Ekleme ve Odaklanma Motoru
  addTkgmParcel(geojsonData, focus = true) {
    if (!geojsonData) return { success: false, error: "Geçersiz parsel verisi" };

    let feature = null;
    if (geojsonData.type === "Feature") feature = geojsonData;
    else if (geojsonData.features && geojsonData.features.length > 0) feature = geojsonData.features[0];

    if (!feature || !feature.geometry || !feature.geometry.coordinates) {
      return { success: false, error: "Parsel geometrisi bulunamadı" };
    }

    const props = feature.properties || {};
    let ring = feature.geometry.coordinates;
    while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0]) && typeof ring[0][0] !== 'number') {
      ring = ring[0];
    }

    if (!Array.isArray(ring) || ring.length < 3) {
      return { success: false, error: "Geçerli bir parsel poligonu bulunamadı" };
    }

    const flatCoords = ring; // Array of [lon, lat]

    // Ortalama boylamdan Türkiye 3° ITRF96 Dilimini tespit et
    let lonSum = 0;
    flatCoords.forEach(p => { lonSum += p[0]; });
    const avgLon = lonSum / flatCoords.length;

    const zones = [27, 30, 33, 36, 39, 42, 45];
    const cm = zones.reduce((prev, curr) => Math.abs(curr - avgLon) < Math.abs(prev - avgLon) ? curr : prev);
    const targetProjCode = `ITRF${cm}`;

    // Eğer projeksiyon seçilmemişse veya mevcut projeksiyon yoksa, tespit edilen dilime ayarla
    if (this.projection === "NONE") {
      this.setProjection(targetProjCode);
      if (!this.satelliteEnabled) {
        this.satelliteEnabled = true;
      }
    }

    this.ensureProjDefs();
    const projEpsg = this.getProjEpsg() || 'EPSG:7935';

    // WGS84 (Lon, Lat) -> CAD Koordinatlarına Dönüştür (CAD: Y = Easting, X = Northing)
    const cadPoints = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;

    flatCoords.forEach(p => {
      // proj4('EPSG:4326', targetEpsg, [lon, lat]) -> [easting, northing]
      let pr = null;
      try {
        pr = window.proj4('EPSG:4326', projEpsg, [p[0], p[1]]);
      } catch (e) {
        // Fallback custom proj4 def
        const fallbackDef = `+proj=tmerc +lat_0=0 +lon_0=${cm} +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
        pr = window.proj4('EPSG:4326', fallbackDef, [p[0], p[1]]);
      }

      if (pr) {
        const pt = { x: pr[0], y: pr[1] };
        cadPoints.push(pt);
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
        sumX += pt.x;
        sumY += pt.y;
      }
    });

    if (cadPoints.length < 3) {
      return { success: false, error: "Koordinat dönüşümü başarısız oldu" };
    }

    // TKGM Tabakası Bul veya Oluştur (CAD Turuncu tema)
    let tkgmLayerIdx = this.layers.findIndex(l => l && l.toUpperCase().includes("TKGM"));
    if (tkgmLayerIdx < 0) {
      tkgmLayerIdx = this.layers.length;
      this.layers.push("TKGM_PARSEL");
      this.layerColors.push("#ea580c"); // CAD Turuncu
    } else {
      this.layerColors[tkgmLayerIdx] = "#ea580c";
    }

    // Tabakayı görünür yap
    this.hidden.delete(tkgmLayerIdx);

    const adaNo = props.adaNo || props.ada || '';
    const parselNo = props.parselNo || props.parsel || '';
    const labelTitle = `Ada: ${adaNo}  Parsel: ${parselNo}`;
    const subTitle = props.alan ? `${props.alan} m²` : (props.nitelik || '');
    const parcelId = props.id || `${props.ilceAd || ''}_${props.mahalleAd || ''}_${adaNo}_${parselNo}`.replace(/\s+/g, '_');

    // Eğer daha önce bu parsel eklenmişse eskilerini temizle
    this.removeTkgmParcel(parcelId);

    // Parsel çevreleme boyutuna göre dinamik metin yüksekliği
    const parcelSpan = Math.max(maxX - minX, maxY - minY);
    const dynamicTextHeight = Math.max(2.5, Math.min(25.0, parcelSpan * 0.08));

    // 1. Parsel Poligonu
    const polygonEntity = {
      kind: "Polygon",
      layer: tkgmLayerIdx,
      points: cadPoints,
      text: `${adaNo}/${parselNo}`,
      tkgmId: parcelId,
      tkgmProps: props
    };

    this.entities.push(polygonEntity);

    // 2. Köşe Noktaları (Point)
    for (let i = 0; i < cadPoints.length; i++) {
      const pt = cadPoints[i];
      this.entities.push({
        kind: "Point",
        layer: tkgmLayerIdx,
        points: [{ x: pt.x, y: pt.y }],
        text: `P${i + 1}`,
        tkgmId: parcelId
      });
    }

    // 3. Merkez Yazı (Text) - Asla NaN olmaması için textHeight garanti edilir
    const cx = sumX / cadPoints.length;
    const cy = sumY / cadPoints.length;
    this.entities.push({
      kind: "Text",
      layer: tkgmLayerIdx,
      points: [{ x: cx, y: cy }],
      text: `${labelTitle}\n${subTitle}`,
      textHeight: dynamicTextHeight,
      rotation: 0,
      align: 1, // center
      tkgmId: parcelId
    });

    // Spatial Grid ve Meta İndeksini Yeniden Oluştur
    this.rebuildSpatialIndex();

    // Seçili obje olarak işaretle
    this.selected = polygonEntity;

    if (focus) {
      // Parselin üzerine odaklan ve Radar Reticle Beacon'ı başlat
      this.zoomToBounds(minX, maxX, minY, maxY, true);

      this.activeBeacon = {
        x: cx,
        y: cy,
        label: `${labelTitle}`,
        startTime: performance.now(),
        duration: 4000
      };
    }

    this.requestRender();

    return {
      success: true,
      id: parcelId,
      props,
      cm,
      targetProjCode,
      area: this.calcArea(cadPoints),
      perimeter: this.calcPerimeter(cadPoints),
      cx, cy,
      pointsCount: cadPoints.length,
      geojsonData: feature
    };
  }

  // Haritadan belirli bir TKGM parselini silme
  removeTkgmParcel(parcelId) {
    if (!parcelId) return false;
    const beforeCount = this.entities.length;
    this.entities = this.entities.filter(e => e.tkgmId !== parcelId);
    if (this.entities.length !== beforeCount) {
      if (this.selected && this.selected.tkgmId === parcelId) {
        this.selected = null;
      }
      this.rebuildSpatialIndex();
      this.requestRender();
      return true;
    }
    return false;
  }

  // Haritadaki belirli bir TKGM parseline odaklanma
  zoomToTkgmParcel(parcelId) {
    const poly = this.entities.find(e => e.tkgmId === parcelId && e.kind === "Polygon");
    if (!poly || !poly.points || poly.points.length < 3) return false;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;
    for (const p of poly.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      sumX += p.x;
      sumY += p.y;
    }

    const cx = sumX / poly.points.length;
    const cy = sumY / poly.points.length;

    this.zoomToBounds(minX, maxX, minY, maxY, true);
    this.activeBeacon = {
      x: cx,
      y: cy,
      label: poly.text || "Parsel",
      startTime: performance.now(),
      duration: 3800
    };
    this.requestRender();
    return true;
  }

  requestRender() {
    if (!this.renderRequested) {
      this.renderRequested = true;
      requestAnimationFrame(() => {
        this.renderRequested = false;
        this.render();
      });
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.fillStyle = this.satelliteEnabled ? "#0a0c10" : (this.theme === "light" ? "#ffffff" : "#15181e");
    ctx.fillRect(0, 0, this.width, this.height);

    // 1. Draw Satellite imagery if enabled
    if (this.satelliteEnabled && this.projection !== "NONE") {
      this.drawSatelliteTiles(ctx);
    }

    if (this.entities.length > 0) {
      const fastFrame = this.isDragging || this.performanceMode;
    const detail = !fastFrame && this.zoom >= 0.55;
    const labels = this.showAreas && !fastFrame && this.zoom >= 0.8;
    const allowText = this.showAreas && !this.isDragging && (!this.performanceMode || this.zoom >= 1.0);
    const allowPointNames = this.showPointNames && !this.isDragging && this.zoom >= 0.5;
    const allowFill = !this.isDragging && (!this.performanceMode || this.zoom >= 2.0);

    const batchedPaths = new Map();
    const textsToDraw = [];
    const pointNamesToDraw = [];

    // Ultra-fast Viewport Bounding Box Culling in World Space
    const vMin = this.worldAt(-80, this.height + 80);
    const vMax = this.worldAt(this.width + 80, -80);
    const vpMinX = Math.min(vMin.x, vMax.x);
    const vpMaxX = Math.max(vMin.x, vMax.x);
    const vpMinY = Math.min(vMin.y, vMax.y);
    const vpMaxY = Math.max(vMin.y, vMax.y);

    for (let mi = 0; mi < this.meta.length; mi++) {
      const m = this.meta[mi];
      const e = m.e;
      if (this.hidden.has(e.layer) || !e.points || e.points.length === 0) continue;

      // Fast AABB intersection rejection
      if (m.maxX < vpMinX || m.minX > vpMaxX || m.maxY < vpMinY || m.minY > vpMaxY) continue;

      const strokeColor = this.color(e.layer);

      switch (e.kind) {
        case "Polygon": {
          ctx.strokeStyle = strokeColor;
          ctx.beginPath();
          ctx.moveTo(this.sx(e.points[0].x, e.points[0].y), this.sy(e.points[0].x, e.points[0].y));
          for (let i = 1; i < e.points.length; i++) {
            ctx.lineTo(this.sx(e.points[i].x, e.points[i].y), this.sy(e.points[i].x, e.points[i].y));
          }
          ctx.closePath();

          if (allowFill && this.fillMode === this.FillMode.SOLID) {
            ctx.fillStyle = strokeColor;
            ctx.globalAlpha = 0.22;
            ctx.fill();
            ctx.globalAlpha = 1.0;
          } else if (allowFill && this.fillMode === this.FillMode.HATCH) {
            ctx.save();
            ctx.clip();
            ctx.strokeStyle = "rgba(255, 190, 70, 0.4)";
            ctx.lineWidth = 1;
            const step = 18;
            for (let x = -this.height; x < this.width + this.height; x += step) {
              ctx.beginPath();
              ctx.moveTo(x, 0);
              ctx.lineTo(x + this.height, this.height);
              ctx.stroke();
            }
            ctx.restore();
          }
          ctx.stroke();

          if (labels && !this.hiddenTextLayers.has(e.layer) && m.area > 0.01) {
            const cx = this.sx(m.cx, m.cy);
            const cy = this.sy(m.cx, m.cy);
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const isLight = (this.theme === "light" && !this.satelliteEnabled);
            if (e.text && e.text.trim()) {
              // Parsel Numarası (Üstte) + Alan Bilgisi (Altta)
              ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
              ctx.strokeStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(0, 0, 0, 0.92)";
              ctx.lineWidth = 3.0;
              ctx.strokeText(e.text, cx, cy - 7);
              ctx.fillStyle = isLight ? "#ea580c" : "#ffdd57"; // Açık temada CAD Turuncu, koyu temada altın sarısı
              ctx.fillText(e.text, cx, cy - 7);

              ctx.font = "11px monospace";
              ctx.strokeText(`${m.area.toFixed(2)} m²`, cx, cy + 7);
              ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
              ctx.fillText(`${m.area.toFixed(2)} m²`, cx, cy + 7);
            } else {
              ctx.font = "11px monospace";
              ctx.strokeStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(0, 0, 0, 0.92)";
              ctx.lineWidth = 3.0;
              ctx.strokeText(`${m.area.toFixed(2)} m²`, cx, cy);
              ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
              ctx.fillText(`${m.area.toFixed(2)} m²`, cx, cy);
            }
            ctx.restore();
          }
          break;
        }

        case "Circle": {
          ctx.strokeStyle = strokeColor;
          const p = e.points[0];
          const r = e.radius * this.bs() * this.zoom;
          ctx.beginPath();
          ctx.arc(this.sx(p.x, p.y), this.sy(p.x, p.y), Math.max(1, r), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        case "Arc": {
          ctx.strokeStyle = strokeColor;
          const p = e.points[0];
          const r = e.radius * this.bs() * this.zoom;
          ctx.beginPath();
          // NCZ yay açıları +X ekseninden radyan cinsindedir.
          // Canvas Y ekseni ters (aşağı doğru) olduğu için açı -angle ve anticlockwise=true olarak çizilir.
          ctx.arc(this.sx(p.x, p.y), this.sy(p.x, p.y), Math.max(1, r), -e.startAngle, -e.endAngle, true);
          ctx.stroke();
          break;
        }

        case "Text": {
          if (allowText && !this.hiddenTextLayers.has(e.layer) && e.text && e.text.trim()) {
            textsToDraw.push({ e, strokeColor });
          }
          break;
        }

        case "Symbol": {
          if (this.isDragging) continue;
          const p = e.points[0];
          const x = this.sx(p.x, p.y);
          const y = this.sy(p.x, p.y);
          const r = Math.min(24, Math.max(6, e.textHeight * this.bs() * this.zoom * 0.45));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate((-e.rotation * Math.PI) / 180);
          ctx.strokeStyle = strokeColor;
          ctx.fillStyle = strokeColor;
          ctx.lineWidth = 1.4;

          const code = (e.symbolCode || 0) % 10;
          switch (code) {
            case 0: { // 0: Genel / Poligon Çaprazlı Daire
              ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
              ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
              break;
            }
            case 1: { // 1: Nirengi Noktası (Eşkenar Üçgen ve Merkez Nokta)
              ctx.beginPath();
              ctx.moveTo(0, -r * 1.15);
              ctx.lineTo(r, r * 0.7);
              ctx.lineTo(-r, r * 0.7);
              ctx.closePath();
              ctx.stroke();
              ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
              break;
            }
            case 2: { // 2: Nivelman / RS Kot Taşı (Üçgen ve Yatay Zemin)
              ctx.beginPath();
              ctx.moveTo(0, -r);
              ctx.lineTo(r * 0.8, r * 0.6);
              ctx.lineTo(-r * 0.8, r * 0.6);
              ctx.closePath();
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(-r * 1.1, r * 0.6);
              ctx.lineTo(r * 1.1, r * 0.6);
              ctx.moveTo(-r * 0.7, r * 0.85);
              ctx.lineTo(r * 0.7, r * 0.85);
              ctx.stroke();
              break;
            }
            case 3: { // 3: Elektrik Direği (Daire ve Çapraz Çubuklar)
              ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
              ctx.moveTo(0, -r); ctx.lineTo(0, r);
              ctx.moveTo(-r * 0.7, -r * 0.7); ctx.lineTo(r * 0.7, r * 0.7);
              ctx.moveTo(r * 0.7, -r * 0.7); ctx.lineTo(-r * 0.7, r * 0.7);
              ctx.stroke();
              break;
            }
            case 4: { // 4: Ağaç / Yeşil Alan
              ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.75, 0, Math.PI * 2); ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(0, r * 0.55); ctx.lineTo(0, r * 1.1);
              ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0);
              ctx.stroke();
              break;
            }
            case 5: { // 5: Kuyu / Sarnıç (Eşmerkezli Çift Halka)
              ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
              ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();
              break;
            }
            case 6: { // 6: Rögar / Muayene Bacası (Kare + İç Çember)
              ctx.strokeRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
              ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();
              break;
            }
            case 7: { // 7: Vana / Yangın Hidrantı (Kum Saati / Papyon ⧓)
              ctx.beginPath();
              ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, r * 0.7); ctx.lineTo(-r, r * 0.7); ctx.lineTo(r, -r * 0.7);
              ctx.closePath();
              ctx.stroke();
              break;
            }
            case 8: { // 8: Kuzey Oku (Yön İbresi)
              ctx.beginPath();
              ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * 0.5, r * 0.8); ctx.lineTo(0, r * 0.3);
              ctx.closePath();
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(0, -r * 1.2); ctx.lineTo(-r * 0.5, r * 0.8); ctx.lineTo(0, r * 0.3);
              ctx.closePath();
              ctx.stroke();
              break;
            }
            case 9: { // 9: Sınır / Taşınmaz Köşe Taşı (Dolu Çekirdekli Çift Kare)
              ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
              ctx.fillRect(-r * 0.3, -r * 0.3, r * 0.6, r * 0.6);
              break;
            }
          }
          ctx.restore();
          break;
        }

        default: { // Line / Polyline / Point
          if (e.points.length === 1) {
            const p = e.points[0];
            const x = this.sx(p.x, p.y);
            const y = this.sy(p.x, p.y);

            // Professional CAD Survey Point Marker
            ctx.beginPath();
            ctx.arc(x, y, this.showPoints ? 5 : 3.5, 0, Math.PI * 2);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x, y, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();

            // Collect point labels if enabled (Tabaka bazında ayrı ayrı kontrol edilir)
            if (allowPointNames && !this.hiddenPointNameLayers.has(e.layer) && e.text && e.text.trim()) {
              pointNamesToDraw.push({ x, y, text: e.text, color: strokeColor });
            }

            // Show Elevation (Z Kot Değeri)
            if (this.showElevations && !this.hiddenPointNameLayers.has(e.layer) && !this.hiddenTextLayers.has(e.layer) && p.z && p.z !== 0) {
              const isLight = (this.theme === "light" && !this.satelliteEnabled);
              ctx.fillStyle = isLight ? "#0284c7" : "#39c5cf";
              ctx.font = "10px monospace";
              ctx.fillText(`Z:${p.z.toFixed(2)}`, x + 7, y + 10);
            }
          } else {
            let pth = batchedPaths.get(strokeColor);
            if (!pth) {
              pth = new Path2D();
              batchedPaths.set(strokeColor, pth);
            }
            pth.moveTo(this.sx(e.points[0].x, e.points[0].y), this.sy(e.points[0].x, e.points[0].y));
            for (let i = 1; i < e.points.length; i++) {
              pth.lineTo(this.sx(e.points[i].x, e.points[i].y), this.sy(e.points[i].x, e.points[i].y));
            }
          }
        }
      }

      if (this.showPoints && detail && e.kind !== "Text" && e.points.length < 500) {
        ctx.fillStyle = strokeColor;
        for (let i = 0; i < e.points.length; i++) {
          const pt = e.points[i];
          ctx.beginPath();
          ctx.arc(this.sx(pt.x, pt.y), this.sy(pt.x, pt.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Render batched lines
    ctx.lineWidth = this.performanceMode ? 1 : 1.4;
    for (const [clr, pth] of batchedPaths.entries()) {
      ctx.strokeStyle = clr;
      ctx.stroke(pth);
    }

    // Render Drawing Texts (Yazıların Asla Kaybolmaması İçin Sağlamlaştırıldı)
    if (textsToDraw.length > 0) {
      for (let i = 0; i < textsToDraw.length; i++) {
        const { e, strokeColor } = textsToDraw[i];
        const p = e.points[0];
        const x = this.sx(p.x, p.y);
        const y = this.sy(p.x, p.y);

        if (x < -100 || x > this.width + 100 || y < -100 || y > this.height + 100) continue;

        const textH = (typeof e.textHeight === "number" && !isNaN(e.textHeight) && e.textHeight > 0) ? e.textHeight : 3.0;
        const fontSize = Math.min(160, Math.max(7, textH * this.bs() * this.zoom * (this.textScale || 1.0)));
        if (fontSize < 5) continue;

        ctx.save();
        ctx.translate(x, y);
        const rotRad = (-((e.rotation || 0) * Math.PI)) / 180.0;
        ctx.rotate(rotRad);

        const isLight = (this.theme === "light" && !this.satelliteEnabled);
        ctx.font = `600 ${Math.round(fontSize)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = (e.align === 1 ? "center" : (e.align === 2 ? "right" : "left"));
        ctx.textBaseline = "middle";

        // Halo outline: Açık temada beyaz, koyu/uyduda koyu kontrast
        const haloColor = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(0, 0, 0, 0.92)";
        const textColor = isLight ? (strokeColor === "#ffffff" ? "#0f172a" : strokeColor) : strokeColor;

        ctx.strokeStyle = haloColor;
        ctx.lineWidth = Math.max(2.5, fontSize * 0.22);
        ctx.lineJoin = "round";

        const lines = (e.text || "").split('\n');
        const lineSpacing = fontSize * 1.25;
        const startY = -((lines.length - 1) * lineSpacing) / 2;

        for (let li = 0; li < lines.length; li++) {
          const ly = startY + li * lineSpacing;
          ctx.strokeText(lines[li], 0, ly);
          ctx.fillStyle = textColor;
          ctx.fillText(lines[li], 0, ly);
        }
        ctx.restore();
      }
    }

    // Render Point Names / Numbers (Nokta Adları - Yüksek Kontrastlı CAD Rozeti)
    if (this.showPointNames && pointNamesToDraw.length > 0) {
      const isLight = (this.theme === "light" && !this.satelliteEnabled);
      const scale = this.textScale || 1.0;
      const baseFontSize = Math.max(9, Math.round(11 * scale));
      ctx.font = `bold ${baseFontSize}px 'Segoe UI', Arial, sans-serif`;
      ctx.textBaseline = "middle";

      for (let i = 0; i < pointNamesToDraw.length; i++) {
        const pt = pointNamesToDraw[i];
        const text = pt.text;
        const textW = ctx.measureText(text).width;
        const badgeX = pt.x + 8;
        const badgeY = pt.y - 1;

        // Nokta Adı Arka Plan Kontrast Rozeti
        ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(badgeX - 2, badgeY - (baseFontSize / 2) - 2, textW + 4, baseFontSize + 4);

        ctx.strokeStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(0, 0, 0, 0.9)";
        ctx.lineWidth = 2.4;
        ctx.lineJoin = "round";
        ctx.strokeText(text, badgeX, badgeY);

        ctx.fillStyle = pt.color || (isLight ? "#0f172a" : "#f8fafc");
        ctx.fillText(text, badgeX, badgeY);
      }
    }

    // Render Selected Entity
    if (this.selected) {
      const e = this.selected;
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 3.5;
      if (e.kind === "Polygon") {
        ctx.beginPath();
        ctx.moveTo(this.sx(e.points[0].x, e.points[0].y), this.sy(e.points[0].x, e.points[0].y));
        for (let i = 1; i < e.points.length; i++) {
          ctx.lineTo(this.sx(e.points[i].x, e.points[i].y), this.sy(e.points[i].x, e.points[i].y));
        }
        ctx.closePath();
        ctx.stroke();

        if (this.showEdgeLengths && this.zoom >= 0.4 && e.points.length >= 2 && e.points.length <= 150) {
          for (let i = 0; i < e.points.length; i++) {
            const a = e.points[i];
            const b = e.points[(i + 1) % e.points.length];
            const len = Math.hypot(a.x - b.x, a.y - b.y);
            const mx = (a.x + b.x) / 2.0;
            const my = (a.y + b.y) / 2.0;
            const sx0 = this.sx(a.x, a.y);
            const sy0 = this.sy(a.x, a.y);
            const sx1 = this.sx(b.x, b.y);
            const sy1 = this.sy(b.x, b.y);
            const angle = Math.atan2(sy1 - sy0, sx1 - sx0);
            this.drawEdgeLabelBadge(ctx, this.sx(mx, my), this.sy(mx, my), len, angle, -14);
          }
        }
      } else if (e.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.sx(e.points[0].x, e.points[0].y), this.sy(e.points[0].x, e.points[0].y));
        for (let i = 1; i < e.points.length; i++) {
          ctx.lineTo(this.sx(e.points[i].x, e.points[i].y), this.sy(e.points[i].x, e.points[i].y));
        }
        ctx.stroke();
      } else if (e.points.length === 1) {
        ctx.beginPath();
        ctx.arc(this.sx(e.points[0].x, e.points[0].y), this.sy(e.points[0].x, e.points[0].y), 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Seçili objenin tabaka ve detay bilgisi sağ alttaki bilgi kutusunda (entityInfoBox) gösterilmektedir.
    }

    // Length Labels (Çizime Yazdırılan Kenar Boyları)
    if (this.lengthLabels.length > 0 && !this.isDragging) {
      for (const l of this.lengthLabels) {
        const mx = this.sx(l.mid.x, l.mid.y);
        const my = this.sy(l.mid.x, l.mid.y);
        let angle = 0;
        if (l.a && l.b) {
          const sx0 = this.sx(l.a.x, l.a.y);
          const sy0 = this.sy(l.a.x, l.a.y);
          const sx1 = this.sx(l.b.x, l.b.y);
          const sy1 = this.sy(l.b.x, l.b.y);
          angle = Math.atan2(sy1 - sy0, sx1 - sx0);
        }
        this.drawEdgeLabelBadge(ctx, mx, my, l.value, angle);
      }
    }

    // Saved Points
    if (this.savedPoints.length > 0) {
      ctx.strokeStyle = "#ffd700";
      ctx.fillStyle = "#ffd700";
      ctx.lineWidth = 2;
      ctx.font = "11px monospace";
      this.savedPoints.forEach((p, idx) => {
        const x = this.sx(p.x, p.y);
        const y = this.sy(p.x, p.y);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y);
        ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9);
        ctx.stroke();
        ctx.fillText(`N${idx + 1}`, x + 8, y - 6);
      });
    }

    // Measurement Points & Line
    if (this.measurePts.length > 0) {
      ctx.strokeStyle = "#00ffff";
      ctx.fillStyle = "#00ffff";
      ctx.lineWidth = 2.5;
      if (this.measurePts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.sx(this.measurePts[0].x, this.measurePts[0].y), this.sy(this.measurePts[0].x, this.measurePts[0].y));
        for (let i = 1; i < this.measurePts.length; i++) {
          ctx.lineTo(this.sx(this.measurePts[i].x, this.measurePts[i].y), this.sy(this.measurePts[i].x, this.measurePts[i].y));
        }
        ctx.stroke();
      }
      for (const p of this.measurePts) {
        ctx.beginPath();
        ctx.arc(this.sx(p.x, p.y), this.sy(p.x, p.y), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Zoom Window Box
    if (this.zoomWindow && this.zoomWindowStart && this.zoomWindowNow) {
      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 2;
      const x1 = this.sx(this.zoomWindowStart.x, this.zoomWindowStart.y);
      const y1 = this.sy(this.zoomWindowStart.x, this.zoomWindowStart.y);
      const x2 = this.sx(this.zoomWindowNow.x, this.zoomWindowNow.y);
      const y2 = this.sy(this.zoomWindowNow.x, this.zoomWindowNow.y);
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }

    if (this.boxSelect && this.boxSelectStart && this.boxSelectNow) {
      const x1 = this.sx(this.boxSelectStart.x, this.boxSelectStart.y);
      const y1 = this.sy(this.boxSelectStart.x, this.boxSelectStart.y);
      const x2 = this.sx(this.boxSelectNow.x, this.boxSelectNow.y);
      const y2 = this.sy(this.boxSelectNow.x, this.boxSelectNow.y);
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);

      ctx.fillStyle = "rgba(234, 88, 12, 0.16)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // Snap Hit Marker
    if (this.snapHit) {
      const s = this.snapHit;
      const x = this.sx(s.p.x, s.p.y);
      const y = this.sy(s.p.x, s.p.y);
      ctx.strokeStyle = "#00ff66";
      ctx.fillStyle = "#00ff66";
      ctx.lineWidth = 2;
      if (s.kind === "KÖŞE") {
        ctx.strokeRect(x - 7, y - 7, 14, 14);
      } else if (s.kind === "ORTA") {
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 8, y + 6);
        ctx.lineTo(x - 8, y + 6);
        ctx.closePath();
        ctx.stroke();
      } else if (s.kind === "KESİŞİM") {
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8);
        ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = "11px monospace";
      ctx.fillText(s.kind, x + 10, y - 8);
    }

    // Topoloji Hata Gösterimi (Kapanmayan Açık Parsel Uçları)
    if (this.topologyErrors.length > 0) {
      ctx.strokeStyle = "#f85149";
      ctx.fillStyle = "rgba(248, 81, 73, 0.25)";
      ctx.lineWidth = 2;
      ctx.font = "10.5px monospace";
      for (let i = 0; i < this.topologyErrors.length; i++) {
        const err = this.topologyErrors[i];
        const x = this.sx(err.x, err.y);
        const y = this.sy(err.x, err.y);
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#f85149";
        ctx.fillText(`AÇIK UÇ #${i + 1}`, x + 15, y + 4);
      }
    }
    } // End of if (this.entities.length > 0)

    // Active Beacon Radar Reticle (Her zaman çizilebilir)
    if (this.activeBeacon) {
      this.drawBeacon(ctx);
    }

    // Aktif Ölçüm Çizgileri ve Canlı Rozetler (Distance, Polyline, Free Area, Angle, Perpendicular)
    this.drawActiveMeasurements(ctx);

    // İmar Çekme Mesafesi ve Yapı Yaklaşma Sınırı Canlı Önizlemesi
    this.drawSetbackPreview(ctx);

    this.drawScaleBar(ctx);

    // Kuşbakışı Minimap güncelle (Throttled: Sürükleme anında render kasmalarını önler)
    if (this.showMinimap && this.minimapCanvas) {
      const now = performance.now();
      if (!this.isDragging && (now - this.lastMinimapDraw > 140)) {
        this.lastMinimapDraw = now;
        this.drawMinimap();
      }
    }
  }

  // İmar Çekme Mesafesi ve Yapı Yaklaşma Sınırı Canlı Çizimi
  drawSetbackPreview(ctx) {
    if (!this.setbackPreview) return;
    const sp = this.setbackPreview;
    if (!sp.points || sp.points.length < 3) return;

    ctx.save();

    // 1. Orijinal Parsel Kenarlarını Çekme Türüne Göre Renkli Vurgula
    if (sp.origPoints && sp.edgeTypes) {
      const origPts = sp.origPoints;
      for (let i = 0; i < origPts.length; i++) {
        const a = origPts[i];
        const b = origPts[(i + 1) % origPts.length];
        const type = (sp.edgeTypes && sp.edgeTypes[i]) ? sp.edgeTypes[i] : 'komsu';
        const dist = (sp.distances && sp.distances[i] !== undefined) ? sp.distances[i] : 3.0;

        const isRoad = (type === 'yol' || type === 'on');
        ctx.strokeStyle = isRoad ? "#0284c7" : "#f59e0b"; // Mavi (Yol) veya Kehribar (Komşu)
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(this.sx(a.x, a.y), this.sy(a.y, a.y));
        ctx.lineTo(this.sx(b.x, b.y), this.sy(b.y, b.y));
        ctx.stroke();

        // Kenar Orta Noktasına Çekme Türü ve Mesafe Rozeti
        const mx = this.sx((a.x + b.x) / 2, (a.y + b.y) / 2);
        const my = this.sy((a.x + b.x) / 2, (a.y + b.y) / 2);
        const label = `${isRoad ? '🚗 YOL' : '🏠 KOMŞU'}: ${dist.toFixed(2)}m`;

        ctx.font = "bold 10px 'Segoe UI', Arial, sans-serif";
        const tm = ctx.measureText(label);
        const tw = tm.width + 10;
        ctx.fillStyle = isRoad ? "rgba(2, 132, 199, 0.92)" : "rgba(217, 119, 6, 0.92)";
        ctx.fillRect(mx - tw / 2, my - 10, tw, 20);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(mx - tw / 2, my - 10, tw, 20);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx, my);
      }
    }

    // 2. Yapı Yaklaşma Sınırı (Oturum Poligonu)
    const pts = sp.points;
    ctx.beginPath();
    ctx.moveTo(this.sx(pts[0].x, pts[0].y), this.sy(pts[0].x, pts[0].y));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(this.sx(pts[i].x, pts[i].y), this.sy(pts[i].x, pts[i].y));
    }
    ctx.closePath();

    // Bina Tabanı Yarı Saydam Gül Kırmızısı Dolgu
    ctx.fillStyle = "rgba(225, 29, 72, 0.22)";
    ctx.fill();

    // Kesikli Yapı Yaklaşma Konturu (İmar Standardı)
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Köşe Noktaları (Yapı Köşeleri)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sx = this.sx(p.x, p.y);
      const sy = this.sy(p.x, p.y);

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#e11d48";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`B${i + 1}`, sx, sy - 6);
    }

    // Kenar Boyları (Bina Cephe Ölçüleri)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ax = this.sx(a.x, a.y);
      const ay = this.sy(a.y, a.y);
      const bx = this.sx(b.x, b.y);
      const by = this.sy(b.y, b.y);
      const mx = (ax + bx) / 2.0;
      const my = (ay + by) / 2.0;
      const angle = Math.atan2(by - ay, bx - ax);
      if (d > 0.05) {
        this.drawEdgeLabelBadge(ctx, mx, my, d, angle, -14);
      }
    }

    // 3. Merkezde Bina Taban Alanı & TAKS Rozeti
    if (pts.length >= 3) {
      let cx = 0, cy = 0;
      pts.forEach(p => { cx += p.x; cy += p.y; });
      cx /= pts.length;
      cy /= pts.length;

      const scx = this.sx(cx, cy);
      const scy = this.sy(cx, cy);

      const title = "🏗️ YAPI TABAN ALANI";
      const line1 = `TABAN ALANI: ${sp.newArea.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
      const line2 = `TAKS: %${sp.taks.toFixed(1)} • ÇEVRE: ${sp.perimeter.toFixed(2)} m`;

      ctx.font = "bold 11px 'Segoe UI', Arial, sans-serif";
      const w0 = ctx.measureText(title).width;
      ctx.font = "bold 12px monospace";
      const w1 = ctx.measureText(line1).width;
      ctx.font = "10.5px monospace";
      const w2 = ctx.measureText(line2).width;

      const boxW = Math.max(w0, w1, w2) + 24;
      const boxH = 56;
      const boxX = scx - boxW / 2;
      const boxY = scy - boxH / 2;

      ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Üst Başlık
      ctx.font = "bold 10px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = "#fb7185";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title, scx, boxY + 12);

      // Alan Satırı
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(line1, scx, boxY + 28);

      // TAKS Satırı
      ctx.font = "10.5px monospace";
      ctx.fillStyle = "#facc15"; // Sarı altın vurgusu
      ctx.fillText(line2, scx, boxY + 44);
    }

    ctx.restore();
  }

  drawBeacon(ctx) {
    const b = this.activeBeacon;
    const now = performance.now();
    const elapsed = now - b.startTime;
    if (elapsed > b.duration) {
      this.activeBeacon = null;
      return;
    }

    const t = elapsed / b.duration; // 0..1
    const sx = this.sx(b.x, b.y);
    const sy = this.sy(b.x, b.y);

    // Ekran dışındaysa yine de gösterge çizilebilir ama ekran içindeyse animasyonu çiz
    ctx.save();
    const waveProgress = (elapsed % 1200) / 1200; // Her 1.2 sn'de bir yeni dalga
    const r1 = 15 + waveProgress * 65;
    const alpha1 = Math.max(0, (1.0 - waveProgress) * (1.0 - t * 0.5));

    // Dış genişleyen dalga 1
    ctx.strokeStyle = `rgba(234, 88, 12, ${alpha1})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r1, 0, Math.PI * 2);
    ctx.stroke();

    // İkinci iç dalga
    const wave2 = ((elapsed + 600) % 1200) / 1200;
    const r2 = 15 + wave2 * 65;
    const alpha2 = Math.max(0, (1.0 - wave2) * (1.0 - t * 0.5));
    ctx.strokeStyle = `rgba(249, 115, 22, ${alpha2})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r2, 0, Math.PI * 2);
    ctx.stroke();

    // Sabit hedef reticle (Crosshair)
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Merkez daire
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Çapraz/Düz çizgiler
    ctx.beginPath();
    ctx.moveTo(sx - 26, sy); ctx.lineTo(sx - 12, sy);
    ctx.moveTo(sx + 12, sy); ctx.lineTo(sx + 26, sy);
    ctx.moveTo(sx, sy - 26); ctx.lineTo(sx, sy - 12);
    ctx.moveTo(sx, sy + 12); ctx.lineTo(sx, sy + 26);
    ctx.stroke();

    // Merkez parlayan nokta
    ctx.fillStyle = "#ea580c";
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Etiket ve Koordinat Balonu
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.5;
    const labelText = `${b.label || 'HEDEF'} • Y: ${b.x.toFixed(2)} X: ${b.y.toFixed(2)}`;
    ctx.font = "bold 12px monospace";
    const textWidth = ctx.measureText(labelText).width;
    const bx = sx + 18;
    const by = sy - 34;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, textWidth + 14, 24, 4) : ctx.rect(bx, by, textWidth + 14, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ea580c";
    ctx.fillText(labelText, bx + 7, by + 16);

    ctx.restore();

    // Animasyon devam ettiği sürece bir sonraki kareyi iste
    this.requestRender();
  }

  drawScaleBar(ctx) {
    if (this.width < 100 || this.height < 100) return;
    const metersPerPx = 1.0 / (Math.max(0.000001, this.bs()) * this.zoom);
    const target = metersPerPx * 120.0;
    const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(0.000001, target))));
    const n = target / pow10;
    const nice = (n < 2 ? 1.0 : (n < 5 ? 2.0 : (n < 10 ? 5.0 : 10.0))) * pow10;
    const px = nice / metersPerPx;
    const y = this.height - 25;
    const x = 20;

    // Standart Türk Standart Pafta Ölçeği Tahmini (1 px ≈ 0.264 mm)
    const rawScale = metersPerPx / 0.000264583;
    const standardScales = [100, 200, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
    let bestScale = standardScales[0];
    let minDiff = Infinity;
    for (const sc of standardScales) {
      const diff = Math.abs(Math.log(sc) - Math.log(rawScale));
      if (diff < minDiff) {
        minDiff = diff;
        bestScale = sc;
      }
    }

    ctx.save();
    // Arka plan kutusu
    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(12, 16, 24, 0.75)";
    ctx.strokeStyle = isLight ? "#fdba74" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - 8, y - 28, Math.max(px + 16, 110), 38);
    ctx.fill();
    ctx.stroke();

    // Standart Pafta Ölçeği Metni
    ctx.fillStyle = isLight ? "#ea580c" : "#58a6ff";
    ctx.font = "bold 11px -apple-system, monospace";
    ctx.fillText(`ÖLÇEK: 1/${bestScale.toLocaleString()}`, x, y - 14);

    // Çift Bölmeli Metrik Bar (Standart Pafta Formatı)
    const halfPx = px / 2;
    ctx.fillStyle = isLight ? "#ea580c" : "#ffffff";
    ctx.fillRect(x, y - 6, halfPx, 5);
    ctx.fillStyle = isLight ? "#ffffff" : "#000000";
    ctx.fillRect(x + halfPx, y - 6, halfPx, 5);
    ctx.strokeStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - 6, px, 5);

    // Uç işaretleri ve Değer
    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.font = "10px monospace";
    const label = (nice >= 1000) ? `${(nice / 1000).toFixed(1)} km` : `${nice.toFixed(0)} m`;
    ctx.fillText("0", x - 2, y + 8);
    ctx.fillText(label, x + px - 12, y + 8);
    ctx.restore();
  }

  // Serbest Çokgen Alanı Rozeti (Merkezde Çift Satır: Alan ve Çevre)
  drawAreaBadge(ctx, mx, my, area, per) {
    const line1 = `ALAN: ${area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
    const line2 = `ÇEVRE: ${per.toFixed(2)} m`;

    ctx.save();
    ctx.translate(mx, my);

    ctx.font = "bold 11.5px monospace";
    const w1 = ctx.measureText(line1).width;
    ctx.font = "10.5px monospace";
    const w2 = ctx.measureText(line2).width;

    const boxW = Math.max(w1, w2) + 18;
    const boxH = 36;
    const boxX = -boxW / 2;
    const boxY = -boxH / 2;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(10, 14, 22, 0.92)";
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.4;

    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = "#ea580c";
    ctx.fillRect(boxX, boxY, 3, boxH);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ea580c";
    ctx.font = "bold 11.5px monospace";
    ctx.fillText(line1, 1.5, -4);

    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.font = "10.5px monospace";
    ctx.fillText(line2, 1.5, 11);

    ctx.restore();
  }

  // 3 Nokta Açı Ölçümü Yayı ve Rozeti
  drawAngleArcAndBadge(ctx, A, B, C) {
    const v1x = A.x - B.x, v1y = A.y - B.y;
    const v2x = C.x - B.x, v2y = C.y - B.y;
    const d1 = Math.hypot(v1x, v1y);
    const d2 = Math.hypot(v2x, v2y);
    if (d1 < 1e-6 || d2 < 1e-6) return;

    const dot = (v1x * v2x + v1y * v2y) / (d1 * d2);
    const rad = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
    const deg = rad * 180.0 / Math.PI;
    const gon = rad * 200.0 / Math.PI;

    const bx = this.sx(B.x, B.y);
    const by = this.sy(B.x, B.y);
    const ang1 = Math.atan2(this.sy(A.x, A.y) - by, this.sx(A.x, A.y) - bx);
    const ang2 = Math.atan2(this.sy(C.x, C.y) - by, this.sx(C.x, C.y) - bx);

    // Açı Yayı Çizimi
    ctx.save();
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let diff = ang2 - ang1;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const anticlockwise = diff < 0;
    ctx.arc(bx, by, 28, ang1, ang2, anticlockwise);
    ctx.stroke();

    // Açı rozeti
    const midAngle = ang1 + diff / 2;
    const badgeX = bx + Math.cos(midAngle) * 52;
    const badgeY = by + Math.sin(midAngle) * 52;

    const text = `α: ${deg.toFixed(2)}° (${gon.toFixed(2)} gon)`;
    ctx.font = "bold 11px monospace";
    const textW = ctx.measureText(text).width;
    const boxW = textW + 14;
    const boxH = 19;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(10, 14, 22, 0.92)";
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.2;
    ctx.fillRect(badgeX - boxW / 2, badgeY - boxH / 2, boxW, boxH);
    ctx.strokeRect(badgeX - boxW / 2, badgeY - boxH / 2, boxW, boxH);

    ctx.fillStyle = "#ea580c";
    ctx.fillRect(badgeX - boxW / 2, badgeY - boxH / 2, 3, boxH);

    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, badgeX + 1.5, badgeY + 0.5);

    ctx.restore();
  }

  // Kırık Hat Çoklu Ölçüm Özet Rozeti (Toplam Mesafe & Segment Sayısı)
  drawPolylineSummaryBadge(ctx, mx, my, totalDist, segCount, isFinished = false) {
    const text = isFinished 
      ? `✔ TOPLAM: ${totalDist.toFixed(3)} m (${segCount} segment)` 
      : `Σ TOPLAM: ${totalDist.toFixed(3)} m (${segCount} seg)`;

    ctx.save();
    ctx.font = "bold 12px monospace";
    const textW = ctx.measureText(text).width;
    const boxW = textW + 20;
    const boxH = 26;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(15, 23, 42, 0.95)";
    ctx.strokeStyle = isFinished ? "#22c55e" : "#ea580c";
    ctx.lineWidth = 1.6;

    ctx.fillRect(mx - boxW / 2, my - boxH / 2, boxW, boxH);
    ctx.strokeRect(mx - boxW / 2, my - boxH / 2, boxW, boxH);

    // Sol vurgulu dikey çizgi
    ctx.fillStyle = isFinished ? "#22c55e" : "#ea580c";
    ctx.fillRect(mx - boxW / 2, my - boxH / 2, 4, boxH);

    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, mx + 2, my);

    ctx.restore();
  }

  // Seçili Objenin Üzerinde Yüzen Şık CAD Tabaka Rozeti (HUD Badge)
  drawSelectedEntityBadge(ctx, e) {
    if (!e || !e.points || e.points.length === 0) return;

    let bx = 0, by = 0;
    if (e.kind === "Polygon" && e.points.length >= 3) {
      let sumX = 0, sumY = 0;
      for (const p of e.points) { sumX += p.x; sumY += p.y; }
      bx = this.sx(sumX / e.points.length, sumY / e.points.length);
      by = this.sy(sumX / e.points.length, sumY / e.points.length) - 18;
    } else if (e.points.length > 1) {
      const midIdx = Math.floor(e.points.length / 2);
      bx = this.sx(e.points[midIdx].x, e.points[midIdx].y);
      by = this.sy(e.points[midIdx].x, e.points[midIdx].y) - 22;
    } else {
      bx = this.sx(e.points[0].x, e.points[0].y);
      by = this.sy(e.points[0].x, e.points[0].y) - 24;
    }

    const layerName = this.layerName(e.layer);
    const layerColor = this.color(e.layer);
    const typeName = (e.kind === "Polygon") ? "Parsel / Alan" : ((e.kind === "Point") ? "Nokta" : ((e.kind === "Line") ? "Çizgi / Hat" : e.kind));
    const text = `📁 ${layerName}  •  ${typeName}`;

    ctx.save();
    ctx.font = "bold 11px 'Segoe UI', Arial, sans-serif";
    const textW = ctx.measureText(text).width;
    const boxW = textW + 20;
    const boxH = 24;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(15, 23, 42, 0.96)";
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.6;

    // Arka plan kutusu
    ctx.fillRect(bx - boxW / 2, by - boxH / 2, boxW, boxH);
    ctx.strokeRect(bx - boxW / 2, by - boxH / 2, boxW, boxH);

    // Tabakanın kendi renginde sol dikey şerit
    ctx.fillStyle = layerColor;
    ctx.fillRect(bx - boxW / 2, by - boxH / 2, 4.5, boxH);

    // Metin
    ctx.fillStyle = isLight ? "#0f172a" : "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 2, by);

    ctx.restore();
  }

  // Hatta Dik Ayak - Dik Boy Rozeti
  drawPerpendicularBadge(ctx, mx, my, dPerp, dPar) {
    const text = `Dik Boy: ${dPerp.toFixed(2)} m • Dik Ayak: ${dPar.toFixed(2)} m`;
    ctx.save();
    ctx.font = "bold 11px monospace";
    const textW = ctx.measureText(text).width;
    const boxW = textW + 14;
    const boxH = 20;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(10, 14, 22, 0.92)";
    ctx.strokeStyle = "#388bfd";
    ctx.lineWidth = 1.3;
    ctx.fillRect(mx - boxW / 2, my - boxH / 2, boxW, boxH);
    ctx.strokeRect(mx - boxW / 2, my - boxH / 2, boxW, boxH);

    ctx.fillStyle = "#388bfd";
    ctx.fillRect(mx - boxW / 2, my - boxH / 2, 3, boxH);

    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, mx + 1.5, my + 0.5);

    ctx.restore();
  }

  // Aktif Ölçüm Hatları, Canlı Lastik Bant (Rubberband) ve Metraj Rozetleri
  drawActiveMeasurements(ctx) {
    const pts = this.measurePts;
    const hover = this.measureHoverPt;
    if (pts.length === 0 && !hover) return;

    ctx.save();

    // 1. DISTANCE (2 Nokta Mesafe & Eğim)
    if (this.queryMode === this.QueryMode.DISTANCE) {
      if (pts.length === 1 && hover) {
        const x0 = this.sx(pts[0].x, pts[0].y);
        const y0 = this.sy(pts[0].x, pts[0].y);
        const x1 = this.sx(hover.x, hover.y);
        const y1 = this.sy(hover.x, hover.y);
        const d = Math.hypot(hover.x - pts[0].x, hover.y - pts[0].y);

        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#ea580c";
        ctx.beginPath(); ctx.arc(x0, y0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();

        const angle = Math.atan2(y1 - y0, x1 - x0);
        this.drawEdgeLabelBadge(ctx, (x0 + x1) / 2, (y0 + y1) / 2, d, angle);
      } else if (pts.length >= 2) {
        const x0 = this.sx(pts[0].x, pts[0].y);
        const y0 = this.sy(pts[0].x, pts[0].y);
        const x1 = this.sx(pts[1].x, pts[1].y);
        const y1 = this.sy(pts[1].x, pts[1].y);
        const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        [pts[0], pts[1]].forEach((p) => {
          const px = this.sx(p.x, p.y);
          const py = this.sy(p.x, p.y);
          ctx.fillStyle = "#ea580c";
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        });

        const angle = Math.atan2(y1 - y0, x1 - x0);
        this.drawEdgeLabelBadge(ctx, (x0 + x1) / 2, (y0 + y1) / 2, d, angle);
      }
    }

    // 2. POLYLINE (Kırık Hat Toplam Mesafe)
    else if (this.queryMode === this.QueryMode.POLYLINE) {
      if (pts.length > 0) {
        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(this.sx(pts[0].x, pts[0].y), this.sy(pts[0].x, pts[0].y));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(this.sx(pts[i].x, pts[i].y), this.sy(pts[i].x, pts[i].y));
        }
        ctx.stroke();

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const ax = this.sx(a.x, a.y);
          const ay = this.sy(a.y, a.y);
          const bx = this.sx(b.x, b.y);
          const by = this.sy(b.y, b.y);
          const mx = (ax + bx) / 2.0;
          const my = (ay + by) / 2.0;
          const angle = Math.atan2(by - ay, bx - ax);
          this.drawEdgeLabelBadge(ctx, mx, my, d, angle, -16);

          // Kenar Orta Noktası Tutamacı (Midpoint Grip)
          if (pts.length >= 2 && (!hover || this.measureFinished)) {
            const isHoverMid = (this.hoverMeasureGrip && this.hoverMeasureGrip.type === 'midpoint' && this.hoverMeasureGrip.insertIndex === (i + 1));
            const midSize = isHoverMid ? 9 : 6;
            ctx.fillStyle = isHoverMid ? "#ea580c" : "#ffffff";
            ctx.strokeStyle = isHoverMid ? "#ffffff" : "#ea580c";
            ctx.lineWidth = isHoverMid ? 2 : 1.5;
            ctx.fillRect(mx - midSize / 2, my - midSize / 2, midSize, midSize);
            ctx.strokeRect(mx - midSize / 2, my - midSize / 2, midSize, midSize);
          }
        }

        // Köşe Tutamaçları
        pts.forEach((p, idx) => {
          const px = this.sx(p.x, p.y);
          const py = this.sy(p.x, p.y);
          const isDragged = (this.draggedMeasureGrip && this.draggedMeasureGrip.index === idx);
          const isHover = (this.hoverMeasureGrip && this.hoverMeasureGrip.type === 'vertex' && this.hoverMeasureGrip.index === idx);

          if (isDragged || isHover) {
            ctx.fillStyle = isDragged ? "#16a34a" : "#ea580c";
            ctx.beginPath();
            ctx.arc(px, py, isDragged ? 8 : 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.strokeStyle = isDragged ? "rgba(22, 163, 74, 0.45)" : "rgba(234, 88, 12, 0.45)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(px, py, 13, 0, Math.PI * 2);
            ctx.stroke();

            const tipText = isDragged ? `N${idx + 1} Taşınıyor...` : `N${idx + 1} • Taşı / Sağ Tık: Sil`;
            ctx.font = "bold 10px 'Segoe UI', Arial, sans-serif";
            const tm = ctx.measureText(tipText);
            const tw = tm.width + 10;
            ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
            ctx.fillRect(px + 10, py - 20, tw, 18);
            ctx.strokeStyle = isDragged ? "#16a34a" : "#ea580c";
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 10, py - 20, tw, 18);
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(tipText, px + 15, py - 11);
          } else {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(px, py, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ea580c";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.font = "bold 9px monospace";
            ctx.fillStyle = "#ea580c";
            ctx.textBaseline = "bottom";
            ctx.fillText(`${idx + 1}`, px + 6, py - 4);
          }
        });

        if (hover) {
          const last = pts[pts.length - 1];
          const lx = this.sx(last.x, last.y);
          const ly = this.sy(last.x, last.y);
          const hx = this.sx(hover.x, hover.y);
          const hy = this.sy(hover.x, hover.y);
          const segD = Math.hypot(hover.x - last.x, hover.y - last.y);

          ctx.strokeStyle = "#ea580c";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.setLineDash([]);

          const angle = Math.atan2(hy - ly, hx - lx);
          this.drawEdgeLabelBadge(ctx, (lx + hx) / 2, (ly + hy) / 2, segD, angle);
        }

        // Kırık Hat Çoklu Ölçüm Toplam Rozeti (Canlı / Tamamlanmış)
        if (pts.length >= 2) {
          let totalDist = this.calcLength(pts, false);
          let segCount = pts.length - 1;
          if (hover && !this.measureFinished) {
            const last = pts[pts.length - 1];
            totalDist += Math.hypot(hover.x - last.x, hover.y - last.y);
            segCount++;
          }
          const targetPt = (hover && !this.measureFinished) ? hover : pts[pts.length - 1];
          const badgeX = this.sx(targetPt.x, targetPt.y);
          const badgeY = this.sy(targetPt.x, targetPt.y) - 34;
          this.drawPolylineSummaryBadge(ctx, badgeX, badgeY, totalDist, segCount, this.measureFinished);
        }
      }
    }

    // 3. FREE_AREA (Serbest Çokgen Alanı, Kenar Boyları ve Dinamik Köşe/Orta Nokta Tutamaçları)
    else if (this.queryMode === this.QueryMode.FREE_AREA) {
      const allPts = [...pts];
      if (hover && !this.measureFinished) allPts.push(hover);

      if (allPts.length >= 2) {
        // Çokgen Dolgusu ve Ana Konturu
        ctx.beginPath();
        ctx.moveTo(this.sx(allPts[0].x, allPts[0].y), this.sy(allPts[0].x, allPts[0].y));
        for (let i = 1; i < allPts.length; i++) {
          ctx.lineTo(this.sx(allPts[i].x, allPts[i].y), this.sy(allPts[i].x, allPts[i].y));
        }
        if (allPts.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = "rgba(234, 88, 12, 0.22)";
          ctx.fill();
        }
        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2.4;
        ctx.stroke();

        // Kenar Uzunlukları ve Kenar Orta Noktası Tutamaçları (Midpoint Grips)
        const edgeCount = (allPts.length >= 3) ? allPts.length : allPts.length - 1;
        for (let i = 0; i < edgeCount; i++) {
          const a = allPts[i];
          const b = allPts[(i + 1) % allPts.length];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const ax = this.sx(a.x, a.y);
          const ay = this.sy(a.x, a.y);
          const bx = this.sx(b.x, b.y);
          const by = this.sy(b.x, b.y);
          const mx = (ax + bx) / 2.0;
          const my = (ay + by) / 2.0;
          const angle = Math.atan2(by - ay, bx - ax);

          // Kenar Uzunluğu Rozeti (Orta nokta tutamacıyla çakışmaması için çizginin yukarısına ötelendi)
          if (d > 0.05) {
            this.drawEdgeLabelBadge(ctx, mx, my, d, angle, -16);
          }

          // Kenar Orta Noktası Tutamacı (Midpoint Grip: Çekilerek araya yeni köşe eklenir)
          if (pts.length >= 3 && (!hover || this.measureFinished)) {
            const isHoverMid = (this.hoverMeasureGrip && this.hoverMeasureGrip.type === 'midpoint' && this.hoverMeasureGrip.insertIndex === (i + 1));
            const midSize = isHoverMid ? 9 : 6;
            ctx.fillStyle = isHoverMid ? "#ea580c" : "#ffffff";
            ctx.strokeStyle = isHoverMid ? "#ffffff" : "#ea580c";
            ctx.lineWidth = isHoverMid ? 2 : 1.5;
            ctx.fillRect(mx - midSize / 2, my - midSize / 2, midSize, midSize);
            ctx.strokeRect(mx - midSize / 2, my - midSize / 2, midSize, midSize);

            if (isHoverMid) {
              ctx.font = "bold 10px 'Segoe UI', Arial, sans-serif";
              ctx.fillStyle = "#ea580c";
              ctx.textBaseline = "middle";
              ctx.fillText("➕ Yeni Köşe Ekle", mx + 10, my - 6);
            }
          }
        }

        // Köşe Tutamaçları (Vertex Grips: Taşınabilir ve Sağ Tıkla Silinebilir)
        pts.forEach((p, idx) => {
          const px = this.sx(p.x, p.y);
          const py = this.sy(p.x, p.y);
          const isDragged = (this.draggedMeasureGrip && this.draggedMeasureGrip.index === idx);
          const isHover = (this.hoverMeasureGrip && this.hoverMeasureGrip.type === 'vertex' && this.hoverMeasureGrip.index === idx);

          if (isDragged || isHover) {
            // Canlı Vurgulu Köşe
            ctx.fillStyle = isDragged ? "#16a34a" : "#ea580c";
            ctx.beginPath();
            ctx.arc(px, py, isDragged ? 8 : 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Dış Hedef Halkası
            ctx.strokeStyle = isDragged ? "rgba(22, 163, 74, 0.45)" : "rgba(234, 88, 12, 0.45)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(px, py, 13, 0, Math.PI * 2);
            ctx.stroke();

            // Bilgi Rozeti
            const tipText = isDragged ? `K${idx + 1} Taşınıyor...` : `K${idx + 1} • Taşı / Sağ Tık: Sil`;
            ctx.font = "bold 10.5px 'Segoe UI', Arial, sans-serif";
            const tm = ctx.measureText(tipText);
            const tw = tm.width + 12;
            ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
            ctx.fillRect(px + 10, py - 20, tw, 18);
            ctx.strokeStyle = isDragged ? "#16a34a" : "#ea580c";
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 10, py - 20, tw, 18);
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(tipText, px + 16, py - 11);
          } else {
            // Standart Şık CAD Tutamacı
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(px, py, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ea580c";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Köşe Numarası
            ctx.font = "bold 9px monospace";
            ctx.fillStyle = "#ea580c";
            ctx.textBaseline = "bottom";
            ctx.fillText(`${idx + 1}`, px + 6, py - 4);
          }
        });

        // Merkezdeki Alan ve Çevre Rozeti
        if (allPts.length >= 3) {
          const area = this.calcArea(allPts);
          const per = this.calcLength(allPts, true);
          let cx = 0, cy = 0;
          allPts.forEach(p => { cx += p.x; cy += p.y; });
          cx /= allPts.length;
          cy /= allPts.length;

          this.drawAreaBadge(ctx, this.sx(cx, cy), this.sy(cx, cy), area, per);
        }
      }
    }

    // 4. ANGLE (3 Nokta ile Kırıklık Açısı)
    else if (this.queryMode === this.QueryMode.ANGLE) {
      if (pts.length === 1 && hover) {
        const ax = this.sx(pts[0].x, pts[0].y);
        const ay = this.sy(pts[0].x, pts[0].y);
        const hx = this.sx(hover.x, hover.y);
        const hy = this.sy(hover.x, hover.y);
        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
      } else if (pts.length === 2) {
        const ax = this.sx(pts[0].x, pts[0].y);
        const ay = this.sy(pts[0].x, pts[0].y);
        const bx = this.sx(pts[1].x, pts[1].y);
        const by = this.sy(pts[1].x, pts[1].y);

        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        if (hover) {
          const hx = this.sx(hover.x, hover.y);
          const hy = this.sy(hover.x, hover.y);
          ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.setLineDash([]);
          this.drawAngleArcAndBadge(ctx, pts[0], pts[1], hover);
        }
      } else if (pts.length >= 3) {
        const ax = this.sx(pts[0].x, pts[0].y);
        const ay = this.sy(pts[0].x, pts[0].y);
        const bx = this.sx(pts[1].x, pts[1].y);
        const by = this.sy(pts[1].x, pts[1].y);
        const cx = this.sx(pts[2].x, pts[2].y);
        const cy = this.sy(pts[2].y, pts[2].y);

        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke();

        [pts[0], pts[1], pts[2]].forEach((p, idx) => {
          const px = this.sx(p.x, p.y);
          const py = this.sy(p.x, p.y);
          ctx.fillStyle = idx === 1 ? "#388bfd" : "#ea580c";
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        });

        this.drawAngleArcAndBadge(ctx, pts[0], pts[1], pts[2]);
      }
    }

    // 5. PERPENDICULAR (Hatta Dik Ayak - Dik Boy)
    else if (this.queryMode === this.QueryMode.PERPENDICULAR) {
      if (pts.length === 1 && hover) {
        const ax = this.sx(pts[0].x, pts[0].y);
        const ay = this.sy(pts[0].x, pts[0].y);
        const hx = this.sx(hover.x, hover.y);
        const hy = this.sy(hover.x, hover.y);
        ctx.strokeStyle = "#388bfd";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
      } else if (pts.length >= 2) {
        const A = pts[0];
        const B = pts[1];
        const ax = this.sx(A.x, A.y);
        const ay = this.sy(A.x, A.y);
        const bx = this.sx(B.x, B.y);
        const by = this.sy(B.x, B.y);

        ctx.strokeStyle = "#388bfd";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        const C = (pts.length >= 3) ? pts[2] : hover;
        if (C) {
          const vx = B.x - A.x;
          const vy = B.y - A.y;
          const len2 = vx * vx + vy * vy;
          if (len2 > 1e-9) {
            const t = ((C.x - A.x) * vx + (C.y - A.y) * vy) / len2;
            const H = { x: A.x + t * vx, y: A.y + t * vy };
            const hx = this.sx(H.x, H.y);
            const hy = this.sy(H.y, H.y);
            const cx = this.sx(C.x, C.y);
            const cy = this.sy(C.x, C.y);

            const dPerp = Math.hypot(C.x - H.x, C.y - H.y);
            const dPar = t * Math.sqrt(len2);

            ctx.strokeStyle = "#ea580c";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = "#ea580c";
            ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

            this.drawPerpendicularBadge(ctx, (cx + hx) / 2, (cy + hy) / 2, dPerp, dPar);
          }
        }
      }
    }

    ctx.restore();
  }

  // Yüksek Kontrastlı ve Çizgiye Paralel CAD Kenar Boyu Rozeti (Okunabilirlik Garantisi)
  drawEdgeLabelBadge(ctx, mx, my, lenVal, angle = 0, offsetDist = 0) {
    const text = `${lenVal.toFixed(2)} m`;
    ctx.save();
    ctx.translate(mx, my);

    if (angle !== 0) {
      let rot = angle;
      if (rot > Math.PI / 2 || rot < -Math.PI / 2) {
        rot += Math.PI;
      }
      ctx.rotate(rot);
    }

    // Çizgiye dik yönde öteleme (Orta nokta tutamaçları veya çizgiyle çakışmayı önler)
    if (offsetDist !== 0) {
      ctx.translate(0, offsetDist);
    }

    ctx.font = "bold 11px monospace";
    const textW = ctx.measureText(text).width;
    const boxW = Math.ceil(textW + 14);
    const boxH = 19;
    const boxX = -boxW / 2;
    const boxY = -boxH / 2;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    // Güçlü kontrastlı arka plan: Uyduda veya koyu temada derin siyah/lacivert, açık temada beyaz
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(10, 14, 22, 0.92)";
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.2;

    // Keskin 90° CAD rozeti
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Sol taraf estetik turuncu CAD çizgi vurgusu
    ctx.fillStyle = "#ea580c";
    ctx.fillRect(boxX, boxY, 3, boxH);

    // Metin: Koyu zeminde kristal beyaz, açık zeminde koyu siyah
    ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 1.5, 0.5);

    ctx.restore();
  }

  // --- KUŞBAKIŞI MİNİMAP (OVERVIEW / BIRDS EYE ENGINE) ---
  setupMinimap(canvas) {
    if (!canvas) return;
    this.minimapCanvas = canvas;
    this.minimapCtx = canvas.getContext('2d');

    // Minimap Tıklama ve Sürükleme Eventleri
    const handleMinimapInteraction = (e) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mw = this.minimapCanvas.width;
      const mh = this.minimapCanvas.height;

      // Minimap koordinatından CAD koordinatına dönüşüm
      const rangeX = Math.max(1, this.maxX - this.minX);
      const rangeY = Math.max(1, this.maxY - this.minY);
      const pad = 12;
      const usableW = mw - pad * 2;
      const usableH = mh - pad * 2;
      const scale = Math.min(usableW / rangeX, usableH / rangeY);

      const offsetX = pad + (usableW - rangeX * scale) / 2;
      const offsetY = pad + (usableH - rangeY * scale) / 2;

      const worldX = this.minX + (mx - offsetX) / scale;
      const worldY = this.maxY - (my - offsetY) / scale;

      // Kamerayı bu dünya koordinatına merkezle
      const base = Math.max(0.000001, this.bs());
      const projectCx = (this.minX + this.maxX) / 2.0;
      const projectCy = (this.minY + this.maxY) / 2.0;
      this.ox = -((worldX - projectCx) * base * this.zoom);
      this.oy = ((worldY - projectCy) * base * this.zoom);

      this.navUpdate();
      this.requestRender();
    };

    this.minimapCanvas.addEventListener('mousedown', (e) => {
      this.minimapDragging = true;
      handleMinimapInteraction(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.minimapDragging) {
        handleMinimapInteraction(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.minimapDragging) {
        this.minimapDragging = false;
        this.pushViewHistory();
      }
    });
  }

  drawMinimap() {
    if (!this.minimapCanvas || !this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    const isLight = (this.theme === "light" && !this.satelliteEnabled);
    ctx.fillStyle = isLight ? "#ffffff" : "#0c1017";
    ctx.fillRect(0, 0, w, h);

    if (this.entities.length === 0) {
      ctx.fillStyle = "#6e7681";
      ctx.font = "11px sans-serif";
      ctx.fillText("Proje Yok", w / 2 - 25, h / 2);
      return;
    }

    const rangeX = Math.max(1, this.maxX - this.minX);
    const rangeY = Math.max(1, this.maxY - this.minY);
    const pad = 10;
    const usableW = w - pad * 2;
    const usableH = h - pad * 2;
    const scale = Math.min(usableW / rangeX, usableH / rangeY);

    const offX = pad + (usableW - rangeX * scale) / 2;
    const offY = pad + (usableH - rangeY * scale) / 2;

    const mx = (x) => offX + (x - this.minX) * scale;
    const my = (y) => offY + (this.maxY - y) * scale;

    // Basitleştirilmiş çizim (Sadece tabaka renkleriyle hızlı konturlar)
    ctx.lineWidth = 1;
    const step = Math.max(1, Math.floor(this.entities.length / 400)); // En fazla 400 çizgiyle ultra hızlı render
    for (let i = 0; i < this.entities.length; i += step) {
      const e = this.entities[i];
      if (this.hidden.has(e.layer) || !e.points || e.points.length < 2) continue;
      ctx.strokeStyle = this.color(e.layer) || "#388bfd";
      ctx.beginPath();
      ctx.moveTo(mx(e.points[0].x), my(e.points[0].y));
      for (let j = 1; j < e.points.length; j++) {
        ctx.lineTo(mx(e.points[j].x), my(e.points[j].y));
      }
      if (e.kind === "Polygon") ctx.closePath();
      ctx.stroke();
    }

    // Mevcut Ekran Görüş Alanı Dikdörtgeni (Viewport Frame)
    const tl = this.worldAt(0, 0);
    const br = this.worldAt(this.width, this.height);

    const px0 = mx(tl.x);
    const py0 = my(tl.y);
    const px1 = mx(br.x);
    const py1 = my(br.y);

    const vx0 = Math.max(0, Math.min(w - 6, Math.min(px0, px1)));
    const vy0 = Math.max(0, Math.min(h - 6, Math.min(py0, py1)));
    const vx1 = Math.min(w, Math.max(6, Math.max(px0, px1)));
    const vy1 = Math.min(h, Math.max(6, Math.max(py0, py1)));

    const vw = Math.max(6, vx1 - vx0);
    const vh = Math.max(6, vy1 - vy0);

    // Yarı saydam turuncu görüş alanı (Viewport Frame)
    ctx.fillStyle = "rgba(234, 88, 12, 0.22)";
    ctx.fillRect(vx0, vy0, vw, vh);
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx0, vy0, vw, vh);

    // Çerçeve kenarı
    ctx.strokeStyle = isLight ? "#fdba74" : "#30363d";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
  }

  setupEvents() {
    window.addEventListener('resize', () => this.resize());
    this.updateCursor();

    // State for advanced navigation
    this.isMiddleDragging = false;
    this.isSpacePressed = false;
    this.touchPinchDist = null;
    this.touchMidX = 0;
    this.touchMidY = 0;

    // Wheel Zoom (Mouse tekerleği ile odak noktalı yumuşak yakınlaşma)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
      this.zoomAt(fx, fy, factor);
    }, { passive: false });

    // Mouse Down
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Orta Tuş (Wheel Click) veya Spacebar basılıyken Sol Tuş: Anında PAN
      if (e.button === 1 || (e.button === 0 && this.isSpacePressed)) {
        e.preventDefault();
        this.isMiddleDragging = true;
        this.lastMouseX = px;
        this.lastMouseY = py;
        this.canvas.style.cursor = "grabbing";
        return;
      }

      if (e.button !== 0) return; // Sadece sol tık diğer işlemler için

      if (this.zoomWindow) {
        this.zoomWindowStart = this.worldAt(px, py);
        this.zoomWindowNow = this.zoomWindowStart;
        this.requestRender();
        return;
      }

      if (this.boxSelect) {
        this.boxSelectStart = this.worldAt(px, py);
        this.boxSelectNow = this.boxSelectStart;
        this.requestRender();
        return;
      }

      // Ölçüm Modunda Tutamaç Yakalama (Köşe Taşıma & Kenar Ortasından Yeni Köşe Ekleme)
      if ((this.queryMode === this.QueryMode.FREE_AREA || this.queryMode === this.QueryMode.POLYLINE) && this.measurePts.length >= 2) {
        const grip = this.findMeasureGrip(px, py);
        if (grip) {
          e.preventDefault();
          if (grip.type === 'midpoint') {
            // Kenar orta noktası tutuldu: oraya anında yeni bir köşe ekle ve sürüklemeye başla
            this.measurePts.splice(grip.insertIndex, 0, { x: grip.pt.x, y: grip.pt.y });
            this.draggedMeasureGrip = { type: 'vertex', index: grip.insertIndex };
            this.updateMeasureInfo();
          } else {
            this.draggedMeasureGrip = grip;
          }
          this.isDragging = false;
          this.canvas.style.cursor = "grabbing";
          this.requestRender();
          return;
        }
      }

      this.isDragging = true;
      this.hasMoved = false;
      this.lastMouseX = px;
      this.lastMouseY = py;
    });

    // Mouse Move
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const wp = this.worldAt(px, py);
      this.lastWorldX = wp.x;
      this.lastWorldY = wp.y;
      this.navUpdate();

      // Orta tuş pan
      if (this.isMiddleDragging) {
        const dx = px - this.lastMouseX;
        const dy = py - this.lastMouseY;
        this.ox += dx;
        this.oy += dy;
        this.lastMouseX = px;
        this.lastMouseY = py;
        this.requestRender();
        return;
      }

      if (this.zoomWindow && this.zoomWindowStart) {
        this.zoomWindowNow = wp;
        this.requestRender();
        return;
      }

      if (this.boxSelect && this.boxSelectStart) {
        this.boxSelectNow = wp;
        this.requestRender();
        return;
      }

      // Ölçüm Tutamacı Sürükleniyorsa (Köşe Taşıma)
      if (this.draggedMeasureGrip) {
        const snapped = this.snapPoint(px, py);
        this.measurePts[this.draggedMeasureGrip.index] = { x: snapped.x, y: snapped.y };
        this.updateMeasureInfo();
        this.requestRender();
        return;
      }

      if (this.isDragging) {
        const dx = px - this.lastMouseX;
        const dy = py - this.lastMouseY;
        if (Math.hypot(dx, dy) > 2) {
          this.hasMoved = true;
          this.ox += dx;
          this.oy += dy;
          this.lastMouseX = px;
          this.lastMouseY = py;
          this.canvas.style.cursor = "grabbing";
          this.requestRender();
        }
      } else {
        let shouldRender = false;

        // Ölçüm Tutamacı Hover Algılama (İmleç Değişimi & Görsel Vurgu)
        if ((this.queryMode === this.QueryMode.FREE_AREA || this.queryMode === this.QueryMode.POLYLINE) && this.measurePts.length >= 2) {
          const hGrip = this.findMeasureGrip(px, py);
          const oldGrip = this.hoverMeasureGrip;
          const gripChanged = (oldGrip === null && hGrip !== null) ||
                              (oldGrip !== null && hGrip === null) ||
                              (oldGrip !== null && hGrip !== null && (oldGrip.index !== hGrip.index || oldGrip.type !== hGrip.type));
          if (gripChanged) {
            this.hoverMeasureGrip = hGrip;
            shouldRender = true;
          }
          if (hGrip) {
            this.canvas.style.cursor = (hGrip.type === 'vertex') ? 'move' : 'crosshair';
          } else {
            this.updateCursor();
          }
        } else {
          if (this.hoverMeasureGrip) {
            this.hoverMeasureGrip = null;
            shouldRender = true;
          }
          this.updateCursor();
        }

        const isMeasuring = !this.measureFinished && (
          (this.queryMode === this.QueryMode.DISTANCE && this.measurePts.length === 1) ||
          (this.queryMode === this.QueryMode.POLYLINE && this.measurePts.length >= 1) ||
          (this.queryMode === this.QueryMode.FREE_AREA && this.measurePts.length >= 1) ||
          (this.queryMode === this.QueryMode.ANGLE && this.measurePts.length >= 1 && this.measurePts.length < 3) ||
          (this.queryMode === this.QueryMode.PERPENDICULAR && this.measurePts.length >= 1 && this.measurePts.length < 3)
        );

        if (this.snapEnabled) {
          const oldHit = this.snapHit;
          const snapped = this.snapPoint(px, py);
          const newHit = this.snapHit;
          const hitChanged = (oldHit === null && newHit !== null) ||
                             (oldHit !== null && newHit === null) ||
                             (oldHit !== null && newHit !== null && (oldHit.p.x !== newHit.p.x || oldHit.p.y !== newHit.p.y || oldHit.kind !== newHit.kind));
          if (hitChanged) shouldRender = true;

          if (isMeasuring) {
            this.measureHoverPt = snapped;
            shouldRender = true;
          } else if (this.measureHoverPt) {
            this.measureHoverPt = null;
            shouldRender = true;
          }
        } else {
          if (isMeasuring) {
            this.measureHoverPt = wp;
            shouldRender = true;
          } else if (this.measureHoverPt) {
            this.measureHoverPt = null;
            shouldRender = true;
          }
        }

        if (shouldRender) {
          this.requestRender();
        }
      }
    });

    // Mouse Up
    this.canvas.addEventListener('mouseup', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Ölçüm Tutamacı Sürüklemesi Tamamlandı
      if (this.draggedMeasureGrip) {
        this.draggedMeasureGrip = null;
        this.updateCursor();
        if (this.queryMode === this.QueryMode.FREE_AREA && this.measurePts.length >= 3) {
          const area = this.calcArea(this.measurePts);
          const per = this.calcLength(this.measurePts, true);
          if (this.onMeasureInfo) {
            this.onMeasureInfo(`✔ ALAN GÜNCELLENDİ (${this.measurePts.length} Köşe) • ALAN: ${area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² • ÇEVRE: ${per.toFixed(2)} m`);
          }
        } else {
          this.updateMeasureInfo();
        }
        this.requestRender();
        return;
      }

      if (this.isMiddleDragging) {
        this.isMiddleDragging = false;
        this.updateCursor();
        this.pushViewHistory();
        if (this.showMinimap && this.minimapCanvas) {
          this.lastMinimapDraw = 0;
          this.drawMinimap();
        }
        this.requestRender();
        return;
      }

      if (this.zoomWindow && this.zoomWindowStart) {
        const a = this.zoomWindowStart;
        const b = this.worldAt(px, py);
        if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) {
          this.zoomToBounds(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y), true);
        }
        this.zoomWindow = false;
        this.zoomWindowStart = null;
        this.zoomWindowNow = null;
        if (this.onMeasureInfo) this.onMeasureInfo("Zoom pencere tamamlandı");
        return;
      }

      if (this.boxSelect && this.boxSelectStart) {
        const a = this.boxSelectStart;
        const b = this.worldAt(px, py);
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);

        this.boxSelect = false;
        this.boxSelectStart = null;
        this.boxSelectNow = null;
        this.updateCursor();

        if (Math.abs(maxX - minX) > 0.01 && Math.abs(maxY - minY) > 0.01) {
          this.selectInBox(minX, maxX, minY, maxY);
        }
        this.requestRender();
        return;
      }

      if (this.isDragging) {
        if (!this.hasMoved) {
          this.handleClick(px, py);
        } else {
          this.pushViewHistory();
        }
        this.isDragging = false;
        this.updateCursor();
        if (this.showMinimap && this.minimapCanvas) {
          this.lastMinimapDraw = 0;
          this.drawMinimap();
        }
        this.requestRender();
      }
    });

    // Mouse Leave: İmleç canvas dışına çıkınca snap temizliği
    this.canvas.addEventListener('mouseleave', () => {
      if (this.snapHit) {
        this.snapHit = null;
        this.requestRender();
      }
    });

    // Prevent default context menu on right click or middle click
    this.canvas.addEventListener('contextmenu', (e) => {
      // Ölçüm modunda bir köşe tutamacına sağ tıklandıysa: O köşeyi sil / iptal et!
      if ((this.queryMode === this.QueryMode.FREE_AREA || this.queryMode === this.QueryMode.POLYLINE) && this.measurePts.length > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const grip = this.findMeasureGrip(px, py);
        if (grip && grip.type === 'vertex') {
          e.preventDefault();
          this.deleteMeasurePoint(grip.index);
          return;
        }
      }

      // Sağ tık: Seçimi veya ölçümü iptal etme / son noktayı geri alma CAD standardı
      if (this.zoomWindow) {
        e.preventDefault();
        this.cancelZoomWindow();
        return;
      }
      if (this.boxSelect) {
        e.preventDefault();
        this.cancelBoxSelect();
        return;
      }
      // Ölçüm modunda sağ tık: Kırık hat veya serbest alanda ölçümü bitirme (CAD standardı)
      if ((this.queryMode === this.QueryMode.POLYLINE && this.measurePts.length >= 2) ||
          (this.queryMode === this.QueryMode.FREE_AREA && this.measurePts.length >= 3)) {
        if (!this.measureFinished) {
          e.preventDefault();
          this.finishMeasure();
          return;
        }
      }
      if (this.measurePts.length > 0) {
        e.preventDefault();
        this.undoMeasure();
        return;
      }
    });

    // Double Click (Çift Tıklama: Çokgen/Kırık Hat Ölçümünü Tamamlama veya Hızlı Zoom)
    this.canvas.addEventListener('dblclick', (e) => {
      if ((this.queryMode === this.QueryMode.FREE_AREA && this.measurePts.length >= 3) ||
          (this.queryMode === this.QueryMode.POLYLINE && this.measurePts.length >= 2)) {
        e.preventDefault();
        this.finishMeasure();
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, 1.8, true);
    });

    // Touch Pinch-to-Zoom & Pan (Mobil / Tablet Desteği)
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        this.isDragging = true;
        this.hasMoved = false;
        this.lastMouseX = t.clientX - rect.left;
        this.lastMouseY = t.clientY - rect.top;
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.touchPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const rect = this.canvas.getBoundingClientRect();
        this.touchMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
        this.touchMidY = (t1.clientY + t2.clientY) / 2 - rect.top;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        const t = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const px = t.clientX - rect.left;
        const py = t.clientY - rect.top;
        const dx = px - this.lastMouseX;
        const dy = py - this.lastMouseY;
        if (Math.hypot(dx, dy) > 2) {
          this.hasMoved = true;
          this.ox += dx;
          this.oy += dy;
          this.lastMouseX = px;
          this.lastMouseY = py;
          this.requestRender();
        }
      } else if (e.touches.length === 2 && this.touchPinchDist) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const factor = newDist / this.touchPinchDist;
        const rect = this.canvas.getBoundingClientRect();
        const newMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const newMidY = (t1.clientY + t2.clientY) / 2 - rect.top;

        // İki parmak hareketiyle hem pinch zoom hem de pan yap
        this.zoomAt(newMidX, newMidY, factor, false);
        this.ox += (newMidX - this.touchMidX);
        this.oy += (newMidY - this.touchMidY);

        this.touchPinchDist = newDist;
        this.touchMidX = newMidX;
        this.touchMidY = newMidY;
        this.requestRender();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        this.touchPinchDist = null;
      }
      if (e.touches.length === 0) {
        if (this.isDragging && !this.hasMoved) {
          this.handleClick(this.lastMouseX, this.lastMouseY);
        } else {
          this.pushViewHistory();
        }
        this.isDragging = false;
        if (this.showMinimap && this.minimapCanvas) {
          this.lastMinimapDraw = 0;
          this.drawMinimap();
        }
        this.requestRender();
      }
    });

    // Keyboard Shortcuts (Klavye Kısayolları)
    window.addEventListener('keydown', (e) => {
      // Modal açıkken veya bir input aktifken kısayolları engelle
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space' && !this.isSpacePressed) {
        this.isSpacePressed = true;
        this.canvas.style.cursor = "grab";
      } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        this.zoomIn();
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        this.zoomOut();
      } else if (e.key === 'Home') {
        this.fitToScreen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.zoomPrevious();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.zoomNext();
      } else if (e.key === 'ArrowLeft') {
        this.ox += 50; this.requestRender(); this.pushViewHistory();
      } else if (e.key === 'ArrowRight') {
        this.ox -= 50; this.requestRender(); this.pushViewHistory();
      } else if (e.key === 'ArrowUp') {
        this.oy += 50; this.requestRender(); this.pushViewHistory();
      } else if (e.key === 'ArrowDown') {
        this.oy -= 50; this.requestRender(); this.pushViewHistory();
      } else if (e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.altKey) {
        this.startZoomWindow();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.hoverMeasureGrip && this.hoverMeasureGrip.type === 'vertex') {
          e.preventDefault();
          this.deleteMeasurePoint(this.hoverMeasureGrip.index);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        this.updateCursor();
      }
    });
  }

  handleClick(px, py) {
    if (this.queryMode === this.QueryMode.LENGTH_LABEL) {
      this.lengthLabelTap(px, py);
    } else if (this.queryMode === this.QueryMode.POINT_CAPTURE) {
      this.capturePoint(px, py);
    } else if (
      this.queryMode === this.QueryMode.DISTANCE ||
      this.queryMode === this.QueryMode.POLYLINE ||
      this.queryMode === this.QueryMode.FREE_AREA ||
      this.queryMode === this.QueryMode.ANGLE ||
      this.queryMode === this.QueryMode.PERPENDICULAR ||
      this.queryMode === this.QueryMode.COORDINATE
    ) {
      this.measureTap(px, py);
    } else {
      this.selectAt(px, py);
    }
  }

  lengthLabelTap(px, py) {
    const raw = this.worldAt(px, py);
    const searchRadiusWorld = (32 / (Math.max(0.000001, this.bs()) * this.zoom));
    const localMetas = this.queryGrid(raw.x, raw.y, searchRadiusWorld);

    let best = 28.0;
    let ba = null, bb = null;

    for (let mi = 0; mi < localMetas.length; mi++) {
      const m = localMetas[mi];
      const e = m.e;
      if (this.hidden.has(e.layer) || !this.visible(m) || e.kind === "Text" || !e.points || e.points.length < 2) continue;
      const n = (e.kind === "Polygon") ? e.points.length : e.points.length - 1;
      for (let i = 0; i < n; i++) {
        const a = e.points[i];
        const b = e.points[(i + 1) % e.points.length];
        const q = this.nearestOnSegment(raw, a, b);
        const d = Math.hypot(this.sx(q.x, q.y) - px, this.sy(q.x, q.y) - py);
        if (d < best) {
          best = d;
          ba = a;
          bb = b;
        }
      }
    }

    if (!ba || !bb) {
      if (this.onMeasureInfo) this.onMeasureInfo("Kenar bulunamadı");
      return;
    }

    const mid = { x: (ba.x + bb.x) / 2.0, y: (ba.y + bb.y) / 2.0 };
    const value = Math.hypot(ba.x - bb.x, ba.y - bb.y);
    const existing = this.lengthLabels.findIndex(l => Math.hypot(l.mid.x - mid.x, l.mid.y - mid.y) < 0.001);

    if (existing >= 0) {
      this.lengthLabels.splice(existing, 1);
      if (this.onMeasureInfo) this.onMeasureInfo("Uzunluk yazısı kaldırıldı");
    } else {
      this.lengthLabels.push({ a: ba, b: bb, mid, value });
      if (this.onMeasureInfo) this.onMeasureInfo(`Uzunluk ${value.toFixed(3)} m yazdırıldı`);
    }
    this.requestRender();
  }

  capturePoint(px, py) {
    const p = this.snapPoint(px, py);
    const kind = this.snapHit ? this.snapHit.kind : "SERBEST";
    this.savedPoints.push({ x: p.x, y: p.y });
    this.requestRender();
    if (this.onMeasureInfo) {
      this.onMeasureInfo(`N${this.savedPoints.length} • ${kind} • Y ${p.y.toFixed(3)} • X ${p.x.toFixed(3)}`);
    }
  }

  measureTap(px, py) {
    const p = this.snapPoint(px, py);
    if (this.queryMode === this.QueryMode.COORDINATE) {
      if (this.onMeasureInfo) this.onMeasureInfo(`X ${p.x.toFixed(3)} • Y ${p.y.toFixed(3)}`);
    } else if (this.queryMode === this.QueryMode.DISTANCE) {
      if (this.measurePts.length >= 2) this.measurePts = [];
      this.measureFinished = false;
      this.measurePts.push(p);
      this.updateMeasureInfo();
    } else if (this.queryMode === this.QueryMode.POLYLINE) {
      // Eğer önceki ölçüm tamamlanmışsa, yeni bir kırık hat başlat
      if (this.measureFinished) {
        this.measurePts = [];
        this.measureFinished = false;
      }
      // Aynı noktaya çift tıklama veya çok yakın tıklamada son noktayı tekrarlamayı engelle
      if (this.measurePts.length > 0) {
        const last = this.measurePts[this.measurePts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.0001) {
          this.requestRender();
          return;
        }
      }
      this.measurePts.push(p);
      this.updateMeasureInfo();
    } else if (this.queryMode === this.QueryMode.FREE_AREA) {
      // Eğer önceki alan tamamlanmışsa, yeni bir alan başlat
      if (this.measureFinished) {
        this.measurePts = [];
        this.measureFinished = false;
      }
      if (this.measurePts.length > 0) {
        const last = this.measurePts[this.measurePts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.0001) {
          this.requestRender();
          return;
        }
      }
      this.measurePts.push(p);
      this.updateMeasureInfo();
    } else if (this.queryMode === this.QueryMode.ANGLE) {
      if (this.measurePts.length >= 3) this.measurePts = [];
      this.measureFinished = false;
      this.measurePts.push(p);
      this.updateMeasureInfo();
    } else if (this.queryMode === this.QueryMode.PERPENDICULAR) {
      if (this.measurePts.length >= 3) this.measurePts = [];
      this.measureFinished = false;
      this.measurePts.push(p);
      this.updateMeasureInfo();
    }
    this.requestRender();
  }

  selectAt(px, py) {
    const raw = this.worldAt(px, py);
    let chosen = null;

    const searchRadiusWorld = (40 / (Math.max(0.000001, this.bs()) * this.zoom));
    const localMetas = this.queryGrid(raw.x, raw.y, searchRadiusWorld);

    if (this.queryMode === this.QueryMode.AREA) {
      for (let i = localMetas.length - 1; i >= 0; i--) {
        const m = localMetas[i];
        if (this.hidden.has(m.e.layer) || this.lockedLayers.has(m.e.layer)) continue;
        if (this.visible(m) && m.e.kind === "Polygon" && m.e.points.length >= 3 && this.pointInPolygon(px, py, m.e.points)) {
          chosen = m;
          break;
        }
      }
    } else if (this.queryMode === this.QueryMode.LENGTH) {
      let best = 35.0;
      for (let i = 0; i < localMetas.length; i++) {
        const m = localMetas[i];
        if (this.hidden.has(m.e.layer) || this.lockedLayers.has(m.e.layer) || !this.visible(m) || m.e.kind === "Text" || !m.e.points || m.e.points.length < 2) continue;
        const d = this.screenDistanceToEntity(px, py, m.e);
        if (d < best) {
          best = d;
          chosen = m;
        }
      }
    } else { // SELECT Mode
      for (let i = localMetas.length - 1; i >= 0; i--) {
        const m = localMetas[i];
        if (this.hidden.has(m.e.layer) || this.lockedLayers.has(m.e.layer)) continue;
        if (this.visible(m) && m.e.kind === "Polygon" && m.e.points.length >= 3 && this.pointInPolygon(px, py, m.e.points)) {
          chosen = m;
          break;
        }
      }
      if (!chosen) {
        let best = 40.0;
        for (let i = 0; i < localMetas.length; i++) {
          const m = localMetas[i];
          if (this.hidden.has(m.e.layer) || this.lockedLayers.has(m.e.layer) || !this.visible(m)) continue;
          const d = this.screenDistanceToEntity(px, py, m.e);
          if (d < best) {
            best = d;
            chosen = m;
          }
        }
      }
    }

    this.selected = chosen ? chosen.e : null;

    if (this.onSelectionChanged) {
      if (chosen) {
        const p = chosen.e.points[0] || { x: 0, y: 0 };
        const len = (chosen.e.kind === "Polygon") ? chosen.perimeter : ((chosen.e.kind === "Circle") ? 2 * Math.PI * chosen.e.radius : this.calcLength(chosen.e.points, false));
        this.onSelectionChanged({
          kind: chosen.e.kind,
          layer: chosen.e.layer,
          layerName: this.layerName(chosen.e.layer),
          layerColor: this.color(chosen.e.layer),
          pointsCount: chosen.e.points ? chosen.e.points.length : 1,
          text: chosen.e.text || '',
          x: p.x,
          y: p.y,
          area: chosen.area,
          perimeter: chosen.perimeter,
          length: len,
          queryMode: this.queryMode
        });
      } else {
        this.onSelectionChanged(null);
      }
    }

    this.requestRender();
  }
}

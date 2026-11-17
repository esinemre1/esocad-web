import { parseNCZ } from './NczScanner.js';
import { CadView } from './CadView.js';
import { exportEntitiesToDxf, exportEntitiesToCsv } from './DxfExporter.js';

let currentLoadedFileName = "";

// DOM Elements
const canvas = document.getElementById('cadCanvas');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const hudNav = document.getElementById('hudNav');
const hudSelection = document.getElementById('hudSelection');
const layerPanel = document.getElementById('layerPanel');
const layerListContainer = document.getElementById('layerListContainer');
const layerSearchInput = document.getElementById('layerSearchInput');
const layerCountHeader = document.getElementById('layerCountHeader');
const dropZone = document.getElementById('dropZone');
const workspace = document.getElementById('workspace');

// Status & Toggle indicators
const snapStatusText = document.getElementById('snapStatusText');
const fillModeLabel = document.getElementById('fillModeLabel');
const textToggleLabel = document.getElementById('textToggleLabel');
const pointNamesLabel = document.getElementById('pointNamesLabel');
const pointStatusLabel = document.getElementById('pointStatusLabel');
const edgeLenStatusLabel = document.getElementById('edgeLenStatusLabel');
const projLabel = document.getElementById('projLabel');
const satStatusLabel = document.getElementById('satStatusLabel');
const btnSatellite = document.getElementById('btnSatellite');
const btnCadToggleSnap = document.getElementById('btnCadToggleSnap');
const btnToggleAreas = document.getElementById('btnToggleAreas');
const btnTogglePointNames = document.getElementById('btnTogglePointNames');

// Modal Elements
const modal = document.getElementById('genericModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalFooter = document.getElementById('modalFooter');
const btnModalClose = document.getElementById('btnModalClose');
const btnModalOk = document.getElementById('btnModalOk');

// Initialize CAD Engine
const cad = new CadView(canvas);

// Initialize Overview Minimap (Kuşbakışı Navigasyon)
const minimapCanvas = document.getElementById('minimapCanvas');
if (minimapCanvas) {
  cad.setupMinimap(minimapCanvas);
}

// Setup Callbacks
cad.onNavigationInfo = (msg) => {
  hudNav.textContent = msg;
};

cad.onMeasureInfo = (msg) => {
  hudSelection.textContent = msg;
};

// Sağ Panel Tıklanan Obje / Tabaka Canlı Bilgi Penceresi Elemanları (Kuşbakışı Üstü)
const entityInfoBox = document.getElementById('entityInfoBox');
const entInfoColor = document.getElementById('entInfoColor');
const entInfoLayer = document.getElementById('entInfoLayer');
const entInfoKind = document.getElementById('entInfoKind');
const entRowArea = document.getElementById('entRowArea');
const entInfoArea = document.getElementById('entInfoArea');
const entRowLength = document.getElementById('entRowLength');
const entInfoLength = document.getElementById('entInfoLength');
const entRowPerimeter = document.getElementById('entRowPerimeter');
const entInfoPerimeter = document.getElementById('entInfoPerimeter');
const entRowText = document.getElementById('entRowText');
const entInfoText = document.getElementById('entInfoText');
const entInfoCoord = document.getElementById('entInfoCoord');
const btnEntityInfoClose = document.getElementById('btnEntityInfoClose');
const btnEntZoom = document.getElementById('btnEntZoom');
const btnEntCopy = document.getElementById('btnEntCopy');
const btnEntLayerSolo = document.getElementById('btnEntLayerSolo');

let currentSelectedInfo = null;

if (btnEntityInfoClose) {
  btnEntityInfoClose.onclick = () => {
    if (entityInfoBox) entityInfoBox.classList.add('hidden');
  };
}

if (btnEntZoom) {
  btnEntZoom.onclick = () => {
    cad.zoomToSelected();
  };
}

if (btnEntCopy) {
  btnEntCopy.onclick = () => {
    copySelectedEntityInfo();
  };
}

if (btnEntLayerSolo) {
  btnEntLayerSolo.onclick = () => {
    if (currentSelectedInfo && currentSelectedInfo.layer !== undefined) {
      const isSolo = cad.isolateLayer(currentSelectedInfo.layer);
      renderLayersList();
      hudSelection.textContent = isSolo 
        ? `"${currentSelectedInfo.layerName}" tabakası izole edildi (Diğerleri gizlendi)` 
        : "Tabaka izolasyonu kaldırıldı";
    }
  };
}

function updateEntityInfoBox(s) {
  if (!entityInfoBox) return;
  if (!s) {
    entityInfoBox.classList.add('hidden');
    currentSelectedInfo = null;
    return;
  }

  currentSelectedInfo = s;
  entityInfoBox.classList.remove('hidden');

  if (entInfoColor) entInfoColor.style.backgroundColor = s.layerColor || cad.color(s.layer);
  if (entInfoLayer) entInfoLayer.textContent = `${s.layerName} [No: ${s.layer}]`;

  const typeName = (s.kind === "Polygon") ? "Parsel / Alan" : ((s.kind === "Point") ? "Nokta" : ((s.kind === "Line") ? "Çizgi / Hat" : s.kind));
  if (entInfoKind) entInfoKind.textContent = `${typeName} (${s.pointsCount || 1} nokta)`;

  // Alan gösterimi
  if (s.area && s.area > 0.01) {
    if (entRowArea) entRowArea.style.display = 'flex';
    if (entInfoArea) entInfoArea.textContent = `${s.area.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
  } else {
    if (entRowArea) entRowArea.style.display = 'none';
  }

  // Uzunluk gösterimi
  if (s.length && s.length > 0.001) {
    if (entRowLength) entRowLength.style.display = 'flex';
    if (entInfoLength) entInfoLength.textContent = `${s.length.toFixed(2)} m`;
  } else {
    if (entRowLength) entRowLength.style.display = 'none';
  }

  // Çevre gösterimi
  if (s.perimeter && s.perimeter > 0.01) {
    if (entRowPerimeter) entRowPerimeter.style.display = 'flex';
    if (entInfoPerimeter) entInfoPerimeter.textContent = `${s.perimeter.toFixed(2)} m`;
  } else {
    if (entRowPerimeter) entRowPerimeter.style.display = 'none';
  }

  // Yazı / Metin / Etiket
  if (s.text && s.text.trim()) {
    if (entRowText) entRowText.style.display = 'flex';
    if (entInfoText) entInfoText.textContent = s.text.trim();
  } else {
    if (entRowText) entRowText.style.display = 'none';
  }

  // Koordinat Y (Sağa) - X (Yukarı)
  if (entInfoCoord) {
    entInfoCoord.textContent = `Y: ${s.x.toFixed(2)}  X: ${s.y.toFixed(2)}`;
  }
}

cad.onSelectionChanged = (s) => {
  updateEntityInfoBox(s);

  if (!s) {
    hudSelection.textContent = "Hazır • Obje veya parsele tıklayarak seçin";
    return;
  }
  const typeText = (s.kind === "Polygon") ? "Alan" : ((s.kind === "Point") ? "Nokta" : ((s.kind === "Line") ? "Çizgi" : s.kind));
  if (s.queryMode === "AREA" && s.area > 0) {
    hudSelection.textContent = `📁 Tabaka: ${s.layerName} [No: ${s.layer}] • ${typeText} • Alan: ${s.area.toFixed(2)} m² • Çevre: ${s.perimeter.toFixed(2)} m`;
  } else if (s.queryMode === "LENGTH") {
    hudSelection.textContent = `📁 Tabaka: ${s.layerName} [No: ${s.layer}] • ${typeText} • Uzunluk: ${s.length.toFixed(2)} m`;
  } else if (s.area > 0) {
    hudSelection.textContent = `📁 Tabaka: ${s.layerName} [No: ${s.layer}] • ${typeText} • Alan: ${s.area.toFixed(2)} m² • Çevre: ${s.perimeter.toFixed(2)} m`;
  } else {
    hudSelection.textContent = `📁 Tabaka: ${s.layerName} [No: ${s.layer}] • ${typeText} • Y (Sağa): ${s.x.toFixed(3)}  X (Yukarı): ${s.y.toFixed(3)}`;
  }
};

// Güvenlik: HTML Kaçış Yardımcısı (XSS Önleme)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Modal Helper
function showModal(title, content, onOk = null, customButtons = null) {
  modalTitle.textContent = title;
  if (typeof content === 'string') {
    modalBody.innerHTML = content;
  } else {
    modalBody.innerHTML = '';
    modalBody.appendChild(content);
  }

  modalFooter.innerHTML = '';
  if (customButtons) {
    customButtons.forEach(btn => modalFooter.appendChild(btn));
  } else {
    const ok = document.createElement('button');
    ok.className = 'modal-btn primary';
    ok.textContent = 'TAMAM';
    ok.onclick = () => {
      closeModal();
      if (onOk) onOk();
    };
    modalFooter.appendChild(ok);
  }

  modal.classList.add('show');
}

function closeModal() {
  modal.classList.remove('show');
}

btnModalClose.onclick = closeModal;
btnModalOk.onclick = closeModal;
modal.onclick = (e) => {
  if (e.target === modal) closeModal();
};

// EsoCAD Klasik Masaüstü Menü Çubuğu Sistemi (Desktop Menubar System)
const menubarNav = document.getElementById('menubarNav');
let activeMenuId = null;

function closeAllMenus() {
  document.querySelectorAll('.menubar-dropdown').forEach(d => d.classList.remove('show'));
  document.querySelectorAll('.menubar-btn').forEach(b => b.classList.remove('open'));
  activeMenuId = null;
}

function openMenu(menuId, btn) {
  closeAllMenus();
  const dropdown = document.getElementById(menuId);
  if (!dropdown) return;
  dropdown.classList.add('show');
  btn.classList.add('open');
  activeMenuId = menuId;
}

// Menü Butonları Tıklama ve Hover Gezinme (Desktop Hover UX)
document.querySelectorAll('.menubar-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menuId = btn.dataset.menu;
    if (activeMenuId === menuId) {
      closeAllMenus();
    } else {
      openMenu(menuId, btn);
    }
  });

  btn.addEventListener('mouseenter', () => {
    // Eğer herhangi bir menü açıksa, fare diğer menünün üzerine geldiğinde otomatik geçiş yap
    if (activeMenuId && activeMenuId !== btn.dataset.menu) {
      openMenu(btn.dataset.menu, btn);
    }
  });
});

// Menü içi bir aksiyona veya boşluğa tıklandığında menüyü kapat
document.querySelectorAll('.menu-action').forEach(item => {
  item.addEventListener('click', () => {
    closeAllMenus();
  });
});

window.addEventListener('click', (e) => {
  if (!e.target.closest('.menubar-item')) {
    closeAllMenus();
  }
});

// Sağ Menubar Hızlı Erişim Butonları
const qBtnTkgm = document.getElementById('qBtnTkgm');
if (qBtnTkgm) {
  qBtnTkgm.onclick = () => toggleParcelPanel(true, 'live');
}

const qBtnLayers = document.getElementById('qBtnLayers');
if (qBtnLayers) {
  qBtnLayers.onclick = () => toggleLayerPanel();
}

const qBtnFitScreen = document.getElementById('qBtnFitScreen');
if (qBtnFitScreen) {
  qBtnFitScreen.onclick = () => cad.fitToScreen(true);
}

// Standart Kısayollar (Ctrl+O, Ctrl+L, Home, W, Esc)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    fileInput.click();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    layerPanel.classList.toggle('hidden');
    if (!layerPanel.classList.contains('hidden')) renderLayersList();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    if (cad.selected) {
      e.preventDefault();
      copySelectedEntityInfo();
    }
  } else if (e.key === 'Escape') {
    closeAllMenus();
    closeModal();
    if (entityInfoBox && !entityInfoBox.classList.contains('hidden')) {
      entityInfoBox.classList.add('hidden');
    }
    if (parcelPanel && !parcelPanel.classList.contains('hidden')) {
      toggleParcelPanel(false);
    }
    if (layerPanel && !layerPanel.classList.contains('hidden')) {
      toggleLayerPanel(false);
    }
    cad.cancelBoxSelect();
    cad.clearSelection();
    cad.clearMeasure();
    cad.setQueryMode(cad.QueryMode.SELECT);
    setActiveModeBtn(document.getElementById('btnQuerySelect'));
    hudSelection.textContent = "SEÇİM MODU (El İmleci Aktif) • Obje veya parsele tıklayarak seçin";
  } else if (!e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    cad.cancelBoxSelect();
    cad.setQueryMode(cad.QueryMode.SELECT);
    setActiveModeBtn(document.getElementById('btnQuerySelect'));
    hudSelection.textContent = "SEÇİM MODU (El İmleci Aktif) • Obje veya parsele tıklayarak seçin";
  } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    cad.setQueryMode(cad.QueryMode.DISTANCE);
    setActiveModeBtn(document.getElementById('btnMeasureDist'));
    hudSelection.textContent = "2 NOKTA MESAFE • Başlangıç ve bitiş noktalarını seçin";
  } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    cad.setQueryMode(cad.QueryMode.POLYLINE);
    setActiveModeBtn(document.getElementById('btnMeasurePoly'));
    hudSelection.textContent = "KIRIK HAT TOPLAM MESAFE • Noktaları sırayla seçin, çift tıkla tamamlayın";
  } else if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    cad.setQueryMode(cad.QueryMode.FREE_AREA);
    setActiveModeBtn(document.getElementById('btnMeasureFreeArea'));
    hudSelection.textContent = "SERBEST ÇOKGEN ALANI • Harita üzerinde köşelere tıklayın, çift tıkla tamamlayın";
  } else if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'n' || e.key === 'N')) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    setPointNamesVisible(!cad.showPointNames);
  }
});

// Full Screen Toggle (F11 / Tam Ekran)
const btnFullScreen = document.getElementById('btnFullScreen');
if (btnFullScreen) {
  btnFullScreen.onclick = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
}

// Projection Selector Items
document.querySelectorAll('#drop-proj .dropdown-item').forEach(item => {
  item.addEventListener('click', () => {
    const proj = item.dataset.proj;
    cad.setProjection(proj);

    const labels = {
      'NONE': 'Projeksiyon: Yok',
      'ITRF33': 'ITRF96 / TM33',
      'ITRF30': 'ITRF96 / TM30',
      'ITRF36': 'ITRF96 / TM36',
      'ITRF27': 'ITRF96 / TM27',
      'ED50_TM33': 'ED50 / TM33',
      'ED50_TM30': 'ED50 / TM30',
      'ED50_TM36': 'ED50 / TM36',
      'ED50_TM27': 'ED50 / TM27',
      'UTM35': 'WGS84 / UTM 35',
      'UTM36': 'WGS84 / UTM 36',
      'UTM37': 'WGS84 / UTM 37'
    };

    projLabel.textContent = labels[proj] || proj;
    closeAllMenus();

    if (proj !== 'NONE') {
      hudSelection.textContent = `${labels[proj]} koordinat sistemi aktif edildi`;
      if (!cad.satelliteEnabled) {
        cad.satelliteEnabled = true;
        btnSatellite.classList.add('active');
        satStatusLabel.textContent = "Google Uydu: Açık";
      }
      cad.requestRender();
    } else {
      hudSelection.textContent = "Projeksiyon kapatıldı (CAD Modu)";
      cad.satelliteEnabled = false;
      btnSatellite.classList.remove('active');
      satStatusLabel.textContent = "Google Uydu: Kapalı";
      cad.requestRender();
    }
  });
});

// Satellite Provider & Opacity Selector Items
document.querySelectorAll('#drop-sat-settings .dropdown-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.dataset.satProvider) {
      cad.setSatelliteProvider(item.dataset.satProvider);
      if (!cad.satelliteEnabled) {
        cad.satelliteEnabled = true;
        btnSatellite.classList.add('active');
        satStatusLabel.textContent = "Uydu: Açık";
      }
      hudSelection.textContent = `GIS Altlığı Aktif: ${item.textContent}`;
    } else if (item.dataset.satOpacity) {
      cad.setSatelliteOpacity(parseFloat(item.dataset.satOpacity));
      hudSelection.textContent = `Uydu ${item.textContent}`;
    }
    closeAllMenus();
  });
});

// Satellite Toggle Button
btnSatellite.onclick = () => {
  if (cad.projection === "NONE") {
    // If no projection is chosen, default to ITRF 33 (Dilim 33) as requested!
    cad.setProjection('ITRF33');
    projLabel.textContent = "ITRF96 / TM33";
  }

  const on = cad.toggleSatellite();
  if (on) {
    btnSatellite.classList.add('active');
    satStatusLabel.textContent = "Uydu: Açık";
    hudSelection.textContent = "GIS & Uydu altlığı devrede (ITRF96 / TM33)";
  } else {
    btnSatellite.classList.remove('active');
    satStatusLabel.textContent = "Uydu: Kapalı";
    hudSelection.textContent = "GIS & Uydu altlığı kapatıldı";
  }
};

// Mode Buttons Group helper
const modeButtons = [
  document.getElementById('btnQuerySelect'),
  document.getElementById('btnQueryArea'),
  document.getElementById('btnMeasureFreeArea'),
  document.getElementById('btnMeasureDist'),
  document.getElementById('btnMeasurePoly'),
  document.getElementById('btnMeasureAngle'),
  document.getElementById('btnMeasurePerpendicular'),
  document.getElementById('btnPointCapture')
];

function setActiveModeBtn(activeBtn) {
  modeButtons.forEach(btn => {
    if (btn) {
      btn.classList.remove('active');
      btn.classList.remove('active-mode');
    }
  });
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.classList.add('active-mode');
  }
  const bottomSelectBtn = document.getElementById('bBtnSelectMode');
  const bottomBoxBtn = document.getElementById('bBtnBoxSelect');
  if (bottomSelectBtn) {
    const isSelect = (activeBtn && activeBtn.id === 'btnQuerySelect');
    bottomSelectBtn.classList.toggle('active', isSelect);
  }
  if (bottomBoxBtn && activeBtn && activeBtn.id !== 'btnQuerySelect') {
    bottomBoxBtn.classList.remove('active');
  }
}

// Load NCZ File Function
async function loadNCZFile(file) {
  currentLoadedFileName = file.name;
  fileInfo.textContent = `${file.name} taranıyor...`;
  hudSelection.textContent = "NCZ binary geometriler çözümleniyor...";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const t0 = performance.now();
    const report = parseNCZ(arrayBuffer);
    const t1 = performance.now();

    cad.setEntities(report.entities, report.layers, report.layerColors, report.layerVisibility);

    // Kayıtlı TKGM parselleri varsa haritanın üzerine tekrar ekle
    const restoredCount = restoreAllStoredParcelsToMap(false);
    renderLayersList();
    updateSavedParcelsBadge();

    const hiddenCount = cad.hidden.size;
    const hiddenMsg = (hiddenCount > 0) ? ` • ${hiddenCount} tabaka varsayılan duruma göre kapalı açıldı` : '';
    const restoredMsg = (restoredCount > 0) ? ` • ${restoredCount} kayıtlı parsel eklendi` : '';

    // Auto-detect Turkish Geodetic Projection (ITRF 33, 30, 36, 27)
    const detectedProj = cad.detectProjection();
    let projMsg = "";
    if (detectedProj && cad.projection === "NONE") {
      cad.setProjection(detectedProj);
      cad.satelliteEnabled = true;
      btnSatellite.classList.add('active');
      satStatusLabel.textContent = "Google Uydu: Açık";
      const projNames = {
        'ITRF33': 'ITRF96 / TM33',
        'ITRF30': 'ITRF96 / TM30',
        'ITRF36': 'ITRF96 / TM36',
        'ITRF27': 'ITRF96 / TM27'
      };
      projLabel.textContent = projNames[detectedProj] || detectedProj;
      projMsg = ` • ${projNames[detectedProj]} algılandı ve Google Uydu açıldı`;
    }

    const kb = (report.size / 1024).toFixed(0);
    const parseSec = ((t1 - t0) / 1000).toFixed(2);
    fileInfo.textContent = `${file.name} (${kb} KB) • NCZ Sürüm: ${report.version} • ${report.entities.length.toLocaleString()} geometri (${parseSec}s)`;
    hudSelection.textContent = `Hazır • ${report.entities.length.toLocaleString()} geometri başarıyla yüklendi${projMsg}${hiddenMsg}`;

    const counts = {};
    for (let i = 0; i < report.entities.length; i++) {
      const k = report.entities[i].kind;
      counts[k] = (counts[k] || 0) + 1;
    }
    const sortedKinds = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const summaryHtml = `
      <div style="line-height: 1.8;">
        <div><strong>Dosya Adı:</strong> ${file.name}</div>
        <div><strong>Dosya Boyutu:</strong> ${report.size.toLocaleString()} bayt (${kb} KB)</div>
        <div><strong>Çözümleme Süresi:</strong> ${parseSec} saniye</div>
        <div><strong>NCZ Sürümü:</strong> ${report.version}</div>
        <div><strong>Toplam Tabaka:</strong> ${report.layers.length}</div>
        <div><strong>Toplam Geometri:</strong> ${report.entities.length.toLocaleString()}</div>
        <div style="margin-top: 10px;"><strong>Geometri Tipleri Dağılımı:</strong></div>
        <div class="mono-table" style="margin-top: 6px;">${sortedKinds.map(([k, v]) => `${k.padEnd(12)}: ${v.toLocaleString()}`).join('\n')}</div>
      </div>
    `;
    showModal("NCZ Başarıyla Açıldı", summaryHtml);
  } catch (err) {
    console.error("Hata:", err);
    fileInfo.textContent = "Dosya okuma hatası";
    hudSelection.textContent = "Hata: Dosya çözümlenemedi!";
    showModal("Hata", `<div style="color: #f85149;">Dosya açılırken hata oluştu: ${err.message}</div>`);
  }
}

// File Inputs & Drag-and-Drop
document.getElementById('btnOpenFile').onclick = () => fileInput.click();
fileInput.onchange = (e) => {
  if (e.target.files.length > 0) {
    loadNCZFile(e.target.files[0]);
  }
};

workspace.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('active');
});

workspace.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null || !workspace.contains(e.relatedTarget)) {
    dropZone.classList.remove('active');
  }
});

workspace.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('active');
  if (e.dataTransfer.files.length > 0) {
    loadNCZFile(e.dataTransfer.files[0]);
  }
});

// Layer Panel Butonları
const btnToggleLayers = document.getElementById('btnToggleLayers');
if (btnToggleLayers) {
  btnToggleLayers.onclick = () => toggleLayerPanel();
}
const btnClosePanel = document.getElementById('btnClosePanel');
if (btnClosePanel) {
  btnClosePanel.onclick = () => toggleLayerPanel(false);
}

// Gelişmiş Tabaka Yönetimi Durumları
let layerSortMode = 'NAME'; // 'NAME' (A-Z) veya 'COUNT' (Geometri Çoktan Aza)
let filterOnlyNonEmpty = false; // Sadece geometrisi olan tabakaları göster

function updateLayerStats(totalLayers, visibleLayers, totalGeoms) {
  const statsBar = document.getElementById('layerStatsBar');
  if (statsBar) {
    statsBar.textContent = `${visibleLayers} / ${totalLayers} açık • Toplam ${totalGeoms.toLocaleString()} geometri`;
  }
}

function openAddLayerModal() {
  const box = document.createElement('div');
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '12px';

  const rowName = document.createElement('div');
  rowName.innerHTML = `
    <label style="display:block; font-size:12px; margin-bottom:4px; color:#c9d1d9;">Tabaka Adı:</label>
    <input type="text" id="newLayerNameInput" placeholder="Örn: 101_PARSEL veya BİNA" style="width:100%; padding:8px 10px; background:#0d1117; border:1px solid #30363d; border-radius:4px; color:#fff; font-size:13px;">
  `;

  const rowColor = document.createElement('div');
  rowColor.innerHTML = `
    <label style="display:block; font-size:12px; margin-bottom:4px; color:#c9d1d9;">Tabaka Rengi:</label>
    <div style="display:flex; align-items:center; gap:10px;">
      <input type="color" id="newLayerColorInput" value="#39c5cf" style="width:40px; height:32px; border:none; background:transparent; cursor:pointer;">
      <span style="font-size:11.5px; color:#8b949e;">Haritada bu renkle çizilecektir</span>
    </div>
  `;

  box.appendChild(rowName);
  box.appendChild(rowColor);

  const btnCancel = document.createElement('button');
  btnCancel.className = 'modal-btn';
  btnCancel.textContent = 'İPTAL';
  btnCancel.onclick = closeModal;

  const btnCreate = document.createElement('button');
  btnCreate.className = 'modal-btn primary';
  btnCreate.textContent = 'OLUŞTUR';
  btnCreate.onclick = () => {
    const inputName = document.getElementById('newLayerNameInput');
    const inputColor = document.getElementById('newLayerColorInput');
    const name = (inputName ? inputName.value.trim() : '') || 'Yeni Tabaka';
    const color = inputColor ? inputColor.value : '#39c5cf';

    const newIdx = cad.addNewLayer(name, color);
    closeModal();
    renderLayersList();
    hudSelection.textContent = `"${name}" tabakası oluşturuldu (No: ${newIdx})`;
  };

  showModal("Yeni Tabaka Ekle", box, null, [btnCancel, btnCreate]);
  setTimeout(() => {
    const inp = document.getElementById('newLayerNameInput');
    if (inp) inp.focus();
  }, 100);
}

function renderLayersList() {
  layerListContainer.innerHTML = '';
  const counts = cad.layerCounts();
  const allLayerIndices = new Set([...Array(cad.layers.length).keys(), ...counts.keys()]);
  if (layerCountHeader) layerCountHeader.textContent = allLayerIndices.size;

  let totalGeoms = 0;
  let visibleLayers = 0;

  const layerItems = Array.from(allLayerIndices).map(code => {
    const count = counts.get(code) || 0;
    totalGeoms += count;
    if (cad.isLayerVisible(code)) visibleLayers++;
    return {
      code,
      name: cad.layerName(code),
      count,
      visible: cad.isLayerVisible(code),
      textVisible: cad.isLayerTextVisible(code),
      pointNamesVisible: cad.isLayerPointNamesVisible(code),
      locked: cad.isLayerLocked(code),
      color: cad.color(code)
    };
  });

  updateLayerStats(allLayerIndices.size, visibleLayers, totalGeoms);

  // Sıralama
  layerItems.sort((a, b) => {
    if (layerSortMode === 'COUNT') {
      return b.count - a.count || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  const query = layerSearchInput.value.trim().toLowerCase();

  for (let i = 0; i < layerItems.length; i++) {
    const item = layerItems[i];
    if (filterOnlyNonEmpty && item.count === 0) continue;
    if (query && !item.name.toLowerCase().includes(query) && !String(item.code).includes(query)) continue;

    const row = document.createElement('div');
    row.className = 'layer-row' + (item.locked ? ' locked' : '') + (cad.isolateState && cad.isolateState.layer === item.code ? ' isolated' : '');

    // Görünürlük Checkbox
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'layer-toggle';
    chk.checked = item.visible;
    chk.title = item.visible ? "Görünür (Gizlemek için tıkla)" : "Gizli (Göstermek için tıkla)";
    chk.onchange = (e) => {
      cad.setLayerVisible(item.code, e.target.checked);
      row.classList.toggle('isolated', false);
      updateLayerStats(allLayerIndices.size, Array.from(allLayerIndices).filter(c => cad.isLayerVisible(c)).length, totalGeoms);
    };

    // Renk Seçici Kutusu (Color Picker)
    const colorWrap = document.createElement('div');
    colorWrap.className = 'layer-color-wrap';
    colorWrap.style.backgroundColor = item.color;
    colorWrap.title = `Rengi Değiştir (${item.color})`;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'layer-color-input';
    colorInput.value = item.color.startsWith('#') ? item.color : '#39c5cf';
    colorInput.onchange = (e) => {
      const newHex = e.target.value;
      colorWrap.style.backgroundColor = newHex;
      cad.setLayerColor(item.code, newHex);
      hudSelection.textContent = `"${item.name}" tabakasının rengi güncellendi`;
    };
    colorWrap.appendChild(colorInput);

    // Tabaka Adı
    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = item.name;
    nameSpan.title = `Tabaka No: ${item.code} • Çift tıklayarak adı düzenleyin`;
    nameSpan.ondblclick = () => {
      const newName = prompt(`"${item.name}" tabakası için yeni ad:`, item.name);
      if (newName && newName.trim() && newName.trim() !== item.name) {
        cad.layers[item.code] = newName.trim();
        nameSpan.textContent = newName.trim();
        hudSelection.textContent = `Tabaka adı güncellendi: ${newName.trim()}`;
      }
    };

    // Geometri Sayısı Rozeti
    const countBadge = document.createElement('span');
    countBadge.className = 'layer-count-badge';
    countBadge.textContent = item.count.toLocaleString();
    countBadge.title = `${item.count} adet geometri`;

    // Eylemler Barı
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'layer-row-actions';

    // 1. Kilit Butonu (Lock/Unlock)
    const lockBtn = document.createElement('button');
    lockBtn.className = 'layer-icon-btn' + (item.locked ? ' active' : '');
    lockBtn.innerHTML = item.locked ? '🔒' : '🔓';
    lockBtn.title = item.locked ? "Tabaka Kilitli (Açmak için tıkla)" : "Tabakayı Kilitle (Seçimden korur)";
    lockBtn.onclick = (e) => {
      e.stopPropagation();
      const isLocked = cad.toggleLayerLock(item.code);
      lockBtn.innerHTML = isLocked ? '🔒' : '🔓';
      lockBtn.classList.toggle('active', isLocked);
      row.classList.toggle('locked', isLocked);
      hudSelection.textContent = `"${item.name}" tabakası ${isLocked ? 'kilitlendi' : 'kilidi açıldı'}`;
    };

    // 2. Solo / İzole Butonu (Sadece Bu Tabakayı Göster)
    const soloBtn = document.createElement('button');
    soloBtn.className = 'layer-icon-btn' + (cad.isolateState && cad.isolateState.layer === item.code ? ' active' : '');
    soloBtn.innerHTML = '🎯';
    soloBtn.title = `"${item.name}" tabakasını izole et (Sadece bu tabakayı göster)`;
    soloBtn.onclick = (e) => {
      e.stopPropagation();
      const isSolo = cad.isolateLayer(item.code);
      renderLayersList();
      hudSelection.textContent = isSolo ? `"${item.name}" tabakası izole edildi (Diğerleri gizlendi)` : "Tabaka izolasyonu kaldırıldı";
    };

    // 3. Tabakaya Odaklan Butonu (Zoom)
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'layer-icon-btn';
    zoomBtn.innerHTML = '🔍';
    zoomBtn.title = `"${item.name}" tabakasına ekranda odaklan`;
    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      const success = cad.zoomToLayer(item.code);
      if (success) {
        hudSelection.textContent = `"${item.name}" tabakasına odaklanıldı`;
        chk.checked = true;
      } else {
        showModal("Bilgi", `"${item.name}" tabakasında çizilmiş geometri bulunamadı.`);
      }
    };

    // 4. Tabakadaki Tüm Objeleri Seç Butonu
    const selectBtn = document.createElement('button');
    selectBtn.className = 'layer-icon-btn';
    selectBtn.innerHTML = '🗹';
    selectBtn.title = `"${item.name}" tabakasındaki tüm nesneleri seç`;
    selectBtn.onclick = (e) => {
      e.stopPropagation();
      const c = cad.selectLayerEntities(item.code);
      if (c > 0) {
        hudSelection.textContent = `"${item.name}" tabakasındaki ${c} geometri seçildi`;
      } else {
        showModal("Bilgi", `"${item.name}" tabakasında seçilecek nesne yok.`);
      }
    };

    // 0A. Nokta Adları / Numaraları Aç-Kapa Butonu (Her Tabaka İçin Ayrı Ayrı)
    const ptNameBtn = document.createElement('button');
    ptNameBtn.className = 'layer-icon-btn' + (item.pointNamesVisible ? ' active' : ' dimmed');
    ptNameBtn.innerHTML = '🏷️';
    ptNameBtn.title = item.pointNamesVisible 
      ? `"${item.name}" tabakasının nokta adlarını gizle` 
      : `"${item.name}" tabakasının nokta adlarını göster`;
    ptNameBtn.onclick = (e) => {
      e.stopPropagation();
      const isPtOn = cad.toggleLayerPointNames(item.code);
      ptNameBtn.classList.toggle('active', isPtOn);
      ptNameBtn.classList.toggle('dimmed', !isPtOn);
      ptNameBtn.title = isPtOn 
        ? `"${item.name}" tabakasının nokta adlarını gizle` 
        : `"${item.name}" tabakasının nokta adlarını göster`;
      hudSelection.textContent = `"${item.name}" tabakasının nokta adları ${isPtOn ? 'açıldı' : 'kapatıldı'}`;
    };

    // 0B. Yazı / Alan / Parsel No Aç-Kapa Butonu (Text Toggle)
    const textBtn = document.createElement('button');
    textBtn.className = 'layer-icon-btn' + (item.textVisible ? ' active' : '');
    textBtn.innerHTML = item.textVisible ? '📝' : '🚫';
    textBtn.title = item.textVisible 
      ? `"${item.name}" tabakasının yazılarını gizle` 
      : `"${item.name}" tabakasının yazılarını göster`;
    textBtn.onclick = (e) => {
      e.stopPropagation();
      const isTextOn = cad.toggleLayerText(item.code);
      textBtn.innerHTML = isTextOn ? '📝' : '🚫';
      textBtn.classList.toggle('active', isTextOn);
      textBtn.title = isTextOn 
        ? `"${item.name}" tabakasının yazılarını gizle` 
        : `"${item.name}" tabakasının yazılarını göster`;
      hudSelection.textContent = `"${item.name}" tabakasının yazıları ${isTextOn ? 'açıldı' : 'kapatıldı'}`;
    };

    actionsWrap.appendChild(ptNameBtn);
    actionsWrap.appendChild(textBtn);
    actionsWrap.appendChild(lockBtn);
    actionsWrap.appendChild(soloBtn);
    actionsWrap.appendChild(zoomBtn);
    actionsWrap.appendChild(selectBtn);

    row.appendChild(chk);
    row.appendChild(colorWrap);
    row.appendChild(nameSpan);
    row.appendChild(countBadge);
    row.appendChild(actionsWrap);

    row.onclick = (e) => {
      if (!e.target.closest('.layer-toggle') && !e.target.closest('.layer-color-wrap') && !e.target.closest('.layer-row-actions')) {
        chk.checked = !chk.checked;
        cad.setLayerVisible(item.code, chk.checked);
        updateLayerStats(allLayerIndices.size, Array.from(allLayerIndices).filter(c => cad.isLayerVisible(c)).length, totalGeoms);
      }
    };

    layerListContainer.appendChild(row);
  }
}

layerSearchInput.oninput = renderLayersList;

// Panel İçi Hızlı Düğmeler
const btnPanelAddLayer = document.getElementById('btnPanelAddLayer');
if (btnPanelAddLayer) {
  btnPanelAddLayer.onclick = openAddLayerModal;
}

document.getElementById('btnAllLayersOn').onclick = () => {
  cad.setAllLayersVisible(true);
  renderLayersList();
  hudSelection.textContent = "Tüm tabakalar görünür yapıldı";
};

document.getElementById('btnAllLayersOff').onclick = () => {
  cad.setAllLayersVisible(false);
  renderLayersList();
  hudSelection.textContent = "Tüm tabakalar gizlendi";
};

const btnInvertLayers = document.getElementById('btnInvertLayers');
if (btnInvertLayers) {
  btnInvertLayers.onclick = () => {
    cad.invertLayersVisibility();
    renderLayersList();
    hudSelection.textContent = "Tabaka görünürlükleri tersine çevrildi";
  };
}

const btnSortLayers = document.getElementById('btnSortLayers');
if (btnSortLayers) {
  btnSortLayers.onclick = () => {
    layerSortMode = (layerSortMode === 'NAME') ? 'COUNT' : 'NAME';
    btnSortLayers.textContent = (layerSortMode === 'COUNT') ? 'SIRALA (SAYI)' : 'SIRALA (A-Z)';
    renderLayersList();
  };
}

// Üst Menü "Tabaka ▾" Eylemleri
const mBtnOpenLayerPanel = document.getElementById('mBtnOpenLayerPanel');
if (mBtnOpenLayerPanel) {
  mBtnOpenLayerPanel.onclick = () => {
    layerPanel.classList.remove('hidden');
    renderLayersList();
  };
}

const mBtnAddNewLayer = document.getElementById('mBtnAddNewLayer');
if (mBtnAddNewLayer) {
  mBtnAddNewLayer.onclick = openAddLayerModal;
}

const mBtnAllLayersOn = document.getElementById('mBtnAllLayersOn');
if (mBtnAllLayersOn) {
  mBtnAllLayersOn.onclick = () => {
    cad.setAllLayersVisible(true);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakalar açıldı";
  };
}

const mBtnAllLayersOff = document.getElementById('mBtnAllLayersOff');
if (mBtnAllLayersOff) {
  mBtnAllLayersOff.onclick = () => {
    cad.setAllLayersVisible(false);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakalar kapatıldı";
  };
}

const mBtnInvertLayers = document.getElementById('mBtnInvertLayers');
if (mBtnInvertLayers) {
  mBtnInvertLayers.onclick = () => {
    cad.invertLayersVisibility();
    renderLayersList();
    hudSelection.textContent = "Tabaka görünürlükleri tersine çevrildi";
  };
}

const mBtnAllLayerTextsOn = document.getElementById('mBtnAllLayerTextsOn');
if (mBtnAllLayerTextsOn) {
  mBtnAllLayerTextsOn.onclick = () => {
    cad.setAllLayerTextsVisible(true);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakaların yazıları açıldı";
  };
}

const mBtnAllLayerTextsOff = document.getElementById('mBtnAllLayerTextsOff');
if (mBtnAllLayerTextsOff) {
  mBtnAllLayerTextsOff.onclick = () => {
    cad.setAllLayerTextsVisible(false);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakaların yazıları kapatıldı";
  };
}

// Merkezi Nokta Adı (Point Names) Durum Yöneticisi
function setPointNamesVisible(on) {
  cad.showPointNames = !!on;
  cad.requestRender();

  const mBtnTogglePointNames = document.getElementById('mBtnTogglePointNames');
  const mPointNamesLabel = document.getElementById('mPointNamesLabel');
  const btnPanelTogglePointNames = document.getElementById('btnPanelTogglePointNames');

  if (pointNamesLabel) {
    pointNamesLabel.textContent = `Nokta Adları: ${on ? 'Açık' : 'Kapalı'}`;
  }
  if (btnTogglePointNames) {
    btnTogglePointNames.classList.toggle('active', on);
  }
  if (mPointNamesLabel) {
    mPointNamesLabel.textContent = `🏷️ Nokta Adları: ${on ? 'Açık' : 'Kapalı'}`;
  }
  if (mBtnTogglePointNames) {
    mBtnTogglePointNames.classList.toggle('active-mode', on);
  }
  if (btnPanelTogglePointNames) {
    btnPanelTogglePointNames.classList.toggle('active', on);
    btnPanelTogglePointNames.style.color = on ? '#ea580c' : '';
  }

  hudSelection.textContent = `Nokta adları ve numaraları: ${on ? 'Açık' : 'Kapalı'}`;
}

// Tabaka Menüsü: Nokta Adları Aç/Kapat Butonları
const mBtnTogglePointNames = document.getElementById('mBtnTogglePointNames');
if (mBtnTogglePointNames) {
  mBtnTogglePointNames.onclick = () => {
    setPointNamesVisible(!cad.showPointNames);
  };
}

const mBtnAllPointNamesOn = document.getElementById('mBtnAllPointNamesOn');
if (mBtnAllPointNamesOn) {
  mBtnAllPointNamesOn.onclick = () => {
    cad.setAllLayerPointNamesVisible(true);
    setPointNamesVisible(true);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakaların nokta adları açıldı";
  };
}

const mBtnAllPointNamesOff = document.getElementById('mBtnAllPointNamesOff');
if (mBtnAllPointNamesOff) {
  mBtnAllPointNamesOff.onclick = () => {
    cad.setAllLayerPointNamesVisible(false);
    renderLayersList();
    hudSelection.textContent = "Tüm tabakaların nokta adları kapatıldı";
  };
}

// Tabaka Paneli: Nokta Adları Hızlı Butonu
const btnPanelTogglePointNames = document.getElementById('btnPanelTogglePointNames');
if (btnPanelTogglePointNames) {
  btnPanelTogglePointNames.onclick = () => {
    const nextState = !cad.showPointNames;
    if (nextState) {
      cad.setAllLayerPointNamesVisible(true);
    }
    setPointNamesVisible(nextState);
    renderLayersList();
  };
}

const mBtnFilterNonEmpty = document.getElementById('mBtnFilterNonEmpty');
if (mBtnFilterNonEmpty) {
  mBtnFilterNonEmpty.onclick = () => {
    filterOnlyNonEmpty = !filterOnlyNonEmpty;
    mBtnFilterNonEmpty.classList.toggle('active-mode', filterOnlyNonEmpty);
    renderLayersList();
    hudSelection.textContent = filterOnlyNonEmpty ? "Sadece dolu tabakalar gösteriliyor" : "Tüm tabakalar listeleniyor";
  };
}

// View Actions
document.getElementById('btnFit').onclick = () => cad.fitToScreen(true);
document.getElementById('qFit').onclick = () => cad.fitToScreen(true);
document.getElementById('btnZoomWindow').onclick = () => cad.startZoomWindow();
document.getElementById('qZoomIn').onclick = () => cad.zoomIn();
document.getElementById('qZoomOut').onclick = () => cad.zoomOut();

// Zoom Önceki / Sonraki
const btnZoomPrev = document.getElementById('btnZoomPrev');
if (btnZoomPrev) {
  btnZoomPrev.onclick = () => {
    if (!cad.zoomPrevious()) {
      hudSelection.textContent = "Önceki görünüm yok";
    }
  };
}

const btnZoomNext = document.getElementById('btnZoomNext');
if (btnZoomNext) {
  btnZoomNext.onclick = () => {
    if (!cad.zoomNext()) {
      hudSelection.textContent = "Sonraki görünüm yok";
    }
  };
}

// Kuşbakışı Minimap Aç/Kapat
const btnToggleMinimap = document.getElementById('btnToggleMinimap');
const minimapContainer = document.getElementById('minimapContainer');
const minimapStatusLabel = document.getElementById('minimapStatusLabel');
const btnMinimapClose = document.getElementById('btnMinimapClose');

function toggleMinimapState(open) {
  cad.showMinimap = open;
  const bBtnMinimap = document.getElementById('bBtnMinimap');
  if (open) {
    minimapContainer.classList.remove('hidden');
    minimapContainer.style.display = 'block';
    if (btnToggleMinimap) btnToggleMinimap.classList.add('active');
    if (bBtnMinimap) bBtnMinimap.classList.add('active');
    if (minimapStatusLabel) minimapStatusLabel.textContent = "Kuşbakışı: Açık";
    cad.requestRender();
  } else {
    minimapContainer.classList.add('hidden');
    minimapContainer.style.display = 'none';
    if (btnToggleMinimap) btnToggleMinimap.classList.remove('active');
    if (bBtnMinimap) bBtnMinimap.classList.remove('active');
    if (minimapStatusLabel) minimapStatusLabel.textContent = "Kuşbakışı: Kapalı";
  }
}

if (btnToggleMinimap) {
  btnToggleMinimap.onclick = () => {
    toggleMinimapState(!cad.showMinimap);
  };
}

if (btnMinimapClose) {
  btnMinimapClose.onclick = () => {
    toggleMinimapState(false);
  };
}

// Koordinata Git (Radar Beacon Reticle ile Uçuş)
const btnGotoCoord = document.getElementById('btnGotoCoord');
if (btnGotoCoord) {
  btnGotoCoord.onclick = () => {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '12px';

    const desc = document.createElement('div');
    desc.style.color = '#8b949e';
    desc.style.fontSize = '12px';
    desc.textContent = 'Gitmek istediğiniz harita koordinatlarını girin. Kamera yumuşak bir şekilde o noktaya uçacak ve radar reticle hedef işareti belirecektir.';
    box.appendChild(desc);

    const yInp = document.createElement('input');
    yInp.type = 'number';
    yInp.step = 'any';
    yInp.placeholder = 'Y (Sağa Değer / Easting ~500.000)';
    yInp.style.cssText = 'padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; color: #fff; border-radius: 4px; font-family: monospace; font-size: 13px;';

    const xInp = document.createElement('input');
    xInp.type = 'number';
    xInp.step = 'any';
    xInp.placeholder = 'X (Yukarı Değer / Northing ~4.200.000)';
    xInp.style.cssText = yInp.style.cssText;

    // Eğer projede kayıtlı nokta veya daha önce seçilmiş nokta varsa varsayılan olarak yaz
    if (cad.lastWorldX && cad.lastWorldY) {
      yInp.value = cad.lastWorldX.toFixed(3);
      xInp.value = cad.lastWorldY.toFixed(3);
    }

    box.appendChild(yInp);
    box.appendChild(xInp);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'modal-btn';
    btnCancel.textContent = 'İPTAL';
    btnCancel.onclick = closeModal;

    const btnGo = document.createElement('button');
    btnGo.className = 'modal-btn primary';
    btnGo.textContent = 'RADAR İLE GİT';
    btnGo.onclick = () => {
      const easting = parseFloat(yInp.value);
      const northing = parseFloat(xInp.value);
      if (isNaN(easting) || isNaN(northing)) {
        alert("Lütfen geçerli Y ve X sayısal değerleri girin.");
        return;
      }
      cad.zoomToCoordinate(easting, northing, null, `Y:${easting.toFixed(0)} X:${northing.toFixed(0)}`);
      closeModal();
      hudSelection.textContent = `Hedefe uçuldu: Y (Sağa): ${easting.toFixed(3)}  X (Yukarı): ${northing.toFixed(3)}`;
    };

    showModal("Koordinata Git (Radar Beacon)", box, null, [btnCancel, btnGo]);
  };
}

document.getElementById('btnZoomSelected').onclick = () => {
  if (!cad.zoomToSelected()) {
    showModal("Bilgi", "Lütfen önce bir obje veya parsel seçin.");
  }
};

document.getElementById('btnCycleFill').onclick = () => {
  const mode = cad.cycleFillMode();
  const name = cad.fillModeName();
  fillModeLabel.textContent = name;
  hudSelection.textContent = `Tarama / Dolgu modu: ${name}`;
};

// Toggle Drawing Texts (Yazılar Açık/Kapalı)
btnToggleAreas.onclick = () => {
  cad.showAreas = !cad.showAreas;
  cad.requestRender();
  if (cad.showAreas) {
    btnToggleAreas.classList.add('active');
    textToggleLabel.textContent = "Yazılar: Açık";
    hudSelection.textContent = "Çizim yazıları: Açık";
  } else {
    btnToggleAreas.classList.remove('active');
    textToggleLabel.textContent = "Yazılar: Kapalı";
    hudSelection.textContent = "Çizim yazıları: Kapalı";
  }
};

// Toggle Point Names / Numbers (Nokta Adları Açık/Kapalı)
if (btnTogglePointNames) {
  btnTogglePointNames.onclick = () => {
    setPointNamesVisible(!cad.showPointNames);
  };
}

// Yazı ve Nokta Adı Ölçeklendirici Butonu (0.8x -> 1.0x -> 1.3x -> 1.7x)
const btnCycleTextScale = document.getElementById('btnCycleTextScale');
const textScaleLabel = document.getElementById('textScaleLabel');
if (btnCycleTextScale) {
  btnCycleTextScale.onclick = () => {
    const newScale = cad.cycleTextScale();
    let scaleName = "1.0x (Normal)";
    if (newScale < 0.9) scaleName = "0.8x (Küçük)";
    else if (newScale > 1.5) scaleName = "1.7x (Büyük)";
    else if (newScale > 1.1) scaleName = "1.3x (Orta)";
    if (textScaleLabel) textScaleLabel.textContent = scaleName;
    hudSelection.textContent = `Yazı ve nokta adı boyutu: ${scaleName}`;
  };
}

document.getElementById('btnTogglePoints').onclick = () => {
  cad.showPoints = !cad.showPoints;
  cad.requestRender();
  pointStatusLabel.textContent = cad.showPoints ? "Görünür" : "Gizli";
  hudSelection.textContent = `Köşe nokta gösterimi: ${cad.showPoints ? 'Açık' : 'Kapalı'}`;
};

document.getElementById('btnToggleEdgeLengths').onclick = () => {
  cad.showEdgeLengths = !cad.showEdgeLengths;
  cad.requestRender();
  edgeLenStatusLabel.textContent = cad.showEdgeLengths ? "Görünür" : "Gizli";
  hudSelection.textContent = `Seçili kenar boyları: ${cad.showEdgeLengths ? 'Açık' : 'Kapalı'}`;
};

// Mode Actions
document.getElementById('btnQuerySelect').onclick = () => {
  cad.setQueryMode(cad.QueryMode.SELECT);
  setActiveModeBtn(document.getElementById('btnQuerySelect'));
  hudSelection.textContent = "SEÇİM MODU • Obje veya parsele tıklayarak seçin";
};

document.getElementById('btnQueryArea').onclick = () => {
  cad.setQueryMode(cad.QueryMode.AREA);
  setActiveModeBtn(document.getElementById('btnQueryArea'));
  hudSelection.textContent = "KAPALI ALAN SORGULA • Çizimdeki kapalı bir parsele tıklayın";
};

const btnMeasureFreeArea = document.getElementById('btnMeasureFreeArea');
if (btnMeasureFreeArea) {
  btnMeasureFreeArea.onclick = () => {
    cad.setQueryMode(cad.QueryMode.FREE_AREA);
    setActiveModeBtn(btnMeasureFreeArea);
    hudSelection.textContent = "SERBEST ÇOKGEN ALANI • Harita üzerinde köşelere tıklayın, çift tıkla tamamlayın";
  };
}

document.getElementById('btnMeasureDist').onclick = () => {
  cad.setQueryMode(cad.QueryMode.DISTANCE);
  setActiveModeBtn(document.getElementById('btnMeasureDist'));
  hudSelection.textContent = "2 NOKTA MESAFE • Başlangıç ve bitiş noktalarını seçin";
};

document.getElementById('btnMeasurePoly').onclick = () => {
  cad.setQueryMode(cad.QueryMode.POLYLINE);
  setActiveModeBtn(document.getElementById('btnMeasurePoly'));
  hudSelection.textContent = "KIRIK HAT TOPLAM MESAFE • Noktaları sırayla seçin, çift tıkla tamamlayın";
};

const btnMeasureAngle = document.getElementById('btnMeasureAngle');
if (btnMeasureAngle) {
  btnMeasureAngle.onclick = () => {
    cad.setQueryMode(cad.QueryMode.ANGLE);
    setActiveModeBtn(btnMeasureAngle);
    hudSelection.textContent = "AÇI ÖLÇÜMÜ • 1. Başlangıç, 2. Tepe (Köşe), 3. Bitiş noktasını seçin";
  };
}

const btnMeasurePerpendicular = document.getElementById('btnMeasurePerpendicular');
if (btnMeasurePerpendicular) {
  btnMeasurePerpendicular.onclick = () => {
    cad.setQueryMode(cad.QueryMode.PERPENDICULAR);
    setActiveModeBtn(btnMeasurePerpendicular);
    hudSelection.textContent = "DİK AYAK - DİK BOY • Önce hattın 2 ucunu, sonra dik düşülecek noktayı seçin";
  };
}

// ========================================================
// TKGM MEGSİS Sol Açılır/Kapanır Panel & Canlı Sorgu Motoru
// ========================================================
const parcelPanel = document.getElementById('parcelPanel');
const btnToggleParcelDock = document.getElementById('btnToggleParcelDock');
const btnCloseParcelPanel = document.getElementById('btnCloseParcelPanel');
const btnToggleLayerDock = document.getElementById('btnToggleLayerDock');

const tabParcelLive = document.getElementById('tabParcelLive');
const tabParcelSaved = document.getElementById('tabParcelSaved');
const viewParcelLive = document.getElementById('viewParcelLive');
const viewParcelSaved = document.getElementById('viewParcelSaved');
const parcelSavedBadge = document.getElementById('parcelSavedBadge');

const selPanelIl = document.getElementById('selPanelIl');
const selPanelIlce = document.getElementById('selPanelIlce');
const selPanelMahalle = document.getElementById('selPanelMahalle');
const inputPanelAda = document.getElementById('inputPanelAda');
const inputPanelParsel = document.getElementById('inputPanelParsel');
const btnPanelQueryExec = document.getElementById('btnPanelQueryExec');
const btnPanelQueryClear = document.getElementById('btnPanelQueryClear');
const panelQueryStatus = document.getElementById('panelQueryStatus');

// Kalıcı Sonuç Kartı Elemanları
const panelResultBox = document.getElementById('panelResultBox');
const resParcelBadge = document.getElementById('resParcelBadge');
const resLocationText = document.getElementById('resLocationText');
const resAdaParselText = document.getElementById('resAdaParselText');
const resTapuAlanText = document.getElementById('resTapuAlanText');
const resCadAlanText = document.getElementById('resCadAlanText');
const resPerimeterText = document.getElementById('resPerimeterText');
const resNitelikText = document.getElementById('resNitelikText');
const resMevkiiText = document.getElementById('resMevkiiText');
const resProjText = document.getElementById('resProjText');
const resCornerCount = document.getElementById('resCornerCount');
const resCoordTableWrap = document.getElementById('resCoordTableWrap');

const btnResZoom = document.getElementById('btnResZoom');
const btnResSave = document.getElementById('btnResSave');
const btnResRemove = document.getElementById('btnResRemove');
const btnResCopyCoords = document.getElementById('btnResCopyCoords');
const btnResExportDxf = document.getElementById('btnResExportDxf');
const btnResDrawLabels = document.getElementById('btnResDrawLabels');

// Kayıtlı Parseller Arama & Listeleme
const savedSearchInput = document.getElementById('savedSearchInput');
const btnSavedClearAll = document.getElementById('btnSavedClearAll');
const savedParcelsList = document.getElementById('savedParcelsList');

let activeCurrentParcel = null;
let provincesLoaded = false;

// Sol Parsel Panelini Aç/Kapat
function toggleParcelPanel(forceOpen = null, targetTab = null) {
  if (!parcelPanel) return;
  const isHidden = parcelPanel.classList.contains('hidden');
  const shouldOpen = (forceOpen !== null) ? forceOpen : isHidden;

  if (shouldOpen) {
    parcelPanel.classList.remove('hidden');
    if (btnToggleParcelDock) {
      btnToggleParcelDock.classList.add('active');
      btnToggleParcelDock.textContent = "◀ PARSEL";
    }
    if (!provincesLoaded) {
      loadProvincesIntoPanel();
    }
    if (targetTab === 'saved') {
      switchParcelTab('saved');
    } else if (targetTab === 'live') {
      switchParcelTab('live');
    }
  } else {
    parcelPanel.classList.add('hidden');
    if (btnToggleParcelDock) {
      btnToggleParcelDock.classList.remove('active');
      btnToggleParcelDock.textContent = "📍 PARSEL SORGU";
    }
  }
}

// Sağ Tabaka Panelini Aç/Kapat
function toggleLayerPanel(forceOpen = null) {
  if (!layerPanel) return;
  const isHidden = layerPanel.classList.contains('hidden');
  const shouldOpen = (forceOpen !== null) ? forceOpen : isHidden;

  if (shouldOpen) {
    layerPanel.classList.remove('hidden');
    if (btnToggleLayerDock) {
      btnToggleLayerDock.classList.add('active');
      btnToggleLayerDock.textContent = "TABAKALAR ▶";
    }
    renderLayersList();
  } else {
    layerPanel.classList.add('hidden');
    if (btnToggleLayerDock) {
      btnToggleLayerDock.classList.remove('active');
      btnToggleLayerDock.textContent = "📑 TABAKALAR";
    }
  }
}

// Dock ve Kapatma Butonları
if (btnToggleParcelDock) btnToggleParcelDock.onclick = () => toggleParcelPanel();
if (btnCloseParcelPanel) btnCloseParcelPanel.onclick = () => toggleParcelPanel(false);
if (btnToggleLayerDock) btnToggleLayerDock.onclick = () => toggleLayerPanel();

// Menüdeki TKGM ve Kayıtlılar Butonları
const btnTkgmQuery = document.getElementById('btnTkgmQuery');
if (btnTkgmQuery) {
  btnTkgmQuery.onclick = () => {
    closeAllMenus();
    toggleParcelPanel(true, 'live');
  };
}

// Sekme Değiştirme
function switchParcelTab(tab) {
  if (tab === 'saved') {
    tabParcelLive.classList.remove('active');
    tabParcelSaved.classList.add('active');
    viewParcelLive.style.display = 'none';
    viewParcelSaved.style.display = 'flex';
    renderSavedParcelsInPanel();
  } else {
    tabParcelSaved.classList.remove('active');
    tabParcelLive.classList.add('active');
    viewParcelSaved.style.display = 'none';
    viewParcelLive.style.display = 'flex';
  }
}

if (tabParcelLive) tabParcelLive.onclick = () => switchParcelTab('live');
if (tabParcelSaved) tabParcelSaved.onclick = () => switchParcelTab('saved');

// İl Listesini Yükle
function loadProvincesIntoPanel() {
  if (!selPanelIl) return;
  selPanelIl.innerHTML = '<option value="">İller yükleniyor...</option>';
  setPanelStatus("İller yükleniyor...", "info");

  fetch('/api/tkgm/iller')
    .then(r => r.json())
    .then(data => {
      selPanelIl.innerHTML = '<option value="">İl Seçiniz</option>';
      if (data && data.features) {
        data.features.sort((a, b) => a.properties.text.localeCompare(b.properties.text, 'tr')).forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.properties.id;
          opt.textContent = f.properties.text;
          selPanelIl.appendChild(opt);
        });
        provincesLoaded = true;
        clearPanelStatus();
      }
    })
    .catch(err => {
      selPanelIl.innerHTML = '<option value="">İller yüklenemedi</option>';
      setPanelStatus('İl listesi alınırken hata: ' + err.message, "error");
    });
}

// İl Değiştiğinde İlçeleri Getir
if (selPanelIl) {
  selPanelIl.onchange = () => {
    selPanelIlce.disabled = true;
    selPanelMahalle.disabled = true;
    selPanelIlce.innerHTML = '<option value="">Yükleniyor...</option>';
    selPanelMahalle.innerHTML = '<option value="">Önce ilçe seçiniz...</option>';

    if (!selPanelIl.value) {
      selPanelIlce.innerHTML = '<option value="">Önce il seçiniz...</option>';
      return;
    }

    setPanelStatus("İlçeler getiriliyor...", "info");
    fetch(`/api/tkgm/ilceler/${selPanelIl.value}`)
      .then(r => r.json())
      .then(data => {
        selPanelIlce.innerHTML = '<option value="">İlçe Seçiniz</option>';
        if (data && data.features) {
          data.features.sort((a, b) => a.properties.text.localeCompare(b.properties.text, 'tr')).forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.properties.id;
            opt.textContent = f.properties.text;
            selPanelIlce.appendChild(opt);
          });
          selPanelIlce.disabled = false;
          clearPanelStatus();
        }
      })
      .catch(err => {
        selPanelIlce.innerHTML = '<option value="">Hata oluştu</option>';
        setPanelStatus('İlçe listesi alınamadı: ' + err.message, "error");
      });
  };
}

// İlçe Değiştiğinde Mahalleleri Getir
if (selPanelIlce) {
  selPanelIlce.onchange = () => {
    selPanelMahalle.disabled = true;
    selPanelMahalle.innerHTML = '<option value="">Yükleniyor...</option>';

    if (!selPanelIlce.value) {
      selPanelMahalle.innerHTML = '<option value="">Önce ilçe seçiniz...</option>';
      return;
    }

    setPanelStatus("Mahalle / köyler getiriliyor...", "info");
    fetch(`/api/tkgm/mahalleler/${selPanelIlce.value}`)
      .then(r => r.json())
      .then(data => {
        selPanelMahalle.innerHTML = '<option value="">Mahalle / Köy Seçiniz</option>';
        if (data && data.features) {
          data.features.sort((a, b) => a.properties.text.localeCompare(b.properties.text, 'tr')).forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.properties.id;
            opt.textContent = f.properties.text;
            selPanelMahalle.appendChild(opt);
          });
          selPanelMahalle.disabled = false;
          clearPanelStatus();
        }
      })
      .catch(err => {
        selPanelMahalle.innerHTML = '<option value="">Hata oluştu</option>';
        setPanelStatus('Mahalle listesi alınamadı: ' + err.message, "error");
      });
  };
}

// Panel Durum Mesajı Yardımcıları
function setPanelStatus(msg, type = "info") {
  if (!panelQueryStatus) return;
  panelQueryStatus.style.display = 'block';
  panelQueryStatus.className = `parcel-status-box ${type}`;
  panelQueryStatus.textContent = msg;
}

function clearPanelStatus() {
  if (!panelQueryStatus) return;
  panelQueryStatus.style.display = 'none';
  panelQueryStatus.textContent = '';
}

// Formu Temizle
if (btnPanelQueryClear) {
  btnPanelQueryClear.onclick = () => {
    inputPanelAda.value = '';
    inputPanelParsel.value = '';
    clearPanelStatus();
  };
}

// Canlı TKGM MEGSİS Parsel Sorgulama Yürütme
if (btnPanelQueryExec) {
  btnPanelQueryExec.onclick = async () => {
    const mahalleId = selPanelMahalle ? selPanelMahalle.value : '';
    const ada = (inputPanelAda ? inputPanelAda.value.trim() : '') || '0';
    const parsel = inputPanelParsel ? inputPanelParsel.value.trim() : '';

    if (!mahalleId || !parsel) {
      setPanelStatus('Lütfen Mahalle ve Parsel No alanlarını doldurunuz.', 'error');
      return;
    }

    btnPanelQueryExec.disabled = true;
    setPanelStatus('TKGM MEGSİS parsel geometrisi sorgulanıyor...', 'info');

    try {
      const resp = await fetch(`/api/tkgm/parsel/${mahalleId}/${ada}/${parsel}`);
      if (!resp.ok) throw new Error(`Sunucu yanıtı: ${resp.status}`);
      const data = await resp.json();

      let feature = null;
      if (data.type === "Feature") feature = data;
      else if (data.features && data.features.length > 0) feature = data.features[0];

      if (!feature) {
        setPanelStatus('Belirtilen kriterlere uygun parsel kaydı bulunamadı.', 'error');
        btnPanelQueryExec.disabled = false;
        return;
      }

      // CAD Çizimine Ekle
      const res = cad.addTkgmParcel(data);
      if (!res.success) {
        setPanelStatus('Hata: ' + res.error, 'error');
        btnPanelQueryExec.disabled = false;
        return;
      }

      // Tabaka Listesini Yenile
      renderLayersList();

      // Projeksiyon Etiketini Güncelle
      const projNames = {
        'ITRF33': 'ITRF96 / TM33',
        'ITRF30': 'ITRF96 / TM30',
        'ITRF36': 'ITRF96 / TM36',
        'ITRF27': 'ITRF96 / TM27'
      };
      if (projLabel) projLabel.textContent = projNames[cad.projection] || cad.projection;
      if (cad.satelliteEnabled && btnSatellite && satStatusLabel) {
        btnSatellite.classList.add('active');
        satStatusLabel.textContent = "Google Uydu: Açık";
      }

      const p = res.props;
      const parcelRecord = {
        id: res.id,
        ilAd: p.ilAd || (selPanelIl.options[selPanelIl.selectedIndex]?.text || ''),
        ilceAd: p.ilceAd || (selPanelIlce.options[selPanelIlce.selectedIndex]?.text || ''),
        mahalleAd: p.mahalleAd || (selPanelMahalle.options[selPanelMahalle.selectedIndex]?.text || ''),
        adaNo: p.adaNo || ada,
        parselNo: p.parselNo || parsel,
        alan: p.alan || res.area.toFixed(2),
        nitelik: p.nitelik || '',
        mevkii: p.mevkii || '',
        cm: res.cm,
        targetProjCode: res.targetProjCode,
        cadArea: res.area,
        perimeter: res.perimeter,
        date: new Date().toLocaleString('tr-TR'),
        geojsonData: feature
      };

      // Kalıcı Depolamaya Kaydet
      saveParcelToStorage(parcelRecord);
      updateSavedParcelsBadge();

      // Kalıcı Sonuç Kartını Doldur ve Göster
      showParcelResultBox(parcelRecord);

      setPanelStatus('✓ Parsel başarıyla çizime eklendi ve sonuçlar kaydedildi!', 'success');
      hudSelection.textContent = `TKGM Parsel Eklendi: ${parcelRecord.ilceAd} ${parcelRecord.mahalleAd} ${ada}/${parsel} • ${parcelRecord.alan} m²`;
      btnPanelQueryExec.disabled = false;
    } catch (err) {
      console.error(err);
      setPanelStatus('Parsel sorgulama hatası: ' + err.message, 'error');
      btnPanelQueryExec.disabled = false;
    }
  };
}

// Kalıcı Sonuç Kartını Doldurma Fonksiyonu (Asla Kaybolmaz!)
function showParcelResultBox(parcel) {
  if (!panelResultBox || !parcel) return;
  activeCurrentParcel = parcel;

  if (resParcelBadge) resParcelBadge.textContent = `PARSEL: ${parcel.adaNo} / ${parcel.parselNo}`;
  if (resLocationText) resLocationText.textContent = `${parcel.ilAd || ''} / ${parcel.ilceAd || ''} / ${parcel.mahalleAd || ''}`;
  if (resAdaParselText) resAdaParselText.textContent = `Ada: ${parcel.adaNo} • Parsel: ${parcel.parselNo}`;
  if (resTapuAlanText) resTapuAlanText.textContent = `${parcel.alan} m²`;
  if (resCadAlanText) resCadAlanText.textContent = parcel.cadArea ? `${parcel.cadArea.toFixed(2)} m²` : `${parcel.alan} m²`;
  if (resPerimeterText) resPerimeterText.textContent = parcel.perimeter ? `${parcel.perimeter.toFixed(2)} m` : '-';
  if (resNitelikText) resNitelikText.textContent = parcel.nitelik || 'Belirtilmemiş';
  if (resMevkiiText) resMevkiiText.textContent = parcel.mevkii || 'Belirtilmemiş';
  if (resProjText) resProjText.textContent = `ITRF96 Dilim ${parcel.cm || 33} (TM${parcel.cm || 33})`;

  // Haritadaki Poligon Noktalarını Bulup Tabloya Bas
  const poly = cad.entities.find(e => e.tkgmId === parcel.id && e.kind === "Polygon");
  if (poly && poly.points && poly.points.length > 0) {
    if (resCornerCount) resCornerCount.textContent = poly.points.length;
    let tableHtml = `
      <table class="result-coord-table">
        <thead>
          <tr>
            <th>Nokta</th>
            <th>Y (Sağa)</th>
            <th>X (Yukarı)</th>
          </tr>
        </thead>
        <tbody>
    `;
    for (let i = 0; i < poly.points.length; i++) {
      const pt = poly.points[i];
      tableHtml += `
        <tr>
          <td><b>P${i + 1}</b></td>
          <td>${pt.x.toFixed(3)}</td>
          <td>${pt.y.toFixed(3)}</td>
        </tr>
      `;
    }
    tableHtml += `</tbody></table>`;
    if (resCoordTableWrap) resCoordTableWrap.innerHTML = tableHtml;
  } else {
    if (resCoordTableWrap) resCoordTableWrap.innerHTML = '<div style="padding: 8px; color: #64748b; font-size: 11px;">Koordinat geometrisi haritada bulunamadı.</div>';
  }

  panelResultBox.style.display = 'flex';
}

// Sonuç Kartı Buton Eylemleri
if (btnResZoom) {
  btnResZoom.onclick = () => {
    if (!activeCurrentParcel) return;
    const exists = cad.entities.some(e => e.tkgmId === activeCurrentParcel.id);
    if (!exists && activeCurrentParcel.geojsonData) {
      cad.addTkgmParcel(activeCurrentParcel.geojsonData);
      renderLayersList();
    }
    cad.zoomToTkgmParcel(activeCurrentParcel.id);
    hudSelection.textContent = `Parsele odaklanıldı: ${activeCurrentParcel.adaNo}/${activeCurrentParcel.parselNo}`;
  };
}

if (btnResSave) {
  btnResSave.onclick = () => {
    if (!activeCurrentParcel) return;
    saveParcelToStorage(activeCurrentParcel);
    updateSavedParcelsBadge();
    setPanelStatus(`✓ ${activeCurrentParcel.adaNo}/${activeCurrentParcel.parselNo} kalıcı hafızaya kaydedildi!`, 'success');
  };
}

if (btnResRemove) {
  btnResRemove.onclick = () => {
    if (!activeCurrentParcel) return;
    cad.removeTkgmParcel(activeCurrentParcel.id);
    panelResultBox.style.display = 'none';
    hudSelection.textContent = "Parsel çizimden kaldırıldı";
    setPanelStatus("Parsel çizimden kaldırıldı.", "info");
  };
}

if (btnResCopyCoords) {
  btnResCopyCoords.onclick = () => {
    if (!activeCurrentParcel) return;
    const poly = cad.entities.find(e => e.tkgmId === activeCurrentParcel.id && e.kind === "Polygon");
    if (!poly || !poly.points) return;
    let t = `NO\tY (SAĞA)\tX (YUKARI)\n`;
    poly.points.forEach((p, idx) => {
      t += `P${idx + 1}\t${p.x.toFixed(3)}\t${p.y.toFixed(3)}\n`;
    });
    navigator.clipboard.writeText(t).then(() => {
      hudSelection.textContent = `✓ ${poly.points.length} köşe koordinatı panoya kopyalandı!`;
      setPanelStatus(`✓ ${poly.points.length} köşe koordinatı panoya kopyalandı (Harita Y-X formatı)!`, 'success');
    });
  };
}

if (btnResExportDxf) {
  btnResExportDxf.onclick = () => {
    if (!activeCurrentParcel) return;
    downloadParcelDxf(activeCurrentParcel);
    hudSelection.textContent = `${activeCurrentParcel.adaNo}_${activeCurrentParcel.parselNo}.dxf indirildi`;
  };
}

if (btnResDrawLabels) {
  btnResDrawLabels.onclick = () => {
    if (!activeCurrentParcel) return;
    const poly = cad.entities.find(e => e.tkgmId === activeCurrentParcel.id && e.kind === "Polygon");
    if (poly) {
      const n = cad.drawParcelEdgeLengths(poly);
      hudSelection.textContent = `${n} kenar boyu çizime yazdırıldı`;
      setPanelStatus(`✓ ${n} kenar boyu haritaya yazdırıldı!`, 'success');
    }
  };
}

// Kayıtlı Parseller Sekmesini Doldurma
function renderSavedParcelsInPanel(filterText = '') {
  if (!savedParcelsList) return;
  const list = getStoredParcels();
  const filter = filterText.toLowerCase().trim();

  const filtered = filter ? list.filter(p => {
    const hay = `${p.ilAd || ''} ${p.ilceAd || ''} ${p.mahalleAd || ''} ${p.adaNo} ${p.parselNo} ${p.nitelik || ''}`.toLowerCase();
    return hay.includes(filter);
  }) : list;

  if (filtered.length === 0) {
    savedParcelsList.innerHTML = `<div class="saved-empty-msg">${filter ? 'Aramanıza uygun kayıt bulunamadı.' : 'Henüz kayıtlı parsel bulunmamaktadır.'}</div>`;
    return;
  }

  savedParcelsList.innerHTML = '';
  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'saved-parcel-item';

    const main = document.createElement('div');
    main.className = 'saved-parcel-main';
    const safeTitle = `${escapeHtml(p.ilceAd)} / ${escapeHtml(p.mahalleAd)} • Ada ${escapeHtml(p.adaNo)} Parsel ${escapeHtml(p.parselNo)}`;
    const safeDetails = `Alan: <b>${escapeHtml(p.alan)} m²</b> • ${escapeHtml(p.nitelik || 'Nitelik Yok')} • <span style="color: #64748b;">${escapeHtml(p.date || '')}</span>`;
    main.innerHTML = `
      <div class="saved-parcel-title">${safeTitle}</div>
      <div class="saved-parcel-details">${safeDetails}</div>
    `;
    main.onclick = () => {
      // Tıklandığında canlı görünüme geç ve sonuç kutusuna yükle
      switchParcelTab('live');
      const exists = cad.entities.some(e => e.tkgmId === p.id);
      if (!exists && p.geojsonData) {
        cad.addTkgmParcel(p.geojsonData);
        renderLayersList();
      }
      showParcelResultBox(p);
      cad.zoomToTkgmParcel(p.id);
    };

    const actions = document.createElement('div');
    actions.className = 'saved-parcel-actions';

    // Odaklan
    const btnZoom = document.createElement('button');
    btnZoom.className = 'sp-btn';
    btnZoom.innerHTML = '🎯';
    btnZoom.title = 'Haritada Odaklan';
    btnZoom.onclick = (e) => {
      e.stopPropagation();
      const exists = cad.entities.some(e => e.tkgmId === p.id);
      if (!exists && p.geojsonData) {
        cad.addTkgmParcel(p.geojsonData);
        renderLayersList();
      }
      cad.zoomToTkgmParcel(p.id);
      showParcelResultBox(p);
      hudSelection.textContent = `Parsele odaklanıldı: ${p.adaNo}/${p.parselNo}`;
    };

    // DXF İndir
    const btnDxf = document.createElement('button');
    btnDxf.className = 'sp-btn';
    btnDxf.innerHTML = '💾 DXF';
    btnDxf.title = 'DXF İndir';
    btnDxf.onclick = (e) => {
      e.stopPropagation();
      downloadParcelDxf(p);
    };

    // Sil
    const btnDel = document.createElement('button');
    btnDel.className = 'sp-btn danger';
    btnDel.innerHTML = '✕';
    btnDel.title = 'Hafızadan Sil';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      deleteStoredParcel(p.id);
      renderSavedParcelsInPanel(savedSearchInput ? savedSearchInput.value : '');
      if (activeCurrentParcel && activeCurrentParcel.id === p.id) {
        panelResultBox.style.display = 'none';
      }
    };

    actions.appendChild(btnZoom);
    actions.appendChild(btnDxf);
    actions.appendChild(btnDel);

    item.appendChild(main);
    item.appendChild(actions);
    savedParcelsList.appendChild(item);
  });
}

// Kayıtlı Parseller Arama Kutusu
if (savedSearchInput) {
  savedSearchInput.oninput = () => {
    renderSavedParcelsInPanel(savedSearchInput.value);
  };
}

// Tüm Kayıtları Temizle
if (btnSavedClearAll) {
  btnSavedClearAll.onclick = () => {
    if (confirm("Kayıtlı tüm parselleri silmek istediğinize emin misiniz?")) {
      clearAllStoredParcels();
      renderSavedParcelsInPanel();
      if (panelResultBox) panelResultBox.style.display = 'none';
      hudSelection.textContent = "Tüm kayıtlı parseller silindi";
    }
  };
}

// --- TKGM PARSEL KALICI HAFIZA SİSTEMİ (LOCALSTORAGE ENGINE) ---
const TKGM_STORAGE_KEY = 'CEPN_TKGM_SAVED_PARCELS';

function getStoredParcels() {
  try {
    const raw = localStorage.getItem(TKGM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Depolama okuma hatası:", e);
    return [];
  }
}

function saveParcelToStorage(record) {
  if (!record || !record.id) return;
  const list = getStoredParcels();
  const existingIdx = list.findIndex(p => p.id === record.id);
  if (existingIdx >= 0) {
    list[existingIdx] = record;
  } else {
    list.unshift(record); // Yeni parsel en başa
  }
  try {
    localStorage.setItem(TKGM_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Depolama yazma hatası:", e);
  }
}

function deleteStoredParcel(id) {
  const list = getStoredParcels().filter(p => p.id !== id);
  try {
    localStorage.setItem(TKGM_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {}
  cad.removeTkgmParcel(id);
  updateSavedParcelsBadge();
}

function clearAllStoredParcels() {
  const list = getStoredParcels();
  list.forEach(p => cad.removeTkgmParcel(p.id));
  try {
    localStorage.removeItem(TKGM_STORAGE_KEY);
  } catch (e) {}
  updateSavedParcelsBadge();
}

function updateSavedParcelsBadge() {
  const count = getStoredParcels().length;
  const label = document.getElementById('savedParcelsCountLabel');
  if (label) {
    label.textContent = count > 0 ? `Kayıtlı Parseller (${count})` : 'Kayıtlı Parseller';
  }
  const badge = document.getElementById('parcelSavedBadge');
  if (badge) {
    badge.textContent = count;
  }
}

// AutoCAD / CAD Uyumlu DXF Dosyası İndirme (ITRF LWPOLYLINE)
function downloadParcelDxf(p) {
  if (!p || !p.geojsonData) return;
  const data = p.geojsonData;
  let ring = data.geometry ? data.geometry.coordinates : null;
  while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0]) && typeof ring[0][0] !== 'number') {
    ring = ring[0];
  }
  if (!Array.isArray(ring) || ring.length < 3) {
    alert("Geçerli koordinat bulunamadı.");
    return;
  }

  const cm = p.cm || 33;
  const itrfProj = `+proj=tmerc +lat_0=0 +lon_0=${cm} +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs`;

  let dxf = "  0\nSECTION\n  2\nENTITIES\n";
  dxf += "  0\nLWPOLYLINE\n  8\nTKGM_PARSEL\n 90\n" + ring.length + "\n 70\n1\n";

  ring.forEach(pt => {
    let proj = null;
    try {
      proj = window.proj4("EPSG:4326", itrfProj, [pt[0], pt[1]]);
    } catch (e) {
      proj = [pt[0], pt[1]];
    }
    // CAD: X = Easting, Y = Northing
    dxf += ` 10\n${proj[0]}\n 20\n${proj[1]}\n`;
  });

  dxf += "  0\nENDSEC\n  0\nEOF";

  const blob = new Blob([dxf], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeIlce = (p.ilceAd || '').replace(/[^a-zA-Z0-9çÇğĞıİöÖşŞüÜ_-]/g, '_');
  const safeMahalle = (p.mahalleAd || '').replace(/[^a-zA-Z0-9çÇğĞıİöÖşŞüÜ_-]/g, '_');
  a.download = `${safeIlce}_${safeMahalle}_Ada${p.adaNo}_Parsel${p.parselNo}_itrf${cm}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Kayıtlı Parselleri Haritaya Geri Yükleme
function restoreAllStoredParcelsToMap(focus = false) {
  const list = getStoredParcels();
  if (list.length === 0) return 0;
  let count = 0;
  list.forEach(p => {
    if (p.geojsonData) {
      cad.addTkgmParcel(p.geojsonData, focus);
      count++;
    }
  });
  renderLayersList();
  if (focus && count > 0) {
    cad.fitToScreen(true);
  }
  return count;
}

// Kayıtlı Parseller Modalını Açma
function openSavedParcelsModal() {
  const list = getStoredParcels();
  if (list.length === 0) {
    showModal("Kayıtlı Parseller", `<div style="text-align: center; color: #8b949e; padding: 20px 0;">Henüz kaydedilmiş bir parsel bulunmuyor.<br><br>Üst menüdeki <b>TKGM Sorgu</b> butonundan parsel sorguladığınızda burada kalıcı olarak saklanacaktır.</div>`);
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '12px';

  const info = document.createElement('div');
  info.style.fontSize = '12px';
  info.style.color = '#8b949e';
  info.textContent = `Toplam ${list.length} adet kayıtlı parseliniz bulunmaktadır. İstediğiniz parsele tıklayarak odaklanabilir veya CAD (DXF) olarak indirebilirsiniz.`;
  wrap.appendChild(info);

  const listDiv = document.createElement('div');
  listDiv.className = 'saved-parcels-list';

  list.forEach(p => {
    const item = document.createElement('div');
    item.className = 'saved-parcel-item';

    const main = document.createElement('div');
    main.className = 'saved-parcel-main';
    const modalTitleText = `${p.ilAd ? `${escapeHtml(p.ilAd)} / ` : ''}${escapeHtml(p.ilceAd)} / ${escapeHtml(p.mahalleAd)} • Ada ${escapeHtml(p.adaNo)} Parsel ${escapeHtml(p.parselNo)}`;
    const modalDetailText = `Alan: <b>${escapeHtml(p.alan)} m²</b> • ${escapeHtml(p.nitelik || 'Nitelik Yok')} • ITRF96 (TM${escapeHtml(p.cm || 33)}) • <span style="color: #6e7681;">${escapeHtml(p.date || '')}</span>`;
    main.innerHTML = `
      <div class="saved-parcel-title">${modalTitleText}</div>
      <div class="saved-parcel-details">${modalDetailText}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'saved-parcel-actions';

    // Odaklan (Zoom)
    const btnZoom = document.createElement('button');
    btnZoom.className = 'sp-btn';
    btnZoom.innerHTML = '🎯 Odaklan';
    btnZoom.title = 'Haritada bu parsele odaklan ve radar reticle göster';
    btnZoom.onclick = () => {
      closeModal();
      // Haritada yoksa önce yükle
      const exists = cad.entities.some(e => e.tkgmId === p.id);
      if (!exists && p.geojsonData) {
        cad.addTkgmParcel(p.geojsonData);
        renderLayersList();
      }
      cad.zoomToTkgmParcel(p.id);
      hudSelection.textContent = `Parsele odaklanıldı: ${p.ilceAd} ${p.mahalleAd} ${p.adaNo}/${p.parselNo}`;
    };

    // DXF İndir
    const btnDxf = document.createElement('button');
    btnDxf.className = 'sp-btn';
    btnDxf.innerHTML = '💾 DXF';
    btnDxf.title = 'AutoCAD ve CAD uyumlu ITRF DXF dosyası indir';
    btnDxf.onclick = () => {
      downloadParcelDxf(p);
      hudSelection.textContent = `${p.adaNo}_${p.parselNo}.dxf indirildi`;
    };

    // Sil
    const btnDel = document.createElement('button');
    btnDel.className = 'sp-btn danger';
    btnDel.innerHTML = '✕';
    btnDel.title = 'Bu parseli hafızadan ve haritadan sil';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      deleteStoredParcel(p.id);
      item.remove();
      if (getStoredParcels().length === 0) {
        closeModal();
      }
      hudSelection.textContent = "Parsel hafızadan silindi";
    };

    actions.appendChild(btnZoom);
    actions.appendChild(btnDxf);
    actions.appendChild(btnDel);

    item.appendChild(main);
    item.appendChild(actions);
    listDiv.appendChild(item);
  });

  wrap.appendChild(listDiv);

  // Modal Butonları
  const btnClose = document.createElement('button');
  btnClose.className = 'modal-btn';
  btnClose.textContent = 'KAPAT';
  btnClose.onclick = closeModal;

  const btnReloadAll = document.createElement('button');
  btnReloadAll.className = 'modal-btn';
  btnReloadAll.textContent = 'TÜMÜNÜ ÇİZİME YÜKLE';
  btnReloadAll.onclick = () => {
    const loaded = restoreAllStoredParcelsToMap(true);
    closeModal();
    hudSelection.textContent = `${loaded} kayıtlı parsel haritaya yüklendi`;
  };

  const btnClearAll = document.createElement('button');
  btnClearAll.className = 'modal-btn danger';
  btnClearAll.style.backgroundColor = '#da3633';
  btnClearAll.textContent = 'TÜMÜNÜ SİL';
  let confirmTimer = null;
  btnClearAll.onclick = () => {
    if (btnClearAll.dataset.confirming === "true") {
      clearAllStoredParcels();
      closeModal();
      hudSelection.textContent = "Tüm kayıtlı parseller silindi";
    } else {
      btnClearAll.dataset.confirming = "true";
      btnClearAll.textContent = 'EMİN MİSİNİZ? (ONAYLA)';
      btnClearAll.style.backgroundColor = '#b62324';
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        btnClearAll.dataset.confirming = "false";
        btnClearAll.textContent = 'TÜMÜNÜ SİL';
        btnClearAll.style.backgroundColor = '#da3633';
      }, 3500);
    }
  };

  showModal(`Kayıtlı Parseller (${list.length})`, wrap, null, [btnClearAll, btnReloadAll, btnClose]);
}

// Menüdeki Kayıtlı Parseller Butonu Bağlantısı (Sol Panel Kayıtlılar Sekmesini Açar)
const btnSavedParcels = document.getElementById('btnSavedParcels');
if (btnSavedParcels) {
  btnSavedParcels.onclick = () => {
    closeAllMenus();
    toggleParcelPanel(true, 'saved');
  };
}

document.getElementById('btnParcelInfo').onclick = () => {
  const sum = cad.selectedParcelSummary();
  if (sum) {
    showModal("Parsel Bilgisi", `<div style="font-size: 15px; font-weight: 500; color: #58a6ff;">${sum}</div>`);
  } else {
    showModal("Uyarı", "Lütfen önce bir kapalı parsel (Polygon) seçin.");
  }
};

document.getElementById('btnParcelTable').onclick = () => {
  const table = cad.selectedParcelCornerTable();
  if (table) {
    const wrap = document.createElement('div');
    const pre = document.createElement('div');
    pre.className = 'mono-table';
    pre.textContent = table;
    wrap.appendChild(pre);
    showModal("Parsel Köşe • Kenar • Semt Tablosu", wrap);
  } else {
    showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
  }
};

document.getElementById('btnParcelLabels').onclick = () => {
  const n = cad.labelSelectedParcelEdges();
  if (n > 0) {
    hudSelection.textContent = `${n} kenar uzunluğu çizime yazdırıldı`;
  } else {
    showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
  }
};

document.getElementById('btnParcelSaveCorners').onclick = () => {
  const n = cad.saveSelectedParcelCorners();
  if (n > 0) {
    hudSelection.textContent = `${n} parsel köşesi Nokta Listesine eklendi`;
  } else {
    showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
  }
};

document.getElementById('btnMeasureLabel').onclick = () => {
  cad.setQueryMode(cad.QueryMode.LENGTH_LABEL);
  setActiveModeBtn(null);
  hudSelection.textContent = "UZUNLUK YAZDIR • İstediğiniz kenara tıklayın";
};

document.getElementById('btnMeasureClearLabels').onclick = () => cad.clearLengthLabels();
document.getElementById('btnMeasureClear').onclick = () => cad.clearMeasure();

// Snap & Point Actions
btnCadToggleSnap.onclick = () => {
  cad.snapEnabled = !cad.snapEnabled;
  if (cad.snapEnabled) {
    btnCadToggleSnap.classList.add('active');
    snapStatusText.textContent = "Snap: Açık";
    hudSelection.textContent = "SNAP motoru: Açık";
  } else {
    btnCadToggleSnap.classList.remove('active');
    snapStatusText.textContent = "Snap: Kapalı";
    hudSelection.textContent = "SNAP motoru: Kapalı";
  }
};

document.getElementById('btnPointCapture').onclick = () => {
  cad.setQueryMode(cad.QueryMode.POINT_CAPTURE);
  cad.snapEnabled = true;
  btnCadToggleSnap.classList.add('active');
  snapStatusText.textContent = "Snap: Açık";
  setActiveModeBtn(document.getElementById('btnPointCapture'));
  hudSelection.textContent = "NOKTA YAKALA • Köşe / Orta / Kesişim / Yakın";
};

document.getElementById('btnSnapSettings').onclick = () => {
  const kinds = ["KÖŞE", "ORTA", "KESİŞİM", "DİK", "YAKIN"];
  const div = document.createElement('div');
  div.className = 'snap-checkbox-group';

  kinds.forEach(k => {
    const row = document.createElement('label');
    row.className = 'snap-checkbox-row';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = cad.snapKinds.has(k);
    chk.onchange = (e) => {
      if (e.target.checked) cad.snapKinds.add(k);
      else cad.snapKinds.delete(k);
      cad.requestRender();
    };
    row.appendChild(chk);
    row.appendChild(document.createTextNode(k));
    div.appendChild(row);
  });

  showModal("SNAP (Mıknatıs) Ayarları", div);
};

document.getElementById('btnPointSaveCurrent').onclick = () => {
  const p = cad.saveCurrentPoint();
  if (!p) {
    showModal("Bilgi", "Haritada bir konuma tıklayın veya ölçüm noktası seçin.");
  }
};

document.getElementById('btnPointManual').onclick = () => {
  const box = document.createElement('div');
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '10px';

  const yInp = document.createElement('input');
  yInp.type = 'number';
  yInp.step = 'any';
  yInp.placeholder = 'Y (Sağa Değer / Easting ~500.000)';
  yInp.style.cssText = 'padding: 8px; background: #0d1117; border: 1px solid #30363d; color: #fff; border-radius: 4px;';

  const xInp = document.createElement('input');
  xInp.type = 'number';
  xInp.step = 'any';
  xInp.placeholder = 'X (Yukarı Değer / Northing ~4.200.000)';
  xInp.style.cssText = yInp.style.cssText;

  box.appendChild(yInp);
  box.appendChild(xInp);

  const btnCancel = document.createElement('button');
  btnCancel.className = 'modal-btn';
  btnCancel.textContent = 'İPTAL';
  btnCancel.onclick = closeModal;

  const btnAdd = document.createElement('button');
  btnAdd.className = 'modal-btn primary';
  btnAdd.textContent = 'EKLE';
  btnAdd.onclick = () => {
    const easting = parseFloat(yInp.value);
    const northing = parseFloat(xInp.value);
    if (isNaN(easting) || isNaN(northing)) {
      alert("Lütfen geçerli Y ve X sayısal değerleri girin.");
      return;
    }
    const idx = cad.addSavedPoint(easting, northing);
    cad.zoomToSavedPoint(idx - 1);
    closeModal();
    hudSelection.textContent = `N${idx} • Y (Sağa): ${easting.toFixed(3)} • X (Yukarı): ${northing.toFixed(3)}`;
  };

  showModal("Harita Koordinatından Nokta Ekle (Y-X)", box, null, [btnCancel, btnAdd]);
};

document.getElementById('btnPointList').onclick = () => {
  const pts = cad.savedPoints;
  if (!pts || pts.length === 0) {
    showModal("Nokta Listesi", "Kayıtlı nokta bulunmuyor.");
    return;
  }

  const listDiv = document.createElement('div');
  listDiv.style.display = 'flex';
  listDiv.style.flexDirection = 'column';
  listDiv.style.gap = '6px';
  listDiv.style.maxHeight = '350px';
  listDiv.style.overflowY = 'auto';

  pts.forEach((p, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;';
    item.innerHTML = `<span style="font-family: monospace;">N${String(idx + 1).padEnd(3)} Y (Sağa): ${p.x.toFixed(3).padStart(10)}  X (Yukarı): ${p.y.toFixed(3).padStart(10)}</span>`;
    item.onclick = () => {
      cad.zoomToSavedPoint(idx);
      closeModal();
    };
    listDiv.appendChild(item);
  });

  const btnDelLast = document.createElement('button');
  btnDelLast.className = 'modal-btn';
  btnDelLast.textContent = 'SON NOKTAYI SİL';
  btnDelLast.onclick = () => {
    cad.removeSavedPoint(pts.length - 1);
    closeModal();
  };

  const btnClose = document.createElement('button');
  btnClose.className = 'modal-btn primary';
  btnClose.textContent = 'KAPAT';
  btnClose.onclick = closeModal;

  showModal(`Nokta Listesi (${pts.length} Nokta)`, listDiv, null, [btnDelLast, btnClose]);
};

// Export Google Earth KML
// AutoCAD DXF (R2000) Dışa Aktarma
const btnExportDxf = document.getElementById('btnExportDxf');
if (btnExportDxf) {
  btnExportDxf.onclick = () => {
    if (cad.entities.length === 0) {
      showModal("Bilgi", "Dışa aktarılacak çizim geometrisi bulunamadı.");
      return;
    }
    const dxfContent = exportEntitiesToDxf(cad.entities, cad.layers, cad.layerColors);
    const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = currentLoadedFileName ? currentLoadedFileName.replace(/\.ncz$/i, "") : "EsoCAD_Proje";
    a.download = `${baseName}_cad.dxf`;
    a.click();
    URL.revokeObjectURL(url);
    hudSelection.textContent = `AutoCAD DXF (${cad.entities.length.toLocaleString()} obje, ${cad.layers.length} tabaka) başarıyla indirildi`;
  };
}

// Excel / CSV Koordinat Cetveli (Y-X-Z) Dışa Aktarma
const btnExportCsv = document.getElementById('btnExportCsv');
if (btnExportCsv) {
  btnExportCsv.onclick = () => {
    if (cad.entities.length === 0) {
      showModal("Bilgi", "Dışa aktarılacak koordinat verisi bulunamadı.");
      return;
    }
    const csvContent = exportEntitiesToCsv(cad.entities, cad.layers);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = currentLoadedFileName ? currentLoadedFileName.replace(/\.ncz$/i, "") : "EsoCAD_Proje";
    a.download = `${baseName}_koordinat_cetveli.csv`;
    a.click();
    URL.revokeObjectURL(url);
    hudSelection.textContent = "Excel / CSV Koordinat Cetveli (Y-X-Z) başarıyla indirildi";
  };
}

// Kapanmayan Parselleri Bul (Açık Uç Avcısı)
const btnFindOpenPolygons = document.getElementById('btnFindOpenPolygons');
if (btnFindOpenPolygons) {
  btnFindOpenPolygons.onclick = () => {
    if (cad.entities.length === 0) {
      showModal("Bilgi", "Lütfen önce bir NCZ dosyası açınız.");
      return;
    }
    const errCount = cad.findOpenPolygons();
    if (errCount > 0) {
      hudSelection.textContent = `🔍 ${errCount} adet kapanmayan açık uç tespit edildi (Haritada kırmızı işaretlendi)`;
    } else {
      hudSelection.textContent = "Tebrikler! Çizimde açık kalmış parsel ucu bulunamadı (Topoloji temiz).";
    }
  };
}

const btnClearTopologyErrors = document.getElementById('btnClearTopologyErrors');
if (btnClearTopologyErrors) {
  btnClearTopologyErrors.onclick = () => {
    cad.clearTopologyErrors();
    hudSelection.textContent = "Topoloji hata işaretleri temizlendi";
  };
}

// Nokta Kot Değerleri (Z) Aç / Kapat
const btnToggleElevations = document.getElementById('btnToggleElevations');
const elevStatusLabel = document.getElementById('elevStatusLabel');
if (btnToggleElevations) {
  btnToggleElevations.onclick = () => {
    const on = cad.toggleElevations();
    if (elevStatusLabel) elevStatusLabel.textContent = on ? "Açık" : "Gizli";
    hudSelection.textContent = on ? "Nokta Z kot değerleri çizime yansıtıldı" : "Nokta Z kot değerleri gizlendi";
  };
}

// CAD Teması Değiştir (Beyaz & Turuncu / Koyu Gece)
const btnToggleTheme = document.getElementById('btnToggleTheme');
const themeStatusLabel = document.getElementById('themeStatusLabel');
if (btnToggleTheme) {
  btnToggleTheme.onclick = () => {
    const t = cad.toggleTheme();
    if (themeStatusLabel) {
      themeStatusLabel.textContent = (t === "dark") ? "CAD Teması: Koyu (Gece)" : "CAD Teması: Beyaz & Turuncu";
    }
    hudSelection.textContent = (t === "dark") ? "Koyu CAD teması aktif edildi" : "Beyaz & Turuncu CAD teması aktif edildi";
  };
}

const btnExportKml = document.getElementById('btnExportKml');
if (btnExportKml) {
  btnExportKml.onclick = () => {
    const kml = cad.exportKML();
    if (!kml) return;
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proje_${cad.projection || 'kml'}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    hudSelection.textContent = "Google Earth KML dosyası başarıyla indirildi";
  };
}

// Export GeoJSON
const btnExportGeoJson = document.getElementById('btnExportGeoJson');
if (btnExportGeoJson) {
  btnExportGeoJson.onclick = () => {
    const geojson = cad.exportGeoJSON();
    if (!geojson) return;
    const blob = new Blob([geojson], { type: 'application/geo+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proje_${cad.projection || 'geojson'}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    hudSelection.textContent = "GeoJSON CBS dosyası başarıyla indirildi";
  };
}

document.getElementById('btnPointClear').onclick = () => {
  if (cad.savedPoints.length === 0) {
    showModal("Bilgi", "Kayıtlı nokta yok.");
    return;
  }
  const btnCancel = document.createElement('button');
  btnCancel.className = 'modal-btn';
  btnCancel.textContent = 'VAZGEÇ';
  btnCancel.onclick = closeModal;

  const btnDel = document.createElement('button');
  btnDel.className = 'modal-btn';
  btnDel.style.backgroundColor = '#da3633';
  btnDel.textContent = 'SİL';
  btnDel.onclick = () => {
    cad.clearSavedPoints();
    closeModal();
    hudSelection.textContent = "Nokta listesi temizlendi";
  };

  showModal("Noktaları Temizle", `${cad.savedPoints.length} kayıtlı noktanın tamamı silinsin mi?`, null, [btnCancel, btnDel]);
};

// Ready state
window.addEventListener('DOMContentLoaded', () => {
  fileInfo.textContent = "Dosya bekleniyor... ('Aç' butonunu kullanın veya NCZ sürükleyin)";
  hudSelection.textContent = "Hazır • Lütfen dosya açınız";

  // Kayıtlı TKGM parsellerini kontrol et ve geri yükle
  updateSavedParcelsBadge();
  const restored = restoreAllStoredParcelsToMap(false);
  if (restored > 0) {
    hudSelection.textContent = `Hazır • ${restored} kayıtlı TKGM parseli haritaya yüklendi`;
  }
});

// ========================================================
// Alt Şerit (Bottombar) & Seçim Menüsü Sistemi
// ========================================================
const bBtnMenuSelect = document.getElementById('bBtnMenuSelect');
const menuBottomSelect = document.getElementById('menu-bottom-select');

if (bBtnMenuSelect && menuBottomSelect) {
  bBtnMenuSelect.onclick = (e) => {
    e.stopPropagation();
    const isOpen = menuBottomSelect.classList.toggle('show');
    bBtnMenuSelect.classList.toggle('open', isOpen);
  };
}

// Menü dışına tıklanınca bottom dropup'ı kapat
window.addEventListener('click', (e) => {
  if (menuBottomSelect && !e.target.closest('#appBottombar')) {
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  }
});

// Canlı CAD Koordinat Gösterimi (Y: Easting / Sağa, X: Northing / Yukarı)
const valCoordY = document.getElementById('valCoordY');
const valCoordX = document.getElementById('valCoordX');

cad.onCoordUpdate = ({ zoom, x, y, wgs }) => {
  if (valCoordY && valCoordX) {
    if (x !== null && y !== null) {
      valCoordY.textContent = x.toLocaleString('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      valCoordX.textContent = y.toLocaleString('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    } else {
      valCoordY.textContent = '---';
      valCoordX.textContent = '---';
    }
  }
  if (hudNav) {
    hudNav.textContent = zoom.toFixed(2) + 'x';
  }
};

// Alt Şerit Hızlı Seçim Butonları
const bBtnSelectMode = document.getElementById('bBtnSelectMode');
const bBtnBoxSelect = document.getElementById('bBtnBoxSelect');
const bBtnSelectAll = document.getElementById('bBtnSelectAll');
const bBtnClearSelect = document.getElementById('bBtnClearSelect');
const bBtnZoomSelected = document.getElementById('bBtnZoomSelected');

function setBottomSelectActive(activeBtn) {
  [bBtnSelectMode, bBtnBoxSelect].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  if (activeBtn) activeBtn.classList.add('active');
}

if (bBtnSelectMode) {
  bBtnSelectMode.onclick = () => {
    cad.cancelBoxSelect();
    cad.setQueryMode(cad.QueryMode.SELECT);
    setActiveModeBtn(document.getElementById('btnQuerySelect'));
    hudSelection.textContent = "SEÇİM MODU (El İmleci Aktif) • Obje veya parsele tıklayarak seçin";
  };
}

if (bBtnBoxSelect) {
  bBtnBoxSelect.onclick = () => {
    cad.startBoxSelect();
    setBottomSelectActive(bBtnBoxSelect);
  };
}

if (bBtnSelectAll) {
  bBtnSelectAll.onclick = () => {
    const total = cad.selectAll();
    if (total > 0) {
      hudSelection.textContent = `Tüm Geometriler Seçildi • Toplam ${total.toLocaleString()} obje`;
    }
  };
}

if (bBtnClearSelect) {
  bBtnClearSelect.onclick = () => {
    cad.clearSelection();
    cad.cancelBoxSelect();
    setBottomSelectActive(bBtnSelectMode);
    hudSelection.textContent = "Seçim temizlendi";
  };
}

if (bBtnZoomSelected) {
  bBtnZoomSelected.onclick = () => {
    if (!cad.zoomToSelected()) {
      showModal("Bilgi", "Lütfen önce bir obje veya parsel seçin.");
    }
  };
}

// Alt Seçim Dropup Menüsü Eylemleri
const bMenuSingleSelect = document.getElementById('bMenuSingleSelect');
if (bMenuSingleSelect) {
  bMenuSingleSelect.onclick = () => {
    cad.cancelBoxSelect();
    cad.setQueryMode(cad.QueryMode.SELECT);
    setActiveModeBtn(document.getElementById('btnQuerySelect'));
    hudSelection.textContent = "SEÇİM MODU (El İmleci Aktif) • Obje veya parsele tıklayarak seçin";
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuBoxSelect = document.getElementById('bMenuBoxSelect');
if (bMenuBoxSelect) {
  bMenuBoxSelect.onclick = () => {
    cad.startBoxSelect();
    setBottomSelectActive(bBtnBoxSelect);
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuSelectAll = document.getElementById('bMenuSelectAll');
if (bMenuSelectAll) {
  bMenuSelectAll.onclick = () => {
    cad.selectAll();
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuClearSelect = document.getElementById('bMenuClearSelect');
if (bMenuClearSelect) {
  bMenuClearSelect.onclick = () => {
    cad.clearSelection();
    cad.cancelBoxSelect();
    setBottomSelectActive(bBtnSelectMode);
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuZoomSelected = document.getElementById('bMenuZoomSelected');
if (bMenuZoomSelected) {
  bMenuZoomSelected.onclick = () => {
    cad.zoomToSelected();
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

// Seçili Obje / Parsel Bilgilerini ve Koordinatlarını Panoya Kopyala
function copySelectedEntityInfo() {
  if (!cad.selected) {
    const text = hudSelection.textContent;
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        const prev = hudSelection.textContent;
        hudSelection.textContent = "✔ Bilgi Panoya Kopyalandı!";
        setTimeout(() => { hudSelection.textContent = prev; }, 1500);
      }).catch(() => {});
    }
    return;
  }

  const s = cad.selected;
  let lines = [];
  const layerName = cad.layerName(s.layer);
  lines.push(`TABAKA: ${layerName} | TİP: ${s.kind}`);

  if (s.points && s.points.length > 0) {
    if (s.kind === "Polygon") {
      const area = cad.calcArea(s.points);
      const perim = cad.calcPerimeter(s.points);
      lines.push(`ALAN: ${area.toFixed(2)} m² | ÇEVRE: ${perim.toFixed(2)} m | KÖŞE SAYISI: ${s.points.length}`);
    } else if (s.kind === "Line") {
      const len = cad.calcLength(s.points, false);
      lines.push(`UZUNLUK: ${len.toFixed(2)} m | KÖŞE SAYISI: ${s.points.length}`);
    }
    lines.push("SIRA\tNOKTA_ADI\tY (Sağa)\tX (Yukarı)\tZ (Kot)");
    for (let i = 0; i < s.points.length; i++) {
      const pt = s.points[i];
      const pName = (s.points.length === 1 && s.text) ? s.text : `P${i + 1}`;
      lines.push(`${i + 1}\t${pName}\t${pt.y.toFixed(3)}\t${pt.x.toFixed(3)}\t${(pt.z || 0).toFixed(3)}`);
    }
  }

  const payload = lines.join("\n");
  navigator.clipboard.writeText(payload).then(() => {
    const prev = hudSelection.textContent;
    hudSelection.textContent = `✔ Seçili Geometri Koordinatları Panoya Kopyalandı (${s.points ? s.points.length : 1} nokta)!`;
    setTimeout(() => { hudSelection.textContent = prev; }, 2000);
  }).catch(() => {
    showModal("Kopyalandı", `<textarea style="width:100%;height:150px;background:#15181e;color:#fff;border:1px solid #38455e;font-family:monospace;padding:8px;" readonly>${payload}</textarea>`);
  });
}

const bMenuCopyCoords = document.getElementById('bMenuCopyCoords');
if (bMenuCopyCoords) {
  bMenuCopyCoords.onclick = () => {
    copySelectedEntityInfo();
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

if (hudSelection) {
  hudSelection.style.cursor = "pointer";
  hudSelection.title = "Tıklayarak seçili bilgiyi / koordinatları panoya kopyalayabilirsiniz";
  hudSelection.onclick = () => copySelectedEntityInfo();
}

const bMenuSaveParcel = document.getElementById('bMenuSaveParcel');
if (bMenuSaveParcel) {
  bMenuSaveParcel.onclick = () => {
    if (cad.selected && cad.selected.kind === "Polygon") {
      saveParcelToStorage(cad.selected);
      updateSavedParcelsBadge();
      hudSelection.textContent = "Seçili parsel hafızaya kaydedildi";
    } else {
      showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
    }
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuDeleteSelected = document.getElementById('bMenuDeleteSelected');
if (bMenuDeleteSelected) {
  bMenuDeleteSelected.onclick = () => {
    if (cad.selected) {
      const idx = cad.entities.indexOf(cad.selected);
      if (idx !== -1) {
        cad.entities.splice(idx, 1);
        cad.clearSelection();
        cad.rebuildSpatialIndex();
        cad.requestRender();
        hudSelection.textContent = "Seçili obje çizimden silindi";
      }
    } else {
      showModal("Bilgi", "Silinecek bir obje seçili değil.");
    }
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuParcelTable = document.getElementById('bMenuParcelTable');
if (bMenuParcelTable) {
  bMenuParcelTable.onclick = () => {
    const tableData = cad.selectedParcelCornerTable();
    if (tableData) {
      const wrap = document.createElement('div');
      const pre = document.createElement('div');
      pre.className = 'mono-table';
      pre.textContent = tableData;
      wrap.appendChild(pre);
      showModal("Parsel Köşe • Kenar • Semt Tablosu", wrap);
    } else {
      showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
    }
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

const bMenuParcelLabels = document.getElementById('bMenuParcelLabels');
if (bMenuParcelLabels) {
  bMenuParcelLabels.onclick = () => {
    const n = cad.labelSelectedParcelEdges();
    if (n > 0) {
      hudSelection.textContent = `${n} kenar boyu çizime yazdırıldı`;
    } else {
      showModal("Uyarı", "Lütfen önce bir kapalı parsel seçin.");
    }
    menuBottomSelect.classList.remove('show');
    if (bBtnMenuSelect) bBtnMenuSelect.classList.remove('open');
  };
}

// Alt Şerit Hızlı Snap Butonu
const bBtnSnap = document.getElementById('bBtnSnap');
if (bBtnSnap) {
  bBtnSnap.onclick = () => {
    cad.snapEnabled = !cad.snapEnabled;
    bBtnSnap.classList.toggle('active', cad.snapEnabled);
    bBtnSnap.textContent = cad.snapEnabled ? 'SNAP' : 'SNAP: KAPALI';
    hudSelection.textContent = cad.snapEnabled ? "Snap motoru aktif" : "Snap motoru kapatıldı";
    if (btnCadToggleSnap) {
      btnCadToggleSnap.classList.toggle('active', cad.snapEnabled);
      snapStatusText.textContent = cad.snapEnabled ? "Snap Motoru: Açık" : "Snap Motoru: Kapalı";
    }
  };
}

// Alt Şerit Kuşbakışı (Minimap) Butonu
const bBtnMinimap = document.getElementById('bBtnMinimap');
if (bBtnMinimap) {
  bBtnMinimap.onclick = () => {
    toggleMinimapState(!cad.showMinimap);
    hudSelection.textContent = cad.showMinimap ? "Kuşbakışı minimap açıldı" : "Kuşbakışı minimap gizlendi";
  };
}

// Başlangıç Açılış Durumu (Doğrudan Türkiye Üzerinde Google Uydu Aktif)
if (projLabel) projLabel.textContent = "ITRF96 / TM33";
if (btnSatellite) btnSatellite.classList.add('active');
if (satStatusLabel) satStatusLabel.textContent = "Google Uydu: Açık";

// Açılışta tam Türkiye coğrafi sınırlarına odaklan
cad.focusOnTurkey(false);
cad.requestRender();

// ========================================================
// Açılış Bilgilendirme & Uyarı Modalı
// ========================================================
setTimeout(() => {
  const alertBox = document.createElement('div');
  alertBox.style.cssText = 'display: flex; flex-direction: column; gap: 14px; padding: 6px 2px;';

  const iconRow = document.createElement('div');
  iconRow.style.cssText = 'display: flex; align-items: center; gap: 10px; color: #ea580c;';
  iconRow.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
    <span style="font-weight: 700; font-size: 14px; letter-spacing: 0.5px; color: #f97316;">ÖNEMLİ KULLANIM BİLGİSİ</span>
  `;

  const msgText = document.createElement('div');
  msgText.style.cssText = 'font-size: 13.5px; line-height: 1.6; color: #f1f5f9; background: #0b0f17; border: 1px solid #334155; padding: 14px; border-radius: 4px; font-weight: 600; text-align: justify;';
  msgText.textContent = "PROGRAMIN STABİL ÇALIŞMASI İÇİN AÇTIĞINIZ NCZ PROJELERİNİN TABAKALARI KAPALI OLABİLİR TABAKALAR MENÜSÜNDEN KONTROL EDİNİZ.";

  const tipText = document.createElement('div');
  tipText.style.cssText = 'font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 6px;';
  tipText.innerHTML = `💡 <i>İpucu: Üst menüden <b>Tabaka ▾</b> &gt; <b>Tüm Tabakaları Aç</b> seçeneğini veya sağdaki Tabakalar panelini kullanabilirsiniz.</i>`;

  alertBox.appendChild(iconRow);
  alertBox.appendChild(msgText);
  alertBox.appendChild(tipText);

  showModal("SİSTEM BİLGİLENDİRMESİ", alertBox);
}, 300);

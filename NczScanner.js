/**
 * NczScanner.js
 * Netcad NCZ High-Performance Binary Parser
 */

export function parseNCZ(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  function u32(o) {
    if (o < 0 || o + 4 > b.length) return -1;
    return view.getUint32(o, true);
  }

  function d(o) {
    if (o < 0 || o + 8 > b.length) return 0;
    return view.getFloat64(o, true);
  }

  function f(o) {
    if (o < 0 || o + 4 > b.length) return 0;
    return view.getFloat32(o, true);
  }

  function valid(x, y) {
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100000000 && Math.abs(y) <= 100000000;
  }

  // Raw Netcad coords: rawX is Northing (Y), rawY is Easting (X)
  function point(rawX, rawY, z = 0.0) {
    return { x: rawY, y: rawX, z };
  }

  function normDeg(v) {
    if (Number.isFinite(v)) {
      return ((v % 360.0) + 360.0) % 360.0;
    }
    return 0.0;
  }

  function radDeg(v) {
    return normDeg(v * 180.0 / Math.PI);
  }

  function legacy(o, n) {
    if (n <= 0 || o < 0 || o + n > b.length) return "";
    let s = "";
    for (let i = 0; i < n; i++) {
      const v = b[o + i];
      if (v === 0) break;
      switch (v) {
        case 221: s += 'İ'; break;
        case 222: s += 'Ş'; break;
        case 208: s += 'Ğ'; break;
        case 240: s += 'ğ'; break;
        case 253: s += 'ı'; break;
        case 254: s += 'ş'; break;
        case 220: s += 'Ü'; break;
        case 252: s += 'ü'; break;
        case 214: s += 'Ö'; break;
        case 246: s += 'ö'; break;
        case 199: s += 'Ç'; break;
        case 231: s += 'ç'; break;
        default:
          s += String.fromCharCode(v);
      }
    }
    return s.trim();
  }

  function lp(lenOff, textOff, max = 240) {
    if (lenOff < 0 || lenOff >= b.length || textOff < 0 || textOff >= b.length) return "";
    const n = b[lenOff];
    if (n >= 1 && n <= max && textOff + n <= b.length) {
      return legacy(textOff, n);
    }
    return "";
  }

  function textPayload(o, g) {
    const pairs = [
      [o + g + 97, o + g + 98],
      [o + g + 86, o + g + 87],
      [o + 97, o + 98],
      [o + 86, o + 87]
    ];
    for (let i = 0; i < pairs.length; i++) {
      const s = lp(pairs[i][0], pairs[i][1]);
      if (s && s.trim().length > 0) return s;
    }
    return "";
  }

  const entities = [];
  const layers = [];
  const layerColors = [];
  const layerVisibility = [];
  let version = null;
  let p = 0;

  function parseGeometry(o, block, g, out) {
    if (o + 38 > b.length) return;
    const gt = b[o + 6];
    const layer = b[o + 7];
    const end = Math.min(o + block + 1, b.length);

    try {
      switch (gt) {
        case 1: { // Point
          const x = d(o + 8);
          const y = d(o + 16);
          if (valid(x, y)) {
            out.push({
              kind: "Point",
              layer,
              points: [point(x, y, f(o + 24))],
              text: lp(o + g + 86, o + g + 87, 120),
              radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 2: { // Line
          const x1 = d(o + 8);
          const y1 = d(o + 16);
          const x2 = d(o + block - 19);
          const y2 = d(o + block - 11);
          if (valid(x1, y1) && valid(x2, y2)) {
            out.push({
              kind: "Line",
              layer,
              points: [point(x1, y1, f(o + 24)), point(x2, y2, f(o + block - 3))],
              text: "",
              radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 3: { // Circle
          const x = d(o + 8);
          const y = d(o + 16);
          if (valid(x, y)) {
            const rad = Math.abs(d(o + 50) - d(o + 66)) / 2.0;
            out.push({
              kind: "Circle",
              layer,
              points: [point(x, y, f(o + 24))],
              radius: rad,
              text: "",
              startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 4: { // Arc
          const x = d(o + 8);
          const y = d(o + 16);
          const q = o + g;
          if (valid(x, y) && q + 120 <= end) {
            out.push({
              kind: "Arc",
              layer,
              points: [point(x, y, f(o + 24))],
              radius: d(q + 86),
              startAngle: d(q + 104),
              endAngle: d(q + 112),
              text: "",
              textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 5: { // Text
          const x = d(o + 8);
          const y = d(o + 16);
          const q = o + g;
          const txt = textPayload(o, g);
          const h = (q + 90 <= end) ? f(q + 86) : 0.0;
          
          // Rotation: Netcad stores rotation in grad / radians. In grad: rad * 200 / PI
          // In Netcad format: rotGrad = f(q+90) * (200.0 / PI)
          // Mathematical Angle in Degrees: deg = rotGrad * 0.9 = f(q+90) * (180.0 / PI)
          const rotDeg = (q + 94 <= end) ? radDeg(f(q + 90)) : 0.0;
          
          // Text alignment flags if available
          const alignCode = (q + 96 < end) ? b[q + 96] : 0;
          
          if (valid(x, y) && txt.trim().length > 0) {
            out.push({
              kind: "Text",
              layer,
              points: [point(x, y, f(o + 24))],
              text: txt.substring(0, 160),
              textHeight: h,
              rotation: rotDeg,
              align: alignCode,
              radius: 0, startAngle: 0, endAngle: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 6: { // Symbol
          const x = d(o + 8);
          const y = d(o + 16);
          const q = o + g;
          const so = (q + 94 < end) ? q + 94 : o + 94;
          const code = (so >= 0 && so < end) ? b[so] : 0;
          let size = 5.0;
          if (q + 90 <= end) {
            const sz = f(q + 86);
            if (Number.isFinite(sz) && sz > 0 && sz < 100000) size = sz;
          }
          const rot = (q + 94 <= end) ? radDeg(f(q + 90)) : 0.0;
          if (valid(x, y)) {
            out.push({
              kind: "Symbol",
              layer,
              points: [point(x, y, f(o + 24))],
              text: "S" + code,
              textHeight: size,
              rotation: rot,
              symbolCode: code,
              radius: 0, startAngle: 0, endAngle: 0, scale: 1
            });
          }
          break;
        }
        case 7: { // Polyline / Polygon
          const count = Math.floor((block + 1 - 113 - g) / 24);
          if (count >= 2) {
            const pts = [];
            for (let i = 0; i < count; i++) {
              const q = o + g + 113 + i * 24;
              if (q + 24 > end) break;
              const px = d(q);
              const py = d(q + 8);
              if (valid(px, py)) {
                pts.push(point(px, py, d(q + 16)));
              }
            }
            if (pts.length >= 2) {
              const dx = pts[0].x - pts[pts.length - 1].x;
              const dy = pts[0].y - pts[pts.length - 1].y;
              const closed = Math.hypot(dx, dy) < 0.01;
              out.push({
                kind: closed ? "Polygon" : "Polyline",
                layer,
                points: pts,
                text: lp(o + g + 86, o + g + 87, 120),
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
              });
            }
          }
          break;
        }
        case 9: { // Polyline (incremental dx, dy)
          const ox = d(o + 8);
          const oy = d(o + 16);
          if (valid(ox, oy)) {
            const pts = [];
            pts.push(point(ox, oy, f(o + 24)));
            let q = o + g + 122;
            while (q + 8 <= end) {
              const dx = f(q);
              const dy = f(q + 4);
              if (!Number.isFinite(dx) || !Number.isFinite(dy)) break;
              const rx = ox + dx;
              const ry = oy + dy;
              if (valid(rx, ry)) pts.push(point(rx, ry));
              q += 18;
            }
            if (pts.length >= 2) {
              out.push({
                kind: "Polyline",
                layer,
                points: pts,
                text: "",
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
              });
            }
          }
          break;
        }
        case 10: { // Rotated Rectangle
          const ax = d(o + 8);
          const ay = d(o + 16);
          const q = o + g;
          if (q + 124 <= end) {
            const bx = d(q + 104);
            const by = d(q + 112);
            if (valid(ax, ay) && valid(bx, by)) {
              const width = Math.abs(bx - ax);
              const height = Math.abs(by - ay);
              const ang = f(q + 120);
              const bottomX = Math.cos(ang);
              const bottomY = -Math.sin(ang);
              const sideX = Math.sin(ang);
              const sideY = Math.cos(ang);
              const raw = [
                [ax, ay],
                [ax + bottomX * width, ay + bottomY * width],
                [ax + bottomX * width + sideX * height, ay + bottomY * width + sideY * height],
                [ax + sideX * height, ay + sideY * height]
              ];
              out.push({
                kind: "Polygon",
                layer,
                points: raw.map(pt => point(pt[0], pt[1])),
                rotation: radDeg(ang),
                text: "",
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, symbolCode: -1, scale: 1
              });
            }
          }
          break;
        }
        case 11: { // Pafta Box
          if (o + 82 <= end) {
            const x1 = d(o + 50);
            const y1 = d(o + 58);
            const x2 = d(o + 66);
            const y2 = d(o + 74);
            const paftaName = lp(o + 86, o + 87, 120) || lp(o + g + 86, o + g + 87, 120) || "PAFTA";
            if (valid(x1, y1) && valid(x2, y2)) {
              const a = point(x1, y1);
              const z = point(x2, y2);
              out.push({
                kind: "Polygon",
                layer,
                points: [a, { x: z.x, y: a.y, z: 0 }, z, { x: a.x, y: z.y, z: 0 }],
                text: paftaName,
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
              });
            }
          }
          break;
        }
        case 12: { // Triangle
          if (o + 122 <= end) {
            const ax = d(o + 8);
            const ay = d(o + 16);
            const bx = d(o + 86);
            const by = d(o + 94);
            const cx = d(o + 106);
            const cy = d(o + 114);
            if (valid(ax, ay) && valid(bx, by) && valid(cx, cy)) {
              out.push({
                kind: "Polygon",
                layer,
                points: [point(ax, ay), point(bx, by), point(cx, cy)],
                text: "",
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, rotation: 0, symbolCode: -1, scale: 1
              });
            }
          }
          break;
        }
        case 13: { // Block
          const x = d(o + 8);
          const y = d(o + 16);
          const q = o + g;
          if (valid(x, y)) {
            out.push({
              kind: "Block",
              layer,
              points: [point(x, y, f(o + 24))],
              text: lp(q + 86, q + 87, 120),
              rotation: (q + 122 <= end) ? radDeg(f(q + 118)) : 0.0,
              radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, symbolCode: -1, scale: 1
            });
          }
          break;
        }
        case 15: { // Smart Block / Object
          const x = d(o + 8);
          const y = d(o + 16);
          if (valid(x, y)) {
            let width = (o + 177 <= end) ? d(o + 169) : 0.0;
            let height = (o + 185 <= end) ? d(o + 177) : 0.0;
            if ((width <= 0 || height <= 0) && o + 82 <= end) {
              const x2 = d(o + 66);
              const y2 = d(o + 74);
              if (valid(x2, y2)) {
                width = Math.abs(x2 - x);
                height = Math.abs(y2 - y);
              }
            }
            const grad = (o + 86 <= end) ? f(o + 82) : 0.0;
            const sc = (o + 90 <= end) ? f(o + 86) : 1.0;
            const deg = normDeg(grad * 0.9);
            if (width > 0.001 && height > 0.001) {
              const ang = deg * Math.PI / 180.0;
              const bottomX = Math.sin(ang);
              const bottomY = Math.cos(ang);
              const sideX = Math.cos(ang);
              const sideY = -Math.sin(ang);
              const raw = [
                [x, y],
                [x + bottomX * width, y + bottomY * width],
                [x + bottomX * width + sideX * height, y + bottomY * width + sideY * height],
                [x + sideX * height, y + sideY * height]
              ];
              out.push({
                kind: "Polygon",
                layer,
                points: raw.map(pt => point(pt[0], pt[1])),
                text: "SMART",
                rotation: deg,
                scale: sc,
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, symbolCode: -1
              });
            } else {
              out.push({
                kind: "Block",
                layer,
                points: [point(x, y, f(o + 24))],
                text: "SMART",
                rotation: deg,
                scale: sc,
                radius: 0, startAngle: 0, endAngle: 0, textHeight: 0, symbolCode: -1
              });
            }
          }
          break;
        }
      }
    } catch (e) {
      // Ignore corrupted sub-record
    }
  }

  function parseEmbedded(start, end, out) {
    let q = start;
    while (q + 8 < end) {
      const t = b[q];
      if (t === 21 || t === 22) {
        const bl = u32(q + 1) + 4;
        if (bl >= 4 && bl < 0x7fffffff && q + bl + 1 <= end) {
          parseGeometry(q, bl, (t === 22) ? 28 : 0, out);
          q += bl + 1;
          continue;
        }
      }
      q++;
    }
  }

  const embeddedTypes = new Set([0, 5, 14, 48, 108, 111, 132, 150, 180]);

  while (p + 6 < b.length) {
    const rawBlock = u32(p + 1);
    const block = rawBlock + 4;
    const total = block + 1;
    if (block < 4 || total > 0x7fffffff || p + total > b.length) {
      p++;
      continue;
    }
    const type = b[p];
    if (type === 25 && version === null) {
      const n = b[p + 5];
      version = legacy(p + 6, n);
    }
    if (type === 6 && p + 18 <= b.length) {
      const count = b[p + 16] + b[p + 17] * 256;
      for (let i = 0; i < count; i++) {
        const q = p + 18 + i * 29;
        if (q + 29 > p + total) break;
        const s = lp(q + 4, q + 5);
        if (s && s.trim().length > 0) layers.push(s);
      }
    }
    if (type === 28) {
      const name = (p + 6 < b.length) ? legacy(p + 6, b[p + 5]) : "";
      if (name === "LEX.ST8" && p + 21 <= b.length) {
        const n = b[p + 20];
        for (let i = 0; i < n; i++) {
          const q = p + 79 + i * 256;
          if (q + 5 > p + total || q + 5 > b.length) break;
          const r = b[q];
          const g = b[q + 1];
          const bl = b[q + 2];
          layerColors[i] = `rgb(${r},${g},${bl})`;
          layerVisibility[i] = (b[q + 4] === 1);
        }
      } else if (name === "LEX.ST2" && p + 21 <= b.length) {
        const n = b[p + 20];
        for (let i = 0; i < n; i++) {
          const q = p + 79 + i * 256;
          if (q + 5 > p + total || q + 5 > b.length) break;
          const r = b[q];
          const g = b[q + 1];
          const bl = b[q + 2];
          if (!layerColors[i]) {
            layerColors[i] = `rgb(${r},${g},${bl})`;
          }
          if (layerVisibility[i] === undefined) {
            layerVisibility[i] = (b[q + 4] === 1);
          }
        }
      }
    }
    if (type === 21 || type === 22) {
      parseGeometry(p, block, (type === 22) ? 28 : 0, entities);
    } else if (embeddedTypes.has(type)) {
      parseEmbedded(p + 5, Math.min(p + total, b.length), entities);
    }
    p += total;
  }

  // Filter smart artifacts
  if (entities.some(e => e.text === "SMART")) {
    for (let i = entities.length - 1; i >= 0; i--) {
      if (entities[i].kind === "Symbol" && entities[i].layer === 0 && entities[i].symbolCode === 0) {
        entities.splice(i, 1);
      }
    }
  }

  return {
    size: b.length,
    version: version || "Bilinmiyor",
    layers,
    entities,
    layerColors,
    layerVisibility
  };
}

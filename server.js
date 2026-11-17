import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 50080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const BASE_TKGM = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Güvenlik: Özel / Dahili Ağ IP'leri ve SSRF Önleme Fonksiyonu
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase().trim();

  // Localhost ve metadata adresleri
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '169.254.169.254') {
    return true;
  }

  // IPv4 Özel Blokları (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const p0 = parseInt(ipv4Match[1], 10);
    const p1 = parseInt(ipv4Match[2], 10);
    if (p0 === 10 || p0 === 127) return true;
    if (p0 === 172 && (p1 >= 16 && p1 <= 31)) return true;
    if (p0 === 192 && p1 === 168) return true;
    if (p0 === 169 && p1 === 254) return true;
    if (p0 === 0) return true;
  }

  // .local, .internal, .lan uzantılı iç alan adları
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.corp')) {
    return true;
  }

  return false;
}

// Güvenlik: Hafif Bellek İçi Hız Sınırlayıcı (Rate Limiter - DoS Engelleme)
const ipRequestCounters = new Map();
setInterval(() => {
  ipRequestCounters.clear();
}, 60000); // Her 60 saniyede bir sayaçları temizle

function checkRateLimit(ip, maxRequests = 180) {
  const current = ipRequestCounters.get(ip) || 0;
  if (current >= maxRequests) {
    return false;
  }
  ipRequestCounters.set(ip, current + 1);
  return true;
}

// Standart Web Güvenlik Başlıkları
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
}

function proxyTkgmRequest(targetUrl, req, res) {
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Referer': 'https://parselsorgu.tkgm.gov.tr/',
      'Origin': 'https://parselsorgu.tkgm.gov.tr',
      'Accept': 'application/json, text/plain, */*'
    },
    agent: httpsAgent,
    timeout: 15000 // 15 saniye zaman aşımı
  };

  const apiReq = https.get(targetUrl, options, (apiRes) => {
    res.writeHead(apiRes.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    apiRes.pipe(res);
  });

  apiReq.on('timeout', () => {
    apiReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'TKGM API istek zaman aşımına uğradı' }));
    }
  });

  apiReq.on('error', (err) => {
    console.error('TKGM API Proxy Hatası:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'TKGM API servisine ulaşılamadı', details: err.message }));
    }
  });

  req.on('close', () => {
    apiReq.destroy();
  });
}

const server = http.createServer((req, res) => {
  // Standart HTTP Güvenlik Başlıklarını Ekle
  setSecurityHeaders(res);

  // İstemci IP Adresi Tespiti ve Hız Sınırlaması (DDoS & Abuse Koruması)
  const clientIp = req.headers['x-forwarded-for'] 
    ? req.headers['x-forwarded-for'].split(',')[0].trim() 
    : (req.socket.remoteAddress || 'unknown');

  // Normalize URL
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = reqUrl.pathname;

  // --- TKGM MEGSİS API PROXY ---
  if (pathname.startsWith('/api/tkgm/')) {
    if (!checkRateLimit(clientIp, 120)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Çok fazla istek yapıldı. Lütfen biraz bekleyip tekrar deneyin.' }));
      return;
    }

    const sub = pathname.replace('/api/tkgm/', '');
    let target = null;
    if (sub === 'iller') {
      target = `${BASE_TKGM}/idariYapi/ilListe`;
    } else if (sub.startsWith('ilceler/')) {
      const id = sub.split('/')[1];
      if (!/^\d+$/.test(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Geçersiz il parametresi' }));
        return;
      }
      target = `${BASE_TKGM}/idariYapi/ilceListe/${id}`;
    } else if (sub.startsWith('mahalleler/')) {
      const id = sub.split('/')[1];
      if (!/^\d+$/.test(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Geçersiz ilçe parametresi' }));
        return;
      }
      target = `${BASE_TKGM}/idariYapi/mahalleListe/${id}`;
    } else if (sub.startsWith('parsel/')) {
      const parts = sub.split('/');
      // /parsel/{mahalleId}/{ada}/{parsel}
      if (parts.length >= 4) {
        const mahalleId = parts[1];
        const ada = parts[2];
        const parsel = parts[3];
        // Katı doğrulama (Sadece sayı, harf, alt çizgi veya tire kabul edilir)
        if (!/^\d+$/.test(mahalleId) || !/^[0-9a-zA-Z_-]+$/.test(ada) || !/^[0-9a-zA-Z_-]+$/.test(parsel)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Geçersiz ada/parsel parametresi' }));
          return;
        }
        target = `${BASE_TKGM}/parsel/${mahalleId}/${ada}/${parsel}`;
      }
    }

    if (target) {
      proxyTkgmRequest(target, req, res);
      return;
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Geçersiz TKGM API isteği' }));
      return;
    }
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(__dirname, pathname);

  // Security check to ensure requested file is inside __dirname
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Bulunamadı');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EsoCAD Web Sunucusu çalışıyor: http://localhost:${PORT}`);
});

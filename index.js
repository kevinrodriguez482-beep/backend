const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// ── Helpers ─────────────────────────────────────────────────
async function fetchPage(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  return cheerio.load(res.data);
}

// ── Scrapers ─────────────────────────────────────────────────

// 1. PelisPlus — scraper para obtener links de video
async function scrapePelisPlus(tmdbId, type, season, episode) {
  try {
    const baseUrl = "https://pelis.plus";
    const searchType = type === "movie" ? "pelicula" : "serie";
    
    // Buscar por TMDB ID directamente
    const url = type === "movie"
      ? `${baseUrl}/pelicula/tmdb-${tmdbId}`
      : `${baseUrl}/serie/tmdb-${tmdbId}/temporada-${season || 1}/episodio-${episode || 1}`;

    const $ = await fetchPage(url);
    
    // Extraer iframes de video
    const sources = [];
    $("iframe").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src && (src.includes("embed") || src.includes("player"))) {
        sources.push(src);
      }
    });

    // Buscar links directos de video
    $("source").each((_, el) => {
      const src = $(el).attr("src");
      if (src) sources.push(src);
    });

    return sources;
  } catch (e) {
    return [];
  }
}

// 2. Cuevana3 — scraper
async function scrapeCuevana(tmdbId, type, season, episode) {
  try {
    const bases = ["https://cuevana3.st", "https://cuevana3i.com", "https://cue.cuevana3.nu"];
    
    for (const base of bases) {
      try {
        const url = type === "movie"
          ? `${base}/pelicula/tmdb-${tmdbId}`
          : `${base}/serie/tmdb-${tmdbId}/temporada/${season || 1}/episodio/${episode || 1}`;

        const $ = await fetchPage(url);
        const sources = [];

        $("iframe").each((_, el) => {
          const src = $(el).attr("src") || $(el).attr("data-src");
          if (src) sources.push(src);
        });

        if (sources.length > 0) return sources;
      } catch (_) { continue; }
    }
    return [];
  } catch (e) {
    return [];
  }
}

// 3. PelisHD — scraper  
async function scrapePelisHD(tmdbId, type, season, episode) {
  try {
    const base = "https://pelishd.cx";
    const url = type === "movie"
      ? `${base}/pelicula/${tmdbId}`
      : `${base}/serie/${tmdbId}/${season || 1}/${episode || 1}`;

    const $ = await fetchPage(url);
    const sources = [];

    $("iframe").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src) sources.push(src);
    });

    return sources;
  } catch (e) {
    return [];
  }
}

// 4. API directa de embed con doblaje LAT conocida
function getEmbedSources(tmdbId, type, season, episode) {
  const isMovie = type === "movie";
  const sources = [];

  // SuperEmbed - mejor para LAT
  if (isMovie) {
    sources.push({
      name: "SuperEmbed (LAT)",
      url: `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1`,
      lang: "🌎 Latino"
    });
    sources.push({
      name: "2Embed",
      url: `https://www.2embed.cc/embed/${tmdbId}`,
      lang: "🌎 ES/LAT"
    });
    sources.push({
      name: "AutoEmbed",
      url: `https://autoembed.cc/movie/tmdb/${tmdbId}`,
      lang: "🌎 Multi"
    });
    sources.push({
      name: "EmbedSU",
      url: `https://embed.su/embed/movie/${tmdbId}`,
      lang: "🌎 Multi"
    });
    sources.push({
      name: "VidSrc",
      url: `https://vidsrc-embed.ru/embed/movie/${tmdbId}?ds_lang=es`,
      lang: "🇺🇸 EN+subs"
    });
    sources.push({
      name: "NontonGo",
      url: `https://www.NontonGo.net/embed/movie/${tmdbId}`,
      lang: "🌎 Multi"
    });
  } else {
    const s = season || 1;
    const e = episode || 1;
    sources.push({
      name: "SuperEmbed (LAT)",
      url: `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`,
      lang: "🌎 Latino"
    });
    sources.push({
      name: "2Embed",
      url: `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`,
      lang: "🌎 ES/LAT"
    });
    sources.push({
      name: "AutoEmbed",
      url: `https://autoembed.cc/tv/tmdb/${tmdbId}-${s}-${e}`,
      lang: "🌎 Multi"
    });
    sources.push({
      name: "EmbedSU",
      url: `https://embed.su/embed/tv/${tmdbId}/${s}/${e}`,
      lang: "🌎 Multi"
    });
    sources.push({
      name: "VidSrc",
      url: `https://vidsrc-embed.ru/embed/tv/${tmdbId}?season=${s}&episode=${e}&ds_lang=es`,
      lang: "🇺🇸 EN+subs"
    });
  }

  return sources;
}

// ── Routes ───────────────────────────────────────────────────

// GET /sources?tmdbId=123&type=movie&season=1&episode=1
app.get("/sources", async (req, res) => {
  const { tmdbId, type = "movie", season, episode } = req.query;

  if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido" });

  // Primero devolver los embeds conocidos (instantáneo)
  const embedSources = getEmbedSources(tmdbId, type, season, episode);

  // Intentar scraping en paralelo (puede fallar, no pasa nada)
  const [pelisplus, cuevana, pelishd] = await Promise.allSettled([
    scrapePelisPlus(tmdbId, type, season, episode),
    scrapeCuevana(tmdbId, type, season, episode),
    scrapePelisHD(tmdbId, type, season, episode),
  ]);

  // Agregar fuentes scrapeadas si se encontraron
  const scrapedSources = [];
  [pelisplus, cuevana, pelishd].forEach((result, i) => {
    const names = ["PelisPlus", "Cuevana3", "PelisHD"];
    if (result.status === "fulfilled" && result.value.length > 0) {
      result.value.forEach(url => {
        scrapedSources.push({ name: names[i], url, lang: "🌎 Latino", scraped: true });
      });
    }
  });

  res.json({
    tmdbId,
    type,
    sources: [...scrapedSources, ...embedSources]
  });
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", message: "StreamVault API" }));

app.listen(PORT, () => console.log(`StreamVault backend en puerto ${PORT}`));

const { DateTime } = require("luxon");
const Image = require("@11ty/eleventy-img");
const { EleventyI18nPlugin } = require("@11ty/eleventy");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

// Generate a short hash for filenames (stable per source file, looks random)
function randomHash(src, width, format) {
    const hash = crypto.createHash('md5')
        .update(src + width + format)
        .digest('hex')
        .slice(0, 12);
    return `${hash}.${format}`;
}

// Dominant colour + dimensions of a source image, memoized per build.
// The colour becomes the loading placeholder; the dimensions reserve the
// layout space so nothing jumps when the photo arrives.
const sharp = require("sharp");

// The colour a viewer would name when asked "what colour is this photo?".
// sharp's stats().dominant is a pure pixel-count mode, so dark backgrounds
// always win; instead, score coarse colour bins by saturation and
// mid-lightness (the node-vibrant idea) so a bright dress or red curtain
// beats a big black background. Monochrome photos fall back to their
// most common tone.
function vibrantColor(data, channels) {
    const bins = new Map();
    for (let i = 0; i < data.length; i += channels) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const lightness = (max + min) / 510;
        const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
        const colourfulness = sat * sat * Math.max(0, 1 - Math.abs(lightness - 0.5) * 1.6);
        const score = 0.02 + colourfulness;
        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        let bin = bins.get(key);
        if (!bin) { bin = { score: 0, r: 0, g: 0, b: 0, n: 0 }; bins.set(key, bin); }
        bin.score += score; bin.r += r; bin.g += g; bin.b += b; bin.n++;
    }
    let best = null;
    for (const bin of bins.values()) if (!best || bin.score > best.score) best = bin;
    return {
        r: Math.round(best.r / best.n),
        g: Math.round(best.g / best.n),
        b: Math.round(best.b / best.n),
    };
}

const imageInfoCache = {};
function imageInfo(inputPath) {
    if (!imageInfoCache[inputPath]) {
        imageInfoCache[inputPath] = (async () => {
            const img = sharp(inputPath);
            const [meta, raw] = await Promise.all([
                img.metadata(),
                img.clone().resize(32, 32, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
            ]);
            const c = vibrantColor(raw.data, raw.info.channels);
            return { color: `rgb(${c.r},${c.g},${c.b})`, width: meta.width, height: meta.height };
        })();
    }
    return imageInfoCache[inputPath];
}

// Sources at or below this size are already light enough — recompressing
// them only costs visible quality. Serve them untouched.
const OPTIMIZE_ABOVE_BYTES = 400 * 1024;

// The original's public URL if the file is small enough to serve as-is,
// otherwise null (→ run it through the optimizer).
function passthroughUrl(inputPath) {
    try {
        if (inputPath.startsWith('_input/') && fs.statSync(inputPath).size <= OPTIMIZE_ABOVE_BYTES) {
            return inputPath.slice('_input'.length);
        }
    } catch (e) { /* let the optimizer deal with it */ }
    return null;
}

// Photographer credits, keyed by public image path ("/images/foo.jpg").
// Maintained from the admin media manager (_data/image_credits.json);
// read fresh on every lookup so --serve picks up edits without a restart.
const CREDITS_FILE = path.join(__dirname, "_input", "_data", "image_credits.json");
// URL-decode and Unicode-normalize a path so lookups survive the many
// spellings of one filename (encoded srcs, macOS decomposed accents)
function normalizePathKey(s) {
    try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
    return s.normalize('NFC');
}

function imageCredit(publicSrc) {
    let credits;
    try { credits = JSON.parse(fs.readFileSync(CREDITS_FILE, "utf8")); }
    catch (e) { return null; }
    const wanted = normalizePathKey(publicSrc);
    for (const key of Object.keys(credits)) {
        if (normalizePathKey(key) === wanted) return credits[key];
    }
    return null;
}

function creditHtml(inputPath) {
    if (!inputPath.startsWith('_input/')) return '';
    const name = imageCredit(inputPath.slice('_input'.length));
    if (!name) return '';
    const esc = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<span class="img-credit-line">&copy;&nbsp;${esc}</span>`;
}

async function buildProgressiveImg(inputPath, alt) {
    const info = await imageInfo(inputPath);
    const altEsc = (alt || '').replace(/"/g, '&quot;');
    // A blank SVG at the photo's size keeps the aspect ratio reserved
    const holder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${info.width}' height='${info.height}'%3E%3C/svg%3E`;
    const imgAttrs = `class="prog-img" src="${holder}" width="${info.width}" height="${info.height}" alt="${altEsc}"`;
    const credit = creditHtml(inputPath);

    const original = passthroughUrl(inputPath);
    if (original) {
        return `<div class="prog-img-wrap" style="background-color:${info.color}"><img ${imgAttrs} data-src="${original}" /></div>${credit}`;
    }

    const fullMeta = await Image(inputPath, imageOptions());
    const jpegSrcset = fullMeta.jpeg.map(i => `${i.url} ${i.width}w`).join(', ');
    const fullSrc = fullMeta.jpeg[fullMeta.jpeg.length - 1].url;

    return `<div class="prog-img-wrap" style="background-color:${info.color}"><img ${imgAttrs} data-src="${fullSrc}" data-srcset="${jpegSrcset}" /></div>${credit}`;
}

// Shared image processing options — progressive JPEG, high quality
function imageOptions(widths = [600, 1200, 1800, 2400, 3200]) {
    return {
        widths,
        formats: ["jpeg"],
        sharpJpegOptions: { quality: 82, progressive: true, mozjpeg: true },
        outputDir: "./_site/images/optimized/",
        urlPath: "/images/optimized/",
        filenameFormat: function (id, src, width, format) {
            return randomHash(src, width, format);
        }
    };
}

module.exports = function (eleventyConfig) {
    // Internationalization (i18n)
    eleventyConfig.addPlugin(EleventyI18nPlugin, {
        defaultLanguage: "en",
        errorMode: "allow-fallback"
    });

    // Image optimization shortcode (standard, non-progressive)
    eleventyConfig.addShortcode("image", async function(src, alt = "") {
        if (!src) return "";
        let inputPath = src.startsWith("/") ? `_input${src}` : src;
        const original = passthroughUrl(inputPath);
        if (original) return `<img src="${original}" alt="${alt}" style="max-width: 100%; height: auto;" loading="lazy" decoding="async">`;
        try {
        let metadata = await Image(inputPath, imageOptions());
        let imageAttributes = {
            alt,
            sizes: "(min-width: 1200px) 1200px, (min-width: 600px) 600px, 100vw",
            loading: "lazy",
            decoding: "async",
            style: "max-width: 100%; height: auto;",
        };
        return Image.generateHTML(metadata, imageAttributes);
        } catch(e) {
            return `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto;" loading="lazy">`;
        }
    });

    // Progressive image shortcode — blurry placeholder → full quality crossfade
    eleventyConfig.addShortcode("progressiveImage", async function(src, alt = "") {
        if (!src) return "";
        const inputPath = src.startsWith("/") ? `_input${src}` : src;
        try {
            return await buildProgressiveImg(inputPath, alt);
        } catch(e) {
            return `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;" loading="lazy">`;
        }
    });

    // Photographer credit tag for images rendered without an <img> element
    // (e.g. the about-page gallery's background-image slides)
    eleventyConfig.addShortcode("imageCredit", function(src) {
        return src ? creditHtml(`_input${src}`) : '';
    });

    // Filter for optimized image URL (for background-image etc.)
    eleventyConfig.addFilter("optimizedImageUrl", async function(src) {
        if (!src) return "";
        let inputPath = src.startsWith("/") ? `_input${src}` : src;
        const original = passthroughUrl(inputPath);
        if (original) return original;
        try {
            let metadata = await Image(inputPath, imageOptions([1200]));
            return metadata.jpeg[0].url;
        } catch(e) {
            return src;
        }
    });

    // Passthrough for static files
    eleventyConfig.addPassthroughCopy("_input/admin");
    eleventyConfig.addPassthroughCopy("_input/images");
    eleventyConfig.addPassthroughCopy("_input/css");
    eleventyConfig.addPassthroughCopy("_input/js");
    eleventyConfig.addPassthroughCopy("_input/audio");
    eleventyConfig.addPassthroughCopy("_input/video");
    eleventyConfig.addPassthroughCopy({ "_input/icons": "/" });

    // Helper: get collection with English fallback
    function collectionWithFallback(collection, langGlob, enGlob) {
        const items = collection.getFilteredByGlob(langGlob);
        return items.length > 0 ? items : collection.getFilteredByGlob(enGlob);
    }

    // Filter helper: exclude draft and archived items from public site
    function notHidden(item) {
        return item.data.status !== 'draft' && item.data.status !== 'archived';
    }

    // Collections for highlights per language
    eleventyConfig.addCollection('highlights_en', function(c) {
        return c.getFilteredByGlob('./_input/highlights/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('highlights_nl', function(c) {
        return collectionWithFallback(c, './_input/highlights/nl/*.md', './_input/highlights/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('highlights_fr', function(c) {
        return collectionWithFallback(c, './_input/highlights/fr/*.md', './_input/highlights/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('highlights_de', function(c) {
        return collectionWithFallback(c, './_input/highlights/de/*.md', './_input/highlights/en/*.md').filter(notHidden);
    });

    // Collections for projects per language
    eleventyConfig.addCollection('projects_en', function(c) {
        return c.getFilteredByGlob('./_input/ensembles/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_nl', function(c) {
        return collectionWithFallback(c, './_input/ensembles/nl/*.md', './_input/ensembles/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_fr', function(c) {
        return collectionWithFallback(c, './_input/ensembles/fr/*.md', './_input/ensembles/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_de', function(c) {
        return collectionWithFallback(c, './_input/ensembles/de/*.md', './_input/ensembles/en/*.md').filter(notHidden);
    });

    // Collections for about per language
    eleventyConfig.addCollection('about_en', function(c) {
        return c.getFilteredByGlob('./_input/about/en/*.md');
    });
    eleventyConfig.addCollection('about_nl', function(c) {
        return collectionWithFallback(c, './_input/about/nl/*.md', './_input/about/en/*.md');
    });
    eleventyConfig.addCollection('about_fr', function(c) {
        return collectionWithFallback(c, './_input/about/fr/*.md', './_input/about/en/*.md');
    });
    eleventyConfig.addCollection('about_de', function(c) {
        return collectionWithFallback(c, './_input/about/de/*.md', './_input/about/en/*.md');
    });

    // Collection for concerts — single list (English as source of truth)
    eleventyConfig.addCollection("notes", collection =>
        collection.getFilteredByGlob("./_input/en/notes/*.md").filter(notHidden)
    );

    // Render a markdown file's body straight from disk — used by the
    // localized concert pages, which reuse the English source content
    // without depending on template render order.
    const matter = require('gray-matter');
    // breaks: true — a single Enter in the CMS is a visible line break on the site
    const mdLib = require('markdown-it')({ html: true, breaks: true, linkify: true });
    eleventyConfig.setLibrary('md', mdLib);
    eleventyConfig.addFilter('fileBody', function(inputPath) {
        try { return mdLib.render(matter.read(inputPath).content); }
        catch (e) { return ''; }
    });

    // Localized sibling of an English source file (same filename in the
    // language folder), falling back to the English file itself.
    function localizedRead(enInputPath, lang) {
        const p = enInputPath.replace('/en/', `/${lang}/`);
        try { return matter.read(p); }
        catch (e) { return matter.read(enInputPath); }
    }
    eleventyConfig.addFilter('localizedFront', function(enInputPath, lang) {
        try { return localizedRead(enInputPath, lang).data; }
        catch (e) { return {}; }
    });
    eleventyConfig.addFilter('localizedBody', function(enInputPath, lang) {
        try { return mdLib.render(localizedRead(enInputPath, lang).content); }
        catch (e) { return ''; }
    });

    eleventyConfig.addCollection("concerts", function(collectionApi) {
        return collectionApi.getFilteredByGlob("./_input/en/concerts/*.md").filter(notHidden);
    });

    // Output concerts as JSON for the client-side lists and the detail popup
    eleventyConfig.addShortcode("concertsJson", function(collection) {
        const json = JSON.stringify(collection.map(concert => {
            let body = "";
            try { body = concert.templateContent || ""; } catch (e) { /* not rendered yet — popup falls back to no body */ }
            return {
                title: concert.data.title,
                date: concert.data.date,
                dateEnd: concert.data.date_end || null,
                monthOnly: !!concert.data.month_only,
                place: concert.data.place,
                composers: concert.data.composers,
                collaborators: concert.data.collaborators,
                ticket: concert.data.link || null,
                featured: !!concert.data.featured,
                body: body,
                link: concert.url
            };
        }));
        // "</" would end the surrounding <script> block
        return json.replace(/<\//g, '<\\/');
    });

    // Full concert date display: month-only → "August 2026"; range → "12 – 16 August 2026"
    // `lang` localizes month and weekday names (defaults to English).
    eleventyConfig.addFilter("concertDate", (dateObj, dateEnd, monthOnly, lang) => {
        if (!dateObj) return "";
        const locale = lang || 'en';
        const toDt = d => (d instanceof Date
            ? DateTime.fromJSDate(d, { zone: 'UTC' })
            : DateTime.fromISO(String(d), { zone: 'UTC' })).setLocale(locale);
        const dt = toDt(dateObj);
        if (!dt.isValid) return "";
        if (monthOnly) return dt.toFormat("LLLL y");
        if (dateEnd) {
            const end = toDt(dateEnd);
            if (end.isValid) {
                if (dt.hasSame(end, 'month')) return `${dt.toFormat("d")} – ${end.toFormat("d LLLL y")}`;
                if (dt.hasSame(end, 'year')) return `${dt.toFormat("d LLLL")} – ${end.toFormat("d LLLL y")}`;
                return `${dt.toFormat("d LLLL y")} – ${end.toFormat("d LLLL y")}`;
            }
        }
        const formatted = dt.toFormat("cccc d LLLL y — HH:mm");
        return formatted.endsWith("00:00") ? formatted.replace(" — 00:00", "") : formatted;
    });

    // Date filters
    eleventyConfig.addFilter("readableDate", dateObj => {
        if (!dateObj) return "";
        const dt = dateObj instanceof Date
            ? DateTime.fromJSDate(dateObj, { zone: 'UTC' })
            : DateTime.fromISO(String(dateObj), { zone: 'UTC' });
        if (!dt.isValid) return "";
        const formatted = dt.toFormat("cccc LLLL d, y — HH:mm");
        return formatted.endsWith("00:00") ? formatted.replace(" — 00:00", "") : formatted;
    });

    eleventyConfig.addFilter("shortDate", dateObj => {
        if (!dateObj) return "";
        const dt = dateObj instanceof Date
            ? DateTime.fromJSDate(dateObj, { zone: 'UTC' })
            : DateTime.fromISO(String(dateObj), { zone: 'UTC' });
        if (!dt.isValid) return "";
        return dt.toFormat("d LLL y");
    });

    eleventyConfig.addFilter("machineDate", dateObj => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(dateObj).toUTC().toFormat("yyyy-MM-dd HH:mm:ss Z");
    });

    eleventyConfig.addFilter("isoDate", dateObj => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(dateObj).toUTC().toISO();
    });

    // Transform: replace plain <img src="/images/..."> with progressive loading version
    eleventyConfig.addTransform("optimizeMarkdownImages", async function(content) {
        if (!this.outputPath || !this.outputPath.endsWith(".html")) return content;
        const imgRegex = /<img\s+[^>]*src="(\/images\/[^"]+)"[^>]*alt="([^"]*)"[^>]*>/g;
        let match;
        const replacements = [];
        while ((match = imgRegex.exec(content)) !== null) {
            const [fullMatch, src, alt] = match;
            if (fullMatch.includes('prog-img')) continue; // already progressive
            try {
                const replacement = await buildProgressiveImg(`_input${src}`, alt);
                replacements.push({ original: fullMatch, replacement });
            } catch(e) {
                // Keep original if optimization fails
            }
        }
        for (const { original, replacement } of replacements) {
            content = content.replace(original, replacement);
        }
        return content;
    });

    // Configuration
    return {
        dir: {
            input: "_input",
            output: "_site",
            data: '_data',
            includes: '_includes',
        },
        templateFormats: ["html", "md", "liquid", "njk"],
        markdownTemplateEngine: "liquid"
    };
};

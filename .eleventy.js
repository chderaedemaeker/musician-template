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

// Tiny placeholder options (20px wide, very low quality — used as inline data URI)
function placeholderOptions() {
    return {
        widths: [20],
        formats: ["jpeg"],
        sharpJpegOptions: { quality: 20 },
        outputDir: "./_site/images/optimized/",
        urlPath: "/images/optimized/",
        filenameFormat: (id, src, width, format) => randomHash(src + '_thumb', width, format),
    };
}

async function buildProgressiveImg(inputPath, alt) {
    const thumbMeta = await Image(inputPath, placeholderOptions());
    const thumbB64 = fs.readFileSync(thumbMeta.jpeg[0].outputPath).toString('base64');
    const placeholder = `data:image/jpeg;base64,${thumbB64}`;

    const fullMeta = await Image(inputPath, imageOptions());
    const jpegSrcset = fullMeta.jpeg.map(i => `${i.url} ${i.width}w`).join(', ');
    const fullSrc = fullMeta.jpeg[fullMeta.jpeg.length - 1].url;

    const altEsc = (alt || '').replace(/"/g, '&quot;');
    return `<div class="prog-img-wrap"><img class="prog-img" src="${placeholder}" data-src="${fullSrc}" data-srcset="${jpegSrcset}" alt="${altEsc}" /></div>`;
}

// Shared image processing options — progressive JPEG, high quality
function imageOptions(widths = [600, 1200, 1800]) {
    return {
        widths,
        formats: ["jpeg"],
        sharpJpegOptions: { quality: 100, progressive: true, mozjpeg: false },
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

    // Filter for optimized image URL (for background-image etc.)
    eleventyConfig.addFilter("optimizedImageUrl", async function(src) {
        if (!src) return "";
        let inputPath = src.startsWith("/") ? `_input${src}` : src;
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
        return c.getFilteredByGlob('./_input/projects/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_nl', function(c) {
        return collectionWithFallback(c, './_input/projects/nl/*.md', './_input/projects/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_fr', function(c) {
        return collectionWithFallback(c, './_input/projects/fr/*.md', './_input/projects/en/*.md').filter(notHidden);
    });
    eleventyConfig.addCollection('projects_de', function(c) {
        return collectionWithFallback(c, './_input/projects/de/*.md', './_input/projects/en/*.md').filter(notHidden);
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
    eleventyConfig.addCollection("concerts", function(collectionApi) {
        return collectionApi.getFilteredByGlob("./_input/en/concerts/*.md");
    });

    // Output concerts as JSON for Swiper
    eleventyConfig.addShortcode("concertsJson", function(collection) {
        return JSON.stringify(collection.map(concert => {
            return {
                title: concert.data.title,
                date: concert.data.date,
                place: concert.data.place,
                composers: concert.data.composers,
                collaborators: concert.data.collaborators,
                link: concert.url
            };
        }));
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

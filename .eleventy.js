const { DateTime } = require("luxon");
const Image = require("@11ty/eleventy-img");
const { EleventyI18nPlugin } = require("@11ty/eleventy");
const path = require("path");

module.exports = function (eleventyConfig) {
    // Internationalization (i18n)
    eleventyConfig.addPlugin(EleventyI18nPlugin, {
        defaultLanguage: "en",
        errorMode: "allow-fallback"
    });

    // Image optimization shortcode
    eleventyConfig.addShortcode("image", async function(src, alt = "") {
        if (!src) return "";
        let inputPath = src.startsWith("/") ? `_input${src}` : src;
        try {
        let metadata = await Image(inputPath, {
            widths: [600, 1200, 1800],
            formats: ["webp", "jpeg"],
            sharpWebpOptions: { quality: 85 },
            sharpJpegOptions: { quality: 85 },
            outputDir: "./_site/images/optimized/",
            urlPath: "/images/optimized/",
            filenameFormat: function (id, src, width, format) {
                const name = path.basename(src, path.extname(src));
                return `${name}-${width}.${format}`;
            }
        });
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

    // Filter for optimized image URL (for background-image etc.)
    eleventyConfig.addFilter("optimizedImageUrl", async function(src) {
        if (!src) return "";
        let inputPath = src.startsWith("/") ? `_input${src}` : src;
        try {
            let metadata = await Image(inputPath, {
                widths: [1200],
                formats: ["webp"],
                sharpWebpOptions: { quality: 85 },
                outputDir: "./_site/images/optimized/",
                urlPath: "/images/optimized/",
                filenameFormat: function (id, src, width, format) {
                    const name = path.basename(src, path.extname(src));
                    return `${name}-${width}.${format}`;
                }
            });
            return metadata.webp[0].url;
        } catch(e) {
            return src;
        }
    });

    // Passthrough for static files
    eleventyConfig.addPassthroughCopy("_input/admin");
    eleventyConfig.addPassthroughCopy("_input/images");
    eleventyConfig.addPassthroughCopy("_input/css");

    // Collections for highlights per language
    eleventyConfig.addCollection('highlights_en', function(collection) {
        return collection.getFilteredByGlob('./_input/highlights/en/*.md');
    });
    eleventyConfig.addCollection('highlights_nl', function(collection) {
        return collection.getFilteredByGlob('./_input/highlights/nl/*.md');
    });
    eleventyConfig.addCollection('highlights_fr', function(collection) {
        return collection.getFilteredByGlob('./_input/highlights/fr/*.md');
    });

    // Collections for projects per language
    eleventyConfig.addCollection('projects_en', function(collection) {
        return collection.getFilteredByGlob('./_input/projects/en/*.md');
    });
    eleventyConfig.addCollection('projects_nl', function(collection) {
        return collection.getFilteredByGlob('./_input/projects/nl/*.md');
    });
    eleventyConfig.addCollection('projects_fr', function(collection) {
        return collection.getFilteredByGlob('./_input/projects/fr/*.md');
    });

    // Collections for about per language
    eleventyConfig.addCollection('about_en', function(collection) {
        return collection.getFilteredByGlob('./_input/about/en/*.md');
    });
    eleventyConfig.addCollection('about_nl', function(collection) {
        return collection.getFilteredByGlob('./_input/about/nl/*.md');
    });
    eleventyConfig.addCollection('about_fr', function(collection) {
        return collection.getFilteredByGlob('./_input/about/fr/*.md');
    });

    // Collection for concerts (all languages in their respective folders)
    eleventyConfig.addCollection("concerts", function(collectionApi) {
        return collectionApi.getFilteredByGlob("./_input/*/concerts/*.md");
    });

    // Output concerts as JSON for Swiper
    eleventyConfig.addShortcode("concertsJson", function(collection) {
        return JSON.stringify(collection.map(concert => {
            return {
                title: concert.data.title,
                date: concert.data.date,
                place: concert.data.place,
                link: concert.url
            };
        }));
    });

    // Date filters
    eleventyConfig.addFilter("readableDate", dateObj => {
        if (!dateObj) return "";
        const dt = DateTime.fromJSDate(dateObj, { zone: 'UTC' });
        const formatted = dt.toFormat("cccc LLLL d, y — HH:mm");
        return formatted.endsWith("00:00") ? formatted.replace(" — 00:00", "") : formatted;
    });

    eleventyConfig.addFilter("shortDate", dateObj => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(dateObj, { zone: 'UTC' }).toFormat("d LLL y");
    });

    eleventyConfig.addFilter("machineDate", dateObj => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(dateObj).toUTC().toFormat("yyyy-MM-dd HH:mm:ss Z");
    });

    eleventyConfig.addFilter("isoDate", dateObj => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(dateObj).toUTC().toISO();
    });

    // Transform markdown images to optimized versions
    eleventyConfig.addTransform("optimizeMarkdownImages", async function(content) {
        if (!this.outputPath || !this.outputPath.endsWith(".html")) return content;
        const imgRegex = /<img\s+[^>]*src="(\/images\/[^"]+)"[^>]*alt="([^"]*)"[^>]*>/g;
        let match;
        const replacements = [];
        while ((match = imgRegex.exec(content)) !== null) {
            const [fullMatch, src, alt] = match;
            try {
                let inputPath = `_input${src}`;
                let metadata = await Image(inputPath, {
                    widths: [600, 1200, 1800],
                    formats: ["webp", "jpeg"],
                    sharpWebpOptions: { quality: 85 },
                    sharpJpegOptions: { quality: 85 },
                    outputDir: "./_site/images/optimized/",
                    urlPath: "/images/optimized/",
                    filenameFormat: function (id, src, width, format) {
                        const name = path.basename(src, path.extname(src));
                        return `${name}-${width}.${format}`;
                    }
                });
                let optimizedHtml = Image.generateHTML(metadata, {
                    alt: alt || "",
                    sizes: "(min-width: 1200px) 1200px, (min-width: 600px) 600px, 100vw",
                    loading: "lazy",
                    decoding: "async",
                    style: "max-width: 100%; height: auto;",
                });
                replacements.push({ original: fullMatch, replacement: optimizedHtml });
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

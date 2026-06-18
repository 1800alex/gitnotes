export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // Favicons / web manifest are served from the site root (matching the
  // /favicon.ico, /site.webmanifest, … links in the page <head>).
  eleventyConfig.addPassthroughCopy({ "src/favicon": "/" });

  eleventyConfig.addPassthroughCopy({
    "node_modules/@fortawesome/fontawesome-free/css/all.min.css":
      "assets/fontawesome/css/all.min.css",
    "node_modules/@fortawesome/fontawesome-free/webfonts":
      "assets/fontawesome/webfonts",
    // Vendored markdown renderer for client-side preview (no CDN dependency).
    "node_modules/marked/marked.min.js": "assets/js/marked.min.js",
    // Syntax highlighting for code blocks (common-languages bundle + dark theme).
    "node_modules/@highlightjs/cdn-assets/highlight.min.js": "assets/js/highlight.min.js",
    "node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css": "assets/css/highlight.css",
  });

  eleventyConfig.addFilter("year", () => new Date().getFullYear());

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}

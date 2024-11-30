import packageJson from './package.json' assert { type: 'json' };
import fs from 'node:fs'
import path from 'node:path'
import { request } from 'undici'

/**
 * Converts a string to kebab-case.
 * @param {string} str - The string to convert to kebab-case
 * @returns The kebab-case version of the string
 */
function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2') // Convert camelCase to kebab-case
    .replace(/[\s_]+/g, '-')             // Replace spaces and underscores with -
    .toLowerCase();                      // Convert the entire string to lowercase
}

console.log(`Google Font Downloader ${packageJson.version}`);

/**
 * @type {string|undefined}
 * The URL of the CSS file to download
 */
const embedUrl = process.argv[2];

if (!embedUrl) {
  console.error('Missing embed URL. The first argument must be the embed URL, e.g. https://fonts.googleapis.com/css2?family=Fira+Sans:ital,wght@0,400;0,600;1,400;1,600&display=swap');
  process.exit(1);
}

/**
 * @type {string|undefined}
 * The target directory to download the fonts to
 */
const targetDir = process.argv[3];

if (!targetDir) {
  console.error('Missing target directory.');
  process.exit(1);
}


// Check if the target directory is empty (if it exists)
if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
  // Ask if the user wants to continue
  const answer = await prompt('The target directory is not empty. Do you want to continue? (y/n)');
  if (answer.toLowerCase() !== 'y') {
    process.exit(0);
  }
}

// Check if the target directory exsists, if not create it
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir);
}

// Also create the fonts subdirectory
if (!fs.existsSync(path.join(targetDir, 'fonts'))) {
  fs.mkdirSync(path.join(targetDir, 'fonts'));
}

// Fetch the CSS file using a recent Chrome user agent
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
const cssFile = await fetch(embedUrl, { headers: { 'User-Agent': userAgent } }).then(res => res.text());

// For each font-face, collect the comment before the @font-face definition, collect the font-style, font-weight and font file URL
const fontFaces = cssFile.matchAll(/\/\*([^*]+)\*\/\s*@font-face\s*{\s*([^}]+)\s*}/g);

let familyName = 'font';
function buildHumanReadableName(fontFamily, fontStyle, fontWeight, comment) {
  // Generate a human-readable name for the font file
  // If the style is normal, it will be omitted
  // If the weight is 400, it will be omitted
  familyName = toKebabCase(fontFamily);
  const styleName = fontStyle === 'normal' ? '' : `-${fontStyle}`;
  const weightName = fontWeight === '400' ? '' : `-${toKebabCase(fontWeight)}`;
  const commentName = comment === 'latin' ? '' : `-${comment}`;

  return `${familyName}${commentName}${styleName}${weightName}.woff2`;
}

/**
 * @typedef {Object} FontFaceData
 * @property {string} fontFamily - The font family name
 * @property {string|undefined} fontStyle - The font style (normal, italic, etc.)
 * @property {string|undefined} fontWeight - The font weight (400, 600, etc.)
 * @property {string|undefined} fontDisplay - The font display (swap, fallback, etc.)
 * @property {string|undefined} fontStretch - The font stretch (normal, wider, narrower, etc.)
 * @property {string|undefined} unicodeRange - The unicode range of the font
 * @property {string} comment - The comment before the @font-face definition  
 */

/**
 * @type {FontFaceData[]}
 * An array of FontFaceData objects, containing the comment, font-family, font-style, font-weight, font-display, unicode-range, font file URL, and human-readable name of each font face
 */
const fontFacesData = [];
for (const fontFace of fontFaces) {
  const comment = fontFace[1].trim();
  const def = fontFace[2].trim();

  const fontFamily = def.match(/font-family:\s*'([^']+)';/)?.[1] ?? 'font';
  const fontStyle = def.match(/font-style:\s*([^;]+);/)?.[1];
  const fontWeight = def.match(/font-weight:\s*([^;]+);/)?.[1];
  const fontStretch = def.match(/font-stretch:\s*([^;]+);/)?.[1];
  const fontDisplay = def.match(/font-display:\s*([^;]+);/)?.[1];
  const unicodeRange = def.match(/unicode-range:\s*([^;]+);/)?.[1];
  fontFacesData.push({
    fontFamily,
    fontStyle,
    fontWeight,
    fontDisplay,
    fontStretch,
    unicodeRange,
    comment,
    fontFileUrl: fontFace[2].match(/url\(([^)]+)\)/)[1],
    humanReadableName: buildHumanReadableName(fontFamily, fontStyle, fontWeight, comment),
  });

}

// Download all the font files using undici
for (const fontFaceData of fontFacesData) {
  const fontFileUrl = fontFaceData.fontFileUrl;
  const fontFileName = fontFaceData.humanReadableName;
  const fontFilePath = path.join(targetDir, 'fonts', fontFileName);

  request(fontFileUrl, { headers: { 'User-Agent': userAgent } }).then(res => {
    const fontFileData = res.body;
    fs.writeFileSync(fontFilePath, fontFileData);
    console.log(`Downloaded ${fontFileName}`);
  });
}

// Get the rest of the CSS file content after the last @font-face definition
// Last @font-face regex
const startOfRest = cssFile.indexOf('body {');
const restCss = startOfRest !== -1 ? cssFile.slice(startOfRest) : '';

// Rebuild the CSS file with the new font-face URLs
let newCssFile = '';
for (const fontFaceData of fontFacesData) {
  newCssFile += `/* ${fontFaceData.comment} */\n`;
  newCssFile += `@font-face {\n`;
  newCssFile += `  font-family: '${fontFaceData.fontFamily}';\n`;
  if (fontFaceData.fontStyle) newCssFile += `  font-style: ${fontFaceData.fontStyle};\n`;
  if (fontFaceData.fontWeight) newCssFile += `  font-weight: ${fontFaceData.fontWeight};\n`;
  if (fontFaceData.fontStretch) newCssFile += `  font-stretch: ${fontFaceData.fontStretch};\n`;
  if (fontFaceData.fontDisplay) newCssFile += `  font-display: ${fontFaceData.fontDisplay};\n`;
  newCssFile += `  src: url(./fonts/${fontFaceData.humanReadableName}) format('woff2');\n`;
  if (fontFaceData.unicodeRange) newCssFile += `  unicode-range: ${fontFaceData.unicodeRange};\n`;
  newCssFile += `}\n`;
}

fs.writeFileSync(path.join(targetDir, `fonts.css`), `${newCssFile}${restCss}`);

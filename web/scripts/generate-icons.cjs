const sharp = require("sharp");
const path = require("node:path");

const svgPath = path.resolve(__dirname, "../public/favicon.svg");
const publicDir = path.resolve(__dirname, "../public");

async function generate() {
  const sizes = [180, 192, 512];

  for (const size of sizes) {
    const outputPath = path.join(publicDir, `icon-${size}x${size}.png`);
    await sharp(svgPath).resize(size, size).png().toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }

  const appleIconPath = path.join(publicDir, "apple-touch-icon.png");
  await sharp(svgPath).resize(180, 180).png().toFile(appleIconPath);
  console.log(`Generated ${appleIconPath}`);
}

generate().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});

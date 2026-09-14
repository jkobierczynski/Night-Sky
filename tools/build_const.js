// Converts constellation line + name data into compact JS data file.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const lines = JSON.parse(fs.readFileSync(path.join(root, 'data', 'const_lines_raw.json'), 'utf8'));
const names = JSON.parse(fs.readFileSync(path.join(root, 'data', 'const_names_raw.json'), 'utf8'));

function radecToVec(raDeg, decDeg) {
  const ra = (((raDeg % 360) + 360) % 360) * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

const arr = [];
let nseg = 0;
for (const f of lines.features) {
  for (const poly of f.geometry.coordinates) {
    for (let i = 0; i < poly.length - 1; i++) {
      const a = radecToVec(poly[i][0], poly[i][1]);
      const b = radecToVec(poly[i + 1][0], poly[i + 1][1]);
      arr.push(...a, ...b);
      nseg++;
    }
  }
}
const f32 = new Float32Array(arr);
const b64 = Buffer.from(f32.buffer).toString('base64');

const nameArr = names.features.map(f => {
  const [ra, dec] = f.geometry.coordinates;
  return `["${f.properties.name.replace(/"/g, '')}",${(((ra % 360) + 360) % 360 * Math.PI / 180).toFixed(5)},${(dec * Math.PI / 180).toFixed(5)},"${f.properties.rank}"]`;
});

const out = `window.CONST_DATA = {\nsegments: ${nseg},\nb64: "${b64}",\nnames: [\n${nameArr.join(',\n')}\n]\n};\n`;
fs.writeFileSync(path.join(root, 'data', 'const_data.js'), out);
console.log(`segments: ${nseg}, names: ${nameArr.length}`);

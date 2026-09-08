// Extracts text from a PDF as an array of reconstructed "lines", clustering
// pdf.js text items by their Y position (and sorting by X within a
// cluster) since these statements are laid out as visual tables, not
// tagged ones — naive reading-order joins would scramble columns.

async function pdfToLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str.trim().length > 0)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));

    // Cluster by Y (rounded to nearest 2px to absorb sub-pixel jitter)
    const clusters = new Map();
    for (const it of items) {
      const key = Math.round(it.y / 3) * 3;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(it);
    }
    // Sort clusters top-to-bottom (pdf.js Y grows upward), then items left-to-right.
    // Within a row, only break into a new "cell" (joined with |) when there's a
    // real gap in X — small gaps are just spaces between words in the same cell.
    const ys = Array.from(clusters.keys()).sort((a, b) => b - a);
    for (const y of ys) {
      const row = clusters.get(y).sort((a, b) => a.x - b.x);
      let line = "";
      let prevEndX = null;
      for (const r of row) {
        const gap = prevEndX === null ? 0 : r.x - prevEndX;
        if (prevEndX === null) {
          line += r.str;
        } else if (gap > 12) {
          line += " | " + r.str;
        } else {
          line += (gap > 1.5 ? " " : "") + r.str;
        }
        prevEndX = r.x + r.str.length * 5; // rough width estimate
      }
      allLines.push(line.replace(/\s+/g, " ").trim());
    }
    allLines.push("---PAGE-BREAK---");
  }
  return allLines;
}

window.pdfToLines = pdfToLines;
